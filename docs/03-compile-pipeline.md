# 03. Compile Pipeline

## 개요

`compile(scene: Scene): CompileResult` 는 L2 → L1 변환의 유일한 진입점이다. 순수 함수이며 IO를 하지 않는다 (이미지의 file→dataURL 변환만 예외적으로 허용되며, 이 역할은 `compileAsync`로 별도 분리).

```ts
export interface CompileResult {
  elements: ExcalidrawElement[];    // L1 elements
  files: BinaryFiles;               // image 첨부
  warnings: CompileWarning[];       // 비치명적 이슈
}
```

## 3-Pass 설계

compile은 3개 pass로 나뉜다. 순서가 중요한 이유는 후행 pass가 선행 pass의 결과를 참조하기 때문.

```
PASS 1: Positional  (LabelBox, Sticky, Image, Frame, Embed, Line, Freedraw)
         → shape과 standalone element를 먼저 생성
         → 각 primitive의 bounding box를 registry에 기록

PASS 2: Relational  (Connector)
         → bounding box를 참조해 binding/focus/gap 계산
         → arrow label도 여기서 생성

PASS 3: Grouping    (Group, Frame의 children 처리)
         → groupIds와 frameId 주입
         → 기존 element들을 mutation
```

이 3단계 설계는 Excalidraw 공식 `convertToExcalidrawElements` (transform.ts)도 동일한 패턴을 쓴다.

## CompileContext

3-pass 간 상태 공유를 위한 컨텍스트 객체.

```ts
class CompileContext {
  private elements: ExcalidrawElement[] = [];
  private files: BinaryFiles = {};
  private warnings: CompileWarning[] = [];

  // primitive id → 생성된 Excalidraw element 정보
  private registry = new Map<PrimitiveId, PrimitiveRecord>();

  constructor(private theme: Theme) {}

  emit(element: ExcalidrawElement): void;
  getRecord(id: PrimitiveId): PrimitiveRecord | undefined;
  addBoundElement(
    ownerId: ExcalidrawId,
    boundId: ExcalidrawId,
    type: 'text' | 'arrow'
  ): void;
  pushWarning(w: CompileWarning): void;
  finalize(): CompileResult;
}

interface PrimitiveRecord {
  kind: Primitive['kind'];
  elementIds: string[];             // 이 primitive가 만든 모든 Excalidraw element
  primaryId: string;                // shape id / arrow id (binding 대상)
  bbox: { x: number; y: number; w: number; h: number };  // 최종 bounding box
}
```

## Pass 1: Positional

각 primitive를 position이 확정된 Excalidraw element로 변환.

```ts
function passPositional(scene: Scene, ctx: CompileContext) {
  for (const p of scene.primitives.values()) {
    switch (p.kind) {
      case 'labelBox':  emitLabelBox(p, ctx); break;
      case 'sticky':    emitSticky(p, ctx); break;
      case 'image':     emitImage(p, ctx); break;
      case 'frame':     emitFrame(p, ctx); break;
      case 'embed':     emitEmbed(p, ctx); break;
      case 'line':      emitLine(p, ctx); break;
      case 'freedraw':  emitFreedraw(p, ctx); break;
      // Connector, Group은 다음 pass
    }
  }
}
```

### `emitLabelBox`

가장 복잡한 emit 함수. 텍스트 측정 → shape 크기 결정 → shape emit → text emit → 양방향 binding.

