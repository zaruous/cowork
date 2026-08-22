---
name: openrouter-live-chat
description: >-
  Run the coworks OpenRouter live-chat runner (openrouter-live-chat.js): stealth/ox-alpha
  by default, reasoning effort, streaming, .env-managed OPENROUTER_API_KEY, local message
  history as the session, and sandboxed file tools (list/find/read/search, optional write).
  Use when the user wants OpenRouter live chat, an ox-alpha session, repo-reading Q&A, or
  mentions openrouter-live-chat.js / openrouter-chat.js / openrouter-tools.js /
  .openrouter-session.json.
compatibility: Node.js 18+ (global fetch). No npm install. OPENROUTER_API_KEY in .env. coworks repo.
metadata:
  author: coworks
  version: "1.0"
  canonical: .agents/skills/openrouter-live-chat
---

# OpenRouter live-chat (Claude entry)

이 파일은 Claude Code 검색용 엔트리다. **본문은 아래 파일을 읽고 그대로 따른다.**

1. Read [`.agents/skills/openrouter-live-chat/SKILL.md`](../../../.agents/skills/openrouter-live-chat/SKILL.md)
2. 다른 러너가 필요하면 [coworks-live-chat](../coworks-live-chat/SKILL.md)

COWORKS_ROOT는 `openrouter-live-chat.js`가 있는 디렉터리다.
`OPENROUTER_API_KEY` 는 `.env`(gitignore)로 관리하고, 템플릿은 `.env.example`.

미리 알고 들어갈 것 두 가지:

- OpenRouter는 서버 세션이 없다. `.openrouter-session.json` 에는 세션 id가 아니라 **대화 전문**이 들어간다 — 커밋 금지.
- 파일 도구는 `--cwd` 안으로 격리되고 `.env` 등 자격증명은 읽기조차 거부된다. 쓰기는 `--allow-write` 일 때만, 명령 실행은 없다.
