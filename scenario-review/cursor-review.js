'use strict';
/**
 * 지정한 저장소를 대상으로 Cursor 에이전트와 다중 턴 리뷰 대화를 진행한다.
 * 세션을 파일에 유지해 프로세스를 새로 띄워도 대화 맥락이 이어진다.
 *
 *   node cursor-review.js <프롬프트파일>                한 턴 진행
 *   node cursor-review.js --new <프롬프트파일>           새 세션으로 시작
 *   node cursor-review.js --cwd <저장소> <프롬프트파일>   대상 저장소 지정
 *
 * 대상 저장소는 --cwd 또는 REVIEW_TARGET_CWD 환경변수로 지정한다(필수).
 * 로그 경로는 REVIEW_LOG_PATH 로 덮어쓸 수 있다(기본: <저장소>/docs/plan/cursor-review-log.md).
 */
const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, '.session.json');
const MODEL = 'composer-2.5';

let TARGET_CWD = '';
let LOG_PATH = '';

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveState(s) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2), 'utf8');
}

function stamp() {
  return new Date().toLocaleString('ko-KR');
}

async function main() {
  const apiKey = String(process.env.CURSOR_API_KEY || '').trim();
  if (!apiKey) {
    console.error('CURSOR_API_KEY 미설정');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const forceNew = args.includes('--new');
  const cwdAt = args.indexOf('--cwd');
  const promptFile = args.find((a, i) => a !== '--new' && i !== cwdAt && i !== cwdAt + 1);
  if (!promptFile) {
    console.error('프롬프트 파일 경로가 필요합니다.');
    process.exit(1);
  }

  const target = String(
    (cwdAt >= 0 ? args[cwdAt + 1] : '') || process.env.REVIEW_TARGET_CWD || ''
  ).trim();
  if (!target) {
    console.error('리뷰 대상 저장소가 필요합니다. --cwd <저장소> 또는 REVIEW_TARGET_CWD 로 지정하세요.');
    process.exit(1);
  }
  TARGET_CWD = path.resolve(target);
  if (!fs.existsSync(TARGET_CWD)) {
    console.error(`대상 저장소를 찾을 수 없습니다: ${TARGET_CWD}`);
    process.exit(1);
  }
  LOG_PATH = process.env.REVIEW_LOG_PATH
    ? path.resolve(process.env.REVIEW_LOG_PATH)
    : path.join(TARGET_CWD, 'docs', 'plan', 'cursor-review-log.md');
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });

  const prompt = fs.readFileSync(promptFile, 'utf8').trim();

  const { Agent } = require('@cursor/sdk');
  let state = forceNew ? null : loadState();
  let agent = null;

  if (state && state.agentId) {
    try {
      agent = await Agent.resume(state.agentId, {
        apiKey,
        model: { id: MODEL },
        local: { cwd: TARGET_CWD, settingSources: [] },
      });
    } catch (e) {
      console.error('세션 재개 실패 → 새 세션:', e.message || e);
      state = null;
    }
  }

  if (!agent) {
    agent = await Agent.create({
      apiKey,
      model: { id: MODEL },
      local: { cwd: TARGET_CWD, settingSources: [] },
    });
    state = { agentId: agent.agentId, turn: 0 };
    if (!fs.existsSync(LOG_PATH)) {
      fs.writeFileSync(LOG_PATH,
        '# 시나리오 테스트 자동화 — Cursor 코드 리뷰 대화 로그\n\n' +
        `- 대상 저장소: \`${TARGET_CWD}\`\n` +
        `- 리뷰 모델: Cursor \`${MODEL}\` (저장소 직접 탐색 가능한 로컬 에이전트)\n` +
        `- 시작: ${stamp()}\n\n` +
        '> 이 로그는 개발계획서 작성 근거를 남기기 위한 원본 대화 기록이다.\n\n',
        'utf8');
    }
    fs.appendFileSync(LOG_PATH, `\n---\n\n_세션 시작: \`${agent.agentId}\` (${stamp()})_\n`, 'utf8');
  }

  state.turn += 1;
  const t = state.turn;
  saveState(state);

  fs.appendFileSync(LOG_PATH, `\n## 턴 ${t}\n\n**질문** _(${stamp()})_\n\n${prompt}\n\n`, 'utf8');

  const run = await agent.send(prompt);
  const result = await run.wait();
  if (result.status !== 'finished') {
    const detail = (result.error && result.error.message) || result.status;
    fs.appendFileSync(LOG_PATH, `**응답 실패:** ${detail}\n\n`, 'utf8');
    console.error('실패:', detail);
    try { agent.close(); } catch { /* noop */ }
    process.exit(1);
  }

  const reply = String(result.result || '').trim();
  fs.appendFileSync(LOG_PATH, `**Cursor 답변** _(${stamp()})_\n\n${reply}\n\n`, 'utf8');
  saveState(state);
  try { agent.close(); } catch { /* noop */ }

  console.log(`===== 턴 ${t} 응답 =====`);
  console.log(reply);
}

main().catch(e => {
  console.error('오류:', e.message || e);
  process.exit(1);
});
