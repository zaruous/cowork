'use strict';

/**
 * openrouter-client.js — OpenRouter Chat Completions 얇은 클라이언트
 *
 * Claude·Codex·Cursor 러너는 CLI/SDK가 대화 기록을 서버에 들고 있어서
 * 상태 파일에 세션 id만 적어두면 재개가 됐다. OpenRouter는 상태가 없는
 * HTTP API라 messages 배열 자체를 로컬에 보관하고 매 턴 전부 다시 보내야 한다.
 * 그 차이만 이 모듈이 흡수하고, 러너 쪽 구조(상태 파일 + 마크다운 로그 + 프롬프트 루프)는
 * 기존 3종과 동일하게 맞춘다.
 *
 * 공식 SDK(@openrouter/sdk)는 ESM 전용("type": "module") + zod 의존성이라
 * CommonJS 저장소에서 그대로 require 할 수 없다. 그래서 SDK가 감싸는 것과 같은
 * REST 엔드포인트(POST /chat/completions)를 fetch 로 직접 호출한다. 의존성 0.
 * SDK 샘플의 chunk.usage.completionTokensDetails.reasoningTokens 는
 * REST 에서 usage.completion_tokens_details.reasoning_tokens 로 온다.
 *
 * 참고: https://openrouter.ai/docs/api-reference/chat-completion
 *       https://openrouter.ai/stealth/ox-alpha?view=api
 */

// .env 를 process.env 에 올린다(셸 환경변수가 우선). require 시점 1회.
require('./load-env').load();

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'stealth/ox-alpha';
const DEFAULT_TIMEOUT_MS = 300_000; // reasoning=max 는 느리다. 300초.
const DEFAULT_MAX_RETRIES = 2;
// 재시도해도 되는 상태코드. 4xx 중에서도 429/408은 일시적이다.
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

class OpenRouterError extends Error {
  constructor(message, { status = null, code = null, body = null, retryable = false } = {}) {
    super(message);
    this.name = 'OpenRouterError';
    this.status = status;
    this.code = code;
    this.body = body;
    this.retryable = retryable;
  }
}

function resolveApiKey(explicit) {
  const key = String(explicit || process.env.OPENROUTER_API_KEY || '').trim();
  return key || null;
}

/** 상태코드별 한국어 힌트. 원인이 키/크레딧/모델id 중 무엇인지 바로 알 수 있게. */
function hintForStatus(status) {
  switch (status) {
    case 401:
    case 403:
      return 'OPENROUTER_API_KEY가 유효하지 않습니다. https://openrouter.ai/keys 에서 확인하세요.';
    case 402:
      return 'OpenRouter 크레딧이 부족합니다.';
    case 404:
      return '모델 id를 찾을 수 없습니다. /models 로 사용 가능한 id를 확인하세요.';
    case 429:
      return '요청이 제한됐습니다(rate limit). 잠시 후 다시 시도하세요.';
    default:
      return '';
  }
}

function extractErrorMessage(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  const err = payload.error || payload;
  if (typeof err === 'string') return err;
  if (typeof err.message === 'string') return err.message;
  // provider 쪽 원문이 metadata.raw 로 들어오는 경우가 있다.
  const raw = err.metadata && err.metadata.raw;
  if (typeof raw === 'string') return raw;
  return '';
}

function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const completionDetails = raw.completion_tokens_details || {};
  const promptDetails = raw.prompt_tokens_details || {};
  return {
    promptTokens: Number(raw.prompt_tokens || 0),
    completionTokens: Number(raw.completion_tokens || 0),
    totalTokens: Number(raw.total_tokens || 0),
    // reasoning 모델은 완료 토큰 안에 추론 토큰이 섞여 온다(ox-alpha 는 reasoning 필수).
    reasoningTokens: Number(completionDetails.reasoning_tokens || 0),
    cachedTokens: Number(promptDetails.cached_tokens || 0),
    // 무료 모델(ox-alpha 등)은 0으로 온다.
    cost: Number(raw.cost || 0),
  };
}

/** 비스트리밍 응답의 tool_calls 를 {id, name, arguments} 형태로 통일한다. */
function normalizeToolCalls(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((call, index) => ({
      id: call.id || `call_${index}`,
      name: (call.function && call.function.name) || '',
      arguments: (call.function && call.function.arguments) || '',
    }))
    .filter(call => call.name);
}