```ts
function emitLabelBox(p: LabelBox, ctx: CompileContext) {
  const style = ctx.resolveStyle(p.style, 'node');
  const padding = p.padding ?? 12;

  // 1. 텍스트 측정 (text가 있을 때만)
  let textMetrics = { width: 0, height: 0 };
  if (p.text) {
    textMetrics = measureText({
      text: p.text,
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
      lineHeight: getLineHeight(style.fontFamily),
    });
  }

  // 2. 크기 결정
  const [w, h] = p.fit === 'fixed' && p.size
    ? p.size
    : [
        Math.max(textMetrics.width + padding * 2, 80),
        Math.max(textMetrics.height + padding * 2, 40),
      ];

  // 3. Shape emit
  const shapeId = newElementId();
  const shape: ExcalidrawGenericElement = {
    ...baseElementFields(),
    id: shapeId,
    type: p.shape,
    x: p.at[0], y: p.at[1],
    width: w, height: h,
    angle: degreesToRadians(p.angle ?? 0),
    ...style.shapeProps,
    roundness: p.rounded && p.shape !== 'ellipse'
      ? { type: 3 }
      : null,
    boundElements: [],
    locked: p.locked ?? false,
    opacity: p.opacity ?? 100,
    link: p.link ?? null,
    customData: p.customData,
  };

  // 4. Text emit (있을 때만)
  let textId: string | null = null;
  if (p.text) {
    textId = newElementId();
    const textElement: ExcalidrawTextElement = {
      ...baseElementFields(),
      id: textId,
      type: 'text',
      x: p.at[0] + padding,
      y: p.at[1] + padding,
      width: w - padding * 2,
      height: h - padding * 2,
      text: p.text,                 // container-bound text는 wrap 결과
      originalText: p.text,         // 원본 보존
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
      textAlign: p.textAlign ?? 'center',
      verticalAlign: p.verticalAlign ?? 'middle',
      containerId: shapeId,
      lineHeight: getLineHeight(style.fontFamily),
      autoResize: false,            // container-bound는 false
      angle: 0 as Radians,
    };
    shape.boundElements = [{ type: 'text', id: textId }];
    ctx.emit(textElement);
  }

  ctx.emit(shape);

  // 5. Registry 등록
  ctx.registry.set(p.id, {
    kind: 'labelBox',
    elementIds: textId ? [shapeId, textId] : [shapeId],
    primaryId: shapeId,
    bbox: { x: p.at[0], y: p.at[1], w, h },
  });
}
```

#### 텍스트 측정 전략

브라우저의 `canvas.measureText` 대신 **정적 폰트 메트릭 테이블**을 사용한다. Node와 브라우저 양쪽에서 결정적으로 동작하고, IO 없이 순수 함수로 유지 가능.

```ts
// @drawcast/core/src/metrics/excalifont.ts
export const EXCALIFONT_METRICS: FontMetrics = {
  fontFamily: 5,
  unitsPerEm: 1000,
  ascent: 950,
  descent: -270,
  lineHeight: 1.25,
  // 유니코드 범위별 평균 advance width 테이블
  advanceWidths: {
    // Basic Latin
    0x0020: 250, 0x0021: 280, ..., 0x007E: 450,
    // Latin Extended-A, B ...
    // CJK Unified Ideographs (평균값)
    '__cjk_default': 1000,
    // default (fallback)
    '__default': 500,
  },
};

export function measureText(params: MeasureParams): TextMetrics {
  const metrics = FONT_METRICS[params.fontFamily];
  const lines = params.text.split('\n');
  const lineHeightPx = params.fontSize * params.lineHeight;

  let maxWidth = 0;
  for (const line of lines) {
    let width = 0;
    for (const ch of line) {
      const cp = ch.codePointAt(0) ?? 0;
      const advance = resolveAdvance(metrics, cp);
      width += (advance / metrics.unitsPerEm) * params.fontSize;
    }
    maxWidth = Math.max(maxWidth, width);
  }

  return {
    width: Math.ceil(maxWidth),
    height: Math.ceil(lineHeightPx * lines.length),
  };
}
```

#### 측정 정확도 확보

- **Tier 1 (자주 쓰이는 문자)**: 실제 폰트에서 추출한 정확한 advance width
- **Tier 2 (CJK 등)**: 평균값 사용, ±5px 오차 허용
- **Tier 3 (희귀 문자)**: default width 사용

측정 오차가 크면 Excalidraw의 `restore`가 실제 렌더 결과로 보정하므로 최초 로드는 우리 기대와 다를 수 있으나, 일반 용도에서 눈에 띄지 않는다.

### `emitSticky`

