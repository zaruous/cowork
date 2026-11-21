'use strict';

/**
 * opencode-live-chat.js — OpenCode CLI 라이브 챗 러너
 *
 * 턴마다 `opencode run --format json` 을 띄우고, 프롬프트는 stdin 으로 넘긴다
 * (Windows 명령줄 길이 제한·한글 인코딩 문제를 피하려고 인자로 넣지 않는다).
 * 첫 턴 응답의 sessionID 를 저장해 두고, 다음 턴부터 `--session <id>` 로 이어 붙인다.
 *
 * 사용 예:
 *   node opencode-live-chat.js                         # 이전 세션 재개
 *   node opencode-live-chat.js --new --cwd D:\git\repo  # 새 세션, 대상 repo 에서 작업
 *   node opencode-live-chat.js --model openai/gpt-5.1 --agent plan
 *   node opencode-live-chat.js --raw --prompt "질문" > answer.md
 *   node opencode-live-chat.js --cwd D:\git\repo --prompt-file prompts/task.md --auto
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');

try { require('./load-env').load(); } catch { /* .env 없이도 동작 */ }

const STATE_PATH = path.join(__dirname, '.opencode-session.json');
const LOG_PATH = path.join(__dirname, 'opencode-live-chat.md');
const EXIT_COMMANDS = new Set(['/exit', '/quit', '종료']);
const NEW_SESSION_COMMAND = '/new';
const DEFAULT_TIMEOUT_SEC = 600;

const HELP = `opencode-live-chat.js — OpenCode CLI 라이브 챗

옵션:
  --new                  이전 세션을 버리고 새로 시작
  --cwd <path>           에이전트가 파일을 읽고 명령을 실행할 디렉터리 (기본 이 스크립트 폴더)
  --model <p/m>          모델 (provider/model[#variant], 목록은 \`opencode models\`)
  --agent <name>         에이전트 (예: build, plan)
  --auto                 명시적으로 거부되지 않은 권한 자동 승인 (셸·편집)
  --thinking             thinking 블록도 출력
  --timeout <sec>        한 턴 제한 시간 (기본 ${DEFAULT_TIMEOUT_SEC}초)
  --prompt <text>        한 턴만 실행하고 종료 (비대화형)
  --prompt-file <path>   파일 내용을 그대로 한 턴 보내고 종료 (비대화형)
  --raw                  응답 본문만 stdout 으로 (안내는 stderr) — 파이프용
  --help                 이 도움말

환경변수: OPENCODE_BIN, OPENCODE_MODEL, OPENCODE_AGENT, OPENCODE_CHAT_CWD,
          OPENCODE_TIMEOUT(초), OPENCODE_AUTO=1

대화 중 명령: /new (새 세션), /exit · /quit · 종료 (세션 보존하고 종료), Ctrl+C (호출 중단)
`;

