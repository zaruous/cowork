---
name: cursor-live-chat
description: >-
  Run and resume the coworks Cursor live-chat runner (cursor-live-chat.js) via
  @cursor/sdk Agent.create/resume: composer-2.5, CURSOR_API_KEY, --cwd target
  repo, markdown logs. Use when the user wants Cursor live chat, coworks Cursor
  session, or mentions cursor-live-chat.js / .cursor-session.json.
compatibility: Node.js 18+, npm install in coworks, CURSOR_API_KEY set. coworks repo.
metadata:
  author: coworks
  version: "1.0"
  runner: cursor-live-chat.js
---

# Cursor live-chat (coworks)

`@cursor/sdk`로 로컬 에이전트를 만들고 `agentId`로 재개하는 대화형 러너.
모델은 `composer-2.5` 고정.

## When to use this skill

- Cursor 에이전트와 CLI에서 이어서 대화할 때
- 대상 저장소를 `--cwd`로 지정해 파일/명령을 돌릴 때

Claude/Codex 러너나 trio가 필요하면 [coworks-live-chat](../../../.agents/skills/coworks-live-chat/SKILL.md)를 연다.

## Resolve COWORKS_ROOT

`cursor-live-chat.js`가 있는 디렉터리.
세션 상태·로그는 항상 여기. `--cwd` / `CURSOR_CHAT_CWD`는 **에이전트 작업 디렉터리만** 바꾼다.

## Prerequisites

```bash
cd "$COWORKS_ROOT"
npm install
```

```powershell
$env:CURSOR_API_KEY = 'key_...'
```

```bash
export CURSOR_API_KEY=key_...
```

이 환경은 로컬 샌드박싱을 지원하지 않을 수 있다. 러너는 `sandboxOptions` 없이 `Agent.create`한다.
`create`는 성공하고 첫 `send()`에서 실패하는 경우가 있으니, 실패 메시지를 그대로 보고한다.

## Run

```bash
cd "$COWORKS_ROOT"
node cursor-live-chat.js
node cursor-live-chat.js --new
node cursor-live-chat.js --cwd /path/to/target-repo
node cursor-live-chat.js --new --cwd /path/to/target-repo
```

또는:

```bash
export CURSOR_CHAT_CWD=/path/to/target-repo
node cursor-live-chat.js
```

## Interactive commands

| Input | Action |
|---|---|
| `/new` | 에이전트 닫고 `Agent.create`로 새 세션 |
| `/exit`, `/quit`, `종료` | 종료 · `agentId` 보존 |
| `Ctrl+C` | 종료 · 세션 보존 |

재개 실패 시 경고 후 자동으로 새 세션을 만든다.

## Artifacts

| File | Purpose |
|---|---|
| `.cursor-session.json` | `agentId`, `turnCount` |
| `cursor-live-chat.md` | 턴별 마크다운 로그 |

커밋하지 말 것.

## Related Cursor scripts (only if asked)

| Script | Notes |
|---|---|
| `scenario-review/cursor-review.js` | 다중 턴 리뷰 · `REVIEW_TARGET_CWD`/`--cwd` 필수 · 모델 `composer-2.5` |
| `scenario-review/cursor-task.js` | 원샷 구현 · 파일 수정 · 세션 없음 · 모델 `auto` · dirty tree 비권장 |
| `cursor-chat.js` | 고정 5턴 스모크 테스트 |

## Agent behavior checklist

1. `CURSOR_API_KEY` 존재와 `npm install`을 확인한다.
2. 대상 repo가 있으면 `--cwd`를 넣는다 (세션/로그 경로는 바꾸지 않음).
3. 끝나면 응답 요약과 `cursor-live-chat.md` 경로를 보고한다.
4. 커밋·푸시는 사용자 요청 없이 하지 않는다.
5. SDK/`Agent` API를 이 스킬 밖에서 새로 짜지 말고, 가능하면 기존 러너를 실행한다.
