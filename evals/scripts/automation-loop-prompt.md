# Drawcast 자동 개선 루프 프롬프트

이 문서는 외부 스케줄러(cron 등)가 매 실행마다 Claude Code에게 통째로 넘기는 프롬프트다.
`cat evals/scripts/automation-loop-prompt.md | claude -p ...` 식으로 호출.

목적: **항상 다른 다이어그램 시나리오로** Drawcast의 Draw 결과를 한 번 평가하고, 문제를 발견하면
검증 가능한 수정만 적용한 뒤 PR/병합까지 자동으로 끌고 간다.

---

## 사전 준비 (매 루프 시작 시 반드시 수행)

1. **시나리오 풀**: `evals/golden-set/questions.json`
   - 카테고리 8종: `flowchart`, `architecture`, `sequence`, `erd`, `state`, `mind`, `org`, `network`
   - 난이도 3종: `easy`, `medium`, `hard`
   - 풀은 매 루프마다 **임의 수정 금지**. 풀 확장이 필요하면 별도 PR로 분리.

2. **작업 디렉토리**:
   - 이번 루프 노트: `evals/automation-runs/<run-id>/` — `<run-id>`는 `YYYYMMDD-HHMMSS-<shortRand>` 형식. **gitignore 됨**(일회용 스크래치).
     - `scenario.md` — 선택한 시나리오와 선정 근거
     - `findings.md` — 관찰된 문제와 가설
     - `iterations.md` — 수정 시도와 검증 결과 (반복마다 append)
   - 실행 이력: `evals/automation-runs/_history.jsonl` — **gitignore 안 됨, 추적 대상**. 매 루프 종료 직전 한 줄 append.
     ```json
     {"run_id":"...","question_id":"...","category":"...","difficulty":"...","status":"pass|fixed|no-change|gave-up","ts":"ISO8601"}
     ```
     이 history는 다음 루프(다른 worktree에서 시작될 수 있음)가 다양화 규칙을 적용하기 위해 main에 머지되어 있어야 한다. 머지 정책은 7단계 참고.

3. **러너 명세**: 구현·CLI 옵션은 `evals/scripts/codex-runner-brief.md`와 `evals/README.md`에 정의되어 있다.

---

## 워크플로우

### 1. 프로젝트 파악
- 처음 한 번, 또는 마지막 실행 이후 `main`이 갱신됐다면 다시 파악.
- `evals/README.md`, `docs/01-architecture.md`, 최근 5개 PR(`gh pr list --state merged -L 5`) 정도면 충분.

### 2. 시나리오 선택 (다양성 보장)
다음 규칙을 **순서대로** 적용해 단 하나의 `question_id`를 고른다.

1. `evals/automation-runs/_history.jsonl`이 있으면 읽고, 최근 **5개 루프**에서 사용한 `question_id`를 후보에서 제외한다.
2. 직전 루프에서 사용한 카테고리도 제외한다(같은 카테고리 연속 금지).
3. 남은 후보 중 **누적 사용 횟수가 가장 적은 카테고리**를 우선한다(카테고리 균형).
4. 그 카테고리 안에서 **누적 사용 횟수가 가장 적은 difficulty**를 우선한다(난이도 균형).
5. 끝까지 동률이면 무작위 선택.
6. 모든 후보가 제외 규칙에 걸려 0개가 되면 규칙 1만 적용해 다시 고른다.

선택이 끝나면 `evals/automation-runs/<run-id>/scenario.md`에 다음을 기록:
- `question_id`, `category`, `difficulty`, 원문 `prompt`
- 선정 이유(어느 규칙에서 결정됐는지 한 줄)
- history 요약(최근 5개 사용 카테고리/난이도 분포)

### 3. E2E 실행 (단일 케이스)
```bash
pnpm --filter drawcast-evals eval -- --id <question_id> --n 1
```
- 결과는 `evals/results/<eval-run-id>/`에 PNG/score.json/scene.json으로 떨어진다.
- 명령이 실패해도 다음 단계로 진행해 원인을 `findings.md`에 기록한다.

### 4. 결과 분석
- PNG를 직접 본다(이미지 검증). structure metric, rubric 점수, failure 사유를 모두 검토.
- **통과**(rubric pass + 구조 메트릭 fit) → `findings.md`에 "pass" 기록. 코드 변경 없이 5단계로 넘어가지 않고 7단계(루프 종료)로 직행.
- **미통과** → 정확한 실패 모드를 `findings.md`에 적는다. 예:
  - `node-overlap`, `label-truncated`, `arrow-routing-broken`, `missing-required-concept`,
    `category-mismatch`, `count-out-of-range`, `render-failure`, `mcp-timeout` 등
