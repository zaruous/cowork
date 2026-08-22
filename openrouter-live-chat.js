'use strict';

/**
 * openrouter-live-chat.js — OpenRouter 라이브 챗 (기본 모델 stealth/ox-alpha)
 *
 * claude/codex/cursor-live-chat.js 와 같은 골격이다.
 *   상태 파일(.openrouter-session.json) + 마크다운 로그(openrouter-live-chat.md) + `나 > ` 루프
 *
 * 다른 점 하나: OpenRouter는 세션이 없는 HTTP API다.
 * 다른 러너의 상태 파일에는 서버 세션 id만 들어가지만, 여기에는 **대화 기록 전체**가 들어간다.
 * 그래서 이 파일이 곧 세션이고, 커밋하면 대화 내용이 그대로 새어 나간다(.gitignore 대상).
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const {
  OpenRouterClient,
  OpenRouterError,
  DEFAULT_MODEL,
  addUsage,
  emptyUsage,
} = require('./openrouter-client');
const { createToolbox } = require('./openrouter-tools');

const STATE_PATH = path.join(__dirname, '.openrouter-session.json');
const LOG_PATH = path.join(__dirname, 'openrouter-live-chat.md');
const EXIT_COMMANDS = new Set(['/exit', '/quit', '종료']);
const NEW_SESSION_COMMAND = '/new';
const VALID_EFFORTS = new Set(['low', 'high', 'max']);
// 매 턴 다시 보내는 대화 기록의 상한(메시지 수). ox-alpha 는 1M 컨텍스트지만
// 무제한으로 늘리면 지연·비용이 라운드에 비례해 커진다.
const DEFAULT_MAX_HISTORY = 40;
const MAX_ATTACHMENT_CHARS = 400_000;
// 한 턴에서 허용할 도구 왕복 횟수. 무한 루프 방지용 상한.
const DEFAULT_MAX_TOOL_STEPS = 12;

const DEFAULT_SYSTEM_PROMPT = String(
  process.env.OPENROUTER_SYSTEM
  || '너는 coworks CLI에서 동작하는 코딩 어시스턴트다. 별도 요청이 없으면 한국어로 답한다.',
).trim();

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

// --raw 에서는 stdout 에 모델 응답만 흘려보내고 안내·상태는 stderr 로 보낸다
// (`node openrouter-live-chat.js --raw --prompt ... > answer.md` 가 되도록).
let RAW_MODE = false;
const info = (...args) => {
  if (RAW_MODE) process.stderr.write(`${args.join(' ')}\n`);
  else process.stdout.write(`${args.join(' ')}\n`);
};

const HELP = `
openrouter-live-chat — OpenRouter 라이브 챗 (기본 ${DEFAULT_MODEL})

사용법: node openrouter-live-chat.js [옵션]

  --new                  이전 대화 기록을 버리고 새 세션으로 시작
  --model <id>           모델 id (기본 OPENROUTER_MODEL 또는 ${DEFAULT_MODEL})
  --effort <low|high|max>  reasoning effort (기본 OPENROUTER_EFFORT, 미지정 시 모델 기본값)
  --cwd <path>           파일 도구가 접근할 디렉터리 (기본 이 스크립트 폴더)
  --no-tools             파일 도구 없이 순수 채팅으로 실행
  --allow-write          write_file 도구 허용 (기본 읽기 전용)
  --max-tool-steps <n>   한 턴에서 허용할 도구 왕복 횟수 (기본 ${DEFAULT_MAX_TOOL_STEPS})
  --system <text>        시스템 프롬프트 지정
  --system-file <path>   시스템 프롬프트를 파일에서 읽기
  --prompt <text>        한 턴만 실행하고 종료 (비대화형)
  --prompt-file <path>   파일 내용을 그대로 한 턴 보내고 종료 (비대화형)
  --raw                  응답 본문만 stdout 으로 (안내·도구 로그는 stderr) — 파이프용
  --max-history <n>      매 턴 재전송할 메시지 수 상한 (기본 ${DEFAULT_MAX_HISTORY})
  --max-tokens <n>       응답 토큰 상한
  --temperature <n>      샘플링 온도
  --no-stream            스트리밍 끄기 (응답을 한 번에 받음)
  --show-reasoning       추론 과정도 출력·기록
  -h, --help             도움말

환경변수: OPENROUTER_API_KEY(필수), OPENROUTER_MODEL, OPENROUTER_EFFORT,
          OPENROUTER_SYSTEM, OPENROUTER_TIMEOUT(초), OPENROUTER_BASE_URL,
          OPENROUTER_CHAT_CWD(파일 도구 작업 디렉터리)
`;

const SLASH_HELP = `
사용 가능한 명령:
  /new                 대화 기록을 버리고 새 세션
  /exit, /quit, 종료   종료 (다음 실행 시 이어서 대화)
  /model [id]          모델 확인 / 변경
  /models [검색어]     OpenRouter 모델 목록 조회
  /effort [low|high|max|off]  reasoning effort 확인 / 변경
  /system [text]       시스템 프롬프트 확인 / 변경
  /reasoning           추론 과정 출력 토글
  /stream              스트리밍 토글
  /tools               파일 도구 상태(작업 디렉터리·목록·쓰기 권한)
  /file [path]         다음 메시지에 파일 내용 첨부 (인자 없으면 첨부 취소)
  /history [n]         최근 n턴 다시 보기 (기본 5)
  /undo                마지막 1턴(내 질문 + 응답)을 기록에서 제거
  /usage               누적 토큰 사용량
  /help                이 목록
`;

// ── 인자 파싱 ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    forceNew: false,
    model: String(process.env.OPENROUTER_MODEL || DEFAULT_MODEL).trim(),
    effort: String(process.env.OPENROUTER_EFFORT || '').trim().toLowerCase() || null,
    system: null,
    prompt: null,
    maxHistory: DEFAULT_MAX_HISTORY,
    maxTokens: null,
    temperature: null,
    stream: true,
    showReasoning: false,
    help: false,
    cwd: String(process.env.OPENROUTER_CHAT_CWD || '').trim() || __dirname,
    useTools: true,
    allowWrite: false,
    maxToolSteps: DEFAULT_MAX_TOOL_STEPS,
    raw: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} 옵션에 값이 필요합니다.`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--new':
        opts.forceNew = true;
        break;
      case '--model':
        opts.model = next().trim();
        break;
      case '--effort': {
        const value = next().trim().toLowerCase();
        if (!VALID_EFFORTS.has(value)) {
          throw new Error(`--effort 는 low|high|max 중 하나여야 합니다: ${value}`);
        }
        opts.effort = value;
        break;
      }
      case '--system':
        opts.system = next();
        break;
      case '--system-file':
        opts.system = fs.readFileSync(path.resolve(next()), 'utf8').trim();
        break;
      case '--prompt':
        opts.prompt = next();
        break;
      case '--prompt-file': {
        const file = path.resolve(next());
        if (!fs.existsSync(file)) throw new Error(`프롬프트 파일이 없습니다: ${file}`);
        const body = fs.readFileSync(file, 'utf8').trim();
        if (!body) throw new Error('프롬프트 파일이 비어 있습니다.');
        // Claude 러너는 파일 경로만 넘기고 에이전트가 Read 도구로 읽지만,
        // OpenRouter는 도구가 없으므로 본문을 그대로 메시지에 담는다.
        opts.prompt = body;
        opts.promptFile = file;
        break;
      }
      case '--max-history':
        opts.maxHistory = Math.max(2, parseInt(next(), 10) || DEFAULT_MAX_HISTORY);
        break;
      case '--max-tokens':
        opts.maxTokens = Math.max(1, parseInt(next(), 10) || 0) || null;
        break;
      case '--temperature':
        opts.temperature = Number(next());
        break;
      case '--cwd':
        opts.cwd = next();
        break;
      case '--no-tools':
        opts.useTools = false;
        break;
      case '--allow-write':
        opts.allowWrite = true;
        break;
      case '--max-tool-steps':
        opts.maxToolSteps = Math.max(1, parseInt(next(), 10) || DEFAULT_MAX_TOOL_STEPS);
        break;
      case '--raw':
        opts.raw = true;
        break;
      case '--no-stream':
        opts.stream = false;
        break;
      case '--show-reasoning':
        opts.showReasoning = true;
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        throw new Error(`알 수 없는 옵션: ${arg}`);
    }
  }
  return opts;
}

// ── 세션 상태 ───────────────────────────────────────────────────────────────

function emptyState(opts) {
  const now = new Date().toISOString();
  return {
    sessionId: `or-${now.replace(/[:.]/g, '-')}`,
    model: opts.model,
    effort: opts.effort,
    system: opts.system !== null ? opts.system : DEFAULT_SYSTEM_PROMPT,
    turnCount: 0,
    createdAt: now,
    updatedAt: now,
    usage: emptyUsage(),
    messages: [],
  };
}

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.messages)) return null;
    return {
      sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : null,
      model: typeof raw.model === 'string' ? raw.model : DEFAULT_MODEL,
      effort: VALID_EFFORTS.has(raw.effort) ? raw.effort : null,
      system: typeof raw.system === 'string' ? raw.system : DEFAULT_SYSTEM_PROMPT,
      turnCount: Number.isInteger(raw.turnCount) ? raw.turnCount : 0,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
      usage: addUsage(null, raw.usage && typeof raw.usage === 'object' ? raw.usage : null),
      // user/assistant 뿐 아니라 도구 왕복(assistant+tool_calls, tool 결과)도 살려야
      // 재개했을 때 대화가 유효한 시퀀스로 남는다.
      messages: raw.messages.filter(message => {
        if (!message || typeof message !== 'object') return false;
        if (message.role === 'user') return typeof message.content === 'string';
        if (message.role === 'assistant') {
          return typeof message.content === 'string'
            || message.content === null
            || Array.isArray(message.tool_calls);
        }
        if (message.role === 'tool') {
          return typeof message.content === 'string' && typeof message.tool_call_id === 'string';
        }
        return false;
      }),
    };
  } catch {
    return null;
  }
}

function saveState(state) {
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

/** 시스템 프롬프트. 도구가 켜져 있으면 사용법을 덧붙인다(저장된 프롬프트는 건드리지 않는다). */
function buildSystemPrompt(state, toolbox) {
  const base = state.system || '';
  if (!toolbox) return base;
  return [
    base,
    '',
    '[파일 도구]',
    `작업 디렉터리: ${toolbox.root}`,
    `사용 가능: ${toolbox.names.join(', ')}${toolbox.allowWrite ? '' : ' (쓰기 불가 — 읽기 전용)'}`,
    '경로는 작업 디렉터리 기준 상대경로로 쓴다.',
    '파일 내용·구조를 추측하지 말고 도구로 직접 확인한 뒤 답한다.',
    '파일을 넓게 찾을 때는 find_files(파일명 glob), 내용을 찾을 때는 search_files(정규식)를 쓴다.',
    '자격증명 파일(.env 등)과 작업 디렉터리 밖은 접근이 거부된다. 거부되면 우회하지 말고 사용자에게 알린다.',
  ].join('\n').trim();
}

