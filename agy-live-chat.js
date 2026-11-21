'use strict';

/**
 * agy-live-chat.js — Antigravity CLI(agy) 라이브 챗
 *
 * cursor-live-chat.js 와 같은 역할이고 세션 유지 방식만 다르다.
 *   - Cursor: SDK 의 Agent.resume(agentId)
 *   - agy: CLI 의 --conversation <id>. 다만 이 러너는 한 프로세스를 띄워 두고
 *     stdin NDJSON 으로 턴을 계속 보내므로(agy-client.js 참고) 평소에는 재기동조차 없다.
 *     프로세스가 죽거나 모델·effort 를 바꿀 때만 --conversation 으로 다시 이어붙인다.
 *
 * 세션 상태는 .agy-session.json, 대화 로그는 agy-live-chat.md (둘 다 이 스크립트 폴더).
 *
 * 사용법:
 *   node agy-live-chat.js
 *   node agy-live-chat.js --new --cwd D:\git\java\reporter --effort high
 *   node agy-live-chat.js --raw --prompt "질문" > answer.md
 *   node agy-live-chat.js --cwd D:\git\repo --prompt-file prompts/task.md --yolo
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// .env 의 AGY_* (모델 · 권한 등)를 읽는다. 셸에서 준 환경변수가 우선한다.
try { require('./load-env').load(); } catch { /* .env 없이도 동작 */ }

const {
  AgySession,
  checkAgyCli,
  listModels,
  emptyUsage,
  addUsage,
  formatUsage,
  DEFAULT_TIMEOUT_SEC,
  VALID_EFFORTS,
  VALID_MODES,
} = require('./agy-client');

const STATE_PATH = path.join(__dirname, '.agy-session.json');
const LOG_PATH = path.join(__dirname, 'agy-live-chat.md');
const EXIT_COMMANDS = new Set(['/exit', '/quit', '종료']);
const NEW_SESSION_COMMAND = '/new';
const MAX_ATTACHMENT_CHARS = 400_000;

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

// --raw 에서는 stdout 에 모델 응답만 흘려보내고 안내·상태는 stderr 로 보낸다.
let RAW_MODE = false;
const info = (...args) => {
  const line = `${args.join(' ')}\n`;
  if (RAW_MODE) process.stderr.write(line);
  else process.stdout.write(line);
};

const HELP = `
agy-live-chat — Antigravity CLI(agy) 라이브 챗

사용법: node agy-live-chat.js [옵션]

  --new                  이전 대화를 버리고 새 대화로 시작
  --cwd <path>           에이전트가 파일을 읽고 명령을 실행할 디렉터리 (기본 이 스크립트 폴더)
  --add-dir <path>       워크스페이스에 디렉터리 추가 (반복 가능, --cwd 는 자동 포함)
  --model <id>           모델 id (기본 AGY_MODEL, 미지정 시 CLI 기본값) — /models 로 목록 확인
  --effort <low|medium|high>  reasoning effort (기본 AGY_EFFORT)
  --mode <accept-edits|plan>  에이전트 실행 모드
  --agent <name>         사용할 에이전트 (agy agents 로 목록 확인)
  --yolo                 --dangerously-skip-permissions (셸 명령까지 자동 승인)
  --sandbox              터미널 제한 샌드박스로 실행
  --no-slash             agy 쪽 슬래시 명령/스킬 확장 비활성화
  --timeout <sec>        한 턴 제한 시간 (기본 ${DEFAULT_TIMEOUT_SEC}초)
  --prompt <text>        한 턴만 실행하고 종료 (비대화형)
  --prompt-file <path>   파일 내용을 그대로 한 턴 보내고 종료 (비대화형)
  --raw                  응답 본문만 stdout 으로 (안내는 stderr) — 파이프용
  --no-stream            스트리밍 끄기 (완료된 응답만 한 번에 출력)
  --quiet-steps          도구 실행 로그 숨기기
  -h, --help             도움말

환경변수: AGY_BIN(agy 실행 파일 경로), AGY_MODEL, AGY_EFFORT, AGY_MODE,
          AGY_CHAT_CWD, AGY_TIMEOUT(초), AGY_SKIP_PERMISSIONS=1

권한 안내: 기본 권한 모드(request-review)에서 파일 읽기(view_file 등)는 자동 허용되지만
          셸 명령(run_command)은 거부되어 턴이 ERROR 로 끝난다. 명령 실행이 필요하면 --yolo.
`;

