---
name: agy-live-chat
description: >-
  Run the coworks agy(Antigravity CLI) live-chat runner (agy-live-chat.js): one long-lived
  `agy --print` process fed NDJSON turns over stdin, conversation resumed by --conversation
  id, streaming deltas, tool-step logs, model/effort/mode switching without losing context,
  and --yolo for shell-command permission. Use when the user wants agy live chat, an
  Antigravity CLI session, Gemini 3.x via agy, or mentions agy-live-chat.js / agy-chat.js /
  agy-client.js / .agy-session.json.
compatibility: Node.js 18+. Antigravity CLI (`agy`) installed and logged in. No npm install. coworks repo.
metadata:
  author: coworks
  version: "1.0"
  canonical: .agents/skills/agy-live-chat
---

# agy live-chat (Claude entry)

이 파일은 Claude Code 검색용 엔트리다. **본문은 아래 파일을 읽고 그대로 따른다.**

1. Read [`.agents/skills/agy-live-chat/SKILL.md`](../../../.agents/skills/agy-live-chat/SKILL.md)
2. 다른 러너가 필요하면 [coworks-live-chat](../coworks-live-chat/SKILL.md)

COWORKS_ROOT는 `agy-live-chat.js`가 있는 디렉터리다. `npm install` 은 필요 없다.

미리 알고 들어갈 것 두 가지:

- 기본 권한 모드(`request-review`)에서 **파일 읽기는 되지만 셸 명령은 거부**되어 턴이 `ERROR` 로 끝난다.
  빌드·테스트가 필요하면 `--yolo`(= `--dangerously-skip-permissions`).
- 러너는 `agy` 프로세스 하나를 띄워 두고 stdin NDJSON 으로 턴을 계속 보낸다. 프로세스가 죽거나
  모델·effort 를 바꿀 때만 `--conversation <id>` 로 다시 이어붙이므로, 그때도 맥락은 유지된다.
