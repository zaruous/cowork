# coworks

Claude · Cursor · Codex · agy(Antigravity) 네 코딩 에이전트와 OpenRouter 모델을 **CLI에서 세션을 유지한 채** 대화시키는 러너 모음.

각 러너는 턴을 넘겨도 대화 맥락이 끊기지 않도록 세션 상태를 파일에 저장한다. 프로세스를 새로 띄워도 이어서 대화할 수 있고, 모든 대화는 마크다운으로 기록된다. 에이전트들을 한 주제로 붙여 라운드 토론을 시키는 `trio-chat`, 지정한 저장소를 대상으로 코드리뷰를 반복 진행하는 `scenario-review`가 함께 들어 있다.

코딩 에이전트 4종은 각자의 CLI/SDK가 대화를 서버에 들고 있어 상태 파일에는 세션 ID만 남는다. OpenRouter 러너는 상태 없는 HTTP API를 직접 호출하므로 대화 기록 자체를 로컬에 들고 매 턴 재전송한다.

## 요구사항

- **Node.js 18 이상**
- 쓰려는 러너에 따라:
  | 러너 | 필요한 것 |
  |---|---|
  | `cursor-*`, `scenario-review/*` | `CURSOR_API_KEY` (`@cursor/sdk` 사용 — `npm install`로 설치됨) |
  | `claude-live-chat.js` | Claude Code CLI + `claude auth login` |
  | `codex-live-chat.js` | Codex CLI + `codex login` (ChatGPT 계정) |
  | `openrouter-*` | `OPENROUTER_API_KEY` (의존성 없음 — Node 18+ 내장 `fetch` 사용) |
  | `agy-*` | Antigravity CLI(`agy`) 설치 + 로그인 (`agy models`로 확인, 의존성 없음) |
  | `trio-chat/trio-chat.js` | 위 코딩 에이전트 3종 (`--with-openrouter` 사용 시 `OPENROUTER_API_KEY`도) |

```bash
npm install
```

## 환경변수

| 변수 | 용도 | 기본값 |
|---|---|---|
| `CURSOR_API_KEY` | Cursor SDK 인증 (**Cursor 러너 필수**) | — |
| `OPENROUTER_API_KEY` | OpenRouter 인증 (**OpenRouter 러너 필수**) | — |
| `OPENROUTER_MODEL` | OpenRouter 모델 id | `stealth/ox-alpha` |
| `OPENROUTER_EFFORT` | reasoning effort (`low`/`high`/`max`) | 모델 기본값 |
| `OPENROUTER_SYSTEM` | OpenRouter 시스템 프롬프트 | 한국어 코딩 어시스턴트 |
| `OPENROUTER_TIMEOUT` | OpenRouter 1회 호출 제한(초) | `300` |
| `CLAUDE_MODEL` | Claude 모델 ID | `sonnet` |
| `CODEX_MODEL` | Codex 모델 ID | CLI 기본값 |
| `AGY_MODEL` | agy 모델 ID (`agy models` 목록) | CLI 기본값 |
| `AGY_EFFORT` | agy reasoning effort (`low`/`medium`/`high`) | 모델 기본값 |
| `AGY_CHAT_CWD` | `agy-live-chat.js`에서 에이전트가 파일을 읽고 명령을 실행할 디렉터리 | 스크립트 폴더 |
| `AGY_BIN` | `agy` 실행 파일 경로 (PATH에 없을 때) | `%LOCALAPPDATA%\agy\bin\agy.exe` |
| `CURSOR_CHAT_CWD` | `cursor-live-chat.js`에서 에이전트가 파일을 읽고 명령을 실행할 디렉터리 | 스크립트 폴더 |
| `REVIEW_TARGET_CWD` | `cursor-review.js`의 리뷰 대상 저장소 (**필수**) | — |
| `REVIEW_LOG_PATH` | `cursor-review.js` 로그 경로 | `<대상>/docs/plan/cursor-review-log.md` |

키는 `.env` 파일로 관리한다. `.env.example`을 복사해 값을 채우면 된다(`.env`는 gitignore 대상).

```bash
cp .env.example .env
```
```powershell
Copy-Item .env.example .env
```

셸에 같은 이름의 환경변수가 이미 있으면 그 값이 `.env`보다 우선한다. 로딩은 의존성 없는 `load-env.js`가 하고, OpenRouter 러너가 시작할 때 자동으로 읽는다. 셸에서 직접 주려면:

