---
name: codex-live-chat
description: >-
  Run and resume the coworks Codex live-chat runner (codex-live-chat.js): ChatGPT
  login session keep-alive, JSONL turn parsing, and markdown logs. Use when the
  user wants Codex live chat, coworks Codex session, or mentions codex-live-chat.js
  / .codex-session.json. Do not use API-key auth for this runner.
compatibility: Codex CLI with ChatGPT login (`codex login`). Node.js 18+. coworks repo.
metadata:
  author: coworks
  version: "1.0"
  runner: codex-live-chat.js
---

# Codex live-chat (coworks)

Codex CLI `exec` / `exec resume`로 thread를 이어 붙이는 대화형 러너.

## When to use this skill

- Codex와 CLI에서 이어서 대화할 때
- ChatGPT 계정 로그인 기반 coworks 세션이 필요할 때

Claude/Cursor 러너나 trio가 필요하면 [coworks-live-chat](../coworks-live-chat/SKILL.md)를 연다.

## Resolve COWORKS_ROOT

`codex-live-chat.js`가 있는 디렉터리. 상태·로그는 여기에 저장된다.
(현재 스크립트는 Codex 자식 프로세스 cwd도 스크립트 폴더를 쓴다.)

## Prerequisites

```bash
# Windows: APPDATA\npm\node_modules\@openai\codex\bin\codex.js 를 Node로 직접 실행할 수 있음
codex --version
codex login status   # logged in 이어야 함. 아니면 codex login
```

**중요:** 러너는 자식 환경에서 `CODEX_API_KEY`와 `OPENAI_API_KEY`를 **제거**한다.
API 키가 아니라 ChatGPT 계정 로그인을 강제한다. 키를 다시 export하지 말 것.

## Run

```bash
cd "$COWORKS_ROOT"
node codex-live-chat.js         # 이전 thread 재개
node codex-live-chat.js --new   # 새 세션
```

선택 모델:

```bash
# bash
export CODEX_MODEL=...
# PowerShell
$env:CODEX_MODEL = '...'
node codex-live-chat.js
```

새 세션은 `--sandbox read-only`로 시작한다. resume 경로는 세션 ID로 `exec resume`한다.

## Interactive commands

| Input | Action |
|---|---|
| `/new` | thread 버리고 새로 시작 |
| `/exit`, `/quit`, `종료` | 종료 · 세션 보존 |
| `Ctrl+C` | 프로세스 트리 종료 · 세션 보존 |

## Artifacts

| File | Purpose |
|---|---|
| `.codex-session.json` | `sessionId` (thread_id), `turnCount` |
| `codex-live-chat.md` | 턴별 마크다운 로그 |

커밋하지 말 것.

## Agent behavior checklist

1. COWORKS_ROOT에서 `node codex-live-chat.js`를 실행한다.
2. auth 실패 시 `codex login`을 안내하고, API 키 우회를 시도하지 않는다.
3. 응답 요약과 `codex-live-chat.md` 경로를 보고한다.
4. 커밋·푸시는 사용자 요청 없이 하지 않는다.

## Optional UI metadata

Codex UI 칩이 필요하면 이 디렉터리에 `agents/openai.yaml`을 추가할 수 있다(선택).
현재는 `SKILL.md`만으로 동작한다.
