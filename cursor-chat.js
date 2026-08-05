'use strict';

const fs = require('fs');
const path = require('path');

const CURSOR_MODEL_ID = 'composer-2.5';

const TURNS = [
  '안녕하세요! 처음 뵙겠습니다. Cursor 에이전트와의 대화 테스트를 시작할게요.',
  '반갑습니다! 오늘 컨디션은 어떤가요?',
  '네, 대화가 잘 이어지는지 확인 중이에요. 계속 잘 부탁드려요.',
  '슬슬 대화를 마무리해볼까 하는데, 오늘 대화 소감이 어떠신가요?',
  '마지막 인사를 나눌 차례네요. 오늘 대화 즐거웠습니다. 안녕히 가세요!',
];

async function createCursorAgent(Agent, apiKey, cwd) {
  // 이 Windows 환경은 로컬 샌드박싱 자체를 지원하지 않는다(Agent.create 시점엔
  // 에러가 나지 않고, 첫 send() 실행 시점에야 실패로 드러남) — 샌드박스 없이 생성한다.
  return Agent.create({
    apiKey,
    model: { id: CURSOR_MODEL_ID },
    local: { cwd, settingSources: [] },
  });
}

function writeMarkdown(transcript) {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(__dirname, `cursor-conversation-${stamp}.md`);

  const lines = [];
  lines.push('# Cursor SDK 대화 기록');
  lines.push('');
  lines.push(`- 생성 시각: ${now.toLocaleString('ko-KR')}`);
  lines.push(`- 모델: ${CURSOR_MODEL_ID}`);
  lines.push(`- 총 턴 수: ${TURNS.length}`);
  lines.push('');

  let currentTurn = null;
  for (const entry of transcript) {
    if (entry.turn !== currentTurn) {
      currentTurn = entry.turn;
      lines.push(`## 턴 ${currentTurn}`);
      lines.push('');
    }
    const label = entry.role === 'user' ? '**사용자**' : '**Cursor**';
    lines.push(`${label} (${entry.at.toLocaleTimeString('ko-KR')})`);
    lines.push('');
    lines.push(`> ${String(entry.text).split('\n').join('\n> ')}`);
    lines.push('');
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return filePath;
}

async function main() {
  const apiKey = String(process.env.CURSOR_API_KEY || '').trim();
  if (!apiKey) {
    console.error('CURSOR_API_KEY 환경변수가 설정되어 있지 않습니다.');
    process.exit(1);
  }

  const { Agent } = require('@cursor/sdk');

  console.log('Cursor 에이전트 생성 중...');
  const agent = await createCursorAgent(Agent, apiKey, __dirname);

  const transcript = [];
  try {
    for (let i = 0; i < TURNS.length; i += 1) {
      const turnNo = i + 1;
      const message = TURNS[i];
      console.log(`\n[턴 ${turnNo}] 사용자 -> ${message}`);
      transcript.push({ turn: turnNo, role: 'user', text: message, at: new Date() });

      const run = await agent.send(message);
      const result = await run.wait();

      if (result.status !== 'finished') {
        const detail = (result.error && result.error.message) || result.status;
        throw new Error(`턴 ${turnNo} 실패: ${detail}`);
      }
      const reply = String(result.result || '').trim();
      console.log(`[턴 ${turnNo}] Cursor -> ${reply}`);
      transcript.push({ turn: turnNo, role: 'cursor', text: reply, at: new Date() });
    }
  } finally {
    try { agent.close(); } catch {
      // ignore
    }
  }

  const filePath = writeMarkdown(transcript);
  console.log(`\n대화 기록을 저장했습니다: ${filePath}`);
}

main().catch(error => {
  console.error('오류:', error.message || error);
  process.exit(1);
});
