# 09. Pitfalls & Compliance

> L2 compile 결과가 "손으로 그린 것과 구별 불가능"하려면, Excalidraw 내부가 암묵적으로 기대하는 **불변식**을 모두 만족해야 한다. 이 문서는 그 불변식을 **10개 compliance 항목**과 **함정 카탈로그**로 정리하고, 자동 검증하는 방법을 제시한다.

## 10개 Compliance 불변식

이 10개가 통과하면 Excalidraw의 `restore`가 거의 건드리지 않고 원본 그대로 렌더된다. L2의 테스트 스위트에 반드시 포함.

### C1. 모든 element가 25+ base 필드를 전부 소유

**규칙**: `_ExcalidrawElementBase`의 모든 필드(`08-excalidraw-reference.md`의 공통 필드 템플릿 참조)가 누락 없이 존재해야 한다. 누락은 `restore`가 파일 경로에서는 채워주지만 **`updateScene` 경로에서는 건너뛰어질 수 있다**.

**검증**:
```ts
const REQUIRED_BASE_FIELDS = [
  'id', 'type', 'x', 'y', 'width', 'height', 'angle',
  'strokeColor', 'backgroundColor', 'fillStyle', 'strokeWidth', 'strokeStyle',
  'roughness', 'opacity', 'groupIds', 'frameId', 'roundness',
  'seed', 'version', 'versionNonce', 'isDeleted', 'boundElements',
  'updated', 'link', 'locked', 'index',
] as const;

function checkC1(element: any): string[] {
  const missing: string[] = [];
  for (const field of REQUIRED_BASE_FIELDS) {
    if (!(field in element)) missing.push(field);
  }
  return missing;
}
```

### C2. `seed`·`versionNonce` 충돌 없음

**규칙**: element 집합 내에서 `seed`는 서로 다른 값이어야 한다. `versionNonce`도 마찬가지 (단일 세션 내 충돌 시 collab 동기화 이슈).

**검증**:
```ts
function checkC2(elements: ExcalidrawElement[]): {
  duplicateSeeds: number[];
  duplicateNonces: number[];
} {
  const seedCount = new Map<number, number>();
  const nonceCount = new Map<number, number>();
  for (const el of elements) {
    seedCount.set(el.seed, (seedCount.get(el.seed) ?? 0) + 1);
    nonceCount.set(el.versionNonce, (nonceCount.get(el.versionNonce) ?? 0) + 1);
  }
  return {
    duplicateSeeds: [...seedCount.entries()].filter(([, c]) => c > 1).map(([s]) => s),
    duplicateNonces: [...nonceCount.entries()].filter(([, c]) => c > 1).map(([n]) => n),
  };
}
```

### C3. Linear element의 `points[0] === [0, 0]`, `width`/`height === max−min`

**규칙**: `arrow`, `line`, `freedraw`의 `points` 배열은 local 좌표이며 **첫 원소가 반드시 `[0, 0]`**. `width`·`height`는 points의 x·y 범위(`max − min`).

**검증**:
```ts
function checkC3(el: ExcalidrawElement): string[] {
  const errors: string[] = [];
  if (!['arrow', 'line', 'freedraw'].includes(el.type)) return errors;

  const points = (el as any).points as [number, number][];
  if (!points || points.length === 0) {
    errors.push('linear element has no points');
    return errors;
  }
  if (points[0][0] !== 0 || points[0][1] !== 0) {
    errors.push(`points[0] is ${JSON.stringify(points[0])}, expected [0, 0]`);
  }

  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  const expectedW = Math.max(...xs) - Math.min(...xs);
  const expectedH = Math.max(...ys) - Math.min(...ys);
  if (Math.abs(el.width - expectedW) > 0.01) {
    errors.push(`width ${el.width} ≠ max-min ${expectedW}`);
  }
  if (Math.abs(el.height - expectedH) > 0.01) {
    errors.push(`height ${el.height} ≠ max-min ${expectedH}`);
  }
  return errors;
}
```

### C4. Text↔container 양방향 boundElements 일치

