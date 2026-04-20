# Codex 위임용 러너 구현 명세

이 문서는 `evals/runner/`를 **Codex CLI(GPT-5.4)가 구현**할 때 그대로 프롬프트로 넘긴다.
사용자는 이 문서를 먼저 검토하고, 필요하면 수정한 뒤 `codex exec "$(cat evals/scripts/codex-runner-brief.md)"` 식으로 실행.

---

## 목표

`evals/golden-set/questions.json`의 각 질문에 대해 다음을 자동화:

1. Claude Code(`claude -p --mcp-config ...`)로 질문을 보내 drawcast MCP 서버에서 `draw_export("excalidraw")` JSON을 받아온다.
2. 그 JSON을 headless Chromium + `@excalidraw/excalidraw`로 PNG 렌더.
3. 구조 메트릭(결정론) + rubric 채점(Codex CLI vision)으로 평가.
4. `evals/results/<run-id>/`에 아티팩트 + `summary.json` 저장.

## 입력/출력

- **입력**: `evals/golden-set/questions.json` (스키마: `evals/golden-set/schemas/question.schema.json`)
- **rubric**: `evals/rubrics/default.md`
- **출력**: `evals/results/<run-id>/`
  - `<question_id>.sample-<n>.scene.json`
  - `<question_id>.sample-<n>.png`
  - `<question_id>.sample-<n>.score.json` — 구조 메트릭 + rubric 결과
  - `<question_id>.sample-<n>.trace.json` — Claude Code 호출 로그 (tool calls, latency, token)
  - `summary.json` — 전체 집계 (pass_rate, 축별 평균, 카테고리별 breakdown)
  - `summary.md` — 사람이 읽는 요약

## 기술 스택 (권장)

- 런타임: Node 20+ (monorepo에 이미 있음). 언어 TypeScript.
- 위치: `evals/runner/` (pnpm workspace `drawcast-evals`로 등록, `packages/*` 워크스페이스와 별도 경로 — `pnpm-workspace.yaml`에 `- evals` 추가)
- 외부 바이너리: `claude` CLI, `codex` CLI (PATH에서 찾기)
- 주요 의존성: `playwright` (or `playwright-core` + 설치된 Chromium), `zod`, `yargs`/`commander`, `@excalidraw/excalidraw` (이미 앱에 있음, 같은 버전 0.17.6 고정), `execa`

## 파이프라인 세부

### 단계 1: MCP 서버 기동
- `packages/mcp-server`의 빌드 산출물을 stdio 모드로 띄운다.
- 러너가 자식 프로세스로 관리. 각 질문마다 **새 인스턴스** (상태 누수 방지).
- MCP config 파일은 `evals/results/<run-id>/.mcp/<question_id>-<n>.json`에 임시 생성.

### 단계 2: Claude Code 호출
```bash
claude -p \
  --mcp-config <tmp-mcp-config> \
  --input-format stream-json \
  --output-format stream-json \
  --allowedTools "mcp__drawcast__draw_*" \
  "<질문 프롬프트> + 최종적으로 반드시 draw_export('excalidraw') 호출 후 종료"
```
- 시스템 프롬프트는 **주입하지 않는다** (프로덕션과 동일하게 Claude Code 기본 + MCP tool description만 사용).
- 타임아웃: 기본 120초.
- 출력 파싱: stream-json에서 tool_use/tool_result 추적, 마지막 `draw_export` 결과에서 JSON 추출.

### 단계 3: 렌더
- Playwright로 about:blank 페이지를 띄우고 `@excalidraw/excalidraw` UMD를 dynamic import.
- scene JSON을 `initialData`로 전달 → `exportToBlob({ mimeType: 'image/png', quality: 1, appState: {...} })` 로 PNG 추출.
- 1800px 최대 폭으로 스케일 고정 (rubric 안정성용).
- 렌더 실패 시 `score.rendered = false`로 기록하고 rubric 건너뜀.

### 단계 4: 구조 메트릭 (결정론)
- scene의 elements에서:
  - `node_count`: 박스/스티키/타원/다이아몬드 등 "shape" 요소 수
  - `edge_count`: arrow / line 요소 수
  - `node_count_fit`: question.expected.node_count 범위 안이면 1, 아니면 0
  - `edge_count_fit`: 동
  - `concept_coverage`: required_concepts 중 레이블에 부분 일치하는 비율 (대소문자 무시, 공백 제거 비교)
  - `overlap_pairs`: bounding box 교차 쌍 수
  - `has_branch`, `has_loop`: must_have_* 체크 시에만 계산