const SLASH_HELP = `
사용 가능한 명령:
  /new                 대화를 버리고 새 대화 시작
  /exit, /quit, 종료   종료 (다음 실행 시 이어서 대화)
  /model [id]          모델 확인 / 변경 (대화 맥락 유지, 프로세스만 재기동)
  /models [검색어]     agy 모델 목록 조회
  /effort [low|medium|high|off]  reasoning effort 확인 / 변경
  /mode [plan|accept-edits|off]  에이전트 실행 모드 확인 / 변경
  /yolo                권한 자동 승인 토글 (프로세스 재기동)
  /tools               이 세션에서 쓸 수 있는 도구 / 권한 모드
  /file [path]         다음 메시지에 파일 내용 첨부 (인자 없으면 첨부 취소)
  /steps               도구 실행 로그 토글
  /stream              스트리밍 토글
  /info                대화 id · 작업 디렉터리 · 모델 · 턴 수
  /usage               누적 토큰 사용량
  /help                이 목록
`;

// ── 인자 파싱 ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    forceNew: false,
    cwd: String(process.env.AGY_CHAT_CWD || '').trim() || __dirname,
    addDirs: [],
    model: String(process.env.AGY_MODEL || '').trim() || null,
    effort: String(process.env.AGY_EFFORT || '').trim().toLowerCase() || null,
    mode: String(process.env.AGY_MODE || '').trim().toLowerCase() || null,
    agent: null,
    skipPermissions: String(process.env.AGY_SKIP_PERMISSIONS || '').trim() === '1',
    sandbox: false,
    disableSlashCommands: false,
    timeoutSec: Number(process.env.AGY_TIMEOUT) > 0 ? Number(process.env.AGY_TIMEOUT) : DEFAULT_TIMEOUT_SEC,
    prompt: null,
    stream: true,
    showSteps: true,
    help: false,
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
      case '--cwd':
        opts.cwd = next();
        break;
      case '--add-dir':
        opts.addDirs.push(path.resolve(next()));
        break;
      case '--model':
        opts.model = next().trim();
        break;
      case '--effort':
        opts.effort = next().trim().toLowerCase();
        break;
      case '--mode':
        opts.mode = next().trim().toLowerCase();
        break;
      case '--agent':
        opts.agent = next().trim();
        break;
      case '--yolo':
      case '--dangerously-skip-permissions':
        opts.skipPermissions = true;
        break;
      case '--sandbox':
        opts.sandbox = true;
        break;
      case '--no-slash':
        opts.disableSlashCommands = true;
        break;
      case '--timeout':
        opts.timeoutSec = Number(next());
        break;
      case '--prompt':
        opts.prompt = next();
        break;
      case '--prompt-file': {
        const file = path.resolve(next());
        opts.prompt = fs.readFileSync(file, 'utf8');
        break;
      }
      case '--raw':
        RAW_MODE = true;
        break;
      case '--no-stream':
        opts.stream = false;
        break;
      case '--quiet-steps':
        opts.showSteps = false;
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        throw new Error(`알 수 없는 옵션: ${arg} (--help 로 사용법 확인)`);
    }
  }

  opts.cwd = path.resolve(opts.cwd);
  if (opts.effort && !VALID_EFFORTS.has(opts.effort)) {
    throw new Error(`--effort 는 ${[...VALID_EFFORTS].join(' | ')} 중 하나여야 합니다.`);
  }
  if (opts.mode && !VALID_MODES.has(opts.mode)) {
    throw new Error(`--mode 는 ${[...VALID_MODES].join(' | ')} 중 하나여야 합니다.`);
  }
  if (!(Number(opts.timeoutSec) > 0)) throw new Error('--timeout 은 양수여야 합니다.');
  return opts;
}

// ── 상태 / 로그 ─────────────────────────────────────────────────────────────