**규칙**: 
- `text.containerId = c.id` 이면 `c.boundElements`에 `{type:"text", id: text.id}` 포함
- 역방향도 동일

**검증**:
```ts
function checkC4(elements: ExcalidrawElement[]): string[] {
  const errors: string[] = [];
  const byId = new Map(elements.map(e => [e.id, e]));

  for (const el of elements) {
    // text → container 방향
    if (el.type === 'text' && (el as any).containerId) {
      const cid = (el as any).containerId;
      const container = byId.get(cid);
      if (!container) {
        errors.push(`text ${el.id} references missing container ${cid}`);
        continue;
      }
      const hasBackRef = (container.boundElements ?? [])
        .some(be => be.type === 'text' && be.id === el.id);
      if (!hasBackRef) {
        errors.push(`container ${cid} missing boundElement for text ${el.id}`);
      }
    }

    // container → text 방향
    for (const be of el.boundElements ?? []) {
      if (be.type !== 'text') continue;
      const text = byId.get(be.id);
      if (!text) {
        errors.push(`${el.id} references missing text ${be.id}`);
        continue;
      }
      if ((text as any).containerId !== el.id) {
        errors.push(`text ${be.id} containerId ≠ ${el.id}`);
      }
    }
  }
  return errors;
}
```

### C5. Arrow의 startBinding/endBinding 참조가 실재

