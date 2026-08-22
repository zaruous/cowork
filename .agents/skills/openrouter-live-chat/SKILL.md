---
name: openrouter-live-chat
description: >-
  Run the coworks OpenRouter live-chat runner (openrouter-live-chat.js) over the
  OpenRouter Chat Completions REST API: stealth/ox-alpha by default, reasoning
  effort, streaming, .env-managed OPENROUTER_API_KEY, local message history as the
  session, and sandboxed file tools (list/find/read/search, optional write) so the
  model can inspect a repo itself. Use when the user wants OpenRouter live chat, an
  ox-alpha session, model comparison, or mentions openrouter-live-chat.js /
  openrouter-chat.js / openrouter-tools.js / .openrouter-session.json.
compatibility: Node.js 18+ (global fetch). No npm install needed. OPENROUTER_API_KEY in .env. coworks repo.
metadata:
  author: coworks
  version: "1.1"
  runner: openrouter-live-chat.js
  model: stealth/ox-alpha
---

# OpenRouter live-chat (coworks)

OpenRouter의 `POST /api/v1/chat/completions` 를 직접 호출하는 대화형 러너.
기본 모델은 `stealth/ox-alpha`(1M 컨텍스트 · reasoning 필수 · 현재 무료).
파일 도구가 붙어 있어 모델이 저장소를 스스로 훑어보고 답한다.

## When to use this skill

- 저장소를 읽고 설계·리뷰 의견을 받을 때 (모델이 직접 파일을 찾아 읽는다)
- 모델을 갈아 끼우며 같은 질문을 비교할 때 (`/model`, `/models`)
- reasoning effort(`low|high|max`)로 품질과 지연을 저울질할 때
- 파이프로 결과를 파일에 뽑을 때 (`--raw`)

**명령 실행(빌드·테스트)은 없다.** 테스트를 돌려가며 구현을 맡길 일이면
Claude/Cursor 러너를 쓴다: [coworks-live-chat](../coworks-live-chat/SKILL.md).

## 다른 러너와 다른 점

| | Claude · Codex · Cursor | OpenRouter |
|---|---|---|
| 대화 기록 위치 | 서버 세션(상태 파일엔 id만) | **로컬 `.openrouter-session.json` 에 전문** |
| 재개 방식 | `--resume <id>` | 저장된 messages 를 매 턴 전부 재전송 |
| 파일 읽기 | 있음 | 있음 (`list_files`/`find_files`/`read_file`/`search_files`) |
| 파일 쓰기 | 있음 | `--allow-write` 일 때만 |
| 명령 실행 | 있음 | **없음** |
| 인증 | CLI 로그인 / SDK 키 | `OPENROUTER_API_KEY` |

→ `.openrouter-session.json` 은 세션 id가 아니라 **대화 내용 자체**다. 절대 커밋하지 않는다.

## Resolve COWORKS_ROOT

`openrouter-live-chat.js` 가 있는 디렉터리. 상태 파일·로그·`.env` 는 항상 여기.
`--cwd` 는 **파일 도구가 접근할 디렉터리만** 바꾼다(세션·로그 경로는 그대로).

## Prerequisites

`npm install` 이 필요 없다(의존성 0, Node 18+ 내장 fetch 사용).

```bash
cd "$COWORKS_ROOT"
cp .env.example .env      # PowerShell: Copy-Item .env.example .env
# .env 의 OPENROUTER_API_KEY 를 실제 키(sk-or-v1-...)로 채운다
```

셸 환경변수가 있으면 `.env` 값보다 우선한다.

## 파일 도구

`openrouter-tools.js` 가 도구 정의와 실행·격리를 함께 들고 있다.

| 도구 | 하는 일 | 상한 |
|---|---|---|
| `list_files(dir, depth)` | 디렉터리 트리 (node_modules/.git 등 제외) | 항목 400개, 깊이 5 |
| `find_files(pattern, dir)` | **파일명 glob 검색**, 수정 최신순 (`*.md`, `**/*.test.js`) | 결과 200~400건 |
| `search_files(pattern, dir, extensions)` | **내용 정규식 검색** → `경로:행:내용` | 일치 100건, 파일 1MB |
| `read_file(path, start_line, end_line)` | 텍스트 파일 읽기 (바이너리 거부) | 60,000자 |
| `write_file(path, content)` | 파일 생성·덮어쓰기 (**`--allow-write` 없으면 도구 자체가 없다**) | 400,000자 |

격리 규칙 (도구 상자가 강제한다):

- 모든 경로는 `--cwd` 안으로 제한 — `..` 탈출과 심볼릭 링크 탈출 모두 차단
- `.env*`, `*.key`, `*.pem`, `*.pfx`, `id_rsa*`, `.npmrc`, `.git-credentials` 등은 **읽기조차 거부**
  → `--cwd` 가 coworks 저장소면 `.env` 의 API 키가 모델 컨텍스트·로그로 새어 나가기 때문
- `.git` 내부 접근 거부
- 쓰기는 기본 꺼짐. 도구 오류는 모델에 그대로 돌려주므로 모델이 경로를 고쳐 다시 시도한다

한 턴에 도구 왕복은 `--max-tool-steps`(기본 12)까지. 넘으면 그 턴을 실패로 처리하고 되돌린다.

## Run

