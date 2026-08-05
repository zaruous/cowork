'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');

const CLAUDE_MODEL_ID = String(process.env.CLAUDE_MODEL || 'sonnet').trim();
const STATE_PATH = path.join(__dirname, '.claude-session.json');
const LOG_PATH = path.join(__dirname, 'claude-live-chat.md');
const EXIT_COMMANDS = new Set(['/exit', '/quit', '종료']);
const NEW_SESSION_COMMAND = '/new';

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
  const label = role === 'user' ? '**나**' : '**Claude**';
  const time = new Date().toLocaleTimeString('ko-KR');
  const quoted = String(text).split('\n').join('\n> ');
  appendLog(`### 턴 ${turnNo} — ${label} (${time})\n\n> ${quoted}\n\n`);
}

function ensureLogFile() {
  if (!fs.existsSync(LOG_PATH)) {
    appendLog(`# Claude 라이브 챗 기록\n\n- 모델: ${CLAUDE_MODEL_ID}\n`);
  }
}

function checkClaudeCli() {
  const versionCheck = spawnSync('claude', ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (versionCheck.error) {
    throw new Error(`Claude CLI를 실행할 수 없습니다: ${versionCheck.error.message}`);
  }
  if (versionCheck.status !== 0) {
    throw new Error(`Claude CLI 확인 실패: ${String(versionCheck.stderr || '').trim()}`);
  }

  const authCheck = spawnSync('claude', ['auth', 'status'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (authCheck.error || authCheck.status !== 0) {
    const detail = authCheck.error?.message || String(authCheck.stderr || '').trim();
    throw new Error(`Claude CLI 로그인 확인 실패: ${detail}`);
  }

  let auth;
  try {
    auth = JSON.parse(authCheck.stdout);
  } catch {
    throw new Error('Claude CLI 로그인 상태를 해석할 수 없습니다.');
  }
  if (!auth.loggedIn) {
    throw new Error('Claude CLI에 로그인되어 있지 않습니다. `claude auth login`을 실행하세요.');
  }

  return String(versionCheck.stdout || '').trim();
}

function runClaudeTurn(prompt, sessionId, setActiveProcess) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      prompt,
      '--output-format',
      'json',
      '--model',
      CLAUDE_MODEL_ID,
      '--permission-mode',
      'dontAsk',
      '--safe-mode',
    ];
    if (sessionId) args.push('--resume', sessionId);

    const child = spawn('claude', args, {
      cwd: __dirname,
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    setActiveProcess(child);

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });

    child.on('error', error => {
      setActiveProcess(null);
      reject(new Error(`Claude CLI 실행 실패: ${error.message}`));
    });

    child.on('close', code => {
      setActiveProcess(null);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Claude CLI가 종료 코드 ${code}로 종료됐습니다.`));
        return;
      }

      let result;
      try {
        result = JSON.parse(stdout);
      } catch {
        reject(new Error(`Claude CLI JSON 응답을 해석할 수 없습니다.\n${stdout.trim()}`));
        return;
      }

      if (result.is_error) {
        reject(new Error(String(result.result || result.error || 'Claude CLI 응답 오류')));
        return;
      }
      if (!result.session_id) {
        reject(new Error('Claude CLI 응답에 session_id가 없습니다.'));
        return;
      }

      resolve({
        reply: String(result.result || '').trim(),
        sessionId: result.session_id,
      });
    });
  });
}

async function main() {
  const forceNew = process.argv.includes('--new');
  const cliVersion = checkClaudeCli();

  ensureLogFile();

  let state = forceNew ? null : loadState();
  if (state && state.sessionId) {
    console.log(`기존 세션 재개: ${state.sessionId} (턴 ${state.turnCount}까지 진행됨)`);
    appendDivider(`세션 재개 (sessionId=${state.sessionId})`);
  } else {
    state = { sessionId: null, turnCount: 0 };
    saveState(state);
    appendDivider('새 세션 시작');
    console.log('새 세션을 시작합니다.');
  }

  console.log(`Claude CLI: ${cliVersion}`);
  console.log(`모델: ${CLAUDE_MODEL_ID}`);
  console.log('대화를 시작하세요. 종료하려면 /exit, 새 세션을 시작하려면 /new 를 입력하세요.');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '나 > ',
  });

  let activeProcess = null;
  const setActiveProcess = value => { activeProcess = value; };

  rl.on('SIGINT', () => {
    console.log('\n중단 신호를 받아 세션을 종료합니다. 다음 실행 시 이어서 대화할 수 있습니다.');
    try { activeProcess?.kill(); } catch {
      // ignore
    }
    rl.close();
  });

  try {
    rl.prompt();
    for await (const raw of rl) {
      const text = raw.trim();
      if (!text) {
        rl.prompt();
        continue;
      }

      if (EXIT_COMMANDS.has(text)) {
        console.log('대화를 종료합니다. 다음 실행 시 이어서 대화할 수 있습니다.');
        break;
      }

      if (text === NEW_SESSION_COMMAND) {
        try { activeProcess?.kill(); } catch {
          // ignore
        }
        state = { sessionId: null, turnCount: 0 };
        saveState(state);
        appendDivider('새 세션 시작');
        console.log('새 세션을 시작합니다.');
        rl.prompt();
        continue;
      }

      state.turnCount += 1;
      appendTurn(state.turnCount, 'user', text);
      saveState(state);

      try {
        const result = await runClaudeTurn(text, state.sessionId, setActiveProcess);
        state.sessionId = result.sessionId;
        saveState(state);
        console.log(`Claude > ${result.reply}\n`);
        appendTurn(state.turnCount, 'claude', result.reply);
      } catch (error) {
        const detail = error.message || String(error);
        if (error.sessionId) state.sessionId = error.sessionId;
        saveState(state);
        console.error(`응답 실패: ${detail}`);
        appendTurn(state.turnCount, 'claude', `[오류] ${detail}`);
      }

      rl.prompt();
    }
  } finally {
    try { activeProcess?.kill(); } catch {
      // ignore
    }
    rl.close();
  }
}

main().catch(error => {
  console.error('오류:', error.message || error);
  process.exit(1);
});
