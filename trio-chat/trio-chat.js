'use strict';

/**
 * trio-chat — Claude · Cursor · Codex 3자 라이브챗
 *
 * 하나의 주제를 놓고 Claude → Cursor → Codex 순서로 라운드를 돌며 토론시킨다.
 * 세 참가자는 각자 자기 세션(대화 기록)을 서버 쪽에 유지하므로,
 * 매 턴 전달하는 프롬프트에는 "내가 마지막으로 말한 이후에 나온 남들의 발언"만 담는다.
 * (전체 로그를 매번 재전송하면 토큰이 라운드 제곱으로 늘고 세션 기록과도 중복된다.)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');
const { spawn } = require('child_process');

// ── 상수 ────────────────────────────────────────────────────────────────────
const DEFAULT_ROUNDS = 3;
const DEFAULT_TIMEOUT_MS = 300_000; // 참가자 1회 호출 제한 (기본 300초)
const CURSOR_MODEL_ID = 'auto'; // Cursor Auto 모델('default'의 별칭)

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

// ── 유틸 ────────────────────────────────────────────────────────────────────

/** PATH + PATHEXT를 직접 순회하는 which. Windows에서 claude=.exe, codex=.cmd 등 형태가 제각각이라 필요. */
function which(name) {
  const isWin = process.platform === 'win32';
  const exts = isWin
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  const dirs = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean);

  // 이미 경로가 포함된 이름이면 그 자리에서만 찾는다.
  const searchDirs = /[\\/]/.test(name) ? [''] : dirs;

  const isExec = p => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };

  for (const dir of searchDirs) {
    const base = dir ? path.join(dir, name) : name;
    if (!isWin && isExec(base)) return base;
    // Windows에서 확장자 없는 파일(git-bash용 sh 스크립트)은 실행 불가 → PATHEXT만 본다.
    if (isWin && path.extname(base) && isExec(base)) return base;
    for (const ext of exts) {
      const cand = base + ext.toLowerCase();
      if (isExec(cand)) return cand;
    }
  }
  return null;
}

/** cmd.exe 한 줄 명령에 넣기 위한 인자 인용. 빈 문자열도 살려야 한다(예: --allowed-tools ""). */
function quoteWinArg(a) {
  const s = String(a);
  if (s === '') return '""';
  if (!/[\s"^&|<>()%!]/.test(s)) return s;
  return '"' + s.replace(/"/g, '\\"') + '"';
}

/**
 * 자식 프로세스를 실행하고 stdin으로 프롬프트를 넣은 뒤 stdout 전체를 회수한다.
 * .cmd/.bat은 Windows에서 직접 spawn할 수 없으므로 cmd.exe로 감싼다.
 */
function runCli({ exe, args, input, timeoutMs, cwd }) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const opts = { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] };
    let file = exe;
    let spawnArgs = args;

    if (isWin && /\.(cmd|bat)$/i.test(exe)) {
      const line = [exe, ...args].map(quoteWinArg).join(' ');
      file = process.env.COMSPEC || 'cmd.exe';
      // /s + 바깥 따옴표는 node의 shell:true가 쓰는 것과 동일한 관례.
      spawnArgs = ['/d', '/s', '/c', `"${line}"`];
      opts.windowsVerbatimArguments = true;
    }

    let child;
    try {
      child = spawn(file, spawnArgs, opts);
    } catch (err) {
      reject(err);
      return;
    }

    const out = [];
    const err = [];
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        // cmd.exe 래퍼는 자식을 남길 수 있어 Windows에선 트리 종료를 쓴다.
        if (isWin && child.pid) {
          spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        /* 이미 죽었으면 무시 */
      }
    }, timeoutMs);

    const finish = fn => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    child.stdout.on('data', d => out.push(d));
    child.stderr.on('data', d => err.push(d));
    child.on('error', e => finish(() => reject(e)));
    child.on('close', code =>
      finish(() => {
        if (timedOut) {
          reject(new Error(`시간 초과 (${Math.round(timeoutMs / 1000)}초)`));
          return;
        }
        resolve({
          code,
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8'),
        });
      })
    );

    // 프롬프트는 인자가 아니라 stdin으로 준다(길이 제한/이스케이프 문제 회피).
    child.stdin.on('error', () => {});
    child.stdin.end(input, 'utf8');
  });
}

