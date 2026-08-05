'use strict';
/**
 * Cursor 로컬 에이전트에게 구현 작업을 위임한다(파일 편집 권한 있음).
 *   node cursor-task.js <프롬프트파일> <작업디렉토리> [로그파일]
 */
const fs = require('fs');
const path = require('path');

async function main() {
  const apiKey = String(process.env.CURSOR_API_KEY || '').trim();
  if (!apiKey) {
    console.error('CURSOR_API_KEY 미설정');
    process.exit(1);
  }
  const [promptFile, cwd, logFile] = process.argv.slice(2);
  if (!promptFile || !cwd) {
    console.error('사용법: node cursor-task.js <프롬프트파일> <작업디렉토리> [로그파일]');
    process.exit(1);
  }
  const prompt = fs.readFileSync(promptFile, 'utf8').trim();

  const { Agent } = require('@cursor/sdk');
  const agent = await Agent.create({
    apiKey,
    model: { id: 'auto' },
    local: { cwd, settingSources: [] },
  });
  console.log(`[cursor] 세션 ${agent.agentId} 시작 — cwd=${cwd}`);

  const started = Date.now();
  const run = await agent.send(prompt);
  const result = await run.wait();
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  let out;
  if (result.status !== 'finished') {
    out = `[실패] ${(result.error && result.error.message) || result.status}`;
  } else {
    out = String(result.result || '').trim();
  }
  console.log(`[cursor] 완료 (${secs}초)\n`);
  console.log(out);

  if (logFile) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile,
      `# Cursor 위임 작업 결과\n\n- 세션: \`${agent.agentId}\`\n- 소요: ${secs}초\n- cwd: \`${cwd}\`\n\n## 지시\n\n${prompt}\n\n## 결과\n\n${out}\n`,
      'utf8');
  }
  try { agent.close(); } catch { /* noop */ }
  process.exit(result.status === 'finished' ? 0 : 1);
}

main().catch(e => { console.error('오류:', e.message || e); process.exit(1); });
