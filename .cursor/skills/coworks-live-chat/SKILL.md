---
name: coworks-live-chat
description: >-
  Routes coworks live-chat runners across Claude, Codex, and Cursor, plus trio-chat.
  Use when the user asks for live chat, coworks session, multi-agent debate, or
  mentions claude-live-chat / codex-live-chat / cursor-live-chat / trio-chat.
compatibility: Node.js 18+ and the chosen agent auth. coworks repo.
metadata:
  author: coworks
  version: "1.0"
  canonical: .agents/skills/coworks-live-chat
---

# coworks live-chat (Cursor entry)

이 파일은 Cursor 검색용 엔트리다. **본문은 아래 파일을 읽고 그대로 따른다.**

1. Read [`.agents/skills/coworks-live-chat/SKILL.md`](../../../.agents/skills/coworks-live-chat/SKILL.md)
2. 러너 전용 스킬:
   - Cursor → [cursor-live-chat](../cursor-live-chat/SKILL.md)
   - Claude → [claude-live-chat](../../../.claude/skills/claude-live-chat/SKILL.md)
   - Codex → [codex-live-chat](../../../.agents/skills/codex-live-chat/SKILL.md)
3. [references/runners.md](../../../.agents/skills/coworks-live-chat/references/runners.md)
4. [references/trio-chat.md](../../../.agents/skills/coworks-live-chat/references/trio-chat.md)

COWORKS_ROOT는 `cursor-live-chat.js`가 있는 디렉터리다. `CURSOR_API_KEY` 필수.
