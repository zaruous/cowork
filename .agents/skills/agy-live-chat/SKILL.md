---
name: agy-live-chat
description: >-
  Run the coworks agy(Antigravity CLI) live-chat runner (agy-live-chat.js): one long-lived
  `agy --print` process fed NDJSON turns over stdin (stream-json in/out), conversation
  resumed by --conversation id, streaming deltas, tool-step logs, model/effort/mode
  switching without losing context, and --yolo for shell-command permission. Use when the
  user wants agy live chat, an Antigravity CLI session, Gemini 3.x via agy, or mentions
  agy-live-chat.js / agy-chat.js / agy-client.js / .agy-session.json.
compatibility: Node.js 18+. Antigravity CLI (`agy`) installed and logged in. No npm install. coworks repo.
metadata:
  author: coworks
  version: "1.0"
  runner: agy-live-chat.js
  model: agy CLI default (see `agy models`)
---

# agy live-chat (coworks)

Antigravity CLI(`agy`)를 print 모드로 붙잡아 두고 대화하는 러너.
모델은 `agy models` 목록(Gemini 3.x / Claude / GPT-OSS)에서 고른다.

## When to use this skill

- Gemini 3.x 계열 의견을 CLI에서 세션 유지하며 받을 때
- 저장소를 읽고(파일 도구 자동 허용) 설계·리뷰 의견을 받을 때
- 같은 대화에서 모델·effort 를 갈아 끼우며 비교할 때 (`/model`, `/effort` — 맥락 유지)
- 파이프로 결과를 파일에 뽑을 때 (`--raw`)

빌드·테스트까지 돌려야 하면 `--yolo` 가 필요하다(아래 권한 절). 그런 작업은
Claude/Cursor 러너가 더 적합할 수 있다: [coworks-live-chat](../coworks-live-chat/SKILL.md).

## 다른 러너와 다른 점

| | Codex 러너 | Cursor 러너 | agy 러너 |
|---|---|---|---|
| 프로세스 | 턴마다 새로 spawn | SDK(프로세스 없음) | **한 번 띄워 두고 계속 씀** |
| 프롬프트 전달 | stdin(텍스트) | SDK 호출 | **stdin NDJSON 한 줄 = 한 턴** |
| 재개 | `exec resume <id>` | `Agent.resume(id)` | `--conversation <id>` (죽었을 때만) |
| 상태 파일 | `.codex-session.json` | `.cursor-session.json` | `.agy-session.json` |
| 명령 실행 | 있음 | 있음 | `--yolo` 일 때만 |

핵심 구조 (`agy-client.js`):

```
agy -p= --input-format stream-json --output-format stream-json --print-timeout 600s
    [--conversation <id>] [--model <id>] [--effort low|medium|high]
    [--mode plan|accept-edits] [--add-dir <path>]... [--dangerously-skip-permissions]
```

- 입력 한 줄: `{"event":"user","message":{"role":"user","content":"텍스트"}}`
- 출력: `init`(대화 id·도구 57개·권한 모드) → `step_update`(`agent_response` 델타 / `tool`) → `result`(응답 전문·usage)
- 프롬프트가 argv 가 아니라 stdin 이라 **Windows 명령줄 길이 제한·한글 인용 문제가 없다**
- `result.usage`·`result.num_turns` 는 **프로세스 누적치**다. 턴별 사용량은 `agent_response`
  스텝의 usage 를 합산해서 계산한다(재개 직후 턴에서 대화 전체 값이 들어오는 것을 피하려고)

## Prerequisites

`npm install` 불필요(의존성 0). `agy` 가 PATH 에 있어야 하고, 없으면 `AGY_BIN` 으로 경로 지정.

```bash
agy --version     # 예: 1.1.18
agy models        # 인증 확인 겸 모델 목록 (실패하면 로그인부터)
```

## Run

```bash
cd "$COWORKS_ROOT"
node agy-live-chat.js                                    # 이전 대화 이어서
node agy-live-chat.js --new                              # 새 대화
node agy-live-chat.js --new --cwd /path/to/target-repo    # 그 저장소를 읽게 한다
node agy-live-chat.js --model gemini-3.1-pro-high --effort high
node agy-live-chat.js --mode plan                         # 계획 모드
node agy-live-chat.js --yolo                              # 셸 명령까지 자동 승인
```

비대화형(한 턴 실행 후 종료):

```bash
node agy-live-chat.js --prompt "질문 한 줄"
node agy-live-chat.js --new --prompt-file prompts/review.md
node agy-live-chat.js --raw --prompt "..." > out.md        # stdout 은 응답만
```

`--cwd` 는 **에이전트 작업 디렉터리**만 바꾼다(세션·로그는 항상 스크립트 폴더).
`--cwd` 는 자동으로 `--add-dir` 에도 들어간다 — 워크스페이스에 넣지 않으면 에이전트가
엉뚱한 경로를 뒤진다. 추가 디렉터리는 `--add-dir` 를 반복해서 붙인다.

