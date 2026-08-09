---
name: claude-live-chat
description: >-
  Run and resume the coworks Claude live-chat runner (claude-live-chat.js): session
  keep-alive, markdown logs, --cwd target repo, and --prompt-file implementation
  delegation. Use when the user wants Claude live chat, coworks Claude session,
  prompt-file 구현 위임, or mentions claude-live-chat.js / .claude-session.json.
argument-hint: "[--new] [--cwd <repo>] [--prompt-file <md>]"
compatibility: Claude Code CLI logged in (`claude auth login`). Node.js 18+. coworks repo.
metadata:
  author: coworks
  version: "1.0"
  runner: claude-live-chat.js
---

# Claude live-chat (coworks)

Claude Code CLI를 세션 ID로 이어 붙이는 대화형 러너.

## When to use this skill

- Claude와 CLI에서 이어서 대화하고 싶을 때
- 긴 구현 지시를 `--prompt-file`로 넘길 때 (Windows 명령줄 길이 한도 회피)
- 다른 저장소를 `--cwd`로 지정해 작업시킬 때

다른 LLM 러너가 필요하면 [coworks-live-chat](../../../.agents/skills/coworks-live-chat/SKILL.md)를 연다.

## Resolve COWORKS_ROOT

`claude-live-chat.js`가 있는 디렉터리. 세션·로그는 항상 여기, `--cwd`는 에이전트 작업 디렉터리만 변경.

## Prerequisites

```bash
claude --version
claude auth status   # loggedIn 이어야 함. 아니면 claude auth login
```

## Run

대화형:

```bash
cd "$COWORKS_ROOT"
node claude-live-chat.js              # 이전 세션 재개
node claude-live-chat.js --new        # 새 세션
node claude-live-chat.js --cwd /path/to/target-repo
```

원샷 구현 위임 (`--prompt-file`):

```bash
node claude-live-chat.js --cwd /path/to/target-repo --prompt-file prompts/task.md
```

- CLI에는 짧은 “지시 파일 Read 후 구현” 프롬프트만 보낸다.
- 로그(`claude-live-chat.md`)에는 프롬프트 파일 전문을 남긴다.
- 프롬프트 파일 디렉터리는 `--add-dir`로 추가 접근한다.
- 기본 permission mode는 `dontAsk`다. Edit/Write가 막히면 `CLAUDE_PERMISSION_MODE=acceptEdits`를 검토한다(구현 위임 시 자주 필요).

## Environment

| Variable | Default | Role |
|---|---|---|
| `CLAUDE_MODEL` | `sonnet` | 모델 ID |
| `CLAUDE_CHAT_CWD` | script dir | `--cwd` 없을 때 작업 디렉터리 |
| `CLAUDE_PERMISSION_MODE` | `dontAsk` | Claude CLI permission mode |

## Interactive commands

| Input | Action |
|---|---|
| `/new` | 세션 초기화 |
| `/exit`, `/quit`, `종료` | 종료 · 세션 보존 |
| `Ctrl+C` | 중단 · 세션 보존 |

## Artifacts

| File | Purpose |
|---|---|
| `.claude-session.json` | `sessionId`, `turnCount` |
| `claude-live-chat.md` | 턴별 마크다운 로그 |

커밋하지 말 것.

## Agent behavior checklist

1. COWORKS_ROOT를 확인한 뒤 명령을 실행한다.
2. 사용자가 대상 repo를 말하면 `--cwd`를 넣는다.
3. 긴 지시문은 파일을 만들고 `--prompt-file`로 넘긴다. `-p`에 전문을 붙이지 않는다.
4. 끝나면 응답 요약과 로그 경로를 보고한다.
5. 커밋·푸시는 사용자 요청 없이 하지 않는다.