function emptyUsage() {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    cost: 0,
  };
}

function addUsage(target, delta) {
  const base = target || emptyUsage();
  if (!delta) return base;
  return {
    promptTokens: base.promptTokens + Number(delta.promptTokens || 0),
    completionTokens: base.completionTokens + Number(delta.completionTokens || 0),
    totalTokens: base.totalTokens + Number(delta.totalTokens || 0),
    reasoningTokens: Number(base.reasoningTokens || 0) + Number(delta.reasoningTokens || 0),
    cachedTokens: Number(base.cachedTokens || 0) + Number(delta.cachedTokens || 0),
    cost: base.cost + Number(delta.cost || 0),
  };
}

/**
 * 외부 signal(Ctrl+C)과 자체 타임아웃을 하나로 묶는다.
 * AbortSignal.any 는 Node 20+ 라서 직접 합친다(이 저장소 요구사항은 Node 18+).
 */
function combineSignals(external, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(
      new OpenRouterError(`응답 시간 초과 (${Math.round(timeoutMs / 1000)}초)`, { retryable: true }),
    );
  }, timeoutMs);

  const onAbort = () => controller.abort(external.reason);
  if (external) {
    if (external.aborted) onAbort();
    else external.addEventListener('abort', onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      if (external) external.removeEventListener('abort', onAbort);
    },
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class OpenRouterClient {
  constructor(options = {}) {
    const apiKey = resolveApiKey(options.apiKey);
    if (!apiKey) {
      throw new OpenRouterError(
        'OPENROUTER_API_KEY 가 없습니다. .env.example 을 .env 로 복사해 키를 넣거나 환경변수로 지정하세요.',
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = String(options.baseUrl || process.env.OPENROUTER_BASE_URL || DEFAULT_BASE_URL)
      .replace(/\/+$/, '');
    this.model = String(options.model || DEFAULT_MODEL);
    this.timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
    this.maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : DEFAULT_MAX_RETRIES;
    // null 이면 파라미터를 아예 보내지 않는다(모델 기본값 사용).
    this.temperature = options.temperature ?? null;
    this.topP = options.topP ?? null;
    this.maxTokens = options.maxTokens ?? null;
    this.reasoningEffort = options.reasoningEffort ?? null; // 'low' | 'high' | 'max'
    this.includeReasoning = options.includeReasoning !== false;
    // 함수 호출. 도구 실행은 호출자 몫이고 여기선 정의 전달과 tool_calls 회수만 한다.
    this.tools = options.tools ?? null;
    this.toolChoice = options.toolChoice ?? 'auto';
    // OpenRouter 순위표에 표시되는 출처 헤더. 없어도 동작한다.
    this.title = String(options.title || process.env.OPENROUTER_SITE_NAME || 'coworks');
    this.referer = String(options.referer || process.env.OPENROUTER_SITE_URL || '');
  }

  buildHeaders(extra = {}) {
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...extra,
    };
    if (this.title) headers['X-Title'] = this.title;
    if (this.referer) headers['HTTP-Referer'] = this.referer;
    return headers;
  }

  buildBody(messages, { stream = false, tools = undefined } = {}) {
    const body = {
      model: this.model,
      messages,
      stream,
      // 스트리밍에서도 마지막 청크로 usage 를 받는다.
      usage: { include: true },
    };
    if (this.temperature !== null) body.temperature = this.temperature;
    if (this.topP !== null) body.top_p = this.topP;
    if (this.maxTokens !== null) body.max_tokens = this.maxTokens;
    if (this.reasoningEffort) body.reasoning = { effort: this.reasoningEffort };
    if (this.includeReasoning) body.include_reasoning = true;
    const effectiveTools = tools === undefined ? this.tools : tools;
    if (Array.isArray(effectiveTools) && effectiveTools.length) {
      body.tools = effectiveTools;
      body.tool_choice = this.toolChoice;
    }
    return body;
  }

  /**
   * 한 턴 호출. onDelta/onReasoning 이 있으면 스트리밍으로 받는다.
   * tools 를 주면 모델이 tool_calls 를 돌려줄 수 있고, 그 경우 text 는 비어 있을 수 있다.
   * @returns {Promise<{text: string, reasoning: string, toolCalls: Array, usage: object|null,
   *                    id: string|null, model: string, finishReason: string|null}>}
   */
  async complete({
    messages, stream = false, onDelta = null, onReasoning = null, signal = null, tools = undefined,
  } = {}) {
    if (!Array.isArray(messages) || !messages.length) {
      throw new OpenRouterError('보낼 messages 가 비어 있습니다.');
    }
    const wantStream = Boolean(stream || onDelta || onReasoning);

    let lastError = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return wantStream
          ? await this.requestStream(messages, { onDelta, onReasoning, signal, tools })
          : await this.requestOnce(messages, { signal, tools });
      } catch (error) {
        lastError = error;
        const aborted = Boolean(signal && signal.aborted);
        if (aborted || !error.retryable || attempt === this.maxRetries) throw error;
        // 429는 Retry-After 를 존중하고, 나머지는 지수 백오프.
        const waitMs = error.retryAfterMs || Math.min(8000, 500 * 2 ** attempt);
        await sleep(waitMs);
      }
    }
    throw lastError;
  }

  async fetchJson(pathname, init, signal) {
    const { signal: merged, cleanup } = combineSignals(signal, this.timeoutMs);
    try {
      return await fetch(`${this.baseUrl}${pathname}`, { ...init, signal: merged });
    } catch (error) {
      if (error instanceof OpenRouterError) throw error;
      // AbortController.abort(reason) 로 넣어둔 타임아웃 에러를 되살린다.
      if (error.name === 'AbortError') {
        const reason = merged.reason;
        if (reason instanceof OpenRouterError) throw reason;
        throw new OpenRouterError('요청이 중단됐습니다.');
      }
      throw new OpenRouterError(`OpenRouter 요청 실패: ${error.message}`, { retryable: true });
    } finally {
      cleanup();
    }
  }

  async ensureOk(response) {
    if (response.ok) return;
    const text = await response.text().catch(() => '');
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      // 본문이 JSON이 아닐 수 있다(게이트웨이 HTML 등).
    }
    const detail = extractErrorMessage(payload) || text.trim().slice(0, 400) || response.statusText;
    const hint = hintForStatus(response.status);
    const error = new OpenRouterError(
      `HTTP ${response.status} — ${detail}${hint ? ` (${hint})` : ''}`,
      {
        status: response.status,
        code: payload && payload.error && payload.error.code,
        body: payload || text,
        retryable: RETRYABLE_STATUS.has(response.status),
      },
    );
    const retryAfter = Number(response.headers.get('retry-after') || 0);
    if (retryAfter > 0) error.retryAfterMs = retryAfter * 1000;
    throw error;
  }

  async requestOnce(messages, { signal, tools }) {
    const response = await this.fetchJson('/chat/completions', {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(this.buildBody(messages, { stream: false, tools })),
    }, signal);
    await this.ensureOk(response);

    const payload = await response.json();
    // OpenRouter는 200 으로 error 를 실어 보내는 경우가 있다(모더레이션 등).
    if (payload.error) {
      throw new OpenRouterError(extractErrorMessage(payload) || 'OpenRouter 응답 오류', { body: payload });
    }
    const choice = (payload.choices || [])[0];
    if (!choice) {
      throw new OpenRouterError('OpenRouter 응답에 choices 가 없습니다.', { body: payload });
    }
    const message = choice.message || {};
    const text = String(message.content || '').trim();
    const toolCalls = normalizeToolCalls(message.tool_calls);
    // 도구를 부르는 턴은 content 가 null 로 온다. 그건 빈 응답이 아니다.
    if (!text && !toolCalls.length) {
      throw new OpenRouterError('OpenRouter가 빈 응답을 반환했습니다.', { retryable: true, body: payload });
    }
    return {
      text,
      reasoning: String(message.reasoning || '').trim(),
      toolCalls,
      usage: normalizeUsage(payload.usage),
      id: payload.id || null,
      model: payload.model || this.model,
      finishReason: choice.finish_reason || choice.native_finish_reason || null,
    };
  }

  async requestStream(messages, { onDelta, onReasoning, signal, tools }) {
    const response = await this.fetchJson('/chat/completions', {
      method: 'POST',
      headers: this.buildHeaders({ Accept: 'text/event-stream' }),
      body: JSON.stringify(this.buildBody(messages, { stream: true, tools })),
    }, signal);
    await this.ensureOk(response);
    if (!response.body) {
      throw new OpenRouterError('스트리밍 응답 본문이 비어 있습니다.', { retryable: true });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let reasoning = '';
    let usage = null;
    let id = null;
    let model = this.model;
    let finishReason = null;
    let streamError = null;
    // tool_calls 는 index 별로 쪼개져 온다.
    // 첫 조각에 id/name 이 있고, 뒤 조각들은 arguments 문자열만 이어 붙인다(병렬 호출 가능).
    const toolCallsByIndex = new Map();

    const handleEvent = payload => {
      if (payload.error) {
        streamError = new OpenRouterError(
          extractErrorMessage(payload) || 'OpenRouter 스트림 오류',
          { body: payload },
        );
        return;
      }
      if (payload.id) id = payload.id;
      if (payload.model) model = payload.model;
      if (payload.usage) usage = normalizeUsage(payload.usage);
      const choice = (payload.choices || [])[0];
      if (!choice) return;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta || {};
      if (typeof delta.reasoning === 'string' && delta.reasoning) {
        reasoning += delta.reasoning;
        if (onReasoning) onReasoning(delta.reasoning);
      }
      if (typeof delta.content === 'string' && delta.content) {
        text += delta.content;
        if (onDelta) onDelta(delta.content);
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const call of delta.tool_calls) {
          const key = Number.isInteger(call.index) ? call.index : toolCallsByIndex.size;
          const entry = toolCallsByIndex.get(key) || { id: null, name: '', arguments: '' };
          if (call.id) entry.id = call.id;
          if (call.function && call.function.name) entry.name = call.function.name;
          if (call.function && typeof call.function.arguments === 'string') {
            entry.arguments += call.function.arguments;
          }
          toolCallsByIndex.set(key, entry);
        }
      }
    };

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
          buffer = buffer.slice(newlineIndex + 1);
          newlineIndex = buffer.indexOf('\n');
          if (!line) continue;
          // OpenRouter는 처리 중 ": OPENROUTER PROCESSING" 주석을 keep-alive 로 보낸다.
          if (line.startsWith(':')) continue;
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          let payload;
          try {
            payload = JSON.parse(data);
          } catch {
            continue; // 해석 불가한 청크는 건너뛴다(스트림 자체는 계속).
          }
          handleEvent(payload);
          if (streamError) throw streamError;
        }
      }
    } catch (error) {
      try {
        await reader.cancel();
      } catch {
        // 이미 닫혔으면 무시
      }
      if (error instanceof OpenRouterError) throw error;
      if (error.name === 'AbortError') throw new OpenRouterError('요청이 중단됐습니다.');
      throw new OpenRouterError(`스트림 읽기 실패: ${error.message}`, { retryable: true });
    }

    const toolCalls = [...toolCallsByIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, entry]) => ({
        id: entry.id || `call_${index}`,
        name: entry.name,
        arguments: entry.arguments,
      }))
      .filter(call => call.name);

    // 도구를 부르는 턴은 본문이 비어 있다. 그건 빈 응답이 아니다.
    if (!text.trim() && !toolCalls.length) {
      throw new OpenRouterError('OpenRouter가 빈 응답을 반환했습니다.', { retryable: true });
    }
    return {
      text: text.trim(),
      reasoning: reasoning.trim(),
      toolCalls,
      usage,
      id,
      model,
      finishReason,
    };
  }

  /** 모델 목록. query 가 있으면 id/name 부분일치로 걸러 준다. */
  async listModels({ query = '', signal = null } = {}) {
    const response = await this.fetchJson('/models', { headers: this.buildHeaders() }, signal);
    await this.ensureOk(response);
    const payload = await response.json();
    const rows = (payload.data || []).map(item => ({
      id: item.id,
      name: item.name,
      contextLength: item.context_length,
      promptPrice: item.pricing && item.pricing.prompt,
      completionPrice: item.pricing && item.pricing.completion,
    }));
    if (!query) return rows;
    const needle = String(query).toLowerCase();
    return rows.filter(row => `${row.id} ${row.name}`.toLowerCase().includes(needle));
  }
}

module.exports = {
  OpenRouterClient,
  OpenRouterError,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
  resolveApiKey,
  normalizeUsage,
  emptyUsage,
  addUsage,
};
