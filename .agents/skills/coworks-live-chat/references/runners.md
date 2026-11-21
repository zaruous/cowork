# Live-chat runners cheat sheet

## Prerequisites

| Runner | Need |
|---|---|
| `claude-live-chat.js` | Claude Code CLI + `claude auth login` |
| `codex-live-chat.js` | Codex CLI + `codex login` (ChatGPT) |
| `cursor-live-chat.js` | `CURSOR_API_KEY` + `npm install` (`@cursor/sdk`) |
| `openrouter-live-chat.js` | `OPENROUTER_API_KEY` in `.env` (no npm install — Node 18+ fetch) |
| `agy-live-chat.js` | Antigravity CLI (`agy`) installed + logged in (`agy models`); no npm install |
| `opencode-live-chat.js` | OpenCode CLI (`opencode`) + provider auth (`opencode auth list`); no npm install |
| `trio-chat/trio-chat.js` | Claude + Codex + Cursor (+ `OPENROUTER_API_KEY` for `--with-openrouter`) |

## Environment

| Variable | Used by | Default |
|---|---|---|
| `CLAUDE_MODEL` | Claude | `sonnet` |
| `CLAUDE_CHAT_CWD` | Claude agent cwd | script dir |
| `CLAUDE_PERMISSION_MODE` | Claude | `dontAsk` |
| `CODEX_MODEL` | Codex | CLI default |
| `CURSOR_API_KEY` | Cursor / trio / scenario-review | (required) |
| `CURSOR_CHAT_CWD` | Cursor agent cwd | script dir |
| `OPENROUTER_API_KEY` | OpenRouter runner / trio seat | (required) |
| `OPENROUTER_MODEL` | OpenRouter | `stealth/ox-alpha` |
| `OPENROUTER_EFFORT` | OpenRouter reasoning effort | model default |
| `OPENROUTER_SYSTEM` | OpenRouter system prompt | Korean coding assistant |
| `OPENROUTER_CHAT_CWD` | OpenRouter file-tool root | script dir |
| `OPENROUTER_TIMEOUT` | OpenRouter per-call limit (sec) | `300` |
| `AGY_BIN` | `agy` executable path (when not on PATH) | `%LOCALAPPDATA%\agy\bin\agy.exe` |
| `AGY_MODEL` | agy model id (`agy models`) | CLI default |
| `AGY_EFFORT` | agy reasoning effort (`low`/`medium`/`high`) | model default |
| `AGY_MODE` | agy exec mode (`plan`/`accept-edits`) | CLI default |
| `AGY_CHAT_CWD` | agy agent cwd (also added to workspace) | script dir |
| `AGY_TIMEOUT` | agy per-turn limit (sec) | `600` |
| `AGY_SKIP_PERMISSIONS` | `1` → auto-approve shell commands | off |
| `OPENCODE_BIN` | `opencode` executable path | `%APPDATA%\npm\node_modules\@opencode\cli\bin\opencode.exe` |
| `OPENCODE_MODEL` | OpenCode model (`provider/model[#variant]`) | CLI/session default |
| `OPENCODE_AGENT` | OpenCode agent (`build`/`plan`/...) | CLI default |
| `OPENCODE_CHAT_CWD` | OpenCode agent cwd | script dir |
| `OPENCODE_TIMEOUT` | OpenCode per-turn limit (sec) | `600` |
| `OPENCODE_AUTO` | `1` → auto-approve permissions | off |

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

# OpenRouter — resume / fresh / repo-reading / pipe
node openrouter-live-chat.js
node openrouter-live-chat.js --new --effort high
node openrouter-live-chat.js --cwd /path/to/target-repo            # file tools read that repo
node openrouter-live-chat.js --cwd /path/to/repo --allow-write     # write_file enabled
node openrouter-live-chat.js --raw --prompt "..." > out.md         # stdout = answer only
node openrouter-chat.js --effort low   # fixed 5-turn smoke test

# agy (Antigravity CLI) — resume / fresh / target repo / shell permission / pipe
node agy-live-chat.js
node agy-live-chat.js --new --cwd /path/to/target-repo
node agy-live-chat.js --model gemini-3.1-pro-high --effort high
node agy-live-chat.js --yolo                        # shell commands auto-approved
node agy-live-chat.js --raw --prompt "..." > out.md # stdout = answer only
node agy-chat.js                                    # fixed 3-turn smoke test

# OpenCode CLI — resume / fresh / target repo / model / pipe
node opencode-live-chat.js
node opencode-live-chat.js --new --cwd /path/to/target-repo
node opencode-live-chat.js --model openai/gpt-5.1 --agent plan --auto
node opencode-live-chat.js --raw --prompt "..." > out.md
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
| OpenRouter | `OPENROUTER_MODEL` (default `stealth/ox-alpha`) |
| agy | `AGY_MODEL` or CLI default (`agy models` lists Gemini 3.x / Claude / GPT-OSS) |
| OpenCode | `OPENCODE_MODEL` or CLI/session default (`opencode models`) |
| trio-chat Cursor seat | `auto` |

## Related scripts (not interactive live-chat)

| Script | Role |
|---|---|
| `scenario-review/cursor-review.js` | Multi-turn review, session kept |
| `scenario-review/cursor-task.js` | One-shot edit agent (no session) |
| `cursor-chat.js` | Fixed 5-turn smoke test |
| `openrouter-chat.js` | Fixed 5-turn smoke test (OpenRouter) |
| `agy-chat.js` | Fixed 3-turn smoke test (agy) |
| `agy-client.js` | agy print-mode wrapper: one process, NDJSON turns over stdin, event parsing, usage |
| `openrouter-client.js` | Shared OpenRouter REST client (streaming, tool_calls, retry, usage) |
| `openrouter-tools.js` | Sandboxed file tools: list/find/read/search (+write behind flag) |
| `load-env.js` | Dependency-free `.env` loader (shell env wins) |
