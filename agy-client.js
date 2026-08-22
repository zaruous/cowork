'use strict';

/**
 * agy-client.js — Antigravity CLI(`agy`) print 모드 래퍼
 *
 * 왜 이 구조인가:
 *   agy 는 `--input-format stream-json --output-format stream-json` 조합에서
 *   stdin 으로 NDJSON 한 줄을 받을 때마다 한 턴을 실행하고, stdin 이 닫힐 때까지
 *   프로세스를 살려 둔다. 즉 프로세스 하나로 대화 전체를 이어갈 수 있다.
 *   - 턴마다 프로세스를 새로 띄우는 codex 러너와 달리 기동 비용(수 초)이 1회뿐이다.
 *   - 프롬프트가 argv 가 아니라 stdin JSON 이라 Windows 명령줄 길이 제한과
 *     한글 인용부호 문제를 아예 피한다. (`-p "..."` 는 argv 로 들어간다)
 *
 * 입력 한 줄 형식 (content 는 문자열 또는 [{type:'text',text:''}] 블록 배열):
 *   {"event":"user","message":{"role":"user","content":"텍스트"}}
 *
 * 출력 이벤트:
 *   {"event":"init","conversation_id":...,"init":{cwd,tools,permission_mode}}
 *   {"event":"step_update","step_update":{step_type:"agent_response",text_delta:"..."}}
 *   {"event":"step_update","step_update":{step_type:"tool",tool_name:"view_file",...}}
 *   {"event":"result","result":{status:"SUCCESS"|"ERROR",response,error,num_turns,usage}}
 *
 * 주의: result.usage / result.num_turns 는 "그 프로세스의 누적치"다. 재기동으로 대화를
 *       이어붙이면 첫 턴의 result.usage 에 대화 전체 값이 들어오므로, 턴별 사용량은
 *       agent_response 스텝의 usage 를 모아서 계산한다(누적치 차분은 보조 수단).
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const DEFAULT_TIMEOUT_SEC = 600;
const INIT_TIMEOUT_MS = 120_000;
const VALID_EFFORTS = new Set(['low', 'medium', 'high']);
const VALID_MODES = new Set(['accept-edits', 'plan']);

// ── 사용량 ──────────────────────────────────────────────────────────────────

function emptyUsage() {
  return { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheReadTokens: 0, totalTokens: 0 };
}

function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return emptyUsage();
  return {
    inputTokens: Number(raw.input_tokens) || 0,
    outputTokens: Number(raw.output_tokens) || 0,
    thinkingTokens: Number(raw.thinking_tokens) || 0,
    cacheReadTokens: Number(raw.cache_read_tokens) || 0,
    totalTokens: Number(raw.total_tokens) || 0,
  };
}

function addUsage(a, b) {
  const left = a || emptyUsage();
  const right = b || emptyUsage();
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    thinkingTokens: left.thinkingTokens + right.thinkingTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

/** 누적치 - 이전 누적치. 프로세스가 바뀌면 음수가 될 수 있어 0 으로 자른다. */
function diffUsage(current, previous) {
  const now = current || emptyUsage();
  const before = previous || emptyUsage();
  const clamp = value => (value > 0 ? value : 0);
  return {
    inputTokens: clamp(now.inputTokens - before.inputTokens),
    outputTokens: clamp(now.outputTokens - before.outputTokens),
    thinkingTokens: clamp(now.thinkingTokens - before.thinkingTokens),
    cacheReadTokens: clamp(now.cacheReadTokens - before.cacheReadTokens),
    totalTokens: clamp(now.totalTokens - before.totalTokens),
  };
}

function formatUsage(usage) {
  const u = usage || emptyUsage();
  return `input ${u.inputTokens} / output ${u.outputTokens} (사고 ${u.thinkingTokens})`
    + ` / cache ${u.cacheReadTokens} / total ${u.totalTokens}`;
}

// ── CLI 위치 확인 ───────────────────────────────────────────────────────────

function resolveAgyCommand() {
  const fromEnv = String(process.env.AGY_BIN || '').trim();
  if (fromEnv) return path.resolve(fromEnv);

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const installed = path.join(localAppData, 'agy', 'bin', 'agy.exe');
      if (fs.existsSync(installed)) return installed;
    }
    return 'agy.exe';
  }
  return 'agy';
}

