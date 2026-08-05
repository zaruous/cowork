'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CURSOR_MODEL_ID = 'composer-2.5';
const STATE_PATH = path.join(__dirname, '.cursor-session.json');
const LOG_PATH = path.join(__dirname, 'cursor-live-chat.md');
const EXIT_COMMANDS = new Set(['/exit', '/quit', '종료']);
const NEW_SESSION_COMMAND = '/new';

// 에이전트가 파일을 읽고 명령을 실행할 디렉터리.
// --cwd <path> 또는 CURSOR_CHAT_CWD 로 다른 프로젝트를 지정할 수 있고,
// 지정하지 않으면 기존과 동일하게 이 스크립트가 있는 폴더를 쓴다.
// (세션 상태와 대화 로그는 항상 __dirname 에 모아 둔다.)
function resolveAgentCwd() {
  const flagIndex = process.argv.indexOf('--cwd');
  const fromFlag = flagIndex >= 0 ? process.argv[flagIndex + 1] : null;
  const raw = fromFlag || process.env.CURSOR_CHAT_CWD || __dirname;
  return path.resolve(raw);
}

const AGENT_CWD = resolveAgentCwd();

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
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
  const label = role === 'user' ? '**나**' : '**Cursor**';
  const time = new Date().toLocaleTimeString('ko-KR');
  const quoted = String(text).split('\n').join('\n> ');
  appendLog(`### 턴 ${turnNo} — ${label} (${time})\n\n> ${quoted}\n\n`);
}

async function createFreshAgent(Agent, apiKey) {
  const agent = await Agent.create({
    apiKey,
    model: { id: CURSOR_MODEL_ID },
    // 이 환경은 로컬 샌드박싱을 지원하지 않아 sandboxOptions는 넣지 않는다.
    local: { cwd: AGENT_CWD, settingSources: [] },
  });
  return agent;
}

async function main() {
  const apiKey = String(process.env.CURSOR_API_KEY || '').trim();
  if (!apiKey) {
    console.error('CURSOR_API_KEY 환경변수가 설정되어 있지 않습니다.');
    process.exit(1);
  }

  const forceNew = process.argv.includes('--new');
  const { Agent } = require('@cursor/sdk');

  let state = forceNew ? null : loadState();
  let agent;

  if (state && state.agentId) {
    try {
      console.log(`기존 세션 재개 시도: ${state.agentId} (턴 ${state.turnCount}까지 진행됨)`);
      agent = await Agent.resume(state.agentId, {
        apiKey,
        model: { id: CURSOR_MODEL_ID },
        local: { cwd: AGENT_CWD, settingSources: [] },
      });
      appendDivider(`세션 재개 (agentId=${state.agentId})`);
    } catch (error) {
      console.warn(`세션 재개 실패, 새 세션으로 시작합니다: ${error.message || error}`);
      state = null;
    }
  }

  if (!agent) {
    agent = await createFreshAgent(Agent, apiKey);
    state = { agentId: agent.agentId, turnCount: 0 };
    saveState(state);
    if (!fs.existsSync(LOG_PATH)) {
      appendLog(`# Cursor 라이브 챗 기록\n\n- 모델: ${CURSOR_MODEL_ID}\n`);
    }
    appendDivider(`새 세션 시작 (agentId=${agent.agentId})`);
    console.log(`새 세션 시작: ${agent.agentId}`);
  }

  console.log(`작업 디렉터리(에이전트): ${AGENT_CWD}`);
  console.log('대화를 시작하세요. 종료하려면 /exit, 새 세션을 시작하려면 /new 를 입력하세요.');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '나 > ' });

  let closed = false;
  const closeAgent = async () => {
    if (closed) return;
    closed = true;
    try { agent.close(); } catch {
      // ignore
    }
  };
  rl.on('SIGINT', async () => {
    console.log('\n중단 신호를 받아 세션을 종료합니다. 다음 실행 시 이어서 대화할 수 있습니다.');
    await closeAgent();
    rl.close();
    process.exit(0);
  });

  try {
    rl.prompt();
    // for-await는 파이프 입력이라도 이미 버퍼에 쌓인 줄을 전부 소비한 뒤 끝난다
    // (rl.question 방식은 네트워크 대기 중 EOF가 오면 다음 호출이 끊겨버림).
    for await (const raw of rl) {
      const text = raw.trim();
      if (!text) { rl.prompt(); continue; }

      if (EXIT_COMMANDS.has(text)) {
        console.log('대화를 종료합니다. 다음 실행 시 이어서 대화할 수 있습니다.');
        break;
      }

      if (text === NEW_SESSION_COMMAND) {
        await closeAgent();
        agent = await createFreshAgent(Agent, apiKey);
        closed = false;
        state = { agentId: agent.agentId, turnCount: 0 };
        saveState(state);
        appendDivider(`새 세션 시작 (agentId=${agent.agentId})`);
        console.log(`새 세션 시작: ${agent.agentId}`);
        rl.prompt();
        continue;
      }

      state.turnCount += 1;
      appendTurn(state.turnCount, 'user', text);
      saveState(state);

      const run = await agent.send(text);
      const result = await run.wait();
      if (result.status !== 'finished') {
        const detail = (result.error && result.error.message) || result.status;
        console.error(`응답 실패: ${detail}`);
        appendTurn(state.turnCount, 'cursor', `[오류] ${detail}`);
        rl.prompt();
        continue;
      }
      const reply = String(result.result || '').trim();
      console.log(`Cursor > ${reply}\n`);
      appendTurn(state.turnCount, 'cursor', reply);
      saveState(state);
      rl.prompt();
    }
  } finally {
    await closeAgent();
    rl.close();
  }
}

main().catch(error => {
  console.error('오류:', error.message || error);
  process.exit(1);
});
