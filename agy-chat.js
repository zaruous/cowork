'use strict';

/**
 * agy-chat.js — 연결 확인용 스모크 테스트 (cursor-chat.js / openrouter-chat.js 와 같은 역할)
 *
 * 미리 정해둔 3턴을 한 프로세스로 순서대로 보내고
 * agy-conversation-<타임스탬프>.md 에 기록한다.
 * 확인 목표: agy CLI 인증 / 모델·effort 지정 / 스트리밍 / 다중 턴 맥락 유지 / usage 회수.
 *
 * 사용법:
 *   node agy-chat.js
 *   node agy-chat.js --model gemini-3.5-flash-low --effort low --no-stream
 */

const fs = require('fs');
const path = require('path');

const {
  AgySession,
  checkAgyCli,
  emptyUsage,
  addUsage,
  formatUsage,
} = require('./agy-client');

const TURNS = [
  '안녕하세요! Antigravity CLI(agy) 연결 테스트를 시작할게요. 한 문장으로 짧게 답해 주세요.',
  '방금 제가 첫 번째로 뭐라고 했는지 그대로 인용해 주세요. (맥락 유지 확인)',
  '지금까지 몇 번째 턴인지 답하고, 이 대화에서 확인된 것을 한 줄로 정리해 주세요.',
];

function parseArgs(argv) {
  const opts = {
    model: String(process.env.AGY_MODEL || '').trim() || null,
    effort: String(process.env.AGY_EFFORT || '').trim().toLowerCase() || null,
    cwd: String(process.env.AGY_CHAT_CWD || '').trim() || __dirname,
    stream: true,
    showTools: false,
    skipPermissions: false,
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
      case '--model':
        opts.model = next().trim();
        break;
      case '--effort':
        opts.effort = next().trim().toLowerCase();
        break;
      case '--cwd':
        opts.cwd = next();
        break;
      case '--no-stream':
        opts.stream = false;
        break;
      case '--show-tools':
        opts.showTools = true;
        break;
      case '--yolo':
        opts.skipPermissions = true;
        break;
      default:
        throw new Error(`알 수 없는 옵션: ${arg}`);
    }
  }
  return opts;
}

function writeMarkdown(transcript, meta) {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(__dirname, `agy-conversation-${stamp}.md`);

  const lines = [];
  lines.push('# agy(Antigravity CLI) 대화 기록');
  lines.push('');
  lines.push(`- 생성 시각: ${now.toLocaleString('ko-KR')}`);
  lines.push(`- CLI: agy ${meta.version}`);
  lines.push(`- 모델: ${meta.model || 'CLI 기본값'}${meta.effort ? ` (effort=${meta.effort})` : ''}`);
  lines.push(`- 대화 id: ${meta.conversationId}`);
  lines.push(`- 총 턴 수: ${TURNS.length}`);
  lines.push(`- 누적 토큰: ${formatUsage(meta.usage)}`);
  lines.push('');

  let currentTurn = null;
  for (const entry of transcript) {
    if (entry.turn !== currentTurn) {
      currentTurn = entry.turn;
      lines.push(`## 턴 ${currentTurn}`);
      lines.push('');
    }
    const label = entry.role === 'user' ? '**사용자**' : '**agy**';
    lines.push(`${label} (${entry.at.toLocaleTimeString('ko-KR')})`);
    lines.push('');
    lines.push(`> ${String(entry.text).split('\n').join('\n> ')}`);
    lines.push('');
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return filePath;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cli = checkAgyCli();
  const agentCwd = path.resolve(opts.cwd);

  console.log(`agy CLI: ${cli.version}`);
  console.log(`모델: ${opts.model || 'CLI 기본값'}${opts.effort ? ` (effort=${opts.effort})` : ''}`);
  console.log(`작업 디렉터리: ${agentCwd}`);
  console.log(`스트리밍: ${opts.stream ? 'ON' : 'OFF'}`);

  const session = new AgySession({
    command: cli.command,
    cwd: agentCwd,
    model: opts.model,
    effort: opts.effort,
    addDirs: [agentCwd],
    skipPermissions: opts.skipPermissions,
    onWarning: text => console.warn(`경고: ${text}`),
  });

  console.log('\nagy 세션 기동 중...');
  await session.start();
  console.log(`대화 id: ${session.conversationId} (권한 모드 ${session.permissionMode || '기본값'})`);

  const transcript = [];
  let usage = emptyUsage();

  try {
    for (let i = 0; i < TURNS.length; i += 1) {
      const turnNo = i + 1;
      const message = TURNS[i];
      console.log(`\n[턴 ${turnNo}] 사용자 -> ${message}`);
      transcript.push({ turn: turnNo, role: 'user', text: message, at: new Date() });

      let printed = false;
      const result = await session.send(message, {
        onDelta: chunk => {
          if (!opts.stream) return;
          if (!printed) {
            process.stdout.write(`[턴 ${turnNo}] agy -> `);
            printed = true;
          }
          process.stdout.write(chunk);
        },
        onStep: step => {
          if (!opts.showTools || step.type !== 'tool' || step.state !== 'ACTIVE') return;
          process.stdout.write(`\n  · 도구 ${step.name}\n`);
        },
      });
      if (opts.stream && printed) process.stdout.write('\n');

      if (!result.ok && !result.reply) {
        throw new Error(`턴 ${turnNo} 실패(${result.status}): ${result.error || '원인 미상'}`);
      }
      if (!result.ok) {
        // 응답은 다 받았는데 CLI 가 턴을 오류로 닫은 경우 — 답변은 살리고 경고만.
        console.warn(`[턴 ${turnNo}] 경고: 응답 수신 후 ${result.status} — ${result.error || '원인 미상'}`);
      }
      if (!opts.stream) console.log(`[턴 ${turnNo}] agy -> ${result.reply}`);

      console.log(`[턴 ${turnNo}] 토큰 -> ${formatUsage(result.usage)} · ${result.durationSeconds.toFixed(1)}s`);
      usage = addUsage(usage, result.usage);
      transcript.push({ turn: turnNo, role: 'agy', text: result.reply, at: new Date() });
    }
  } finally {
    await session.close();
  }

  const filePath = writeMarkdown(transcript, {
    version: cli.version,
    model: opts.model,
    effort: opts.effort,
    conversationId: session.conversationId,
    usage,
  });
  console.log(`\n누적 토큰: ${formatUsage(usage)}`);
  console.log(`대화 기록을 저장했습니다: ${filePath}`);
}

main().catch(error => {
  console.error('오류:', error.message || error);
  process.exit(1);
});