/**
 * 실제로 API에 보낼 messages. 시스템 프롬프트는 항상 맨 앞,
 * 나머지는 최근 maxHistory 개만 보낸다.
 *
 * 두 가지를 지켜야 한다.
 *  1) 창의 첫 메시지는 user 여야 한다 — tool 결과나 tool_calls 가 앞에 오면 API가 거부한다.
 *  2) 도구를 많이 부른 턴이 창보다 커도 지금 질문은 절대 잘리면 안 된다.
 */
function buildRequestMessages(state, maxHistory, toolbox) {
  const total = state.messages.length;
  const windowStart = Math.max(0, total - maxHistory);
  const lastUserIndex = state.messages.map(message => message.role).lastIndexOf('user');
  const from = lastUserIndex >= 0 ? Math.min(windowStart, lastUserIndex) : windowStart;

  const history = state.messages.slice(from);
  while (history.length && history[0].role !== 'user') history.shift();

  const messages = [];
  const system = buildSystemPrompt(state, toolbox);
  if (system) messages.push({ role: 'system', content: system });
  messages.push(...history);
  return messages;
}

// ── 로그 ────────────────────────────────────────────────────────────────────

function appendLog(text) {
  fs.appendFileSync(LOG_PATH, text, 'utf8');
}

function appendDivider(title) {
  const stamp = new Date().toLocaleString('ko-KR');
  appendLog(`\n---\n\n## ${title} (${stamp})\n\n`);
}