### 단계 5: Rubric 채점 (이미지 전용 트랙)
- **입력에서 scene JSON은 의도적으로 제외한다.** 구조·레이블의 기계적 평가는 단계 4 결정론 메트릭이 전담하고, VLM rubric은 사람 눈이 보는 신호(PNG + 원 질문)만으로 채점해 두 트랙을 독립 시그널로 유지한다.
- Codex CLI 호출:
```bash
codex exec --model gpt-5.4 --image <png> \
  "$(cat evals/rubrics/default.md)
---
# 이 케이스의 입력
질문: <prompt>
첨부된 이미지(PNG)가 렌더 결과의 전부다. scene JSON은 주어지지 않는다.
위 rubric대로 채점한 JSON만 출력해라."
```
- 응답을 JSON 파싱. 실패 시 1회 재시도.
- 가중치 적용 후 `total` 계산 (rubrics/default.md의 공식).

### 단계 6: 샘플링
- 기본 `n=1`. baseline 스냅샷 찍을 때만 `--n 3`으로 분산까지 측정.
- 각 샘플은 **새 MCP 서버 프로세스**에서. seed 고정 불가 (Claude Code temperature는 외부 제어 제한적) → 분산으로 받아들이고 min/mean/max를 리포트.

### 단계 7: 집계 (`summary.json`)
```json
{
  "run_id": "2026-04-20T10-00-00",
  "total_questions": 20,
  "total_runs": 60,
  "pass_rate": 0.68,
  "by_axis": {
    "structure": { "mean": 3.9, "std": 0.8 },
    "labels": { "mean": 4.2, "std": 0.5 },
    "layout": { "mean": 2.1, "std": 0.6 },
    "readability": { "mean": 2.4, "std": 0.4 },
    "intent_fit": { "mean": 3.7, "std": 0.9 }
  },
  "by_category": {
    "flowchart": { "pass_rate": 0.80, "n": 15 },
    "architecture": { "pass_rate": 0.58, "n": 12 },
    ...
  },
  "by_difficulty": {
    "easy": { "pass_rate": 0.90 },
    "medium": { "pass_rate": 0.65 },
    "hard": { "pass_rate": 0.40 }
  },
  "cost_usd": 0.84,
  "latency_p50_ms": 12300,
  "latency_p95_ms": 38000,
  "failures": [
    { "id": "flow-ci-04", "sample": 2, "reason": "timeout" }
  ]
}
```

## CLI

```bash
pnpm --filter drawcast-evals eval                    # 전체, n=1 기본
pnpm --filter drawcast-evals eval -- --n 3           # baseline 스냅샷용
pnpm --filter drawcast-evals eval -- --id flow-login-01
pnpm --filter drawcast-evals eval -- --category flowchart
pnpm --filter drawcast-evals eval -- --difficulty easy
pnpm --filter drawcast-evals eval -- --dry-run       # Claude/Codex 호출 없이 스키마 검증만
pnpm --filter drawcast-evals eval -- --skip-rubric   # 구조 메트릭만
```

## 실패 처리

- 한 질문 실패가 전체 run 중단시키지 않음.
- Claude 타임아웃/MCP 에러/렌더 실패/rubric 파싱 실패 각각 구분해 `failures[].reason`에 기록.
- `summary.json`은 성공 케이스만으로 집계하되 failure 목록을 별도 섹션에.

## 비기능 요구

- 병렬도: 기본 1 (MCP 서버와 Claude Code 자식 프로세스가 무겁다). `--concurrency N` 옵션으로 조정 가능.
- 재현성: 같은 run에서 결과는 랜덤이지만 `run_id` + 입력을 기록해 후속 분석 가능.
- 결과 파일은 모두 `evals/results/`(gitignore) 안에만.

## 명시적 비목표 (구현하지 말 것)

- ❌ Tauri 앱을 띄우는 경로 (이번 단계에서 제외)
- ❌ `draw_get_preview` 사용 (앱 없이 돌리는 게 목적)
- ❌ CI에 붙이는 워크플로 (파일럿 안정화 후 별도 작업)
- ❌ 웹 대시보드 (summary.md로 충분)
