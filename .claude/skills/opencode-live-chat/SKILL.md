---
name: opencode-live-chat
description: >-
  Run the coworks OpenCode CLI live-chat runner (opencode-live-chat.js): `opencode run
  --format json` per turn, prompt via stdin, session resumed by --session id, model/agent
  switching, --auto permission, pipe mode. Use when the user wants OpenCode live chat or
  mentions opencode-live-chat.js / .opencode-session.json.
compatibility: Node.js 18+. OpenCode CLI installed with a provider configured. No npm install. coworks repo.
metadata:
  author: coworks
  version: "1.0"
  canonical: .agents/skills/opencode-live-chat
---

# OpenCode live-chat (Claude entry)

이 파일은 Claude Code 검색용 엔트리다. **본문은 아래 파일을 읽고 그대로 따른다.**

1. Read [`.agents/skills/opencode-live-chat/SKILL.md`](../../../.agents/skills/opencode-live-chat/SKILL.md)
2. 다른 러너가 필요하면 [coworks-live-chat](../coworks-live-chat/SKILL.md)

COWORKS_ROOT는 `opencode-live-chat.js`가 있는 디렉터리다. `npm install` 은 필요 없다.