function appendTurn(turnNo, role, text) {
  const label = role === 'user' ? '**나**' : '**OpenRouter**';
  const time = new Date().toLocaleTimeString('ko-KR');
  const quoted = String(text).split('\n').join('\n> ');
  appendLog(`### 턴 ${turnNo} — ${label} (${time})\n\n> ${quoted}\n\n`);
}

function appendReasoning(turnNo, reasoning) {
  if (!reasoning) return;
  appendLog(`<details><summary>턴 ${turnNo} 추론 과정</summary>\n\n\`\`\`\n${reasoning}\n\`\`\`\n\n</details>\n\n`);
}

function ensureLogFile(state) {
  if (!fs.existsSync(LOG_PATH)) {
    appendLog(`# OpenRouter 라이브 챗 기록\n\n- 모델: ${state.model}\n`);
  }
}

// ── 슬래시 명령 ─────────────────────────────────────────────────────────────

function formatUsage(usage) {
  if (!usage) return '사용량 정보 없음';
  const cost = usage.cost ? ` · $${usage.cost.toFixed(6)}` : ' · $0 (무료)';
  // ox-alpha 는 reasoning 필수 모델이라 완료 토큰 대비 추론 토큰 비중을 같이 보는 게 좋다.
  const reasoning = usage.reasoningTokens ? ` (추론 ${usage.reasoningTokens})` : '';
  const cached = usage.cachedTokens ? ` · 캐시 ${usage.cachedTokens}` : '';
  return `prompt ${usage.promptTokens} + completion ${usage.completionTokens}${reasoning}`
    + ` = ${usage.totalTokens} 토큰${cached}${cost}`;
}