```ts
function emitSticky(p: Sticky, ctx: CompileContext) {
  const fontSize = p.fontSize ?? 20;
  const fontFamily = p.fontFamily
    ? resolveFontFamily(p.fontFamily)
    : ctx.theme.defaultFontFamily;

  const lines = p.text.split('\n');
  const lineHeight = getLineHeight(fontFamily);
  const lineHeightPx = fontSize * lineHeight;

  let width: number;
  let text: string;
  let autoResize: boolean;

  if (p.width) {
    // 강제 wrap
    autoResize = false;
    width = p.width;
    text = wrapText(p.text, { fontSize, fontFamily, maxWidth: width });
  } else {
    autoResize = true;
    const metrics = measureText({ text: p.text, fontSize, fontFamily, lineHeight });
    width = metrics.width;
    text = p.text;
  }

  const wrappedLines = text.split('\n');
  const height = Math.ceil(lineHeightPx * wrappedLines.length);

  const id = newElementId();
  ctx.emit({
    ...baseElementFields(),
    id,
    type: 'text',
    x: p.at[0], y: p.at[1],
    width, height,
    text,
    originalText: p.text,
    fontSize, fontFamily, lineHeight,
    textAlign: p.textAlign ?? 'left',
    verticalAlign: 'top',
    containerId: null,
    autoResize,
    angle: degreesToRadians(p.angle ?? 0),
    locked: p.locked ?? false,
    opacity: p.opacity ?? 100,
  });

  ctx.registry.set(p.id, {
    kind: 'sticky',
    elementIds: [id],
    primaryId: id,
    bbox: { x: p.at[0], y: p.at[1], w: width, h: height },
  });
}
```

### `emitImage`, `emitFrame`, `emitEmbed`, `emitLine`, `emitFreedraw`

각각 1:1 element 매핑. 상세 구현은 생략하되 아래 규칙 준수:

- **Line**: `points[0]`을 `[0,0]`으로 정규화 (후술).
- **Freedraw**: `points[0]`을 `[0,0]`으로 정규화. `pressures` 길이 검증.
- **Image**: `fileId = sha1(dataURL)`. `files[fileId]` 생성.
- **Frame**: `name: title ?? null`. `FRAME_STYLE`이 스타일을 덮어쓰므로 stroke/fill 지정 의미 없음.
- **Embed**: `link: url` 세팅, `validated: undefined` 기본.

### Linear element point 정규화

`Line`, `Freedraw`, `Connector`의 arrow 모두 공통:

```ts
function normalizePoints(
  points: Point[],
  origin: Point
): { points: Point[], x: number, y: number, width: number, height: number } {
  const offsetX = points[0][0];
  const offsetY = points[0][1];
  const localPoints = points.map(([px, py]) => [px - offsetX, py - offsetY] as Point);

  const xs = localPoints.map(p => p[0]);
  const ys = localPoints.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  return {
    points: localPoints,
    x: origin[0] + offsetX,
    y: origin[1] + offsetY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
```

이 정규화를 거치지 않으면 Excalidraw의 `restore`가 첫 mutation에 보정하면서 element가 순간 이동한다.

## Pass 2: Relational

Connector의 binding을 resolve하고 arrow element 생성.

```ts
function passRelational(scene: Scene, ctx: CompileContext) {
  for (const p of scene.primitives.values()) {
    if (p.kind === 'connector') emitConnector(p, ctx);
  }
}
```

### `emitConnector`

```ts
function emitConnector(p: Connector, ctx: CompileContext) {
  const style = ctx.resolveStyle(p.style, 'edge');

  // 1. Binding resolve
  const startBinding = resolveBinding(p.from, ctx);
  const endBinding = resolveBinding(p.to, ctx);

  // 2. Endpoint 좌표 산출
  const [startPt, endPt] = resolveEndpoints(p.from, p.to, ctx);

  // 3. Points 구성
  const rawPoints = buildPoints(startPt, endPt, p.routing ?? 'straight');
  const { points, x, y, width, height } = normalizePoints(rawPoints, [0, 0]);

  // 4. Arrow emit
  const arrowId = newElementId();
  const isElbow = p.routing === 'elbow';

  const arrow: ExcalidrawArrowElement = {
    ...baseElementFields(),
    id: arrowId,
    type: 'arrow',
    x: startPt[0], y: startPt[1],
    width, height,
    points,
    lastCommittedPoint: null,
    startBinding,
    endBinding,
    startArrowhead: p.arrowhead?.start ?? null,
    endArrowhead: p.arrowhead?.end ?? 'arrow',
    elbowed: isElbow,
    fixedSegments: isElbow ? [] : null,
    startIsSpecial: false,
    endIsSpecial: false,
    polygon: false,
    roundness: p.routing === 'curved' ? { type: 2 } : null,
    boundElements: [],
    angle: 0 as Radians,
    ...style.edgeProps,
    locked: p.locked ?? false,
    opacity: p.opacity ?? 100,
  };

  ctx.emit(arrow);

  // 5. 반대 방향 boundElements 주입
  if (startBinding) {
    ctx.addBoundElement(startBinding.elementId, arrowId, 'arrow');
  }
  if (endBinding) {
    ctx.addBoundElement(endBinding.elementId, arrowId, 'arrow');
  }

  // 6. Label 처리
  const elementIds = [arrowId];
  if (p.label) {
    const labelId = emitArrowLabel(arrowId, p.label, ctx);
    arrow.boundElements.push({ type: 'text', id: labelId });
    elementIds.push(labelId);
  }

  ctx.registry.set(p.id, {
    kind: 'connector',
    elementIds,
    primaryId: arrowId,
    bbox: { x, y, w: width, h: height },
  });
}
```