- 가설을 1~3개 세우고 우선순위(증거 강도 순)로 적는다.

### 5. 수정 → 재검증 루프
각 시도(iteration)마다:
1. 가설 1개를 골라 코드 수정. 변경 범위는 **그 가설을 검증하는 데 필요한 최소**로 한정.
2. 같은 케이스를 다시 돌려(`pnpm --filter drawcast-evals eval -- --id <question_id> --n 1`) 결과 PNG/점수를 비교.
3. `iterations.md`에 append:
   - 가설, 변경 파일, before/after 점수, 결과 PNG 경로, 판정(`improved` / `regressed` / `flat`)
4. 회귀 방지가 가능한 케이스라면 단위·통합 테스트 추가(`packages/core/test/...` 등).
5. **최대 4회**까지 반복. 4회 안에 `pass`가 나오지 않으면 `gave-up`으로 종료.

**금지 사항**
- 추측만으로 코드 변경 금지. 모든 수정은 직전 step의 PNG/점수/테스트로 가설이 뒷받침되어야 한다.
- 시나리오 풀(`evals/golden-set/questions.json`) 수정 금지.
- rubric 가중치(`evals/rubrics/default.md`) 수정 금지.
- 이번 루프와 무관한 리팩토링·문서 수정 금지.

### 6. PR & 병합 (개선이 검증된 경우에만)
- 코드 변경이 0줄이면 PR을 만들지 않는다.
- PR 본문에 다음을 명시:
  - 사용된 `question_id`, `category`, `difficulty`
  - before/after PNG 첨부 또는 경로
  - structure metric / rubric 점수 변화
  - 추가한 테스트 목록
- PR 머지까지 자동 수행.

### 7. 종료 처리 (분기 무관 항상 수행)
- `evals/automation-runs/_history.jsonl`에 한 줄 append (사전 준비 2번의 스키마).
- `status` 값:
  - `pass` — 처음부터 통과, 변경 없음
  - `fixed` — 수정 후 통과, PR 병합됨
  - `no-change` — 미통과지만 수정 시도 안 함(예: 환경 오류)
  - `gave-up` — 최대 반복 도달, 미해결
- `evals/automation-runs/<run-id>/`의 노트 파일들은 그대로 남긴다(gitignore 됨).
- **`_history.jsonl`은 반드시 main에 머지되어야 한다** (다음 루프가 다양화 규칙을 적용하려면 이게 필요):
  - 6단계에서 코드 PR을 만들었다면 그 PR에 `_history.jsonl` 변경을 같이 포함해 머지.
  - 6단계에서 PR을 만들지 않았다면(`pass` / `no-change` / `gave-up`) `_history.jsonl`만 단독 변경하는 chore PR을 만들어 머지한다(예: `chore(evals): record automation run <run-id>`). 1줄 변경이라 즉시 머지 가능해야 한다.
  - 머지 충돌 시(다른 자동화 루프가 동시에 history를 추가한 경우) `git pull --rebase`로 두 줄 모두 보존한 뒤 다시 푸시.

---

## 제약 조건

1. E2E 테스트로 검증해야 하는 결과물은 **Draw 결과**(렌더된 PNG + 구조 메트릭)이다. 그 외 목적의 E2E는 수행하지 않는다.
2. 검증 없는 수정을 하지 않는다. 모든 수정은 **이미지 비교 또는 자동화된 테스트**로 개선이 입증되어야 한다.
3. 같은 `question_id`를 연속 두 루프 이상 사용하지 않는다(직전 history 확인 필수).
4. 같은 카테고리도 연속 두 루프 이상 사용하지 않는다.
5. 시나리오 풀과 rubric은 이 자동화 루프에서 변경하지 않는다.
6. 작업 노트(`evals/automation-runs/<run-id>/`)와 결과(`evals/results/`)는 gitignore이며 커밋 대상이 아니다. **단** `evals/automation-runs/_history.jsonl`은 추적 대상이며 매 루프 머지에 포함되어야 한다.

---

## 참고

- 시나리오 풀 명세·추가 규칙: `evals/README.md` — "골든셋 추가 규칙" 섹션
- 러너 구현 명세: `evals/scripts/codex-runner-brief.md`
- rubric 정의: `evals/rubrics/default.md`
- 풀이 너무 좁다고 느껴지면(예: 같은 카테고리에 케이스가 1~2개라 4번 규칙이 무의미해짐) 별도 PR로 풀 확장을 제안하라. 이 자동화 루프 안에서 풀을 직접 늘리지는 말 것.