```powershell
# PowerShell
$env:CURSOR_API_KEY = 'key_...'
$env:OPENROUTER_API_KEY = 'sk-or-v1-...'
```
```bash
# bash
export CURSOR_API_KEY=key_...
export OPENROUTER_API_KEY=sk-or-v1-...
```

`codex-live-chat.js`는 Codex CLI를 띄울 때 `CODEX_API_KEY`와 `OPENAI_API_KEY`를 환경에서 **제거한다**. API 키가 아니라 ChatGPT 계정 로그인을 쓰도록 강제하기 위한 것이다.

## Agent Skills (Claude · Codex · Cursor)

라이브 챗 사용법을 각 도구가 자동으로 찾을 수 있도록 [Agent Skills](https://agentskills.io/) 형식으로 넣어 두었다. 폴더 구조만 도구별 검색 경로에 맞춘다(`SKILL.md` frontmatter는 공통).

| 도구 | 검색 경로 | 스킬 |
|---|---|---|
| Claude Code | `.claude/skills/` | `claude-live-chat`, `openrouter-live-chat`(엔트리), `agy-live-chat`(엔트리), `coworks-live-chat`(엔트리 → `.agents` 본문) |
| Codex | `.agents/skills/` | `codex-live-chat`, `openrouter-live-chat`(본문), `agy-live-chat`(본문), `coworks-live-chat`(라우터 + references) |
| Cursor | `.cursor/skills/` (+ `.agents`/`.claude`도 로드) | `cursor-live-chat`, `coworks-live-chat`(엔트리) |

채팅에서 `/claude-live-chat`, `/codex-live-chat`, `/cursor-live-chat`, `/openrouter-live-chat`, `/coworks-live-chat`처럼 부르거나, “라이브 챗 열어줘”라고 하면 해당 스킬이 선택된다. 상세 표·trio 옵션은 `.agents/skills/coworks-live-chat/references/`에 있다.

## 라이브 챗 — 대화형 단일 에이전트

```bash
node claude-live-chat.js          # 이전 세션 이어서
node claude-live-chat.js --new    # 새 세션으로 시작

node codex-live-chat.js  [--new]
node cursor-live-chat.js [--new] [--cwd <디렉터리>]
node openrouter-live-chat.js [--new] [--cwd <디렉터리>] [--effort <low|high|max>]
node agy-live-chat.js        [--new] [--cwd <디렉터리>] [--effort <low|medium|high>] [--yolo]
```

프롬프트(`나 > `)에서 입력하면 응답이 출력되고 마크다운 로그에 누적된다.

| 입력 | 동작 |
|---|---|
| `/new` | 세션을 버리고 새로 시작 |
| `/exit`, `/quit`, `종료` | 종료 (다음 실행 시 이어서 대화 가능) |
| `Ctrl+C` | 진행 중인 호출을 끊고 종료 — 세션은 보존 |

OpenRouter 러너에는 모델·effort·첨부를 다루는 명령이 더 있다(`/help`로 확인). `Ctrl+C`도 호출 중이면 그 호출만 끊고 프롬프트로 돌아온다.

각 러너가 만드는 파일:

| 러너 | 세션 상태 | 로그 |
|---|---|---|
| `claude-live-chat.js` | `.claude-session.json` | `claude-live-chat.md` |
| `codex-live-chat.js` | `.codex-session.json` | `codex-live-chat.md` |
| `cursor-live-chat.js` | `.cursor-session.json` | `cursor-live-chat.md` |
| `openrouter-live-chat.js` | `.openrouter-session.json` (**대화 전문**) | `openrouter-live-chat.md` |
| `agy-live-chat.js` | `.agy-session.json` | `agy-live-chat.md` |

`cursor-live-chat.js`의 `--cwd`는 **에이전트의 작업 디렉터리**만 바꾼다. 세션 상태와 로그는 항상 스크립트 폴더에 모인다. 모델은 `composer-2.5` 고정.

### openrouter-live-chat.js — OpenRouter (기본 `stealth/ox-alpha`)

OpenRouter의 `POST /api/v1/chat/completions`를 직접 호출한다. Node 18+ 내장 `fetch`만 쓰므로 이 러너에는 `npm install`이 필요 없다. 기본 모델 `stealth/ox-alpha`는 1M 컨텍스트 · reasoning 필수 · 현재 무료.

**파일 도구가 붙어 있어 모델이 저장소를 스스로 읽는다.** 함수 호출(tool_calls)을 받아 도구를 실행하고 결과를 되돌려주는 루프를 러너가 돌린다. 명령 실행(빌드·테스트)은 없다 — 그건 Claude/Cursor 러너의 몫이다.

| 도구 | 하는 일 |
|---|---|
| `list_files` | 디렉터리 트리 (node_modules·.git 등 제외) |
| `find_files` | 파일명 glob 검색 (`*.md`, `**/*.test.js`), 수정 최신순 |
| `search_files` | 내용 정규식 검색 → `경로:행:내용` |
| `read_file` | 텍스트 파일 읽기 (행 범위 지정 가능, 바이너리 거부) |
| `write_file` | 파일 생성·덮어쓰기 — `--allow-write` 없으면 도구 자체가 없다 |

격리는 `openrouter-tools.js`가 강제한다: 모든 경로를 `--cwd` 안으로 제한(`..`·심볼릭 링크 탈출 차단), `.env*`·`*.key`·`*.pem` 같은 자격증명 파일은 **읽기조차 거부**(`--cwd`가 이 저장소일 때 API 키가 모델 컨텍스트로 새는 것을 막는다), `.git` 내부 차단. 한 턴의 도구 왕복은 `--max-tool-steps`(기본 12)까지.

**OpenRouter는 서버 세션이 없다.** 그래서 `.openrouter-session.json`에는 세션 ID가 아니라 시스템 프롬프트 + 대화 전문 + 누적 토큰이 들어가고, 매 턴 이 기록을 다시 보내 맥락을 유지한다. 재전송량은 `--max-history <n>`(기본 40개 메시지)으로 제한한다. 이 파일은 곧 대화 내용이므로 커밋하지 않는다.

```bash
node openrouter-live-chat.js --cwd D:\git\my-repo          # 그 저장소를 읽게 한다
node openrouter-live-chat.js --cwd D:\git\my-repo --allow-write
node openrouter-live-chat.js --no-tools                    # 도구 없이 순수 채팅
node openrouter-live-chat.js --model <다른-모델-id>          # id는 대화 중 /models 로 검색
node openrouter-live-chat.js --new --effort high --show-reasoning
```

`--cwd`는 **파일 도구의 작업 디렉터리만** 바꾼다(세션·로그는 항상 스크립트 폴더).

비대화형 한 턴 실행 — 자동화·위임용:

```bash
node openrouter-live-chat.js --prompt "질문 한 줄"
node openrouter-live-chat.js --new --prompt-file prompts/review.md
node openrouter-live-chat.js --raw --prompt "..." > answer.md   # stdout은 응답만
```

`--raw`는 응답 본문만 stdout으로 보내고 안내·도구 로그·토큰 사용량은 stderr로 보낸다. 파이프로 파일에 뽑을 때 쓴다.

`--prompt-file`은 Claude 러너와 달리 **파일 본문을 그대로 메시지에 담아 보낸다**(OpenRouter에는 파일을 읽을 도구가 없다). 호출이 실패하면 종료코드 1.

대화 중 쓰는 추가 명령:

| 입력 | 동작 |
|---|---|
| `/model [id]` | 모델 확인 / 변경 (대화 기록 유지) |
| `/models [검색어]` | OpenRouter 카탈로그 조회 (컨텍스트·무료 여부 표시) |
| `/effort [low|high|max|off]` | reasoning effort |
| `/system [text]` | 시스템 프롬프트 확인 / 변경 |
| `/tools` | 작업 디렉터리·도구 목록·쓰기 권한·차단 규칙 |
| `/file [path]` | 다음 메시지에 파일 내용 첨부 (도구를 껐을 때 유용) |
| `/history [n]` · `/undo` · `/usage` | 기록 보기 · 마지막 턴 취소 · 누적 토큰 |
| `/reasoning` · `/stream` | 추론 과정 출력 · 스트리밍 토글 |

실패한 턴은 대화 기록에서 통째로 되돌린다(사용자 메시지 + tool_calls + 도구 결과). 결과 없는 tool_calls가 남으면 다음 요청이 API에서 거부되기 때문이다. 로그에는 오류가 남는다.

`openrouter-client.js`가 스트리밍·tool_calls 조립·재시도·usage 정규화를 담당하는 공용 클라이언트다. 공식 SDK(`@openrouter/sdk`)는 ESM 전용이라 CommonJS인 이 저장소에서 `require`할 수 없어, SDK가 감싸는 것과 같은 REST 엔드포인트를 직접 호출한다.

### agy-live-chat.js — Antigravity CLI(agy)

`agy`를 **print 모드로 한 번만 띄워 두고** 대화 전체를 그 프로세스로 흘려보낸다. `--input-format stream-json --output-format stream-json` 조합에서 agy는 stdin으로 NDJSON 한 줄(`{"event":"user","message":{...}}`)을 받을 때마다 한 턴을 실행하고, stdin이 닫힐 때까지 살아 있다. 그래서 턴마다 프로세스를 새로 띄우는 Codex 러너와 달리 기동 비용이 1회뿐이고, 프롬프트가 argv가 아니라 stdin으로 들어가 Windows 명령줄 길이 제한도 받지 않는다.

세션은 agy의 대화 ID다. `.agy-session.json`에 ID만 저장하고, 프로세스가 죽거나 모델·effort를 바꿀 때만 `--conversation <id>`로 다시 이어붙인다(대화 맥락은 유지된다).

```bash
node agy-live-chat.js                                   # 이전 대화 이어서
node agy-live-chat.js --new --cwd D:\git\my-repo        # 새 대화 + 그 저장소를 읽게 한다
node agy-live-chat.js --effort high --model gemini-3.1-pro-high
node agy-live-chat.js --raw --prompt "질문" > answer.md   # stdout은 응답만
node agy-live-chat.js --prompt-file prompts/task.md --yolo
```

**권한**: 기본 권한 모드(`request-review`)에서 파일 읽기(`view_file` 등)는 자동 허용되지만 셸 명령(`run_command`)은 거부되어 그 턴이 `ERROR`로 끝난다. 빌드·테스트처럼 명령 실행이 필요하면 `--yolo`(= `--dangerously-skip-permissions`, 권한 모드가 `always-proceed`가 된다) 또는 대화 중 `/yolo`를 쓴다.

대화 중 쓰는 추가 명령:

| 입력 | 동작 |
|---|---|
| `/model [id]` · `/models [검색어]` | 모델 확인·변경 / `agy models` 목록 (변경 시 대화 맥락 유지) |
| `/effort [low\|medium\|high\|off]` | reasoning effort |
| `/mode [plan\|accept-edits\|off]` | 에이전트 실행 모드 |
| `/yolo` | 권한 자동 승인 토글 |
| `/tools` | 권한 모드·작업 디렉터리·도구 목록(57개) |
| `/file [path]` | 다음 메시지에 파일 내용 첨부 |
| `/info` · `/usage` | 대화 ID·모델·턴 수 / 누적 토큰 |
| `/steps` · `/stream` | 도구 실행 로그 · 스트리밍 토글 |

`Ctrl+C`는 턴이 진행 중이면 그 턴만 끊고(프로세스를 죽인다) 프롬프트로 돌아온다. 다음 입력 때 같은 대화 ID로 자동 재개한다.

토큰 사용량은 **스텝(모델 호출) 단위 usage를 합산**해서 턴별로 보고한다. agy가 `result`에 담아 주는 usage는 그 프로세스의 누적치라, 재개 직후 턴에서는 대화 전체 값이 들어오기 때문이다.

## trio-chat — 3자 라운드 토론

Claude → Cursor → Codex 순서로 라운드를 돌며 하나의 주제를 토론시킨다. 세 참가자가 각자 서버 쪽에 자기 세션을 유지하므로, 매 턴 전달하는 프롬프트에는 "내가 마지막으로 말한 이후 나온 남들의 발언"만 담는다. 전체 로그를 매번 재전송하면 토큰이 라운드 제곱으로 늘기 때문이다.

```bash
node trio-chat/trio-chat.js --topic "타입 안전성과 개발 속도, 무엇을 먼저 포기할까" --rounds 3
node trio-chat/trio-chat.js --topic-file topic.md --cwd ../my-repo --timeout 600
```

| 옵션 | 설명 | 기본값 |
|---|---|---|
| `--topic <text>` | 토론 주제 (없으면 실행 시 입력받음) | — |
| `--topic-file <path>` | 주제를 파일에서 읽기 | — |
| `--rounds <n>` | 라운드 수 | `3` |
| `--cwd <path>` | 에이전트 작업 디렉터리 | 현재 디렉터리 |
| `--log <path>` | 마크다운 로그 경로 | `trio-chat/logs/trio-<타임스탬프>.md` |
| `--timeout <sec>` | 참가자 1회 호출 제한 | `300` |
| `--with-openrouter` | OpenRouter를 4번째 참가자로 추가 | 꺼짐 |
| `-h`, `--help` | 도움말 | — |

Cursor 모델은 `auto`를 쓴다. `--with-openrouter`로 붙는 좌석만은 서버 세션이 없어 자기 발언 기록을 프로세스 안에 들고 다닌다(모델은 `OPENROUTER_MODEL`).

## scenario-review — 저장소 코드리뷰 자동화

### cursor-review.js — 다중 턴 리뷰 (읽기 위주)

프롬프트 파일 하나가 한 턴이다. 세션을 유지하므로 턴을 나눠 실행해도 앞선 리뷰 맥락이 이어지고, 질문과 답변이 대상 저장소의 로그 파일에 누적된다.

```bash
node scenario-review/cursor-review.js --cwd ../my-repo --new turn1.md
node scenario-review/cursor-review.js --cwd ../my-repo turn2.md
```

대상 저장소는 `--cwd` 또는 `REVIEW_TARGET_CWD`로 지정한다(필수). 세션 상태는 `scenario-review/.session.json`, 모델은 `composer-2.5`.

### cursor-task.js — 구현 작업 위임 (파일 편집 권한 있음)

```bash
node scenario-review/cursor-task.js <프롬프트파일> <작업디렉토리> [로그파일]
```

한 번의 호출로 끝나고 세션을 남기지 않는다. 모델은 `auto`. **에이전트가 대상 디렉터리의 파일을 직접 수정하므로, 커밋되지 않은 변경이 있는 저장소에는 쓰지 않는 편이 좋다.**

## cursor-chat.js · openrouter-chat.js · agy-chat.js — 연결 확인용

미리 정해둔 턴(Cursor·OpenRouter 5턴, agy 3턴)을 순서대로 보내고 `*-conversation-<타임스탬프>.md`에 기록한다. 연결과 다중 턴 맥락 유지를 확인하는 스모크 테스트 용도.

```bash
node cursor-chat.js
node openrouter-chat.js --effort low   # 모델·토큰(추론 토큰 포함)까지 함께 출력
node agy-chat.js                       # 3턴: 인사 → 첫 발언 인용(맥락) → 턴 수 정리
node agy-chat.js --model gemini-3.5-flash-low --effort low --no-stream
```

## 저장소에 올리지 않는 것

`.gitignore`에서 제외하는 항목:

- **대화 기록 로그** (`*-live-chat.md`, `openrouter-conversation-*.md`, `agy-conversation-*.md`, `trio-chat/logs/`) — 실행 대상 프로젝트의 코드·설계 내용이 그대로 담긴다. 사내 코드를 리뷰시킨 로그라면 공개 저장소에 올리기 전에 반드시 확인할 것
- **세션 상태 파일** (`.claude-session.json`, `.codex-session.json`, `.cursor-session.json`, `.agy-session.json`, `.session.json`) — 로컬 전용
- **`.openrouter-session.json`** — 세션 ID가 아니라 대화 전문이 들어 있다. 위 로그와 같은 기준으로 다룰 것
- `.env` (키 보관), `*.pem`, `*.key`, `node_modules/` — 템플릿 `.env.example`만 커밋한다

## 주의

- API 키는 코드에 넣지 않고 `.env` 또는 환경변수로만 읽는다. 경로도 인자나 환경변수로 받는다
- `claude-live-chat.js`는 Claude CLI를 `--permission-mode dontAsk --safe-mode`로 실행한다. 승인 프롬프트 없이 진행되므로 작업 디렉터리를 확인하고 쓸 것
- Windows에서 검증했다. `trio-chat.js`는 `PATH`/`PATHEXT`를 직접 순회해 CLI를 찾고(`claude`=`.exe`, `codex`=`.cmd` 등 확장자가 제각각이라 필요), `codex-live-chat.js`는 `%APPDATA%\npm`에 설치된 Codex를 Node로 직접 실행한다
- Cursor 로컬 에이전트의 샌드박싱을 지원하지 않는 환경이 있다. 이 경우 `Agent.create` 시점에는 성공하고 첫 `send()`에서 실패로 드러나므로, 러너들은 `sandboxOptions` 없이 에이전트를 만든다

## 라이선스

ISC
