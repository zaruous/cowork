---
name: coworks-live-chat
description: >-
  Routes and runs coworks live-chat runners (Claude, Codex, Cursor) and trio-chat.
  Use when the user asks to live-chat, resume a coworks session, delegate work via
  prompt-file, start a 3-agent debate, or mentions claude-live-chat, codex-live-chat,
  cursor-live-chat, or trio-chat.
compatibility: Requires Node.js 18+ and the chosen agent CLI/SDK auth in the coworks repo.
metadata:
  author: coworks
  version: "1.0"
  tools: claude,codex,cursor
---

# coworks live-chat

세션을 유지한 채 Claude · Codex · Cursor와 CLI로 대화하는 coworks 러너 안내.

## Resolve repo root

작업 cwd와 무관하게, `claude-live-chat.js` · `codex-live-chat.js` · `cursor-live-chat.js`가
함께 있는 디렉터리를 **COWORKS_ROOT**로 잡는다. 이 스킬은 그 저장소 안에 있다.

```bash
cd "$COWORKS_ROOT"
npm install   # Cursor SDK 러너용 (최초 1회)
```

## Pick a runner

| 요청 | 스킬 / 러너 |
|---|---|
| Claude와 이어서 대화 · `--prompt-file` 구현 위임 | [claude-live-chat](../../../.claude/skills/claude-live-chat/SKILL.md) → `node claude-live-chat.js` |
| Codex와 이어서 대화 | [codex-live-chat](../codex-live-chat/SKILL.md) → `node codex-live-chat.js` |
| Cursor와 이어서 대화 · 대상 repo `--cwd` | [cursor-live-chat](../../../.cursor/skills/cursor-live-chat/SKILL.md) → `node cursor-live-chat.js` |
| 3자 라운드 토론 | `node trio-chat/trio-chat.js` — [references/trio-chat.md](references/trio-chat.md) |

도구별 상세 절차는 위 전용 스킬을 **반드시 읽고** 따른다. 공통 표는 [references/runners.md](references/runners.md).

## Common interactive commands

프롬프트 `나 > ` 에서:

| 입력 | 동작 |
|---|---|
| `/new` | 세션 버리고 새로 시작 |
| `/exit`, `/quit`, `종료` | 종료 (다음 실행 시 이어짐) |
| `Ctrl+C` | 진행 중 호출 중단 · 세션 보존 |

## Session / log files

상태·로그는 항상 **COWORKS_ROOT**(스크립트 폴더)에 모인다. `--cwd`는 에이전트 작업 디렉터리만 바꾼다.

| 러너 | 세션 | 로그 |
|---|---|---|
| Claude | `.claude-session.json` | `claude-live-chat.md` |
| Codex | `.codex-session.json` | `codex-live-chat.md` |
| Cursor | `.cursor-session.json` | `cursor-live-chat.md` |

이 파일들은 `.gitignore` 대상이다. 커밋하지 말 것.

## Safety

- API 키를 코드·프롬프트·로그에 넣지 않는다. 환경변수만 사용.
- Claude 기본 `--permission-mode dontAsk` + `--safe-mode` — 작업 디렉터리를 확인한 뒤 실행.
- Codex는 `CODEX_API_KEY` / `OPENAI_API_KEY`를 제거한 채 ChatGPT 로그인으로만 동작.
- Cursor `scenario-review/cursor-task.js`는 대상 repo 파일을 직접 수정한다. 더러운 워킹트리에는 비권장.

## After running

1. 터미널에 나온 응답 요약을 사용자에게 전달한다.
2. 필요하면 해당 `*-live-chat.md` 꼬리를 읽어 맥락을 확인한다.
3. 실패 시 auth/CLI 존재/`CURSOR_API_KEY`/`npm install`부터 점검한다.