function readAttachment(rawPath) {
  const filePath = path.resolve(rawPath);
  if (!fs.existsSync(filePath)) throw new Error(`파일이 없습니다: ${filePath}`);
  let content = fs.readFileSync(filePath, 'utf8');
  let truncated = false;
  if (content.length > MAX_ATTACHMENT_CHARS) {
    content = content.slice(0, MAX_ATTACHMENT_CHARS);
    truncated = true;
  }
  return { path: filePath, content, truncated };
}

function composeWithAttachments(text, attachments) {
  if (!attachments.length) return text;
  const blocks = attachments.map(item => {
    const note = item.truncated ? ' (앞부분만 첨부됨)' : '';
    return `\n\n----- 첨부 파일: ${item.path}${note} -----\n\`\`\`\n${item.content}\n\`\`\``;
  });
  return `${text}${blocks.join('')}`;
}

// ── 한 턴 실행 ──────────────────────────────────────────────────────────────

/**
 * 사용자 메시지를 기록에 넣고 한 턴을 끝까지 돌린다.
 *
 * 도구가 켜져 있으면 한 턴이 여러 번의 API 호출이 된다:
 *   모델이 tool_calls 를 주면 → 도구를 실행해 tool 메시지로 되돌리고 → 다시 호출,
 *   더 이상 도구를 부르지 않을 때의 응답이 최종 답변이다.
 *
 * 실패·중단 시에는 이 턴에서 쌓은 메시지를 통째로 되돌린다.
 * (기록에 답 없는 질문이나 결과 없는 tool_calls 가 남으면 다음 턴 요청이 아예 거부된다.
 *  로그에는 실패 사실을 남긴다.)
 */
