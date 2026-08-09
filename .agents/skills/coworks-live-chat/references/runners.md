# Live-chat runners cheat sheet

## Prerequisites

| Runner | Need |
|---|---|
| `claude-live-chat.js` | Claude Code CLI + `claude auth login` |
| `codex-live-chat.js` | Codex CLI + `codex login` (ChatGPT) |
| `cursor-live-chat.js` | `CURSOR_API_KEY` + `npm install` (`@cursor/sdk`) |
| `trio-chat/trio-chat.js` | All three above |

## Environment

| Variable | Used by | Default |
|---|---|---|
| `CLAUDE_MODEL` | Claude | `sonnet` |
| `CLAUDE_CHAT_CWD` | Claude agent cwd | script dir |
| `CLAUDE_PERMISSION_MODE` | Claude | `dontAsk` |
| `CODEX_MODEL` | Codex | CLI default |
| `CURSOR_API_KEY` | Cursor / trio / scenario-review | (required) |
| `CURSOR_CHAT_CWD` | Cursor agent cwd | script dir |

## Launch examples

```bash
# Claude — resume previous session
node claude-live-chat.js

# Claude — fresh session, work in another repo
node claude-live-chat.js --new --cwd /path/to/target-repo

# Claude — one-shot implement from prompt file (Windows cmd length safe)
node claude-live-chat.js --cwd /path/to/target-repo --prompt-file prompts/task.md

# Codex
node codex-live-chat.js
node codex-live-chat.js --new

# Cursor
node cursor-live-chat.js --new --cwd /path/to/target-repo
```

PowerShell:

```powershell
$env:CURSOR_API_KEY = 'key_...'
$env:CLAUDE_MODEL = 'sonnet'
node cursor-live-chat.js --cwd D:\git\java\reporter
```

## Models (as wired in scripts)

| Runner | Model |
|---|---|
| Claude | `CLAUDE_MODEL` (default `sonnet`) |
| Codex | `CODEX_MODEL` or CLI default |
| Cursor live-chat | `composer-2.5` fixed |
| trio-chat Cursor seat | `auto` |

## Related scripts (not interactive live-chat)

| Script | Role |
|---|---|
| `scenario-review/cursor-review.js` | Multi-turn review, session kept |
| `scenario-review/cursor-task.js` | One-shot edit agent (no session) |
| `cursor-chat.js` | Fixed 5-turn smoke test |