### `resolveBinding`

```ts
function resolveBinding(
  ref: PrimitiveId | Point,
  ctx: CompileContext
): PointBinding | FixedPointBinding | null {
  if (Array.isArray(ref)) return null;  // Point → free

  const record = ctx.registry.get(ref);
  if (!record) {
    ctx.pushWarning({
      kind: 'UnknownReference',
      primitive: ref,
      message: `Connector references unknown primitive: ${ref}`,
    });
    return null;
  }

  if (record.kind !== 'labelBox' && record.kind !== 'frame') {
    ctx.pushWarning({
      kind: 'UnbindableTarget',
      primitive: ref,
      message: `Cannot bind to primitive of kind ${record.kind}`,
    });
    return null;
  }

  // Elbow arrow는 FixedPointBinding
  if (isElbowContext(ctx)) {
    return {
      elementId: record.primaryId,
      focus: 0,
      gap: 4,
      fixedPoint: [0.4999, 0.5001],  // 정중앙 oscillation 회피
      mode: 'orbit',
    };
  }

  // 일반 arrow는 PointBinding
  return {
    elementId: record.primaryId,
    focus: 0,      // 대략 정면 접근. Excalidraw가 첫 상호작용에서 정확히 보정
    gap: 4,
  };
}
```

**중요**: `focus`를 정확히 계산하려 하지 말 것. `0`(정면)과 `gap: 4`(기본 여유)만 주면 Excalidraw가 첫 mutation에 정확한 값으로 재수렴한다. 우리가 계산을 복제하려 들면 Excalidraw 버전 업 시 깨진다.

### `resolveEndpoints`

```ts
function resolveEndpoints(
  from: PrimitiveId | Point,
  to: PrimitiveId | Point,
  ctx: CompileContext
): [Point, Point] {
  return [
    resolveEndpoint(from, ctx, 'from'),
    resolveEndpoint(to, ctx, 'to'),
  ];
}

function resolveEndpoint(
  ref: PrimitiveId | Point,
  ctx: CompileContext,
  which: 'from' | 'to'
): Point {
  if (Array.isArray(ref)) return ref;

  const record = ctx.registry.get(ref);
  if (!record) return [0, 0];

  const { x, y, w, h } = record.bbox;

  // 간단한 방향 추정: bbox 중심에서 반대쪽 endpoint를 향하는 방향
  // (실제 endpoint는 Excalidraw가 boundary에서 재계산하므로 근사값이면 충분)
  const centerX = x + w / 2;
  const centerY = y + h / 2;

  return [centerX, centerY];
}
```

### `buildPoints`

```ts
function buildPoints(
  start: Point, end: Point,
  routing: 'straight' | 'elbow' | 'curved'
): Point[] {
  switch (routing) {
    case 'straight':
    case 'curved':
      // 중심-to-중심 직선. Excalidraw가 boundary에서 재조정
      return [start, end];

    case 'elbow': {
      // 기본 L-shape. Excalidraw의 elbow 라우터가 최종 경로 계산
      const midX = (start[0] + end[0]) / 2;
      return [
        start,
        [midX, start[1]],
        [midX, end[1]],
        end,
      ];
    }
  }
}
```

### `emitArrowLabel`