/** Promise에 타임아웃을 씌운다(Cursor SDK처럼 프로세스가 아닌 호출용). */
function withTimeout(promise, timeoutMs, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} 시간 초과 (${Math.round(timeoutMs / 1000)}초)`)),
      timeoutMs
    );
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

// ── 참가자 팩토리 ───────────────────────────────────────────────────────────
// 모든 참가자는 { name, emoji, color, sessionId, send(text) -> Promise<string>, close() }
// 형태로 통일한다. 새 참가자를 추가하려면 이 인터페이스만 맞추면 된다.

function createClaude({ cwd, timeoutMs }) {
  const exe = which('claude');
  if (!exe) throw new Error('claude CLI를 PATH에서 찾지 못했습니다.');
  // claude는 세션 id를 클라이언트가 정한다. 미리 만들어 두면 resume이 간단해진다.
  const sessionId = crypto.randomUUID();
  let started = false;

  return {
    name: 'Claude',
    emoji: '🟣',
    color: ANSI.magenta,
    get sessionId() {
      return sessionId;
    },
    async send(text) {
      const args = ['-p', '--output-format', 'text'];
      args.push(started ? '--resume' : '--session-id', sessionId);
      // 토론에는 파일/명령 도구가 필요 없다. 막아야 응답이 빠르고 예측 가능하다.
      args.push('--allowed-tools', '');
      const { code, stdout, stderr } = await runCli({ exe, args, input: text, timeoutMs, cwd });
      if (code !== 0) {
        throw new Error(`claude 종료코드 ${code}: ${(stderr || stdout).trim().slice(0, 400)}`);
      }
      started = true;
      const reply = stdout.trim();
      if (!reply) throw new Error('claude가 빈 응답을 반환했습니다.');
      return reply;
    },
    async close() {},
  };
}

function createCodex({ cwd, timeoutMs }) {
  const exe = which('codex');
  if (!exe) throw new Error('codex CLI를 PATH에서 찾지 못했습니다.');
  let threadId = null;

  return {
    name: 'Codex',
    emoji: '🟢',
    color: ANSI.green,
    get sessionId() {
      return threadId;
    },
    async send(text) {
      // 대화만 하면 되므로 쓰기 권한은 주지 않는다(read-only) + git repo 체크 생략.
      // 주의: `codex exec resume`에는 --sandbox 플래그가 없다(v0.145 확인).
      //       같은 효과를 내려면 -c sandbox_mode=... 설정 오버라이드를 써야 한다.
      //       또 인자 순서가 `resume [OPTIONS] <SESSION_ID> [PROMPT]`라 id는 옵션 뒤에 온다.
      //       값에 따옴표를 넣으면 cmd.exe 래핑에서 깨지므로 TOML 파싱 실패 → 리터럴 문자열로
      //       떨어지는 성질을 이용해 따옴표 없이 준다.
      const args = threadId
        ? ['exec', 'resume', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode=read-only', threadId, '-']
        : ['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '-'];

      const { code, stdout, stderr } = await runCli({ exe, args, input: text, timeoutMs, cwd });

      // JSONL을 훑어 thread_id와 agent_message들을 뽑는다. 종료코드보다 본문 유무가 우선.
      const chunks = [];
      let errText = '';
      for (const line of stdout.split(/\r?\n/)) {
        const t = line.trim();
        if (!t.startsWith('{')) continue;
        let ev;
        try {
          ev = JSON.parse(t);
        } catch {
          continue;
        }
        if (ev.type === 'thread.started' && ev.thread_id) threadId = ev.thread_id;
        if (ev.type === 'item.completed' && ev.item && ev.item.type === 'agent_message') {
          chunks.push(String(ev.item.text || ''));
        }
        if (ev.type === 'error' && ev.message) errText = String(ev.message);
      }

      const reply = chunks.join('\n').trim();
      if (!reply) {
        throw new Error(
          `codex 응답 없음 (종료코드 ${code}): ${(errText || stderr || stdout).trim().slice(0, 400)}`
        );
      }
      return reply;
    },
    async close() {},
  };
}

function createCursor({ cwd, timeoutMs }) {
  const apiKey = String(process.env.CURSOR_API_KEY || '').trim();
  if (!apiKey) throw new Error('CURSOR_API_KEY 환경변수가 없습니다.');
  const { Agent } = require('@cursor/sdk');

  let agent = null;
  let agentId = null;

  // 이 환경은 로컬 샌드박싱 미지원이라 sandboxOptions를 넣으면 첫 send에서 실패한다.
  const localOpts = { cwd, settingSources: [] };

  return {
    name: 'Cursor',
    emoji: '🔵',
    color: ANSI.cyan,
    get sessionId() {
      return agentId;
    },
    async send(text) {
      if (!agent) {
        agent = await withTimeout(
          Agent.create({ apiKey, model: { id: CURSOR_MODEL_ID }, local: localOpts }),
          timeoutMs,
          'cursor 세션 생성'
        );
        agentId = agent.agentId;
      }
      const run = await withTimeout(agent.send(text), timeoutMs, 'cursor 전송');
      const result = await withTimeout(run.wait(), timeoutMs, 'cursor 응답');
      if (result.status !== 'finished') {
        const detail = (result.error && result.error.message) || result.status;
        throw new Error(`cursor 상태 ${result.status}: ${detail}`);
      }
      const reply = String(result.result || '').trim();
      if (!reply) throw new Error('cursor가 빈 응답을 반환했습니다.');
      return reply;
    },
    async close() {
      try {
        if (agent) agent.close();
      } catch {
        /* 종료 실패는 무시 */
      }
    },
  };
}

// ── 프롬프트 조립 ───────────────────────────────────────────────────────────

function buildBriefing(self, roster, topic, rounds, isFirstSpeaker) {
  const others = roster.filter(p => p.name !== self.name).map(p => `${p.emoji} ${p.name}`);
  return [
    `당신은 3자 AI 토론의 참가자 "${self.name}"입니다. 다른 참가자는 ${others.join(', ')} 입니다.`,
    `발언 순서는 ${roster.map(p => p.name).join(' → ')} 이며, 총 ${rounds}라운드 진행합니다.`,
    '',
    '규칙:',
    '1. 반드시 한국어로 답한다.',
    '2. 매 발언은 1200자 이내로 간결하게 쓴다.',
    '3. 다른 참가자의 직전 발언에 실제로 반응한다(누가 무슨 말을 했는지 짚어서).',
    '4. 동의인지 반대인지 분명히 밝히고 근거를 댄다. 무난한 요약으로 넘어가지 않는다.',
    '5. 사회자가 아니라 한 명의 토론 참가자다. 자기 의견을 말한다.',
    '6. "알겠습니다" 같은 서두 없이 발언 본문만 출력한다.',
    '',
    '[토론 주제]',
    topic,
    '',
    isFirstSpeaker
      ? '당신이 첫 발언자입니다. 주제에 대한 자기 입장을 먼저 제시하세요.'
      : '아래 다른 참가자들의 발언에 이어 발언하세요.',
  ].join('\n');
}

function buildFollowUp(self, newEntries) {
  const quoted = newEntries.map(e => `${e.emoji} ${e.speaker}:\n${e.text}`).join('\n\n---\n\n');
  return [
    '[다른 참가자의 새 발언]',
    '',
    quoted,
    '',
    '---',
    '',
    `위 발언에 반응해서 ${self.name}의 차례로 발언하세요. (한국어, 1200자 이내, 동의/반대를 분명히)`,
  ].join('\n');
}

// ── 로그 ────────────────────────────────────────────────────────────────────

function createLogger(logPath) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  return {
    path: logPath,
    // 매 발언 즉시 append 한다. 중간에 프로세스가 죽어도 여기까지는 남는다.
    write(text) {
      fs.appendFileSync(logPath, text, 'utf8');
    },
  };
}

// ── 인자 파싱 ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    rounds: DEFAULT_ROUNDS,
    cwd: process.cwd(),
    log: null,
    topic: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} 옵션에 값이 필요합니다.`);
      return v;
    };
    switch (a) {
      case '--rounds':
        opts.rounds = Math.max(1, parseInt(next(), 10) || DEFAULT_ROUNDS);
        break;
      case '--cwd':
        opts.cwd = path.resolve(next());
        break;
      case '--log':
        opts.log = path.resolve(next());
        break;
      case '--topic':
        opts.topic = next();
        break;
      case '--topic-file':
        opts.topic = fs.readFileSync(path.resolve(next()), 'utf8').trim();
        break;
      case '--timeout':
        opts.timeoutMs = Math.max(1, parseInt(next(), 10) || 300) * 1000;
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        throw new Error(`알 수 없는 옵션: ${a}`);
    }
  }
  if (!opts.log) {
    const stamp = new Date(Date.now()).toISOString().replace(/[:.]/g, '-');
    opts.log = path.join(__dirname, 'logs', `trio-${stamp}.md`);
  }
  return opts;
}