async function runTurn({ client, state, opts, toolbox, userText, controller }) {
  const rollbackTo = state.messages.length;
  state.turnCount += 1;
  const turnNo = state.turnCount;
  state.messages.push({ role: 'user', content: userText });
  appendTurn(turnNo, 'user', userText);
  saveState(state);

  const tools = toolbox ? toolbox.definitions : undefined;
  let printedContentHeader = false;
  let printedReasoningHeader = false;

  const onDelta = chunk => {
    if (!printedContentHeader) {
      if (printedReasoningHeader) process.stdout.write(`\n${ANSI.reset}`);
      if (!RAW_MODE) process.stdout.write(`${ANSI.cyan}${ANSI.bold}OpenRouter >${ANSI.reset} `);
      printedContentHeader = true;
    }
    process.stdout.write(chunk);
  };
  const onReasoning = chunk => {
    if (!printedReasoningHeader) {
      process.stderr.write(`${ANSI.gray}${ANSI.dim}[추론] `);
      printedReasoningHeader = true;
    }
    process.stderr.write(chunk);
  };

  try {
    for (let step = 1; step <= opts.maxToolSteps; step += 1) {
      const result = await client.complete({
        messages: buildRequestMessages(state, opts.maxHistory, toolbox),
        stream: opts.stream,
        onDelta: opts.stream ? onDelta : null,
        onReasoning: opts.stream && opts.showReasoning ? onReasoning : null,
        signal: controller.signal,
        tools,
      });
      state.usage = addUsage(state.usage, result.usage);

      if (result.toolCalls.length && toolbox) {
        if (printedReasoningHeader) process.stderr.write(`\n${ANSI.reset}`);
        if (printedContentHeader) process.stdout.write('\n');
        printedContentHeader = false;
        printedReasoningHeader = false;

        // 도구를 부른 턴의 assistant 메시지는 tool_calls 를 그대로 담아야
        // 뒤따르는 tool 결과가 짝을 찾는다.
        state.messages.push({
          role: 'assistant',
          content: result.text || null,
          tool_calls: result.toolCalls.map(call => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.arguments },
          })),
        });
        if (result.text) appendTurn(turnNo, 'assistant', result.text);

        for (const call of result.toolCalls) {
          const label = toolbox.describe(call.name, call.arguments);
          const outcome = toolbox.execute(call.name, call.arguments);
          const head = outcome.content.split('\n')[0].slice(0, 140);
          info(`${ANSI.gray}[도구 ${step}] ${label} → ${outcome.ok ? head : `거부/실패: ${head}`}${ANSI.reset}`);
          appendLog(`_[도구 ${step}] ${label} → ${outcome.ok ? '성공' : '실패'} · ${head}_\n\n`);
          state.messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.name,
            content: outcome.content,
          });
        }
        saveState(state);
        continue;
      }

      // 최종 답변
      if (opts.stream) {
        process.stdout.write('\n');
        if (!RAW_MODE) process.stdout.write('\n');
      } else {
        if (opts.showReasoning && result.reasoning) {
          console.error(`${ANSI.gray}${ANSI.dim}[추론] ${result.reasoning}${ANSI.reset}`);
        }
        if (RAW_MODE) process.stdout.write(`${result.text}\n`);
        else console.log(`${ANSI.cyan}${ANSI.bold}OpenRouter >${ANSI.reset} ${result.text}\n`);
      }

      state.messages.push({ role: 'assistant', content: result.text });
      saveState(state);

      appendTurn(turnNo, 'assistant', result.text);
      if (opts.showReasoning) appendReasoning(turnNo, result.reasoning);
      if (result.usage) {
        appendLog(`_${result.model} · ${formatUsage(result.usage)}_\n\n`);
        info(`${ANSI.gray}${result.model} · ${formatUsage(result.usage)}${ANSI.reset}\n`);
      }
      return result;
    }

    throw new OpenRouterError(
      `도구 호출이 ${opts.maxToolSteps}회를 넘겨 중단했습니다.`
      + ' --max-tool-steps 를 늘리거나 질문 범위를 좁히세요.',
    );
  } catch (error) {
    // 이 턴에서 쌓은 것 전부 되돌린다(user + assistant tool_calls + tool 결과).
    state.messages.length = rollbackTo;
    state.turnCount -= 1;
    saveState(state);
    const detail = error instanceof OpenRouterError ? error.message : (error.message || String(error));
    if (opts.stream && printedContentHeader) process.stdout.write('\n');
    if (opts.stream && printedReasoningHeader) process.stderr.write('\n');
    console.error(`${ANSI.red}응답 실패: ${detail}${ANSI.reset}`);
    appendTurn(turnNo, 'assistant', `[오류] ${detail}`);
    return null;
  }
}