```bash
cd "$COWORKS_ROOT"
node openrouter-live-chat.js                              # 이전 대화 이어서
node openrouter-live-chat.js --new                        # 새 세션
node openrouter-live-chat.js --cwd /path/to/target-repo    # 대상 저장소를 읽게 한다
node openrouter-live-chat.js --cwd /path/to/repo --allow-write   # 쓰기까지 허용
node openrouter-live-chat.js --no-tools                   # 도구 없이 순수 채팅
node openrouter-live-chat.js --effort high --show-reasoning
```

비대화형(한 턴 실행 후 종료) — 자동화·위임에 쓴다:

```bash
node openrouter-live-chat.js --prompt "질문 한 줄"
node openrouter-live-chat.js --new --prompt-file prompts/review.md
node openrouter-live-chat.js --raw --prompt "..." > out.md   # stdout 은 응답만
```

`--raw` 는 응답 본문만 stdout 으로 보내고 안내·도구 로그·usage 는 stderr 로 보낸다.
`--prompt-file` 은 **파일 본문을 그대로 메시지로 보낸다**(Claude 러너처럼 에이전트가
경로를 받아 읽는 방식이 아니다 — 다만 도구가 켜져 있으면 모델이 스스로 다른 파일을 더 읽는다).
실패하면 종료코드 1.

스모크 테스트(고정 5턴, 연결·맥락·usage 확인):

```bash
node openrouter-chat.js --effort low
```

## Interactive commands

| Input | Action |
|---|---|
| `/new` | 대화 기록을 버리고 새 세션 |
| `/exit`, `/quit`, `종료` | 종료 · 기록 보존 |
| `/model [id]` | 모델 확인 / 변경 (기록은 유지) |
| `/models [검색어]` | OpenRouter 카탈로그 조회 (무료 여부·컨텍스트 표시) |
| `/effort [low\|high\|max\|off]` | reasoning effort |
| `/system [text]` | 시스템 프롬프트 확인 / 변경 |
| `/tools` | 작업 디렉터리·도구 목록·쓰기 권한·차단 규칙 |
| `/reasoning` | 추론 과정 출력 토글 |
| `/stream` | 스트리밍 토글 |
| `/file [path]` | 다음 메시지에 파일 내용 첨부 (도구를 껐을 때 유용) |
| `/history [n]` | 최근 n턴 다시 보기 |
| `/undo` | 마지막 1턴을 기록에서 제거 (로그는 보존) |
| `/usage` | 누적 토큰·비용 |
| `Ctrl+C` | 호출 중이면 그 호출만 중단, 대기 중이면 종료 |

실패한 턴은 대화 기록에서 **통째로** 되돌린다(사용자 메시지 + tool_calls + 도구 결과).
결과 없는 tool_calls 가 남으면 다음 요청이 API에서 거부되기 때문이다. 로그에는 오류가 남는다.

## Artifacts

| File | Purpose |
|---|---|
| `.env` | `OPENROUTER_API_KEY` 등 (gitignore) |
| `.openrouter-session.json` | 세션 = 시스템 프롬프트 + messages 전문(도구 왕복 포함) + 누적 usage (gitignore) |
| `openrouter-live-chat.md` | 턴별 마크다운 로그 + 도구 호출 한 줄 요약 (gitignore) |
| `openrouter-conversation-<stamp>.md` | `openrouter-chat.js` 스모크 테스트 기록 (gitignore) |

## Environment

| Variable | Meaning | Default |
|---|---|---|
| `OPENROUTER_API_KEY` | 인증 (**필수**) | — |
| `OPENROUTER_MODEL` | 모델 id | `stealth/ox-alpha` |
| `OPENROUTER_EFFORT` | reasoning effort | 모델 기본값 |
| `OPENROUTER_SYSTEM` | 시스템 프롬프트 | 한국어 코딩 어시스턴트 |
| `OPENROUTER_CHAT_CWD` | 파일 도구 작업 디렉터리 | 스크립트 폴더 |
| `OPENROUTER_TIMEOUT` | 1회 호출 제한(초) | `300` |
| `OPENROUTER_BASE_URL` | API 베이스 URL | `https://openrouter.ai/api/v1` |

## Related

| Script | Notes |
|---|---|
| `openrouter-client.js` | 공용 클라이언트 — 스트리밍, tool_calls 조립, 재시도, usage 정규화 |
| `openrouter-tools.js` | 파일 도구 정의 + 경로 격리·자격증명 차단 |
| `load-env.js` | 의존성 없는 `.env` 로더 (셸 환경변수 우선) |
| `trio-chat/trio-chat.js --with-openrouter` | OpenRouter를 4번째 토론 참가자로 추가 (도구 없음) |

## Agent behavior checklist

1. `.env` 에 `OPENROUTER_API_KEY` 가 있는지 먼저 확인한다. 키 값을 출력·로그·커밋하지 않는다.
2. 대상 저장소가 있으면 `--cwd` 로 지정한다. 지정하지 않으면 coworks 저장소를 읽는다.
3. 쓰기는 사용자가 명시적으로 요청할 때만 `--allow-write` 를 붙인다. 더러운 워킹트리에는 권하지 않는다.
4. 빌드·테스트 실행이 필요한 작업이면 이 러너로 끝내려 하지 말고 Claude/Cursor 러너에 넘긴다.
5. 대화가 길어지면 `--max-history`(기본 40) 로 재전송량을 조절한다. 도구 결과도 이 창을 먹는다.
6. 끝나면 응답 요약과 `openrouter-live-chat.md` 경로를 보고한다.
7. `.openrouter-session.json` · `openrouter-live-chat.md` 를 커밋하지 않는다.