function checkAgyCli() {
  const command = resolveAgyCommand();
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', windowsHide: true });
  if (result.error) {
    throw new Error(`agy CLI를 실행할 수 없습니다(${command}): ${result.error.message}`
      + ' — Antigravity CLI 설치 후 PATH 를 확인하거나 AGY_BIN 으로 경로를 지정하세요.');
  }
  if (result.status !== 0) {
    throw new Error(`agy CLI 확인 실패: ${String(result.stderr || result.stdout || '').trim()}`);
  }
  return { command, version: String(result.stdout || '').trim() };
}

/** `agy models` 출력을 파싱한다. 인증이 안 됐으면 여기서 드러난다. */
function listModels({ query = '' } = {}) {
  const command = resolveAgyCommand();
  const result = spawnSync(command, ['models'], { encoding: 'utf8', windowsHide: true });
  if (result.error) throw new Error(`agy models 실행 실패: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`agy models 실패: ${String(result.stderr || result.stdout || '').trim()}`);
  }
  const needle = String(query || '').trim().toLowerCase();
  const rows = [];
  for (const line of String(result.stdout || '').split(/\r?\n/)) {
    if (!line.includes('\t')) continue;
    const [id, ...rest] = line.split('\t');
    const row = { id: id.trim(), name: rest.join(' ').trim() };
    if (!row.id) continue;
    if (needle && !`${row.id} ${row.name}`.toLowerCase().includes(needle)) continue;
    rows.push(row);
  }
  return rows;
}

// ── 프로세스 종료 (Windows 는 자식까지 함께) ────────────────────────────────

function terminateProcessTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.on('error', () => {
      try { child.kill(); } catch { /* ignore */ }
    });
    return;
  }
  try { child.kill('SIGTERM'); } catch { /* ignore */ }
}

// ── 세션 ────────────────────────────────────────────────────────────────────

class AgySession {
  constructor(options = {}) {
    this.command = options.command || resolveAgyCommand();
    this.cwd = path.resolve(options.cwd || process.cwd());
    this.model = options.model || null;
    this.effort = options.effort || null;
    this.mode = options.mode || null;
    this.agent = options.agent || null;
    this.addDirs = Array.isArray(options.addDirs) ? options.addDirs.slice() : [];
    this.skipPermissions = Boolean(options.skipPermissions);
    this.sandbox = Boolean(options.sandbox);
    this.disableSlashCommands = Boolean(options.disableSlashCommands);
    this.timeoutSec = Number(options.timeoutSec) > 0 ? Number(options.timeoutSec) : DEFAULT_TIMEOUT_SEC;
    this.conversationId = options.conversationId || null;
    this.onWarning = typeof options.onWarning === 'function' ? options.onWarning : () => {};

    this.child = null;
    this.running = false;
    this.tools = [];
    this.permissionMode = null;
    this.agentCwd = null;
    this.numTurns = 0;
    this.cumulative = emptyUsage();
    this.pending = null;
    this.stdoutBuffer = '';
    this.stderrTail = [];
    this.lastExit = null;
    this._initResolve = null;
  }

  buildArgs() {
    // -p= (빈 프롬프트) + stream-json 입력: 프롬프트는 전부 stdin 으로 들어온다.
    const args = [
      '-p=',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--print-timeout', `${this.timeoutSec}s`,
    ];
    if (this.conversationId) args.push('--conversation', this.conversationId);
    if (this.model) args.push('--model', this.model);
    if (this.effort) args.push('--effort', this.effort);
    if (this.mode) args.push('--mode', this.mode);
    if (this.agent) args.push('--agent', this.agent);
    for (const dir of this.addDirs) args.push('--add-dir', dir);
    if (this.skipPermissions) args.push('--dangerously-skip-permissions');
    if (this.sandbox) args.push('--sandbox');
    if (this.disableSlashCommands) args.push('--disable-slash-commands');
    return args;
  }

  /** 프로세스를 띄우고 init 이벤트까지 기다린다. */
  start() {
    if (this.running) return Promise.resolve(this);

    const args = this.buildArgs();
    const child = spawn(this.command, args, {
      cwd: this.cwd,
      env: { ...process.env },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.running = true;
    this.stdoutBuffer = '';
    this.stderrTail = [];
    this.cumulative = emptyUsage();
    this.numTurns = 0;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => this._handleStdout(chunk));
    child.stderr.on('data', chunk => this._handleStderr(chunk));
    child.stdin.on('error', error => {
      if (error && error.code !== 'EPIPE') this.onWarning(`agy stdin 오류: ${error.message}`);
    });

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = fn => value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this._initResolve = null;
        fn(value);
      };
      const done = finish(resolve);
      const fail = finish(reject);

      const timer = setTimeout(() => {
        terminateProcessTree(child);
        fail(new Error(`agy 기동이 ${INIT_TIMEOUT_MS / 1000}초 안에 끝나지 않았습니다.`));
      }, INIT_TIMEOUT_MS);

      this._initResolve = () => done(this);

      child.on('error', error => {
        this.running = false;
        fail(new Error(`agy 실행 실패: ${error.message}`));
      });

      child.on('close', code => {
        this.running = false;
        this.lastExit = code;
        const detail = this.stderrTail.join('\n').trim();
        const message = detail
          ? `agy 프로세스가 종료됐습니다(code=${code}):\n${detail}`
          : `agy 프로세스가 종료됐습니다(code=${code}).`;
        if (this.pending) {
          const pending = this.pending;
          this.pending = null;
          if (pending.timer) clearTimeout(pending.timer);
          pending.reject(new Error(message));
        }
        fail(new Error(message));
      });
    });
  }

  /** 모델·effort 처럼 프로세스 인자를 바꿔야 하는 변경은 재기동으로 반영한다. */
  async restart({ keepConversation = true } = {}) {
    await this.close();
    if (!keepConversation) this.conversationId = null;
    return this.start();
  }

  send(text, { onDelta = () => {}, onStep = () => {} } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.running || !this.child) {
        reject(new Error('agy 세션이 실행 중이 아닙니다.'));
        return;
      }
      if (this.pending) {
        reject(new Error('이전 턴이 아직 끝나지 않았습니다.'));
        return;
      }

      const payload = { event: 'user', message: { role: 'user', content: String(text) } };
      const pending = { resolve, reject, onDelta, onStep, text: '', usage: emptyUsage(), timer: null };
      // agy 쪽 --print-timeout 이 먼저 걸리는 게 정상이고, 이건 그마저 안 올 때의 안전망.
      pending.timer = setTimeout(() => {
        if (this.pending !== pending) return;
        this.pending = null;
        terminateProcessTree(this.child);
        reject(new Error(`응답이 ${this.timeoutSec + 60}초 안에 오지 않아 세션을 끊었습니다.`));
      }, (this.timeoutSec + 60) * 1000);

      this.pending = pending;
      try {
        this.child.stdin.write(`${JSON.stringify(payload)}\n`, 'utf8');
      } catch (error) {
        this.pending = null;
        clearTimeout(pending.timer);
        reject(new Error(`agy 로 입력을 보내지 못했습니다: ${error.message}`));
      }
    });
  }

  async close({ graceMs = 3000 } = {}) {
    const child = this.child;
    this.running = false;
    this.child = null;
    if (!child) return;

    try { child.stdin.end(); } catch { /* ignore */ }
    await new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      const timer = setTimeout(() => { terminateProcessTree(child); resolve(); }, graceMs);
      child.once('close', () => { clearTimeout(timer); resolve(); });
    });
  }

  /** 진행 중인 턴을 강제로 끊는다(Ctrl+C 등). 다음 턴은 restart 후 이어서. */
  kill() {
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error('사용자가 턴을 중단했습니다.'));
    }
    terminateProcessTree(this.child);
    this.running = false;
  }

  // ── 내부: 스트림 파싱 ─────────────────────────────────────────────────────

  _handleStdout(chunk) {
    this.stdoutBuffer += chunk;
    let index = this.stdoutBuffer.indexOf('\n');
    while (index >= 0) {
      const line = this.stdoutBuffer.slice(0, index).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);
      if (line) this._handleLine(line);
      index = this.stdoutBuffer.indexOf('\n');
    }
  }

  _handleStderr(chunk) {
    for (const line of String(chunk).split(/\r?\n/)) {
      const text = line.trim();
      if (!text) continue;
      this.stderrTail.push(text);
      if (this.stderrTail.length > 20) this.stderrTail.shift();
      if (/^warning:/i.test(text) || /not found/i.test(text)) this.onWarning(text);
    }
  }

  _handleLine(line) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      this.onWarning(`agy 출력을 해석할 수 없습니다: ${line.slice(0, 200)}`);
      return;
    }
    if (!event || typeof event !== 'object') return;

    if (event.event === 'init') { this._handleInit(event); return; }
    if (event.event === 'step_update') { this._handleStep(event.step_update || {}); return; }
    if (event.event === 'result') { this._handleResult(event.result || {}); return; }
  }

  _handleInit(event) {
    const requested = this.conversationId;
    if (event.conversation_id) this.conversationId = event.conversation_id;
    const init = event.init || {};
    this.tools = Array.isArray(init.tools) ? init.tools : [];
    this.permissionMode = init.permission_mode || null;
    this.agentCwd = init.cwd || this.cwd;

    // 잘못된 id 로 이어붙이려 하면 agy 는 경고만 내고 새 대화를 시작한다.
    if (requested && event.conversation_id && requested !== event.conversation_id) {
      this.onWarning(`이전 대화(${requested})를 찾지 못해 새 대화(${event.conversation_id})로 시작합니다.`);
    }
    if (this._initResolve) this._initResolve();
  }

  _handleStep(step) {
    if (step.conversation_id) this.conversationId = step.conversation_id;
    const pending = this.pending;
    if (!pending) return;

    if (step.step_type === 'agent_response') {
      if (typeof step.text_delta === 'string' && step.text_delta) {
        pending.text += step.text_delta;
        pending.onDelta(step.text_delta);
      }
      // 스텝 usage 는 그 모델 호출 한 번의 값이다. 이걸 모아야 "이번 턴" 사용량이 나온다
      // (result.usage 는 프로세스 누적치라 재기동 직후 턴에서는 대화 전체 값이 들어온다).
      if (step.usage) pending.usage = addUsage(pending.usage, normalizeUsage(step.usage));
      return;
    }
    if (step.step_type === 'tool') {
      pending.onStep({
        type: 'tool',
        state: String(step.state || ''),
        name: step.tool_name || (step.tool_info && step.tool_info.name) || '(tool)',
        params: (step.tool_info && step.tool_info.parameters) || null,
        durationSeconds: Number(step.duration_seconds) || 0,
      });
      return;
    }
    pending.onStep({
      type: String(step.step_type || 'step'),
      state: String(step.state || ''),
      name: String(step.step_type || ''),
      params: null,
      durationSeconds: Number(step.duration_seconds) || 0,
    });
  }

  _handleResult(result) {
    const pending = this.pending;
    this.pending = null;
    if (pending && pending.timer) clearTimeout(pending.timer);

    const cumulative = normalizeUsage(result.usage);
    // 스텝 usage 합이 있으면 그게 이번 턴의 실측치. 없으면 누적치 차분으로 대체한다.
    const stepUsage = pending ? pending.usage : emptyUsage();
    const turnUsage = stepUsage.totalTokens > 0 ? stepUsage : diffUsage(cumulative, this.cumulative);
    this.cumulative = cumulative;
    if (Number(result.num_turns)) this.numTurns = Number(result.num_turns);
    if (result.conversation_id) this.conversationId = result.conversation_id;

    if (!pending) return;
    pending.resolve({
      status: String(result.status || ''),
      ok: String(result.status || '').toUpperCase() === 'SUCCESS',
      reply: String(result.response || '').trim() || pending.text.trim(),
      error: result.error ? String(result.error) : '',
      usage: turnUsage,
      cumulative,
      numTurns: this.numTurns,
      durationSeconds: Number(result.duration_seconds) || 0,
      conversationId: this.conversationId,
    });
  }
}

module.exports = {
  AgySession,
  checkAgyCli,
  listModels,
  resolveAgyCommand,
  terminateProcessTree,
  emptyUsage,
  normalizeUsage,
  addUsage,
  diffUsage,
  formatUsage,
  DEFAULT_TIMEOUT_SEC,
  VALID_EFFORTS,
  VALID_MODES,
};
