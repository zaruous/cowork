# coworks

Claude · Cursor · Codex 세 코딩 에이전트를 **CLI에서 세션을 유지한 채** 대화시키는 러너 모음.

각 러너는 턴을 넘겨도 대화 맥락이 끊기지 않도록 세션 ID를 파일에 저장한다. 프로세스를 새로 띄워도 이어서 대화할 수 있고, 모든 대화는 마크다운으로 기록된다. 세 에이전트를 한 주제로 붙여 라운드 토론을 시키는 `trio-chat`, 지정한 저장소를 대상으로 코드리뷰를 반복 진행하는 `scenario-review`가 함께 들어 있다.

## 요구사항

- **Node.js 18 이상**
- 쓰려는 러너에 따라:
  | 러너 | 필요한 것 |
  |---|---|
  | `cursor-*`, `scenario-review/*` | `CURSOR_API_KEY` (`@cursor/sdk` 사용 — `npm install`로 설치됨) |
  | `claude-live-chat.js` | Claude Code CLI + `claude auth login` |
  | `codex-live-chat.js` | Codex CLI + `codex login` (ChatGPT 계정) |
  | `trio-chat/trio-chat.js` | 위 세 가지 모두 |

```bash
npm install
```

## 환경변수

| 변수 | 용도 | 기본값 |
|---|---|---|
| `CURSOR_API_KEY` | Cursor SDK 인증 (**필수**) | — |
| `CLAUDE_MODEL` | Claude 모델 ID | `sonnet` |
| `CODEX_MODEL` | Codex 모델 ID | CLI 기본값 |
| `CURSOR_CHAT_CWD` | `cursor-live-chat.js`에서 에이전트가 파일을 읽고 명령을 실행할 디렉터리 | 스크립트 폴더 |
| `REVIEW_TARGET_CWD` | `cursor-review.js`의 리뷰 대상 저장소 (**필수**) | — |
| `REVIEW_LOG_PATH` | `cursor-review.js` 로그 경로 | `<대상>/docs/plan/cursor-review-log.md` |

```powershell
# PowerShell
$env:CURSOR_API_KEY = 'key_...'
```
```bash
# bash
export CURSOR_API_KEY=key_...
```

`codex-live-chat.js`는 Codex CLI를 띄울 때 `CODEX_API_KEY`와 `OPENAI_API_KEY`를 환경에서 **제거한다**. API 키가 아니라 ChatGPT 계정 로그인을 쓰도록 강제하기 위한 것이다.

## Agent Skills (Claude · Codex · Cursor)

라이브 챗 사용법을 각 도구가 자동으로 찾을 수 있도록 [Agent Skills](https://agentskills.io/) 형식으로 넣어 두었다. 폴더 구조만 도구별 검색 경로에 맞춘다(`SKILL.md` frontmatter는 공통).

| 도구 | 검색 경로 | 스킬 |
|---|---|---|
| Claude Code | `.claude/skills/` | `claude-live-chat`, `coworks-live-chat`(엔트리 → `.agents` 본문) |
| Codex | `.agents/skills/` | `codex-live-chat`, `coworks-live-chat`(라우터 + references) |
| Cursor | `.cursor/skills/` (+ `.agents`/`.claude`도 로드) | `cursor-live-chat`, `coworks-live-chat`(엔트리) |

채팅에서 `/claude-live-chat`, `/codex-live-chat`, `/cursor-live-chat`, `/coworks-live-chat`처럼 부르거나, “라이브 챗 열어줘”라고 하면 해당 스킬이 선택된다. 상세 표·trio 옵션은 `.agents/skills/coworks-live-chat/references/`에 있다.

## 라이브 챗 — 대화형 단일 에이전트

```bash
node claude-live-chat.js          # 이전 세션 이어서
node claude-live-chat.js --new    # 새 세션으로 시작

node codex-live-chat.js  [--new]
node cursor-live-chat.js [--new] [--cwd <디렉터리>]
```

프롬프트(`나 > `)에서 입력하면 응답이 출력되고 마크다운 로그에 누적된다.

| 입력 | 동작 |
|---|---|
| `/new` | 세션을 버리고 새로 시작 |
| `/exit`, `/quit`, `종료` | 종료 (다음 실행 시 이어서 대화 가능) |
| `Ctrl+C` | 진행 중인 호출을 끊고 종료 — 세션은 보존 |

각 러너가 만드는 파일:

| 러너 | 세션 상태 | 로그 |
|---|---|---|
| `claude-live-chat.js` | `.claude-session.json` | `claude-live-chat.md` |
| `codex-live-chat.js` | `.codex-session.json` | `codex-live-chat.md` |
| `cursor-live-chat.js` | `.cursor-session.json` | `cursor-live-chat.md` |

`cursor-live-chat.js`의 `--cwd`는 **에이전트의 작업 디렉터리**만 바꾼다. 세션 상태와 로그는 항상 스크립트 폴더에 모인다. 모델은 `composer-2.5` 고정.

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
| `-h`, `--help` | 도움말 | — |

Cursor 모델은 `auto`를 쓴다.

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

## cursor-chat.js — 연결 확인용

미리 정해둔 5턴을 순서대로 보내고 `cursor-conversation-<타임스탬프>.md`에 기록한다. SDK 연결과 다중 턴 동작을 확인하는 스모크 테스트 용도.

```bash
node cursor-chat.js
```

## 저장소에 올리지 않는 것

`.gitignore`에서 제외하는 항목:

- **대화 기록 로그** (`*-live-chat.md`, `trio-chat/logs/`) — 실행 대상 프로젝트의 코드·설계 내용이 그대로 담긴다. 사내 코드를 리뷰시킨 로그라면 공개 저장소에 올리기 전에 반드시 확인할 것
- **세션 상태 파일** (`.claude-session.json`, `.codex-session.json`, `.cursor-session.json`, `.session.json`) — 로컬 전용
- `.env`, `*.pem`, `*.key`, `node_modules/`

## 주의

- API 키는 코드에 넣지 않고 환경변수로만 읽는다. 경로도 인자나 환경변수로 받는다
- `claude-live-chat.js`는 Claude CLI를 `--permission-mode dontAsk --safe-mode`로 실행한다. 승인 프롬프트 없이 진행되므로 작업 디렉터리를 확인하고 쓸 것
- Windows에서 검증했다. `trio-chat.js`는 `PATH`/`PATHEXT`를 직접 순회해 CLI를 찾고(`claude`=`.exe`, `codex`=`.cmd` 등 확장자가 제각각이라 필요), `codex-live-chat.js`는 `%APPDATA%\npm`에 설치된 Codex를 Node로 직접 실행한다
- Cursor 로컬 에이전트의 샌드박싱을 지원하지 않는 환경이 있다. 이 경우 `Agent.create` 시점에는 성공하고 첫 `send()`에서 실패로 드러나므로, 러너들은 `sandboxOptions` 없이 에이전트를 만든다

## 라이선스

ISC
