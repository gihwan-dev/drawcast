# Drawcast Eval Harness

자연어 질문 → Drawcast가 뽑는 다이어그램(JSON + PNG) 품질을 자동 측정한다.
프로덕션 경로(Claude Code + drawcast MCP)를 **그대로** 재현하되 Tauri 앱 없이 headless로 돈다.

## 설계 원칙

- **평가 대상 AI = 프로덕션과 동일**(Claude Code). MCP 스키마·프리셋·시스템 프롬프트가 실제 쓰이는 조건에서 얼마나 좋은 결과를 내는지만 본다.
- **Codex CLI(GPT-5.4)는 그리지 않는다.** 러너 구동과 rubric 채점만 담당.
- **Tauri 앱은 띄우지 않는다.** `draw_get_preview`를 쓰지 않고 `draw_export` JSON을 별도 headless Chromium이 렌더한다.
- **룰 트랙(JSON) ↔ 정성 트랙(이미지) 독립 분리.** 결정론 메트릭(`runner/metrics.ts`)은 JSON만 보고, VLM rubric(`runner/rubric.ts`)은 PNG + 원 질문만 받는다. scene JSON을 VLM에 주면 "시각 품질"이 JSON 구조 정보로 오염되므로 절대 섞지 않는다.

## 파이프라인

```
질문 (golden-set/questions.json)
  │
  ├─ Claude Code CLI (`claude -p --mcp-config ...`)
  │     └─ drawcast MCP 서버 (stdio)
  │           └─ draw_upsert_* → draw_export("excalidraw") → JSON
  │
  ├─ headless Chromium + @excalidraw/excalidraw (runner/render.ts)
  │     └─ PNG
  │
  ├─ [룰 트랙] 구조 메트릭 (runner/metrics.ts) — JSON만 사용, 결정론
  │     └─ node/edge count fit, required_concepts coverage, overlap count
  │
  ├─ [정성 트랙] VLM rubric 채점 (runner/rubric.ts) — PNG만 사용
  │     └─ Codex CLI(`codex exec`) + rubrics/default.md + PNG + 원 질문 (JSON 전달 안 함)
  │
  └─ 결과 (results/<run-id>/)
        ├─ {id}.json       (scene)
        ├─ {id}.png        (렌더)
        ├─ {id}.score.json (rubric + 구조 메트릭)
        └─ summary.json    (집계)
```

## 디렉터리

| 경로 | 역할 | 검토 대상? |
|---|---|---|
| `golden-set/questions.json` | 평가 질문 (20개 초안) | **O** |
| `golden-set/schemas/question.schema.json` | 질문 스키마 | 필요 시 |
| `rubrics/default.md` | VLM 채점 rubric | **O** |
| `runner/` | 러너 구현. 아직 비어 있음 — Codex에 위임 | X |
| `results/` | 실행 결과 (gitignore됨) | — |
| `scripts/codex-runner-brief.md` | Codex 위임용 명세 | 필요 시 |

## 실행 (runner 구현 후)

```bash
pnpm --filter drawcast-evals run eval            # n=3 기본
pnpm --filter drawcast-evals run eval -- --n 5   # 샘플 수 변경
pnpm --filter drawcast-evals run eval -- --id flow-login-01  # 단일
pnpm --filter drawcast-evals run eval -- --model-sonnet     # 모델 비교용
```

## 골든셋 추가 규칙

- id: `{category}-{short-slug}-{nn}` (예: `flow-login-01`)
- 카테고리: `flowchart`, `architecture`, `sequence`, `erd`, `state`, `mind`, `org`, `network`
- 난이도: `easy` / `medium` / `hard`
- `expected.node_count` / `edge_count`는 여유 있는 범위로 (너무 좁으면 정상 응답도 실패 처리됨)
- `required_concepts`는 "레이블에 포함되어야 할 핵심 개념 키워드" (부분 일치 OK)
- `rubric_weights`는 생략 가능, 생략 시 기본(1.0)

## 검토 체크리스트

- [ ] 질문 20개가 실제 제품이 커버해야 하는 사용 사례를 대표하는가
- [ ] 각 질문의 `expected.node_count` 범위가 현실적인가 (실제 Claude가 낼 분량 ± 버퍼)
- [ ] `required_concepts`가 너무 엄격하거나 느슨하지 않은가
- [ ] rubric 5축(structure / labels / layout / readability / intent_fit)의 가중치 기본값이 실사용 감각과 맞는가
- [ ] 어려움(hard) 질문이 너무 길어 Claude가 중간에 포기하지 않는가 (드라이런 필요)
