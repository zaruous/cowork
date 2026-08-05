'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');

const CODEX_MODEL_ID = String(process.env.CODEX_MODEL || '').trim();
const STATE_PATH = path.join(__dirname, '.codex-session.json');
const LOG_PATH = path.join(__dirname, 'codex-live-chat.md');
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
  const label = role === 'user' ? '**나**' : '**Codex**';
  const time = new Date().toLocaleTimeString('ko-KR');
  const quoted = String(text).split('\n').join('\n> ');
  appendLog(`### 턴 ${turnNo} — ${label} (${time})\n\n> ${quoted}\n\n`);
}

function ensureLogFile() {
  if (!fs.existsSync(LOG_PATH)) {
    const model = CODEX_MODEL_ID || 'CLI 기본값';
    appendLog(`# Codex 라이브 챗 기록\n\n- 모델: ${model}\n`);
  }
}

function getCodexInvocation() {
  if (process.platform === 'win32' && process.env.APPDATA) {
    const scriptPath = path.join(
      process.env.APPDATA,
      'npm',
      'node_modules',
      '@openai',
      'codex',
      'bin',
      'codex.js',
    );
    if (fs.existsSync(scriptPath)) {
      return { command: process.execPath, prefixArgs: [scriptPath] };
    }
  }
  return { command: 'codex', prefixArgs: [] };
}

function createCodexEnv() {
  const env = { ...process.env };
  delete env.CODEX_API_KEY;
  delete env.OPENAI_API_KEY;
  return env;
}

function runCodexSync(args) {
  const invocation = getCodexInvocation();
  return spawnSync(invocation.command, [...invocation.prefixArgs, ...args], {
    encoding: 'utf8',
    env: createCodexEnv(),
    windowsHide: true,
  });
}

function checkCodexCli() {
  const versionCheck = runCodexSync(['--version']);
  if (versionCheck.error) {
    throw new Error(`Codex CLI를 실행할 수 없습니다: ${versionCheck.error.message}`);
  }
  if (versionCheck.status !== 0) {
    throw new Error(`Codex CLI 확인 실패: ${String(versionCheck.stderr || '').trim()}`);
  }

  const loginCheck = runCodexSync(['login', 'status']);
  const loginText = `${loginCheck.stdout || ''}\n${loginCheck.stderr || ''}`.trim();
  const loggedIn = loginCheck.status === 0 && !/not logged in/i.test(loginText);
  if (!loggedIn) {
    throw new Error('Codex CLI에 ChatGPT 계정으로 로그인되어 있지 않습니다. `codex login`을 실행하세요.');
  }

  return {
    version: String(versionCheck.stdout || '').trim(),
    auth: 'ChatGPT 계정',
  };
}

function parseJsonLines(stdout) {
  const events = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      throw new Error(`Codex CLI JSONL 응답을 해석할 수 없습니다.\n${line}`);
    }
  }
  return events;
}

function getEventError(event) {
  if (!event) return '';
  if (typeof event.message === 'string') return event.message;
  if (typeof event.error === 'string') return event.error;
  if (event.error && typeof event.error.message === 'string') return event.error.message;
  return '';
}

function terminateProcessTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill.exe', [
      '/pid',
      String(child.pid),
      '/t',
      '/f',
    ], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.on('error', () => {
      try { child.kill(); } catch {
        // ignore
      }
    });
    return;
  }

  try { child.kill('SIGTERM'); } catch {
    // ignore
  }
}

function runCodexTurn(prompt, sessionId, setActiveProcess) {
  return new Promise((resolve, reject) => {
    const args = sessionId
      ? [
        'exec',
        'resume',
        sessionId,
        '--json',
        '--skip-git-repo-check',
        '--ignore-user-config',
        '--ignore-rules',
      ]
      : [
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--ignore-user-config',
        '--ignore-rules',
        '--color',
        'never',
      ];
    if (CODEX_MODEL_ID) args.push('--model', CODEX_MODEL_ID);
    args.push('-');

    const invocation = getCodexInvocation();
    const child = spawn(invocation.command, [...invocation.prefixArgs, ...args], {
      cwd: __dirname,
      env: createCodexEnv(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    setActiveProcess(child);

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdin.on('error', error => {
      if (error.code !== 'EPIPE') stderr += `\nstdin: ${error.message}`;
    });
    child.stdin.end(prompt, 'utf8');

    child.on('error', error => {
      setActiveProcess(null);
      reject(new Error(`Codex CLI 실행 실패: ${error.message}`));
    });

    child.on('close', code => {
      setActiveProcess(null);
      let events;
      try {
        events = parseJsonLines(stdout);
      } catch (error) {
        reject(error);
        return;
      }

      const threadEvent = events.find(event => event.type === 'thread.started');
      const agentMessages = events.filter(
        event => event.type === 'item.completed'
          && event.item?.type === 'agent_message'
          && typeof event.item.text === 'string',
      );
      const failure = events.find(event => event.type === 'turn.failed' || event.type === 'error');

      if (code !== 0 || failure) {
        const detail = getEventError(failure) || stderr.trim() || `Codex CLI가 종료 코드 ${code}로 종료됐습니다.`;
        reject(new Error(detail));
        return;
      }
      if (!threadEvent?.thread_id) {
        reject(new Error('Codex CLI 응답에 thread_id가 없습니다.'));
        return;
      }
      if (!agentMessages.length) {
        reject(new Error('Codex CLI가 최종 응답을 반환하지 않았습니다.'));
        return;
      }

      resolve({
        reply: agentMessages[agentMessages.length - 1].item.text.trim(),
        sessionId: threadEvent.thread_id,
      });
    });
  });
}

async function main() {
  const forceNew = process.argv.includes('--new');
  const cli = checkCodexCli();

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

  console.log(`Codex CLI: ${cli.version}`);
  console.log(`인증: ${cli.auth}`);
  console.log(`모델: ${CODEX_MODEL_ID || 'CLI 기본값'}`);
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
    terminateProcessTree(activeProcess);
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
        terminateProcessTree(activeProcess);
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
        const result = await runCodexTurn(text, state.sessionId, setActiveProcess);
        state.sessionId = result.sessionId;
        saveState(state);
        console.log(`Codex > ${result.reply}\n`);
        appendTurn(state.turnCount, 'codex', result.reply);
      } catch (error) {
        const detail = error.message || String(error);
        saveState(state);
        console.error(`응답 실패: ${detail}`);
        appendTurn(state.turnCount, 'codex', `[오류] ${detail}`);
      }

      rl.prompt();
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