```ts
function emitArrowLabel(
  arrowId: string,
  label: string,
  ctx: CompileContext
): string {
  const fontSize = 16;  // arrow label 기본 (theme에서 override 가능)
  const fontFamily = ctx.theme.defaultFontFamily;
  const metrics = measureText({
    text: label, fontSize, fontFamily,
    lineHeight: getLineHeight(fontFamily),
  });

  const labelId = newElementId();
  // 위치는 arrow의 midpoint에 놓임 (Excalidraw가 자동 재배치)
  // 초기값은 arrow의 대략 중심. restore가 정확한 midpoint로 수정
  ctx.emit({
    ...baseElementFields(),
    id: labelId,
    type: 'text',
    x: 0, y: 0,  // 임시값 (Excalidraw가 재계산)
    width: metrics.width,
    height: metrics.height,
    text: label,
    originalText: label,
    fontSize, fontFamily,
    lineHeight: getLineHeight(fontFamily),
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: arrowId,
    autoResize: true,
    angle: 0 as Radians,
  });

  return labelId;
}
```

## Pass 3: Grouping

Group과 Frame의 children 처리. 이 단계에서는 새 element를 만들지 않고 기존 element를 mutation.

```ts
function passGrouping(scene: Scene, ctx: CompileContext) {
  for (const p of scene.primitives.values()) {
    switch (p.kind) {
      case 'group':
        applyGroup(p, ctx);
        break;
      case 'frame':
        applyFrameChildren(p, ctx);
        break;
    }
  }
}

function applyGroup(p: Group, ctx: CompileContext) {
  const groupId = p.id;  // primitive id를 groupId로 사용 가능 (문자열이면 됨)

  for (const childId of p.children) {
    const record = ctx.registry.get(childId);
    if (!record) {
      ctx.pushWarning({ kind: 'UnknownReference', primitive: childId, message: '...' });
      continue;
    }

    for (const elementId of record.elementIds) {
      const el = ctx.findElement(elementId);
      if (el) {
        el.groupIds = [...(el.groupIds ?? []), groupId];
      }
    }
  }
}

function applyFrameChildren(p: Frame, ctx: CompileContext) {
  const frameRecord = ctx.registry.get(p.id);
  if (!frameRecord) return;

  for (const childId of p.children ?? []) {
    const record = ctx.registry.get(childId);
    if (!record) continue;

    for (const elementId of record.elementIds) {
      const el = ctx.findElement(elementId);
      if (el) {
        el.frameId = frameRecord.primaryId;
      }
    }
  }
}
```

### 중첩 Group 처리

Group이 다른 Group의 child인 경우, inner group의 멤버들은 **자신의 groupIds 배열 끝에 outer groupId도 append**해야 한다.

```ts
// 순서: innermost → outermost
element.groupIds = ['inner-group', 'outer-group'];
```

compile에서는 Group 순서를 Topological sort로 처리. 구현 간략화를 위해 MVP에서는 **Group의 children이 Group이면 명시적으로 flatten하지 않고, 각 Group이 독립적으로 자기 children을 처리**한다. Excalidraw 측에서는 element의 groupIds만 보므로 최종 결과는 동일.

## 공통 필드 생성

### `baseElementFields()`

모든 Excalidraw element에 들어가는 공통 필드. 25+ 필드.

```ts
function baseElementFields(): BaseElementFields {
  return {
    version: 1,
    versionNonce: randomInteger(),
    seed: randomInteger(),
    isDeleted: false,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    roundness: null,
    groupIds: [],
    frameId: null,
    boundElements: [],
    updated: Date.now(),
    link: null,
    locked: false,
    customData: undefined,
    index: null,
  };
}
```

이 필드들은 이후 emit 함수에서 override되기도 한다 (예: theme이 strokeColor 지정).

### `newElementId()` / `randomInteger()`

```ts
import { customAlphabet } from 'nanoid';

const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const idGenerator = customAlphabet(alphabet, 21);

export function newElementId(): string {
  return idGenerator();
}

export function randomInteger(): number {
  return Math.floor(Math.random() * 0x80000000);  // 31-bit
}
```

### `degreesToRadians` / 각도 처리

L2는 사용자에게 **degrees로 angle을 받고** compile 시 radians로 변환. Excalidraw는 radians를 저장.