function parseArgs(argv) {
  const opts = {
    forceNew: false,
    cwd: process.env.OPENCODE_CHAT_CWD || __dirname,
    model: String(process.env.OPENCODE_MODEL || '').trim(),
    agent: String(process.env.OPENCODE_AGENT || '').trim(),
    auto: process.env.OPENCODE_AUTO === '1',
    thinking: false,
    timeoutSec: Number(process.env.OPENCODE_TIMEOUT) > 0
      ? Number(process.env.OPENCODE_TIMEOUT)
      : DEFAULT_TIMEOUT_SEC,
    prompt: null,
    raw: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} 다음에 값이 필요합니다.`);
      }
      i += 1;
      return value;
    };
    switch (arg) {
      case '--new': opts.forceNew = true; break;
      case '--cwd': opts.cwd = path.resolve(next()); break;
      case '--model': opts.model = next(); break;
      case '--agent': opts.agent = next(); break;
      case '--auto': opts.auto = true; break;
      case '--thinking': opts.thinking = true; break;
      case '--timeout': {
        const sec = Number(next());
        if (!(sec > 0)) throw new Error('--timeout 은 양수(초)여야 합니다.');
        opts.timeoutSec = sec;
        break;
      }
      case '--prompt': opts.prompt = next(); break;
      case '--prompt-file': opts.prompt = fs.readFileSync(path.resolve(next()), 'utf8'); break;
      case '--raw': opts.raw = true; break;
      case '--help':
      case '-h':
        process.stdout.write(HELP);
        process.exit(0);
        break;
      default:
        throw new Error(`알 수 없는 옵션: ${arg} (--help 참고)`);
    }
  }

  if (!fs.existsSync(opts.cwd) || !fs.statSync(opts.cwd).isDirectory()) {
    throw new Error(`--cwd 디렉터리가 없습니다: ${opts.cwd}`);
  }
  if (opts.prompt !== null && !opts.prompt.trim()) {
    throw new Error('보낼 프롬프트가 비어 있습니다.');
  }
  return opts;
}

// --raw 에서는 stdout 에 응답만 흘리고 안내·상태는 stderr 로 보낸다.
let RAW = false;
function info(text) {
  (RAW ? process.stderr : process.stdout).write(`${text}\n`);
}

function loadState() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    if (!state || typeof state !== 'object') return null;
    return {
      sessionId: typeof state.sessionId === 'string' ? state.sessionId : null,
      turnCount: Number.isInteger(state.turnCount) ? state.turnCount : 0,
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
  const label = role === 'user' ? '**나**' : '**OpenCode**';
  const time = new Date().toLocaleTimeString('ko-KR');
  const quoted = String(text).split('\n').join('\n> ');
  appendLog(`### 턴 ${turnNo} — ${label} (${time})\n\n> ${quoted}\n\n`);
}

function ensureLogFile(opts) {
  if (!fs.existsSync(LOG_PATH)) {
    appendLog(`# OpenCode 라이브 챗 기록\n\n- 모델: ${opts.model || 'CLI 기본값'}\n`);
  }
}

/**
 * opencode 실행 파일 찾기.
 * npm 전역 설치 시 opencode.cmd 셰임 뒤에 네이티브 exe 가 있다. .cmd 를 shell 로 띄우면
 * 인자 인용·Ctrl+C 처리가 꼬이므로 exe 를 직접 spawn 한다.
 */
function resolveOpencodeBin() {
  if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN;
  if (process.platform === 'win32') {
    const candidates = [];
    if (process.env.APPDATA) {
      candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe'));
      candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'));
    }
    if (process.env.USERPROFILE) {
      candidates.push(path.join(process.env.USERPROFILE, '.opencode', 'bin', 'opencode.exe'));
    }
    for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
      if (dir) candidates.push(path.join(dir, 'opencode.exe'));
    }
    const found = candidates.find(p => fs.existsSync(p));
    if (found) return found;
  }
  return 'opencode';
}

function checkOpencodeCli(bin) {
  const result = spawnSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true });
  if (result.error) {
    throw new Error(`OpenCode CLI를 실행할 수 없습니다 (${bin}): ${result.error.message}\n`
      + '설치: npm i -g opencode-ai  또는 OPENCODE_BIN 으로 경로 지정');
  }
  if (result.status !== 0) {
    throw new Error(`OpenCode CLI 확인 실패: ${String(result.stderr || '').trim()}`);
  }
  return String(result.stdout || '').trim();
}

function terminateProcessTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.on('error', () => { try { child.kill(); } catch { /* ignore */ } });
    return;
  }
  try { child.kill('SIGTERM'); } catch { /* ignore */ }
}

function getEventError(event) {
  if (!event) return '';
  if (typeof event.error === 'string') return event.error;
  if (event.error && typeof event.error.message === 'string') {
    return event.error.type ? `${event.error.message} (${event.error.type})` : event.error.message;
  }
  if (typeof event.message === 'string') return event.message;
  return '';
}

