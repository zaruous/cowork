---
name: opencode-live-chat
description: >-
  Run and resume the coworks OpenCode CLI live-chat runner (opencode-live-chat.js): one
  `opencode run --format json` per turn with the prompt on stdin, session continued by
  --session id, tool-step progress, model/agent switching, --auto permission, and pipe
  mode. Use when the user wants OpenCode live chat, an opencode session, or mentions
  opencode-live-chat.js / .opencode-session.json.
compatibility: Node.js 18+. OpenCode CLI (`opencode`) installed with a provider configured (`opencode auth list`). No npm install. coworks repo.
metadata:
  author: coworks
  version: "1.0"
  runner: opencode-live-chat.js
---

# OpenCode live-chat (coworks)

턴마다 `opencode run --format json`을 띄우고 프롬프트는 **stdin**으로 넘긴다(Windows 명령줄 길이·한글 안전).
첫 턴 JSONL의 `sessionID`를 `.opencode-session.json`에 저장하고, 다음 턴부터 `--session <id>`로 이어 붙인다.

`opencode run`은 상주 background service(`opencode service`)에 붙는 얇은 클라이언트라 턴마다 띄워도 비용이 작다.
그래서 agy 러너처럼 프로세스를 상주시키지 않는다.

## Prerequisites

```bash
opencode --version
opencode auth list     # 공급자 자격증명 확인. 없으면 opencode auth login
opencode models        # --model 에 넣을 provider/model 목록
```

Windows에서는 `%APPDATA%\npm\node_modules\@opencode\cli\bin\opencode.exe`를 직접 실행한다(`.cmd` 셰임 우회).
다른 위치면 `OPENCODE_BIN`으로 지정한다.

## Run

```bash
cd "$COWORKS_ROOT"
node opencode-live-chat.js                                   # 이전 세션 재개
node opencode-live-chat.js --new --cwd /path/to/target-repo  # 새 세션, 대상 repo
node opencode-live-chat.js --model openai/gpt-5.1 --agent plan
node opencode-live-chat.js --auto                            # 셸·편집 권한 자동 승인
node opencode-live-chat.js --raw --prompt "..." > out.md     # stdout = 응답만
node opencode-live-chat.js --cwd /path/to/repo --prompt-file prompts/task.md --auto
```

| 옵션 | 환경변수 | 기본 |
|---|---|---|
| `--cwd` | `OPENCODE_CHAT_CWD` | 스크립트 폴더 |
| `--model` | `OPENCODE_MODEL` | CLI/세션 기본값 |
| `--agent` | `OPENCODE_AGENT` | CLI 기본값 |
| `--auto` | `OPENCODE_AUTO=1` | 끔 |
| `--timeout <sec>` | `OPENCODE_TIMEOUT` | `600` |
| `--thinking` | — | 끔 (켜면 stderr 로 출력) |

도구 사용은 `  · [read completed] 경로` 형태로 stderr에 찍힌다.

## Interactive commands

| Input | Action |
|---|---|
| `/new` | 세션 버리고 새로 시작 |
| `/exit`, `/quit`, `종료` | 종료 · 세션 보존 |
| `Ctrl+C` | 호출 중이면 그 호출만 중단, 아니면 종료 · 세션 보존 |

## Caveats

- **opencode는 세션마다 마지막에 쓴 모델을 기억한다.** 잘못된 `--model`로 한 번 실패하면 `--model` 없이 재개해도
  같은 오류가 난다. 올바른 `--model`을 주거나 `--new`로 시작한다.
- `--auto` 없이 권한이 필요한 도구(셸 등)를 쓰면 opencode 설정의 권한 규칙을 따른다.

## Artifacts

| File | Purpose |
|---|---|
| `.opencode-session.json` | `sessionId`, `turnCount` |
| `opencode-live-chat.md` | 턴별 마크다운 로그 |

커밋하지 말 것.

## Agent behavior checklist

1. COWORKS_ROOT에서 `node opencode-live-chat.js`를 실행한다.
2. 인증·모델 오류면 `opencode auth list` / `opencode models`부터 점검한다.
3. 응답 요약과 `opencode-live-chat.md` 경로를 보고한다.
4. 커밋·푸시는 사용자 요청 없이 하지 않는다.