const HELP = `
trio-chat — Claude · Cursor · Codex 3자 라이브챗

사용법: node trio-chat.js [옵션]

  --rounds <n>        라운드 수 (기본 ${DEFAULT_ROUNDS})
  --cwd <path>        에이전트 작업 디렉토리 (기본: 현재 디렉토리)
  --log <path>        마크다운 로그 경로 (기본 trio-chat/logs/trio-<타임스탬프>.md)
  --topic <text>      토론 주제
  --topic-file <path> 토론 주제를 파일에서 읽기
  --timeout <sec>     참가자 1회 호출 타임아웃 (기본 ${DEFAULT_TIMEOUT_MS / 1000}초)
  -h, --help          도움말
`;

function askTopic() {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('토론 주제를 입력하세요 > ', ans => {
      rl.close();
      resolve(String(ans || '').trim());
    });
  });
}

// ── 메인 ────────────────────────────────────────────────────────────────────

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    // 인자 오류는 스택 트레이스가 아니라 사용법을 보여주는 게 맞다.
    console.error(`${ANSI.red}${(err && err.message) || err}${ANSI.reset}`);
    console.error(HELP);
    process.exitCode = 1;
    return;
  }
  if (opts.help) {
    console.log(HELP);
    return;
  }

  let topic = opts.topic;
  if (!topic) topic = await askTopic();
  if (!topic) {
    console.error('주제가 비어 있습니다.');
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(opts.cwd)) fs.mkdirSync(opts.cwd, { recursive: true });

  const roster = [
    createClaude({ cwd: opts.cwd, timeoutMs: opts.timeoutMs }),
    createCursor({ cwd: opts.cwd, timeoutMs: opts.timeoutMs }),
    createCodex({ cwd: opts.cwd, timeoutMs: opts.timeoutMs }),
  ];

  const log = createLogger(opts.log);
  log.write(
    [
      `# Trio Chat`,
      ``,
      `- 주제: ${topic}`,
      `- 라운드: ${opts.rounds}`,
      `- 작업 디렉토리: ${opts.cwd}`,
      `- 참가자: ${roster.map(p => `${p.emoji} ${p.name}`).join(' → ')}`,
      `- 시작: ${new Date().toLocaleString('ko-KR')}`,
      ``,
    ].join('\n')
  );

  console.log(`${ANSI.bold}=== Trio Chat ===${ANSI.reset}`);
  console.log(`주제: ${topic}`);
  console.log(`라운드: ${opts.rounds} | 로그: ${log.path}\n`);

  // 전체 발언 기록. 참가자별 cursor(lastSeen)로 "아직 못 본 남의 발언"을 계산한다.
  const transcript = [];
  const lastSeen = new Map(roster.map(p => [p.name, 0]));
  const briefed = new Set();

  for (let round = 1; round <= opts.rounds; round++) {
    log.write(`\n## 라운드 ${round}\n`);
    console.log(`${ANSI.gray}────── 라운드 ${round} ──────${ANSI.reset}`);

    for (const p of roster) {
      const from = lastSeen.get(p.name);
      const unseen = transcript.slice(from).filter(e => e.speaker !== p.name);
      lastSeen.set(p.name, transcript.length);

      let prompt;
      if (!briefed.has(p.name)) {
        // 첫 턴: 역할 안내 + 주제 (+ 이미 나온 발언이 있으면 함께)
        prompt = buildBriefing(p, roster, topic, opts.rounds, unseen.length === 0);
        if (unseen.length) prompt += '\n\n' + buildFollowUp(p, unseen);
        briefed.add(p.name);
      } else if (unseen.length) {
        prompt = buildFollowUp(p, unseen);
      } else {
        // 이론상 발생하지 않지만(순서상 항상 새 발언이 있음) 안전장치.
        prompt = `다른 참가자의 새 발언이 없습니다. ${p.name}의 차례로 논의를 한 걸음 진전시키세요. (한국어, 1200자 이내)`;
      }

      process.stdout.write(`${p.color}${ANSI.bold}${p.emoji} ${p.name}${ANSI.reset} 생각 중...\r`);
      const t0 = Date.now();
      let text;
      let failed = false;
      try {
        text = await p.send(prompt);
      } catch (err) {
        // 한 명이 실패해도 토론은 계속한다. 실패 사실을 발언으로 남겨 다음 사람이 보게 한다.
        failed = true;
        text = `[오류: ${(err && err.message) || err}]`;
      }
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

      transcript.push({ speaker: p.name, emoji: p.emoji, text });

      // 콘솔
      process.stdout.write(' '.repeat(40) + '\r');
      console.log(
        `${p.color}${ANSI.bold}${p.emoji} ${p.name}${ANSI.reset} ${ANSI.dim}(${elapsed}초)${ANSI.reset}`
      );
      console.log(failed ? `${ANSI.red}${text}${ANSI.reset}` : text);
      console.log('');

      // 로그(즉시 flush)
      log.write(`\n### ${p.emoji} ${p.name}\n\n${text}\n\n_소요 ${elapsed}초_\n`);
    }
  }

  // 마무리: 세션 id 요약
  const summary = roster.map(p => `- ${p.emoji} ${p.name}: \`${p.sessionId || '(없음)'}\``);
  log.write(`\n---\n\n## 세션 ID\n\n${summary.join('\n')}\n\n- 종료: ${new Date().toLocaleString('ko-KR')}\n`);

  console.log(`${ANSI.bold}=== 세션 ID ===${ANSI.reset}`);
  for (const p of roster) {
    console.log(`${p.color}${p.emoji} ${p.name}${ANSI.reset}: ${p.sessionId || '(없음)'}`);
  }
  console.log(`\n로그: ${log.path}`);

  await Promise.all(roster.map(p => p.close()));
}

main()
  .then(() => {
    // Cursor SDK가 열어둔 핸들이 남아 프로세스가 안 끝나는 경우가 있어 명시 종료.
    process.exit(process.exitCode || 0);
  })
  .catch(err => {
    console.error(`${ANSI.red}치명적 오류:${ANSI.reset}`, (err && err.stack) || err);
    process.exit(1);
  });
