'use strict';

/**
 * openrouter-chat.js — 연결 확인용 스모크 테스트 (cursor-chat.js 와 같은 역할)
 *
 * 미리 정해둔 5턴을 순서대로 보내고 openrouter-conversation-<타임스탬프>.md 에 기록한다.
 * 확인 목표: API 키 / 모델 id / 스트리밍 / 다중 턴 맥락 유지 / usage(추론 토큰) 회수.
 *
 * 사용법:
 *   node openrouter-chat.js
 *   node openrouter-chat.js --model <id> --effort high --no-stream
 */

const fs = require('fs');
const path = require('path');

const { OpenRouterClient, DEFAULT_MODEL, addUsage, emptyUsage } = require('./openrouter-client');

const TURNS = [
  '안녕하세요! 처음 뵙겠습니다. OpenRouter 연결 테스트를 시작할게요. 짧게 답해 주세요.',
  '반갑습니다. 방금 제가 첫 번째로 뭐라고 했는지 그대로 인용해 주세요. (맥락 유지 확인)',
  "'strawberry' 에 알파벳 r 이 몇 개 있나요? 숫자만 답해 주세요.",
  '지금까지 몇 번째 턴인지 답하고, 이 대화에서 확인된 것을 한 줄로 정리해 주세요.',
  '마지막 인사를 나눌 차례네요. 오늘 대화 즐거웠습니다. 안녕히 가세요!',
];

function parseArgs(argv) {
  const opts = { model: null, effort: null, stream: true, showReasoning: false };
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
      case '--no-stream':
        opts.stream = false;
        break;
      case '--show-reasoning':
        opts.showReasoning = true;
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
  const filePath = path.join(__dirname, `openrouter-conversation-${stamp}.md`);

  const lines = [];
  lines.push('# OpenRouter 대화 기록');
  lines.push('');
  lines.push(`- 생성 시각: ${now.toLocaleString('ko-KR')}`);
  lines.push(`- 모델: ${meta.model}${meta.effort ? ` (effort=${meta.effort})` : ''}`);
  lines.push(`- 총 턴 수: ${TURNS.length}`);
  lines.push(`- 누적 토큰: prompt ${meta.usage.promptTokens} / completion ${meta.usage.completionTokens}`
    + ` (추론 ${meta.usage.reasoningTokens}) / total ${meta.usage.totalTokens}`);
  lines.push('');

  let currentTurn = null;
  for (const entry of transcript) {
    if (entry.turn !== currentTurn) {
      currentTurn = entry.turn;
      lines.push(`## 턴 ${currentTurn}`);
      lines.push('');
    }
    const label = entry.role === 'user' ? '**사용자**' : '**OpenRouter**';
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

  const client = new OpenRouterClient({
    model: opts.model || process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
    reasoningEffort: opts.effort || process.env.OPENROUTER_EFFORT || null,
  });

  console.log(`모델: ${client.model}${client.reasoningEffort ? ` (effort=${client.reasoningEffort})` : ''}`);
  console.log(`스트리밍: ${opts.stream ? 'ON' : 'OFF'}`);

  // OpenRouter는 세션이 없다. 이 배열이 곧 대화 맥락이고, 매 턴 전부 다시 보낸다.
  const messages = [];
  const transcript = [];
  let usage = emptyUsage();

  for (let i = 0; i < TURNS.length; i += 1) {
    const turnNo = i + 1;
    const message = TURNS[i];
    console.log(`\n[턴 ${turnNo}] 사용자 -> ${message}`);
    transcript.push({ turn: turnNo, role: 'user', text: message, at: new Date() });
    messages.push({ role: 'user', content: message });

    let printed = false;
    const result = await client.complete({
      messages,
      stream: opts.stream,
      onDelta: opts.stream
        ? chunk => {
          if (!printed) {
            process.stdout.write(`[턴 ${turnNo}] OpenRouter -> `);
            printed = true;
          }
          process.stdout.write(chunk);
        }
        : null,
    });
    if (opts.stream) process.stdout.write('\n');
    else console.log(`[턴 ${turnNo}] OpenRouter -> ${result.text}`);

    if (opts.showReasoning && result.reasoning) {
      console.log(`[턴 ${turnNo}] 추론 -> ${result.reasoning}`);
    }
    if (result.usage) {
      // 공식 SDK 샘플의 chunk.usage.completionTokensDetails.reasoningTokens 와 같은 값.
      console.log(`[턴 ${turnNo}] 토큰 -> total ${result.usage.totalTokens}, 추론 ${result.usage.reasoningTokens}`);
      usage = addUsage(usage, result.usage);
    }

    messages.push({ role: 'assistant', content: result.text });
    transcript.push({ turn: turnNo, role: 'assistant', text: result.text, at: new Date() });
  }

  const filePath = writeMarkdown(transcript, {
    model: client.model,
    effort: client.reasoningEffort,
    usage,
  });
  console.log(`\n누적 토큰: prompt ${usage.promptTokens} / completion ${usage.completionTokens}`
    + ` (추론 ${usage.reasoningTokens}) / total ${usage.totalTokens}`);
  console.log(`대화 기록을 저장했습니다: ${filePath}`);
}

main().catch(error => {
  console.error('오류:', error.message || error);
  process.exit(1);
});