```ts
export function degreesToRadians(deg: number): Radians {
  return ((deg % 360) * Math.PI / 180) as Radians;
}
```

## Serialization

Compile 결과를 파일/클립보드 형식으로 감싸는 어댑터.

### `.excalidraw` 파일

```ts
export function serializeAsExcalidrawFile(
  result: CompileResult
): ExcalidrawFileEnvelope {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'https://drawcast.app',  // 나중에 확정
    elements: result.elements,
    appState: {
      viewBackgroundColor: '#ffffff',
      gridSize: null,
      gridStep: 5,
    },
    files: result.files,
  };
}
```

### 클립보드 (Excalidraw 웹 / Obsidian)

```ts
export function serializeAsClipboardJSON(
  result: CompileResult
): ExcalidrawClipboardEnvelope {
  return {
    type: 'excalidraw/clipboard',
    elements: result.elements,
    files: Object.keys(result.files).length > 0 ? result.files : undefined,
  };
}
```

### Obsidian `.excalidraw.md`

별도 어댑터 (MVP 후순위):

```ts
export function serializeAsObsidianMarkdown(
  result: CompileResult
): string {
  const textElements = result.elements.filter(e => e.type === 'text');
  const textSection = textElements
    .map(t => `${t.text} ^${t.id}\n`)
    .join('\n');

  const drawingJSON = JSON.stringify(
    serializeAsExcalidrawFile(result),
    null, 2
  );

  return `---
excalidraw-plugin: parsed
tags: [excalidraw]
---

==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠==

# Text Elements

${textSection}

%%
# Drawing
\`\`\`json
${drawingJSON}
\`\`\`
%%
`;
}
```

## Incremental Compile

전체 recompile은 primitive 수가 많아지면 비용이 든다. MVP에서는 full recompile로 충분하지만, 향후 incremental 경로 설계:

```ts
export function compileDiff(
  prevScene: Scene,
  nextScene: Scene,
  prevResult: CompileResult
): CompileDiff {
  // primitive id 기준 삼중 집합: added, modified, removed
  // 각 집합에 대해 필요한 만큼만 emit
  // 영향 받는 primitive 전파 (예: LabelBox의 텍스트가 바뀌면 해당 shape + text만 재생성)
}
```

Excalidraw의 `updateScene`이 element id 기준 diff 적용을 지원하므로, compileDiff 결과를 그대로 `updateScene`에 넘길 수 있다.

## 에러 처리

```ts
export type CompileWarning =
  | { kind: 'UnknownReference'; primitive: PrimitiveId; message: string }
  | { kind: 'UnbindableTarget'; primitive: PrimitiveId; message: string }
  | { kind: 'InvalidPoints'; primitive: PrimitiveId; message: string }
  | { kind: 'MissingFile'; primitive: PrimitiveId; path: string; message: string }
  | { kind: 'InvalidStyle'; primitive: PrimitiveId; style: string; message: string };

export class CompileError extends Error {
  constructor(
    public kind: 'CyclicReference' | 'FatalInput',
    public details: unknown,
    message: string
  ) {
    super(message);
  }
}
```

- **Warning**: 비치명적. element가 생성되지만 참조가 끊겨있거나 기본값으로 대체됨.
- **Error**: compile 전체 실패. 순환 참조, 근본적 타입 불일치 등.

MCP tool은 warning을 호출자에게 전달하고 에러는 tool 실패로 반환한다.

## 테스트 전략

### Unit test

각 emit 함수에 대해:
- 최소 입력 → 기대 element
- 모든 optional 필드 포함 → 기대 element
- 경계 조건 (빈 text, 0-dimension, 극단 좌표)

### Snapshot test

전체 scene compile 결과를 JSON snapshot으로 고정. Excalidraw 버전 업 시 회귀 감지.

```ts
it('compiles flowchart scene', () => {
  const result = compile(flowchartScene);
  expect(result).toMatchSnapshot();
});
```

### Property test (fast-check)

- 임의 scene 생성 → compile → `09-pitfalls-and-compliance.md`의 10개 compliance check 모두 통과
- Round-trip: primitive → compile → Excalidraw load → export → primitive (not exact equal, but semantic equivalent)

### Integration test

실제 Excalidraw npm 패키지에 compile 결과를 `updateScene`으로 로드 → DOM에 렌더됨을 확인.