function formatTool(part) {
  const tool = part.tool || 'tool';
  const input = part.state?.input || {};
  const hint = input.command || input.filePath || input.path || input.pattern || input.url || '';
  const status = part.state?.status ? ` ${part.state.status}` : '';
  return `  · [${tool}${status}] ${String(hint).split('\n')[0].slice(0, 120)}`;
}

/**
 * 한 턴 실행. stdout 의 JSONL 이벤트를 줄 단위로 읽으며
 * text 파트를 모으고, tool 사용은 진행 표시로 stderr 에 찍는다.
 */
function runOpencodeTurn(prompt, sessionId, opts, bin, setActiveProcess) {
  return new Promise((resolve, reject) => {
    const args = ['run', '--format', 'json'];
    if (sessionId) args.push('--session', sessionId);
    if (opts.model) args.push('--model', opts.model);
    if (opts.agent) args.push('--agent', opts.agent);
    if (opts.auto) args.push('--auto');
    if (opts.thinking) args.push('--thinking');

    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: process.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    setActiveProcess(child);

    const texts = [];
    let newSessionId = null;
    let failure = null;
    let stderr = '';
    let buffer = '';
    let usage = null;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
    }, opts.timeoutSec * 1000);

    const handleLine = line => {
      if (!line.trim()) return;
      let event;
      try { event = JSON.parse(line); } catch { return; } // JSON 이 아닌 줄(경고 등)은 무시
      if (event.sessionID && !newSessionId) newSessionId = event.sessionID;
      switch (event.type) {
        case 'text':
          if (typeof event.part?.text === 'string') texts.push(event.part.text);
          break;
        case 'reasoning':
          if (opts.thinking && event.part?.text) process.stderr.write(`  (thinking) ${event.part.text}\n`);
          break;
        case 'tool_use':
          process.stderr.write(`${formatTool(event.part || {})}\n`);
          break;
        case 'step_finish':
          if (event.part?.tokens) usage = event.part.tokens;
          break;
        case 'error':
          failure = event;
          break;
        default:
          break;
      }
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      lines.forEach(handleLine);
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdin.on('error', error => {
      if (error.code !== 'EPIPE') stderr += `\nstdin: ${error.message}`;
    });
    child.stdin.end(prompt, 'utf8');

    child.on('error', error => {
      clearTimeout(timer);
      setActiveProcess(null);
      reject(new Error(`OpenCode CLI 실행 실패: ${error.message}`));
    });

    child.on('close', code => {
      clearTimeout(timer);
      setActiveProcess(null);
      if (buffer) handleLine(buffer);

      if (timedOut) {
        reject(Object.assign(new Error(`제한 시간 ${opts.timeoutSec}초를 넘겨 중단했습니다.`), { sessionId: newSessionId }));
        return;
      }
      if (failure || code !== 0) {
        const detail = getEventError(failure) || stderr.trim() || `OpenCode CLI가 종료 코드 ${code}로 종료됐습니다.`;
        reject(Object.assign(new Error(detail), { sessionId: newSessionId }));
        return;
      }
      if (!newSessionId) {
        reject(new Error('OpenCode CLI 응답에 sessionID가 없습니다.'));
        return;
      }
      const reply = texts.join('\n').trim();
      if (!reply) {
        reject(Object.assign(new Error('OpenCode CLI가 텍스트 응답을 반환하지 않았습니다.'), { sessionId: newSessionId }));
        return;
      }
      resolve({ reply, sessionId: newSessionId, usage });
    });
  });
}

function formatUsage(usage) {
  if (!usage) return '';
  const cache = usage.cache?.read ? `, cache ${usage.cache.read}` : '';
  return `  (tokens in ${usage.input ?? '?'} / out ${usage.output ?? '?'}${usage.reasoning ? ` / reasoning ${usage.reasoning}` : ''}${cache})`;
}