**규칙**: `arrow.startBinding.elementId`와 `endBinding.elementId`는 같은 scene에 존재하는 bindable element(rectangle/diamond/ellipse/frame/magicframe/image)의 id여야 한다. Orphan 참조는 **앱 hang을 유발**할 수 있음(issue #8131).

**검증**:
```ts
function checkC5(elements: ExcalidrawElement[]): string[] {
  const errors: string[] = [];
  const byId = new Map(elements.map(e => [e.id, e]));
  const BINDABLE_TYPES = new Set([
    'rectangle', 'diamond', 'ellipse', 'frame', 'magicframe', 'image'
  ]);

  for (const el of elements) {
    if (el.type !== 'arrow') continue;
    const arrow = el as any;

    for (const side of ['startBinding', 'endBinding'] as const) {
      const binding = arrow[side];
      if (!binding) continue;

      const target = byId.get(binding.elementId);
      if (!target) {
        errors.push(`${el.id}.${side} references missing ${binding.elementId}`);
      } else if (target.isDeleted) {
        errors.push(`${el.id}.${side} references deleted ${binding.elementId}`);
      } else if (!BINDABLE_TYPES.has(target.type)) {
        errors.push(`${el.id}.${side} bound to non-bindable type ${target.type}`);
      } else {
        const hasBackRef = (target.boundElements ?? [])
          .some(be => be.type === 'arrow' && be.id === el.id);
        if (!hasBackRef) {
          errors.push(`${target.id} missing boundElement for arrow ${el.id}`);
        }
      }
    }
  }
  return errors;
}
```

### C6. Image `fileId`가 `files` key set에 존재

**규칙**: `image` element의 `fileId`는 scene envelope의 `files` 객체에 해당 key가 있어야 한다.

**검증**:
```ts
function checkC6(
  elements: ExcalidrawElement[],
  files: BinaryFiles
): string[] {
  const errors: string[] = [];
  const fileIds = new Set(Object.keys(files));
  for (const el of elements) {
    if (el.type !== 'image') continue;
    const fileId = (el as any).fileId;
    if (!fileId) {
      errors.push(`image ${el.id} has no fileId`);
      continue;
    }
    if (!fileIds.has(fileId)) {
      errors.push(`image ${el.id} fileId ${fileId} not in files map`);
    }
  }
  return errors;
}
```

### C7. `frameId`가 존재하는 frame/magicframe id

**규칙**: `element.frameId`는 `null` 또는 같은 scene의 `frame`·`magicframe` element id.

**검증**:
```ts
function checkC7(elements: ExcalidrawElement[]): string[] {
  const errors: string[] = [];
  const frameIds = new Set(
    elements
      .filter(e => (e.type === 'frame' || e.type === 'magicframe') && !e.isDeleted)
      .map(e => e.id)
  );

  for (const el of elements) {
    if (el.frameId == null) continue;
    if (!frameIds.has(el.frameId)) {
      errors.push(`${el.id} frameId ${el.frameId} not a valid frame`);
    }
  }
  return errors;
}
```

### C8. `angle`이 radians 범위 `[0, 2π)`

**규칙**: `angle` 필드는 **라디안** (도 아님). 일반적으로 `[0, 2π)` 범위로 normalize.

**검증**:
```ts
function checkC8(el: ExcalidrawElement): string[] {
  const errors: string[] = [];
  if (typeof el.angle !== 'number') {
    errors.push(`${el.id} angle is not a number`);
    return errors;
  }
  // 도를 라디안으로 착각한 케이스 휴리스틱: 90·180·270·360이 들어있으면 의심
  if ([90, 180, 270, 360].includes(el.angle)) {
    errors.push(`${el.id} angle ${el.angle} suspicious (degrees?)`);
  }
  if (el.angle < 0 || el.angle >= 2 * Math.PI + 0.01) {
    errors.push(`${el.id} angle ${el.angle} outside [0, 2π)`);
  }
  return errors;
}
```

### C9. `opacity`가 `0-100` 정수 범위

**규칙**: `opacity`는 **0~100 정수**. `0-1` 아님.

**검증**:
```ts
function checkC9(el: ExcalidrawElement): string[] {
  const errors: string[] = [];
  const op = el.opacity;
  if (typeof op !== 'number') {
    errors.push(`${el.id} opacity not a number`);
  } else if (op < 0 || op > 100) {
    errors.push(`${el.id} opacity ${op} outside [0, 100]`);
  } else if (op > 0 && op < 1.01) {
    errors.push(`${el.id} opacity ${op} suspiciously small (0-1 scale used?)`);
  }
  return errors;
}
```

### C10. Elbow arrow는 FixedPointBinding

**규칙**: `elbowed: true`인 arrow는 `startBinding`·`endBinding`이 있다면 **반드시 `FixedPointBinding`** (`fixedPoint` 필드 포함). 일반 `PointBinding`을 쓰면 첫 상호작용에 L-shape로 reset.

**검증**:
```ts
function checkC10(el: ExcalidrawElement): string[] {
  const errors: string[] = [];
  if (el.type !== 'arrow') return errors;
  const arrow = el as any;
  if (!arrow.elbowed) return errors;

  for (const side of ['startBinding', 'endBinding'] as const) {
    const binding = arrow[side];
    if (!binding) continue;
    if (!('fixedPoint' in binding)) {
      errors.push(`elbow arrow ${el.id} ${side} missing fixedPoint`);
      continue;
    }
    const [fx, fy] = binding.fixedPoint;
    if (fx === 0.5 && fy === 0.5) {
      errors.push(`${el.id} ${side} fixedPoint exactly [0.5, 0.5] — oscillation`);
    }
  }
  return errors;
}
```

## 통합 Compliance Runner

```ts
// @drawcast/core/src/testing/compliance.ts

export interface ComplianceReport {
  passed: boolean;
  checks: {
    [key: string]: { passed: boolean; errors: string[] };
  };
}

export function runCompliance(
  elements: ExcalidrawElement[],
  files: BinaryFiles = {}
): ComplianceReport {
  const report: ComplianceReport = { passed: true, checks: {} };

  // Per-element checks
  const perElement = (name: string, checker: (e: any) => string[]) => {
    const errors: string[] = [];
    for (const el of elements) errors.push(...checker(el));
    report.checks[name] = { passed: errors.length === 0, errors };
    if (errors.length > 0) report.passed = false;
  };

  perElement('C1_baseFields', (el) => {
    const missing = checkC1(el);
    return missing.map(f => `${el.id} missing ${f}`);
  });
  perElement('C3_normalizedPoints', checkC3);
  perElement('C8_radians', checkC8);
  perElement('C9_opacity', checkC9);
  perElement('C10_elbowBinding', checkC10);

  // Global checks
  const c2 = checkC2(elements);
  report.checks.C2_noCollisions = {
    passed: c2.duplicateSeeds.length === 0 && c2.duplicateNonces.length === 0,
    errors: [
      ...c2.duplicateSeeds.map(s => `duplicate seed: ${s}`),
      ...c2.duplicateNonces.map(n => `duplicate versionNonce: ${n}`),
    ],
  };

  const c4 = checkC4(elements);
  report.checks.C4_textContainerLink = { passed: c4.length === 0, errors: c4 };

  const c5 = checkC5(elements);
  report.checks.C5_arrowBinding = { passed: c5.length === 0, errors: c5 };

  const c6 = checkC6(elements, files);
  report.checks.C6_fileIdMapping = { passed: c6.length === 0, errors: c6 };

  const c7 = checkC7(elements);
  report.checks.C7_frameIdValid = { passed: c7.length === 0, errors: c7 };

  for (const check of Object.values(report.checks)) {
    if (!check.passed) report.passed = false;
  }

  return report;
}
```

사용:
```ts
const result = compile(scene);
const report = runCompliance(result.elements, result.files);
if (!report.passed) {
  console.error('Compliance failed:', report);
  throw new Error('L2 compile produced non-compliant output');
}
```

## 함정 카탈로그 (증상 → 원인 → 해결)

리서치 §12 기반. 각 항목을 프로덕션 테스트로 추가할 것.

### P1. boundElements 단방향

**증상**: 재로드 후 text가 container 밖으로 튀거나, arrow label이 사라진다.

**원인**: `restore.ts::repairBoundElements`가 한쪽만 있으면 container 측 링크를 **끊어버린다**.

**해결**: emit 시 text 측과 container 측을 **동시에** 설정. C4가 검증.

### P2. seed 충돌·누락

**증상**: rough 스트로크가 시각적으로 중복 (같은 seed + 같은 dimension → 같은 jitter). 또는 매 렌더마다 다른 jitter → 시각 떨림.

**원인**: seed가 rough.js PRNG seed. 누락 시 매번 다른 값이 들어감.

**해결**: element마다 **서로 다른 32-bit 정수**. C2가 검증.

### P3. points[0] ≠ [0, 0]

**증상**: arrow/line이 선언된 `x,y`에서 오프셋돼 그려지고 selection handle이 어긋남.

**원인**: `points`는 local 좌표이며 `[0,0]` 시작이 불변식.

**해결**:
```ts
function normalizePoints(points: Point[], origin: Point) {
  const [ox, oy] = points[0];
  return {
    points: points.map(([x, y]) => [x - ox, y - oy] as Point),
    x: origin[0] + ox,
    y: origin[1] + oy,
  };
}
```
C3가 검증.

### P4. autoResize vs width 불일치

**증상**: `autoResize:true`인데 `width`가 `measureText` 결과와 다르면 **restore가 덮어쓰기** → 레이아웃 변동. `autoResize:false`인데 `text`가 wrap 안 된 원본 → 첫 상호작용에서 다시 wrap되며 위치 틀어짐.

**해결**:
- `autoResize: true`: `text = originalText`, `width`/`height`는 정확한 `measureText` 결과
- `autoResize: false`: `originalText`에 raw, `text`에 wrap 결과, `width` 고정

### P5. updated: 0 또는 1

**증상**: 24시간 이상 오래된 element로 인식 → collab 병합에서 항상 패배, Firebase에서 삭제 처리.

**원인**: `DELETED_ELEMENT_TIMEOUT = 24h`.

**해결**: `updated: Date.now()`. 절대 placeholder 금지.

### P6. version: 0 또는 누락, 또는 너무 큰 값

**증상**: 초기 version이 너무 크면 (예: 1000000) collab 재협상이 깨짐 (issue #1639).

**해결**: 초기 `1`, mutation마다 `+1`. 큰 값으로 건너뛰지 말 것.

### P7. group 멤버가 groupIds 공유 안 함

**증상**: group이 성립 안 하고 단일 선택만 됨, "Ungroup" 안 됨.

**해결**: 같은 groupId 문자열을 **모든 멤버**의 `groupIds`에 push. 중첩 시 innermost → outermost 순서.

### P8. frameId가 실재 frame 아님

**증상**: element가 팬텀 clip에 갇혀 안 보이거나 hit-test 실패.

**해결**: C7이 검증.

### P9. 이미지 fileId가 files에 없음

**증상**: placeholder 표시 또는 무한 pending.

**해결**: image emit 시 `files[fileId] = {id, mimeType, dataURL, created, lastRetrieved}` 동시 emit. C6가 검증.

### P10. roundness type 오지정

**증상**:
- rectangle에 `{type: 2, value: N}` → default radius로 렌더
- arrow에 `{type: 3}` → 무시
- ellipse에 `{type: 1}` 등 → 무시

**해결**: `08-excalidraw-reference.md`의 Roundness 지원 매트릭스 참조.

### P11. fontFamily 문자열 또는 unknown 정수

**증상**: Excalifont 폴백으로 떨어져 width 틀어짐 (metric 차이).

**해결**: 1/2/3/5/6/7/8/9 중 하나. 기본 5 (Excalifont).

### P12. 음수 width/height

**증상**: SVG export 실패, hit-test 반전, selection inverted.

**해결**: emit 전 normalize:
```ts
if (el.width < 0) { el.x += el.width; el.width = -el.width; }
if (el.height < 0) { el.y += el.height; el.height = -el.height; }
```
Flip은 arrow head swap 또는 image의 `scale: [-1, 1]`로.

### P13. linear element 1 point

**증상**: 안 보임, bounds degenerate.

**해결**: 최소 2개 (`[[0,0], [dx,dy]]`).

### P14. arrow의 x, y 누락

**증상**: points 좌표가 scene 좌표로 오해됨.

**해결**: 항상 `x`, `y` 필드 emit. 0이라도 명시.

### P15. lastCommittedPoint와 points[last] 불일치

**증상**: 편집 진입 시 "midcreate" 상태로 인식, 커서에 point 추가 붙음.

**해결**: 완성된 linear는 `lastCommittedPoint: null`.

### P16. boundElements에 "line" 또는 중복

**증상**: 팬텀 drag. Restore가 첫 mutation에 제거.

**해결**: `"text"` 또는 `"arrow"`만. id로 dedupe.

### P17. Elbow arrow가 fixedPoint 누락

**증상**: 첫 상호작용에서 L-shape로 reset. `[0.5, 0.5]` 사용 시 oscillation (issue #9197).

**해결**: `elbowed: true`면 `FixedPointBinding` 필수, `fixedPoint: [0.4999, 0.5001]`.  C10이 검증.

### P18. 고아 binding elementId

**증상**: 드래그 시 앱 hang (issue #8131).

**해결**: emit 전 존재성 검증, 없으면 해당 binding `null`. C5가 검증.

### P19. FractionalIndex 부정확

**증상**: z-order 깜빡임, 중복 생성.

**해결**: 전부 `null`로 두고 `restore.ts::syncInvalidIndices`에 위임.

### P20. polygon:true인데 첫/끝 point 불일치

**증상**: 폴리곤 닫히지 않음, fill 안 됨.

**해결**:
```ts
if (line.polygon) {
  const first = line.points[0];
  const last = line.points[line.points.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    line.points = [...line.points, [...first]];
  }
}
```

### P21. freedraw pressures/points 길이 불일치

**증상**: stroke 균일화 또는 NaN.

**해결**: 길이 맞추기, 값 `[0, 1]`.

### P22. image status: "pending" 고착

**증상**: dataURL 이미 있는데도 로딩 스피너.

**해결**: dataURL 있으면 `status: "saved"`.

### P23. Clipboard/파일 포맷 type 혼동

**증상**: 원한 것은 scene 삽입인데 전체 덮어쓰기 (또는 반대).

**해결**:
- 삽입: `"excalidraw/clipboard"`
- 전체 로드: `"excalidraw"`

### P24. appState 이중 JSON.stringify

**증상**: 파싱 실패 (issue #9474).

**해결**: `appState`는 **object 그대로**. 최소 `{viewBackgroundColor: "#ffffff", gridSize: null}`.

### P25. angle을 degrees로

**증상**: 90이 90 radians(≈ 5157°)로 해석돼 무의미한 회전.

**해결**: `angle: deg * Math.PI / 180`. C8이 휴리스틱 탐지.

### P26. originalText 누락 또는 불일치

**증상**: container resize 시 `wrapText(undefined, ...)` → 빈 문자열로 wrap.

**해결**: `originalText`에 raw, `text`에 wrap 결과. `autoResize:true`면 동일.

### P27. version 안 올리고 mutate

**증상**: `ElementBounds.boundsCache`가 `element.version`에 키잉되어 낡은 bounds 반환.

**해결**: mutation마다 `version++` + 새 `versionNonce`.

### P28. duplication 시 id 재작성 누락

**증상**: 복제된 arrow가 원본 shape에 bind된 채 — "phantom" 발생.

**해결**: 복제 시 `old → new` id map을 만들고:
- `startBinding.elementId`, `endBinding.elementId`
- `containerId`
- `frameId`
- `boundElements[].id`
- `groupIds` 멤버
전부 일관되게 치환.

## 테스트 전략

### Unit Test: emit 함수

각 `emit*` 함수에 대해:
```ts
describe('emitLabelBox', () => {
  it('produces compliant output for minimal input', () => {
    const ctx = new CompileContext(sketchyTheme);
    emitLabelBox({
      kind: 'labelBox',
      id: 'a' as PrimitiveId,
      shape: 'rectangle',
      at: [0, 0],
    }, ctx);
    const result = ctx.finalize();
    const report = runCompliance(result.elements, result.files);
    expect(report.passed).toBe(true);
  });

  it('handles text with special characters', () => { /* ... */ });
  it('fits auto to text width', () => { /* ... */ });
  it('respects fit:fixed size', () => { /* ... */ });
  it('binds text to shape bidirectionally', () => {
    const result = compileOne({
      kind: 'labelBox', id: 'a' as PrimitiveId,
      text: 'Hello', shape: 'rectangle', at: [0, 0],
    });
    const shape = result.elements.find(e => e.type === 'rectangle')!;
    const text = result.elements.find(e => e.type === 'text')!;
    expect(shape.boundElements).toContainEqual({ type: 'text', id: text.id });
    expect((text as any).containerId).toBe(shape.id);
  });
});
```

### Snapshot Test: 전체 compile

```ts
// tests/snapshots/flowchart.test.ts
it('flowchart scene produces stable output', () => {
  const result = compile(flowchartScene);
  // seed/versionNonce/updated/id는 비결정적이므로 normalize
  const normalized = normalizeForSnapshot(result);
  expect(normalized).toMatchSnapshot();
});

function normalizeForSnapshot(result: CompileResult): unknown {
  return {
    ...result,
    elements: result.elements.map(el => ({
      ...el,
      id: `[id-${el.type}]`,
      seed: 0,
      versionNonce: 0,
      updated: 0,
    })),
  };
}
```

### Property Test (fast-check)

```ts
import fc from 'fast-check';

it('any valid primitive array compiles to compliant output', () => {
  fc.assert(
    fc.property(primitiveArrayArbitrary, (primitives) => {
      const scene: Scene = {
        primitives: new Map(primitives.map(p => [p.id, p])),
        theme: sketchyTheme,
      };
      const result = compile(scene);
      const report = runCompliance(result.elements, result.files);
      return report.passed;
    }),
    { numRuns: 1000 }
  );
});
```

### Integration Test: 실제 Excalidraw 로드

```ts
// Playwright 또는 Cypress 환경에서
it('compiled scene loads into Excalidraw without console errors', async ({ page }) => {
  await page.goto('http://localhost:3000/test-harness');
  const result = compile(testScene);

  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.evaluate((elements) => {
    (window as any).excalidrawAPI.updateScene({ elements });
  }, result.elements);

  await page.waitForTimeout(500);
  expect(errors).toEqual([]);

  // 실제 렌더된 요소 수 확인
  const rendered = await page.locator('.excalidraw__canvas').count();
  expect(rendered).toBeGreaterThan(0);
});
```

### Round-trip Test: compile → save → load → compile

```ts
it('compile → serialize → parse → re-compile is semantically stable', () => {
  const result1 = compile(scene);
  const json = serializeAsExcalidrawFile(result1);
  const parsed = JSON.parse(JSON.stringify(json));  // deep clone

  // 파싱 결과의 elements로 Excalidraw restoreElements 호출
  // (테스트에서는 실제 restore를 import해서 사용 가능)
  const restored = restoreElements(parsed.elements, null);

  // 핵심 속성 비교
  for (let i = 0; i < result1.elements.length; i++) {
    const orig = result1.elements[i];
    const round = restored[i];
    expect(round.type).toBe(orig.type);
    expect(round.x).toBe(orig.x);
    expect(round.y).toBe(orig.y);
    expect(round.width).toBe(orig.width);
    expect(round.height).toBe(orig.height);
    // ... 핵심 필드만
  }
});
```

### Golden Test: convertToExcalidrawElements와 비교

Excalidraw 공식 skeleton API와 L2 compile 결과를 비교해 회귀 감지:

```ts
it('L2 compile matches convertToExcalidrawElements shape for equivalent input', () => {
  const skeleton = [
    { type: 'rectangle', x: 100, y: 100, label: { text: 'Hello' } },
  ];
  const officialResult = convertToExcalidrawElements(skeleton);

  const l2Scene: Scene = {
    primitives: new Map([
      ['a' as PrimitiveId, {
        kind: 'labelBox', id: 'a' as PrimitiveId,
        text: 'Hello', shape: 'rectangle', at: [100, 100],
      }],
    ]),
    theme: sketchyTheme,
  };
  const l2Result = compile(l2Scene);

  // 구조 비교 (id·seed 제외)
  expect(l2Result.elements.length).toBe(officialResult.length);
  // 각 element의 type·dimensions 유사도 체크
  // ...
});
```

## CI 체크

GitHub Actions 또는 GitLab CI에서:

```yaml
# .github/workflows/compliance.yml
- name: Run compliance tests
  run: pnpm -F @drawcast/core test:compliance

- name: Run property tests
  run: pnpm -F @drawcast/core test:property

- name: Run snapshot tests
  run: pnpm -F @drawcast/core test:snapshot
```

`test:compliance`는 10개 check, `test:property`는 1000-run fast-check, `test:snapshot`은 회귀 감지.

## 수동 QA 시나리오

자동화로 잡히지 않는 시각적·인터랙션 회귀:

1. **기본 flowchart**: 3-4 노드 + 엣지 → 로드 → 스타일 점프 없는지
2. **복잡 binding**: arrow가 여러 shape 경유 → shape 이동 시 arrow 추종
3. **Arrow label**: label 있는 arrow → arrow 이동 시 label이 중점 유지
4. **Frame**: frame + 자식 → frame 드래그 시 자식 동반 이동
5. **중첩 Group**: inner group 선택 → 한 번 더 클릭 시 outer group 선택
6. **Image**: 업로드 → 이동·회전·flip 정상
7. **Elbow arrow**: 엘보 라우팅 → shape 크기 변경 시 재라우팅
8. **Roundtrip**: Excalidraw에서 export → L2 parse → L2 compile → 동일 렌더
9. **Obsidian**: Obsidian Excalidraw에 paste → 동일 렌더
10. **Copy/Paste**: L2 scene → 클립보드 → Excalidraw 웹에 붙여넣기

각 시나리오를 스크린샷으로 기록하고 버전 업 시 비교 (visual regression).