function loadState() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    if (!state || typeof state !== 'object') return null;
    return {
      conversationId: typeof state.conversationId === 'string' ? state.conversationId : null,
      turnCount: Number.isInteger(state.turnCount) ? state.turnCount : 0,
      model: typeof state.model === 'string' ? state.model : null,
      effort: typeof state.effort === 'string' ? state.effort : null,
      mode: typeof state.mode === 'string' ? state.mode : null,
      usage: state.usage && typeof state.usage === 'object' ? { ...emptyUsage(), ...state.usage } : emptyUsage(),
    };
  } catch {
    return null;
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function appendLog(text) {
  fs.appendFileSync(LOG_PATH, text, 'utf8');
}

function appendDivider(title) {
  const stamp = new Date().toLocaleString('ko-KR');
  appendLog(`\n---\n\n## ${title} (${stamp})\n\n`);
}

function appendTurn(turnNo, role, text) {
  const label = role === 'user' ? '**나**' : '**agy**';
  const time = new Date().toLocaleTimeString('ko-KR');
  const quoted = String(text).split('\n').join('\n> ');
  appendLog(`### 턴 ${turnNo} — ${label} (${time})\n\n> ${quoted}\n\n`);
}

function ensureLogFile(opts) {
  if (fs.existsSync(LOG_PATH)) return;
  appendLog(`# agy 라이브 챗 기록\n\n- 모델: ${opts.model || 'CLI 기본값'}\n`);
}

function readAttachment(rawPath) {
  const filePath = path.resolve(rawPath);
  const text = fs.readFileSync(filePath, 'utf8');
  if (text.length > MAX_ATTACHMENT_CHARS) {
    throw new Error(`첨부 파일이 너무 큽니다(${text.length}자). ${MAX_ATTACHMENT_CHARS}자 이하만 붙일 수 있습니다.`);
  }
  return { path: filePath, text };
}

function composeWithAttachments(text, attachments) {
  if (!attachments.length) return text;
  const blocks = attachments.map(item => {
    const ext = path.extname(item.path).replace('.', '') || 'text';
    return `첨부 파일: ${item.path}\n\`\`\`${ext}\n${item.text}\n\`\`\``;
  });
  return `${blocks.join('\n\n')}\n\n${text}`;
}

function describeStep(step) {
  if (step.type !== 'tool') return null;
  if (step.state !== 'ACTIVE' && step.state !== 'ERROR') return null;
  const params = step.params && typeof step.params === 'object' ? step.params : null;
  let hint = '';
  if (params) {
    const key = ['AbsolutePath', 'TargetFile', 'CommandLine', 'Query', 'Pattern', 'SearchDirectory']
      .find(candidate => typeof params[candidate] === 'string' && params[candidate]);
    if (key) hint = ` ${String(params[key]).slice(0, 120)}`;
  }
  const mark = step.state === 'ERROR' ? '×' : '·';
  return `${mark} ${step.name}${hint}`;
}

// ── 한 턴 실행 ──────────────────────────────────────────────────────────────

async function runTurn(session, state, opts, text) {
  let printed = false;
  const result = await session.send(text, {
    onDelta: chunk => {
      if (!opts.stream) return;
      if (!printed) {
        if (!RAW_MODE) process.stdout.write(`${ANSI.cyan}agy > ${ANSI.reset}`);
        printed = true;
      }
      process.stdout.write(chunk);
    },
    onStep: step => {
      if (!opts.showSteps) return;
      const line = describeStep(step);
      if (!line) return;
      if (printed) {
        process.stdout.write('\n');
        printed = false;
      }
      info(`${ANSI.gray}  ${line}${ANSI.reset}`);
    },
  });
  if (opts.stream && printed) process.stdout.write('\n');

  // 응답을 다 받아 놓고도 턴이 ERROR 로 닫히는 경우가 있다(예: 마지막에 context canceled).
  // 그때 답변을 버리면 안 된다 — 경고만 남기고 정상 턴과 같이 기록한다.
  const partial = !result.ok && Boolean(result.reply);
  if (!result.ok && !partial) {
    const detail = result.error || result.status || '원인 미상';
    const hint = /permission/i.test(detail) && !opts.skipPermissions
      ? '\n(셸 명령 권한이 거부됐습니다. /yolo 로 자동 승인을 켜거나 --yolo 로 다시 실행하세요.)'
      : '';
    throw new Error(`${detail}${hint}`);
  }

  if (!opts.stream) {
    if (RAW_MODE) process.stdout.write(`${result.reply}\n`);
    else info(`${ANSI.cyan}agy > ${ANSI.reset}${result.reply}`);
  }

  state.turnCount += 1;
  state.conversationId = result.conversationId;
  state.usage = addUsage(state.usage, result.usage);
  saveState(state);
  appendTurn(state.turnCount, 'agy', result.reply);
  if (partial) {
    const detail = result.error || result.status;
    appendLog(`_경고: 턴이 ${result.status} 로 끝났지만 응답 본문은 모두 수신됨 — ${detail}_\n\n`);
    info(`${ANSI.red}  경고: 응답은 받았으나 agy 가 턴을 ${result.status} 로 닫았습니다: ${detail}${ANSI.reset}`);
  }
  info(`${ANSI.gray}  ${formatUsage(result.usage)} · ${result.durationSeconds.toFixed(1)}s`
    + ` · 누적 턴 ${result.numTurns}${ANSI.reset}`);
  return result;
}

// ── 메인 ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    info(HELP);
    return;
  }

  const cli = checkAgyCli();
  const saved = opts.forceNew ? null : loadState();
  const state = saved || { conversationId: null, turnCount: 0, model: null, effort: null, mode: null, usage: emptyUsage() };

  // 저장된 모델·effort 는 명령줄/환경변수가 없을 때만 이어 쓴다.
  if (!opts.model && state.model) opts.model = state.model;
  if (!opts.effort && state.effort) opts.effort = state.effort;
  if (!opts.mode && state.mode) opts.mode = state.mode;

  const addDirs = [opts.cwd, ...opts.addDirs].filter((dir, index, all) => all.indexOf(dir) === index);
  const session = new AgySession({
    command: cli.command,
    cwd: opts.cwd,
    model: opts.model,
    effort: opts.effort,
    mode: opts.mode,
    agent: opts.agent,
    addDirs,
    skipPermissions: opts.skipPermissions,
    sandbox: opts.sandbox,
    disableSlashCommands: opts.disableSlashCommands,
    timeoutSec: opts.timeoutSec,
    conversationId: state.conversationId,
    onWarning: text => info(`${ANSI.gray}경고: ${text}${ANSI.reset}`),
  });

  ensureLogFile(opts);
  info(`agy CLI: ${cli.version}`);
  info(`작업 디렉터리(에이전트): ${opts.cwd}`);
  info(`모델: ${opts.model || 'CLI 기본값'}${opts.effort ? ` (effort=${opts.effort})` : ''}`
    + `${opts.mode ? ` · mode=${opts.mode}` : ''}${opts.skipPermissions ? ' · 권한 자동 승인' : ''}`);
  if (state.conversationId) info(`이전 대화 이어붙이기: ${state.conversationId} (턴 ${state.turnCount}까지 진행됨)`);

  await session.start();
  const resumed = Boolean(state.conversationId) && state.conversationId === session.conversationId;
  state.conversationId = session.conversationId;
  state.model = opts.model;
  state.effort = opts.effort;
  state.mode = opts.mode;
  if (!resumed) state.turnCount = 0;
  saveState(state);

  appendDivider(resumed
    ? `세션 재개 (conversationId=${session.conversationId})`
    : `새 세션 시작 (conversationId=${session.conversationId})`);
  info(`대화 id: ${session.conversationId} · 권한 모드 ${session.permissionMode || '기본값'}`
    + ` · 도구 ${session.tools.length}개`);

  // 프로세스가 죽어 있으면(중단·타임아웃) 같은 대화 id 로 다시 이어붙인다.
  const ensureSession = async () => {
    if (session.running) return;
    info(`${ANSI.gray}세션을 다시 이어붙입니다...${ANSI.reset}`);
    await session.restart({ keepConversation: true });
  };

  // 비대화형: 한 턴만 실행하고 종료.
  if (opts.prompt !== null) {
    const text = String(opts.prompt).trim();
    if (!text) throw new Error('빈 프롬프트입니다.');
    appendTurn(state.turnCount + 1, 'user', text);
    try {
      // 응답 출력은 runTurn 이 맡는다(스트리밍이면 델타를, 아니면 완성본을 stdout 으로).
      await runTurn(session, state, opts, text);
    } finally {
      await session.close();
    }
    return;
  }

  info('대화를 시작하세요. 종료 /exit, 새 대화 /new, 명령 목록 /help');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: RAW_MODE ? '' : '나 > ',
  });
  // 파이프 입력은 마지막 줄을 읽은 시점에 rl 이 닫히는데, 그 뒤 prompt() 를 부르면
  // Node 24 는 ERR_USE_AFTER_CLOSE 를 던진다. 닫힘 여부를 직접 들고 다닌다.
  let rlClosed = false;
  rl.on('close', () => { rlClosed = true; });
  const showPrompt = () => { if (!RAW_MODE && !rlClosed) rl.prompt(); };

  let attachments = [];
  let interrupted = false;

  rl.on('SIGINT', () => {
    if (session.pending) {
      info('\n턴을 중단했습니다. 다음 입력 시 같은 대화로 다시 이어붙입니다.');
      session.kill();
      showPrompt();
      return;
    }
    interrupted = true;
    info('\n대화를 종료합니다. 다음 실행 시 이어서 대화할 수 있습니다.');
    rl.close();
  });

  try {
    showPrompt();
    // for-await 는 파이프 입력이라도 버퍼에 쌓인 줄을 전부 소비한 뒤 끝난다
    // (rl.question 방식은 네트워크 대기 중 EOF 가 오면 다음 호출이 끊긴다).
    for await (const raw of rl) {
      if (interrupted) break;
      const text = raw.trim();
      if (!text) { showPrompt(); continue; }

      if (EXIT_COMMANDS.has(text)) {
        info('대화를 종료합니다. 다음 실행 시 이어서 대화할 수 있습니다.');
        break;
      }

      if (text.startsWith('/')) {
        const [command, ...rest] = text.split(/\s+/);
        const argument = rest.join(' ').trim();

        if (command === NEW_SESSION_COMMAND) {
          await session.restart({ keepConversation: false });
          state.conversationId = session.conversationId;
          state.turnCount = 0;
          state.usage = emptyUsage();
          saveState(state);
          attachments = [];
          appendDivider(`새 세션 시작 (conversationId=${session.conversationId})`);
          info(`새 대화 시작: ${session.conversationId}`);
          showPrompt();
          continue;
        }

        if (command === '/help') { info(SLASH_HELP); showPrompt(); continue; }

        if (command === '/model') {
          if (!argument) {
            info(`현재 모델: ${session.model || 'CLI 기본값'}`);
          } else {
            session.model = argument;
            opts.model = argument;
            state.model = argument;
            saveState(state);
            await session.restart({ keepConversation: true });
            appendLog(`_모델 변경 → ${argument}_\n\n`);
            info(`모델을 ${argument} 로 변경했습니다. (대화 맥락 유지)`);
          }
          showPrompt();
          continue;
        }

        if (command === '/models') {
          try {
            const rows = listModels({ query: argument });
            info(`모델 ${rows.length}개${rows.length > 25 ? ' (상위 25개만 표시)' : ''}`);
            for (const row of rows.slice(0, 25)) {
              info(`  ${row.id}  ${ANSI.gray}${row.name}${ANSI.reset}`);
            }
          } catch (error) {
            info(`${ANSI.red}모델 목록 조회 실패: ${error.message || error}${ANSI.reset}`);
          }
          showPrompt();
          continue;
        }

        if (command === '/effort') {
          const value = argument.toLowerCase();
          if (!value) {
            info(`현재 effort: ${session.effort || '(모델 기본값)'}`);
          } else if (value === 'off') {
            session.effort = null;
            opts.effort = null;
            state.effort = null;
            saveState(state);
            await session.restart({ keepConversation: true });
            info('effort 를 모델 기본값으로 되돌렸습니다.');
          } else if (VALID_EFFORTS.has(value)) {
            session.effort = value;
            opts.effort = value;
            state.effort = value;
            saveState(state);
            await session.restart({ keepConversation: true });
            info(`effort 를 ${value} 로 설정했습니다.`);
          } else {
            info(`effort 는 ${[...VALID_EFFORTS].join(' | ')} | off 중 하나여야 합니다.`);
          }
          showPrompt();
          continue;
        }

        if (command === '/mode') {
          const value = argument.toLowerCase();
          if (!value) {
            info(`현재 mode: ${session.mode || '(기본값)'}`);
          } else if (value === 'off') {
            session.mode = null;
            opts.mode = null;
            state.mode = null;
            saveState(state);
            await session.restart({ keepConversation: true });
            info('mode 를 기본값으로 되돌렸습니다.');
          } else if (VALID_MODES.has(value)) {
            session.mode = value;
            opts.mode = value;
            state.mode = value;
            saveState(state);
            await session.restart({ keepConversation: true });
            info(`mode 를 ${value} 로 설정했습니다.`);
          } else {
            info(`mode 는 ${[...VALID_MODES].join(' | ')} | off 중 하나여야 합니다.`);
          }
          showPrompt();
          continue;
        }

        if (command === '/yolo') {
          session.skipPermissions = !session.skipPermissions;
          opts.skipPermissions = session.skipPermissions;
          await session.restart({ keepConversation: true });
          info(`권한 자동 승인: ${session.skipPermissions ? 'ON (셸 명령까지 자동 승인)' : 'OFF'}`);
          showPrompt();
          continue;
        }

        if (command === '/tools') {
          info(`권한 모드: ${session.permissionMode || '기본값'} · 작업 디렉터리: ${session.agentCwd || opts.cwd}`);
          info(`도구 ${session.tools.length}개: ${session.tools.join(', ')}`);
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
              info(`첨부 예약: ${item.path} (${item.text.length}자) — 다음 메시지에 함께 보냅니다.`);
            } catch (error) {
              info(`${ANSI.red}첨부 실패: ${error.message || error}${ANSI.reset}`);
            }
          }
          showPrompt();
          continue;
        }

        if (command === '/steps') {
          opts.showSteps = !opts.showSteps;
          info(`도구 실행 로그: ${opts.showSteps ? 'ON' : 'OFF'}`);
          showPrompt();
          continue;
        }

        if (command === '/stream') {
          opts.stream = !opts.stream;
          info(`스트리밍: ${opts.stream ? 'ON' : 'OFF'}`);
          showPrompt();
          continue;
        }

        if (command === '/info') {
          info(`대화 id: ${session.conversationId}`);
          info(`작업 디렉터리: ${session.agentCwd || opts.cwd}`);
          info(`모델: ${session.model || 'CLI 기본값'}${session.effort ? ` (effort=${session.effort})` : ''}`
            + `${session.mode ? ` · mode=${session.mode}` : ''}`);
          info(`이 러너 기준 턴 수: ${state.turnCount} · 프로세스 누적 턴: ${session.numTurns}`);
          info(`프로세스: ${session.running ? '실행 중' : '중단됨(다음 입력 시 재개)'}`);
          showPrompt();
          continue;
        }

        if (command === '/usage') {
          info(`누적 토큰: ${formatUsage(state.usage)}`);
          showPrompt();
          continue;
        }

        info(`알 수 없는 명령: ${command} (/help 로 목록 확인)`);
        showPrompt();
        continue;
      }

      const message = composeWithAttachments(text, attachments);
      attachments = [];

      appendTurn(state.turnCount + 1, 'user', message);
      try {
        await ensureSession();
        await runTurn(session, state, opts, message);
      } catch (error) {
        const detail = error.message || String(error);
        info(`${ANSI.red}응답 실패: ${detail}${ANSI.reset}`);
        appendTurn(state.turnCount + 1, 'agy', `[오류] ${detail}`);
      }
      showPrompt();
    }
  } finally {
    await session.close();
    rl.close();
  }
}

main().catch(error => {
  process.stderr.write(`오류: ${error.message || error}\n`);
  process.exit(1);
});
