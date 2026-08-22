# trio-chat

Claude → Cursor → Codex 순으로 라운드를 도는 3자 토론.
`--with-openrouter` 를 주면 OpenRouter(🟠)가 네 번째 좌석으로 붙는다(기본 꺼짐).

각 참가자는 서버 측 세션을 유지한다(OpenRouter 좌석만 예외 — 세션이 없어 자기 발언 기록을 프로세스 안에 들고 있다). 매 턴 프롬프트에는 **자기 마지막 발언 이후 남들이 한 말만** 넣는다(전체 로그 재전송 금지 — 토큰이 라운드 제곱으로 증가).

## Run

```bash
node trio-chat/trio-chat.js --topic "토론 주제" --rounds 3
node trio-chat/trio-chat.js --topic-file topic.md --cwd ../my-repo --timeout 600
```

| Option | Meaning | Default |
|---|---|---|
| `--topic <text>` | Topic string | prompt if omitted |
| `--topic-file <path>` | Topic from file | — |
| `--rounds <n>` | Round count | `3` |
| `--cwd <path>` | Agent working directory | current dir |
| `--log <path>` | Markdown log | `trio-chat/logs/trio-<timestamp>.md` |
| `--timeout <sec>` | Per-participant call limit | `300` |
| `--with-openrouter` | Add an OpenRouter seat (needs `OPENROUTER_API_KEY`) | off |

로그 디렉터리 `trio-chat/logs/`는 gitignore 대상이다.