async function runOneTurn(text, state, opts, bin, setActiveProcess) {
  state.turnCount += 1;
  appendTurn(state.turnCount, 'user', text);
  saveState(state);
  try {
    const result = await runOpencodeTurn(text, state.sessionId, opts, bin, setActiveProcess);
    state.sessionId = result.sessionId;
    saveState(state);
    appendTurn(state.turnCount, 'opencode', result.reply);
    return result;
  } catch (error) {
    // 실패해도 세션이 만들어졌으면 이어 붙일 수 있게 저장한다.
    if (!state.sessionId && error.sessionId) state.sessionId = error.sessionId;
    saveState(state);
    appendTurn(state.turnCount, 'opencode', `[오류] ${error.message || error}`);
    throw error;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  RAW = opts.raw;
  const bin = resolveOpencodeBin();
  const version = checkOpencodeCli(bin);

  ensureLogFile(opts);

  let state = opts.forceNew ? null : loadState();
  if (state && state.sessionId) {
    info(`기존 세션 재개: ${state.sessionId} (턴 ${state.turnCount}까지 진행됨)`);
    appendDivider(`세션 재개 (sessionId=${state.sessionId})`);
  } else {
    state = { sessionId: null, turnCount: 0 };
    saveState(state);
    appendDivider('새 세션 시작');
    info('새 세션을 시작합니다.');
  }

  info(`OpenCode CLI: ${version}`);
  info(`모델: ${opts.model || 'CLI 기본값'}${opts.agent ? ` · 에이전트: ${opts.agent}` : ''}${opts.auto ? ' · 권한 자동 승인' : ''}`);
  info(`작업 디렉터리: ${opts.cwd}`);

  let activeProcess = null;
  const setActiveProcess = value => { activeProcess = value; };

  // 비대화형: 한 턴만
  if (opts.prompt !== null) {
    process.on('SIGINT', () => { terminateProcessTree(activeProcess); process.exit(130); });
    const result = await runOneTurn(opts.prompt, state, opts, bin, setActiveProcess);
    if (opts.raw) {
      process.stdout.write(`${result.reply}\n`);
    } else {
      console.log(`OpenCode > ${result.reply}`);
      console.log(formatUsage(result.usage));
    }
    return;
  }

  info('대화를 시작하세요. 종료하려면 /exit, 새 세션을 시작하려면 /new 를 입력하세요.');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '나 > ',
  });

  let closed = false;
  rl.on('close', () => { closed = true; });
  const prompt = () => { if (!closed) rl.prompt(); };

  rl.on('SIGINT', () => {
    if (activeProcess) {
      console.log('\n진행 중인 호출을 중단합니다. (한 번 더 Ctrl+C 하면 종료)');
      terminateProcessTree(activeProcess);
      return;
    }
    console.log('\n세션을 보존하고 종료합니다. 다음 실행 시 이어서 대화할 수 있습니다.');
    rl.close();
  });

  try {
    prompt();
    for await (const raw of rl) {
      const text = raw.trim();
      if (!text) {
        prompt();
        continue;
      }
      if (EXIT_COMMANDS.has(text)) {
        console.log('대화를 종료합니다. 다음 실행 시 이어서 대화할 수 있습니다.');
        break;
      }
      if (text === NEW_SESSION_COMMAND) {
        terminateProcessTree(activeProcess);
        state = { sessionId: null, turnCount: 0 };
        saveState(state);
        appendDivider('새 세션 시작');
        console.log('새 세션을 시작합니다.');
        prompt();
        continue;
      }

      try {
        const result = await runOneTurn(text, state, opts, bin, setActiveProcess);
        console.log(`OpenCode > ${result.reply}`);
        console.log(`${formatUsage(result.usage)}\n`);
      } catch (error) {
        console.error(`응답 실패: ${error.message || error}`);
      }
      prompt();
    }
  } finally {
    terminateProcessTree(activeProcess);
    rl.close();
  }
}

main().catch(error => {
  console.error('오류:', error.message || error);
  process.exit(1);
});