// ── 메인 ────────────────────────────────────────────────────────────────────

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message || error);
    console.error(HELP);
    process.exitCode = 1;
    return;
  }
  if (opts.help) {
    console.log(HELP);
    return;
  }
  RAW_MODE = opts.raw;

  let state = opts.forceNew ? null : loadState();
  const resumed = Boolean(state);
  if (!state) state = emptyState(opts);

  // 명령줄로 준 값은 이어받은 세션 설정보다 우선한다.
  if (process.argv.includes('--model')) state.model = opts.model;
  if (opts.effort) state.effort = opts.effort;
  if (opts.system !== null) state.system = opts.system;
  opts.model = state.model;
  opts.effort = state.effort;

  let client;
  try {
    client = new OpenRouterClient({
      model: state.model,
      reasoningEffort: state.effort,
      maxTokens: opts.maxTokens,
      temperature: Number.isFinite(opts.temperature) ? opts.temperature : null,
      timeoutMs: Number(process.env.OPENROUTER_TIMEOUT || 0) * 1000 || undefined,
      includeReasoning: true,
    });
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
    return;
  }

  // 파일 도구. root 를 벗어나는 접근과 자격증명 파일은 도구 상자 쪽에서 막는다.
  let toolbox = null;
  if (opts.useTools) {
    try {
      toolbox = createToolbox({ root: opts.cwd, allowWrite: opts.allowWrite });
    } catch (error) {
      console.error(`파일 도구를 준비할 수 없습니다(${opts.cwd}): ${error.message || error}`);
      process.exitCode = 1;
      return;
    }
  }

  ensureLogFile(state);
  if (resumed) {
    info(`기존 세션 재개: ${state.sessionId} (턴 ${state.turnCount}까지 진행됨, 메시지 ${state.messages.length}개)`);
    appendDivider(`세션 재개 (sessionId=${state.sessionId}, model=${state.model})`);
  } else {
    saveState(state);
    appendDivider(`새 세션 시작 (sessionId=${state.sessionId}, model=${state.model})`);
    info(`새 세션 시작: ${state.sessionId}`);
  }

  info(`모델: ${state.model}${state.effort ? ` (effort=${state.effort})` : ''}`);
  info(`대화 기록: ${STATE_PATH} — 이 파일이 세션이다(커밋 금지)`);
  if (toolbox) {
    info(`파일 도구: ${toolbox.names.join(', ')} — ${toolbox.root}`
      + `${toolbox.allowWrite ? ' (쓰기 허용)' : ' (읽기 전용)'}`);
  } else {
    info('파일 도구: 꺼짐 (--no-tools)');
  }

  // 중단 신호를 진행 중인 요청에만 전달하기 위한 컨트롤러. 턴마다 새로 만든다.
  let controller = new AbortController();
  let busy = false;

  // 비대화형 한 턴 모드 (--prompt / --prompt-file)
  if (opts.prompt) {
    if (opts.promptFile) info(`프롬프트 파일: ${opts.promptFile}`);
    const result = await runTurn({ client, state, opts, toolbox, userText: opts.prompt, controller });
    if (!result) process.exitCode = 1;
    return;
  }

  info('대화를 시작하세요. 종료하려면 /exit, 새 세션을 시작하려면 /new, 명령 목록은 /help.');

  const rl = readline.createInterface({
    input: process.stdin,
    // --raw 는 stdout 을 응답 전용으로 비워 둬야 해서 프롬프트도 stderr 로 보낸다.
    output: RAW_MODE ? process.stderr : process.stdout,
    prompt: '나 > ',
  });

  rl.on('SIGINT', () => {
    if (busy) {
      // 진행 중인 호출만 끊고 프롬프트로 돌아온다(대화 기록은 로컬에 있으니 잃을 게 없다).
      info('\n진행 중인 요청을 중단합니다.');
      controller.abort();
      return;
    }
    info('\n대화를 종료합니다. 다음 실행 시 이어서 대화할 수 있습니다.');
    rl.close();
  });

  // 입력 줄을 직접 큐에 담는다.
  // for-await (rl) 로 돌리면 네트워크 응답을 기다리는 동안 파이프가 EOF에 닿는 순간
  // 반복이 끝나면서 아직 처리하지 않은 줄이 버려지고, 이어지는 rl.prompt() 가
  // ERR_USE_AFTER_CLOSE 로 터진다. 큐에 받아두면 EOF 이후에도 남은 줄을 전부 처리한다.
  const lineQueue = [];
  let inputClosed = false;
  let waiter = null;
  const wake = () => {
    if (!waiter) return;
    const resolve = waiter;
    waiter = null;
    resolve();
  };
  rl.on('line', line => {
    lineQueue.push(line);
    wake();
  });
  rl.on('close', () => {
    inputClosed = true;
    wake();
  });
  const nextLine = async () => {
    while (!lineQueue.length && !inputClosed) {
      await new Promise(resolve => { waiter = resolve; });
    }
    return lineQueue.length ? lineQueue.shift() : null;
  };
  const showPrompt = () => {
    if (!inputClosed) rl.prompt();
  };

  let attachments = [];

  try {
    showPrompt();
    for (;;) {
      const raw = await nextLine();
      if (raw === null) break;
      const text = raw.trim();
      if (!text) {
        showPrompt();
        continue;
      }

      if (EXIT_COMMANDS.has(text)) {
        info('대화를 종료합니다. 다음 실행 시 이어서 대화할 수 있습니다.');
        break;
      }

      if (text.startsWith('/')) {
        const [command, ...rest] = text.split(/\s+/);
        const argument = rest.join(' ').trim();

        if (command === NEW_SESSION_COMMAND) {
          state = emptyState(opts);
          state.model = opts.model;
          state.effort = opts.effort;
          saveState(state);
          attachments = [];
          appendDivider(`새 세션 시작 (sessionId=${state.sessionId}, model=${state.model})`);
          info(`새 세션 시작: ${state.sessionId}`);
          showPrompt();
          continue;
        }

        if (command === '/help') {
          info(SLASH_HELP);
          showPrompt();
          continue;
        }

        if (command === '/model') {
          if (!argument) {
            info(`현재 모델: ${state.model}`);
          } else {
            state.model = argument;
            client.model = argument;
            opts.model = argument;
            saveState(state);
            appendLog(`_모델 변경 → ${argument}_\n\n`);
            info(`모델을 ${argument} 로 변경했습니다. (대화 기록은 유지)`);
          }
          showPrompt();
          continue;
        }

        if (command === '/models') {
          try {
            const rows = await client.listModels({ query: argument });
            info(`검색 결과 ${rows.length}개${rows.length > 20 ? ' (상위 20개만 표시)' : ''}`);
            for (const row of rows.slice(0, 20)) {
              const free = Number(row.promptPrice) === 0 && Number(row.completionPrice) === 0;
              info(`  ${row.id}  ${ANSI.gray}${row.name} · ${row.contextLength} ctx${free ? ' · 무료' : ''}${ANSI.reset}`);
            }
          } catch (error) {
            console.error(`${ANSI.red}모델 목록 조회 실패: ${error.message || error}${ANSI.reset}`);
          }
          showPrompt();
          continue;
        }

        if (command === '/effort') {
          const value = argument.toLowerCase();
          if (!value) {
            info(`현재 effort: ${state.effort || '(모델 기본값)'}`);
          } else if (value === 'off') {
            state.effort = null;
            client.reasoningEffort = null;
            opts.effort = null;
            saveState(state);
            info('effort 를 모델 기본값으로 되돌렸습니다.');
          } else if (VALID_EFFORTS.has(value)) {
            state.effort = value;
            client.reasoningEffort = value;
            opts.effort = value;
            saveState(state);
            info(`effort 를 ${value} 로 설정했습니다.`);
          } else {
            info('effort 는 low | high | max | off 중 하나여야 합니다.');
          }
          showPrompt();
          continue;
        }

        if (command === '/system') {
          if (!argument) {
            info(`현재 시스템 프롬프트:\n${state.system || '(없음)'}`);
          } else {
            state.system = argument;
            saveState(state);
            appendLog(`_시스템 프롬프트 변경_\n\n> ${argument.split('\n').join('\n> ')}\n\n`);
            info('시스템 프롬프트를 변경했습니다.');
          }
          showPrompt();
          continue;
        }

        if (command === '/reasoning') {
          opts.showReasoning = !opts.showReasoning;
          info(`추론 과정 출력: ${opts.showReasoning ? 'ON' : 'OFF'}`);
          showPrompt();
          continue;
        }

        if (command === '/stream') {
          opts.stream = !opts.stream;
          info(`스트리밍: ${opts.stream ? 'ON' : 'OFF'}`);
          showPrompt();
          continue;
        }

        if (command === '/tools') {
          if (!toolbox) {
            info('파일 도구가 꺼져 있습니다(--no-tools). 켜려면 러너를 다시 실행하세요.');
          } else {
            info(`작업 디렉터리: ${toolbox.root}`);
            info(`쓰기 권한: ${toolbox.allowWrite ? '있음 (--allow-write)' : '없음 (읽기 전용)'}`);
            info(`도구: ${toolbox.names.join(', ')}`);
            info('차단: 작업 디렉터리 밖 경로, .env 등 자격증명 파일, .git 내부');
          }
          showPrompt();
          continue;
        }

        if (command === '/file') {
          if (!argument) {
            attachments = [];
            info('첨부를 취소했습니다.');
          } else {
            try {
              const item = readAttachment(argument);
              attachments.push(item);
              info(`첨부 대기: ${item.path} (${item.content.length}자${item.truncated ? ', 잘림' : ''}) — 다음 메시지에 포함됩니다.`);
            } catch (error) {
              console.error(`${ANSI.red}${error.message || error}${ANSI.reset}`);
            }
          }
          showPrompt();
          continue;
        }

        if (command === '/history') {
          const turns = Math.max(1, parseInt(argument, 10) || 5);
          const slice = state.messages.slice(-turns * 2);
          if (!slice.length) info('기록이 없습니다.');
          for (const message of slice) {
            const label = message.role === 'user' ? '나' : 'OpenRouter';
            const preview = message.content.length > 400
              ? `${message.content.slice(0, 400)}…`
              : message.content;
            info(`${ANSI.gray}${label} >${ANSI.reset} ${preview}`);
          }
          showPrompt();
          continue;
        }

        if (command === '/undo') {
          if (!state.messages.length) {
            info('되돌릴 기록이 없습니다.');
          } else {
            if (state.messages[state.messages.length - 1].role === 'assistant') state.messages.pop();
            if (state.messages.length && state.messages[state.messages.length - 1].role === 'user') {
              state.messages.pop();
            }
            state.turnCount = Math.max(0, state.turnCount - 1);
            saveState(state);
            appendLog(`_/undo — 마지막 턴을 대화 기록에서 제거 (로그는 보존)_\n\n`);
            info(`마지막 턴을 제거했습니다. (남은 메시지 ${state.messages.length}개)`);
          }
          showPrompt();
          continue;
        }

        if (command === '/usage') {
          info(`누적: ${formatUsage(state.usage)} · 턴 ${state.turnCount}`);
          showPrompt();
          continue;
        }

        info(`알 수 없는 명령: ${command} (/help 로 목록 확인)`);
        showPrompt();
        continue;
      }

      const userText = composeWithAttachments(text, attachments);
      attachments = [];

      controller = new AbortController();
      busy = true;
      await runTurn({ client, state, opts, toolbox, userText, controller });
      busy = false;
      showPrompt();
    }
  } finally {
    busy = false;
    controller.abort();
    rl.close();
  }
}

main().catch(error => {
  console.error('오류:', error.message || error);
  process.exit(1);
});