스모크 테스트(고정 3턴 — 인사 → 첫 발언 인용으로 맥락 확인 → 턴 수 정리):

```bash
node agy-chat.js
node agy-chat.js --model gemini-3.5-flash-low --effort low --no-stream
```

## 권한 (중요)

| 권한 모드 | 언제 | 파일 읽기 | 셸 명령 |
|---|---|---|---|
| `request-review` (기본) | 옵션 없이 실행 | 자동 허용 | **거부 → 그 턴 `ERROR`** |
| `always-proceed` | `--yolo` / `/yolo` / `AGY_SKIP_PERMISSIONS=1` | 허용 | 자동 승인 |

print 모드에는 승인을 물어볼 사람이 없어서, 기본 모드에서 `run_command` 를 쓰려 하면
`permission check failed ... user denied permission` 로 턴이 끝난다. 러너는 이때
`--yolo` 안내를 함께 출력한다. 명령 실행이 꼭 필요할 때만 켜고, 대상 디렉터리를 먼저 확인한다.

## Interactive commands

| Input | Action |
|---|---|
| `/new` | 대화를 버리고 새 대화 |
| `/exit`, `/quit`, `종료` | 종료 · 대화 id 보존 |
| `/model [id]` | 모델 확인 / 변경 (프로세스만 재기동, **맥락 유지**) |
| `/models [검색어]` | `agy models` 목록 조회 |
| `/effort [low\|medium\|high\|off]` | reasoning effort |
| `/mode [plan\|accept-edits\|off]` | 에이전트 실행 모드 |
| `/yolo` | 권한 자동 승인 토글 (재기동) |
| `/tools` | 권한 모드 · 작업 디렉터리 · 도구 목록 |
| `/file [path]` | 다음 메시지에 파일 내용 첨부 |
| `/steps` · `/stream` | 도구 실행 로그 · 스트리밍 토글 |
| `/info` · `/usage` | 대화 id·모델·턴 수 / 누적 토큰 |
| `Ctrl+C` | 턴 진행 중이면 그 턴만 중단(프로세스 kill), 대기 중이면 종료 |

턴을 중단했거나 프로세스가 죽었으면 다음 입력 때 **같은 대화 id로 자동 재개**한다.
모델·effort·mode·yolo 변경은 프로세스 인자라서 재기동이 필요하고, 이때도 `--conversation`
으로 이어붙이므로 대화 맥락은 그대로다.

## Artifacts

| File | Purpose |
|---|---|
| `.agy-session.json` | 대화 id · 턴 수 · 모델/effort/mode · 누적 usage (gitignore) |
| `agy-live-chat.md` | 턴별 마크다운 로그 (gitignore) |
| `agy-conversation-<stamp>.md` | `agy-chat.js` 스모크 테스트 기록 (gitignore) |

## Environment

| Variable | Meaning | Default |
|---|---|---|
| `AGY_BIN` | `agy` 실행 파일 경로 | PATH → `%LOCALAPPDATA%\agy\bin\agy.exe` |
| `AGY_MODEL` | 모델 id | CLI 기본값 |
| `AGY_EFFORT` | reasoning effort | 모델 기본값 |
| `AGY_MODE` | 실행 모드 | 기본값 |
| `AGY_CHAT_CWD` | 에이전트 작업 디렉터리 | 스크립트 폴더 |
| `AGY_TIMEOUT` | 한 턴 제한(초) | `600` |
| `AGY_SKIP_PERMISSIONS` | `1` 이면 권한 자동 승인 | 꺼짐 |

## Related

| Script | Notes |
|---|---|
| `agy-client.js` | 공용 래퍼 — 프로세스 생명주기, NDJSON 송신, 이벤트 파싱, usage 정규화 |
| `agy-chat.js` | 고정 3턴 스모크 테스트 |
| `agy-live-chat.js` | 대화형 러너 |

## Agent behavior checklist

1. `agy --version` → 실패하면 설치/PATH/`AGY_BIN` 부터 점검한다. 인증은 `agy models` 로 확인.
2. 대상 저장소가 있으면 `--cwd` 로 지정한다(자동으로 워크스페이스에도 추가된다).
3. 셸 명령이 필요한 요청인지 먼저 판단한다. 필요하면 `--yolo`, 아니면 기본 모드로 둔다.
4. 긴 지시는 `--prompt-file` 로 넘긴다(stdin 경유라 길이 제한이 없다).
5. 턴이 `ERROR` 로 끝나면 원문 오류를 그대로 사용자에게 전달한다 — 권한 거부와 모델 오류는 대처가 다르다.
6. 끝나면 응답 요약과 `agy-live-chat.md` 경로를 보고한다.
7. `.agy-session.json` · `agy-live-chat.md` 는 커밋하지 않는다.
