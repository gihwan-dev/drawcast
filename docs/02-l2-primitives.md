# 02. L2 Primitive 스펙

## 설계 원칙

L2 primitive는 **"Excalidraw의 모든 element를 표현 가능"**을 최우선 제약으로 삼는다. 동시에 LLM과 사람 모두에게 ergonomic한 API를 제공한다. 이 두 목표를 조화시키기 위해 primitive를 **세 계층**으로 나눈다.

| 계층 | Primitive | 자동화 수준 | 용도 |
|---|---|---|---|
| **Core** | `LabelBox`, `Connector`, `Sticky` | 높음 — text measure, binding 자동 | 90%+ 호출 |
| **Structural** | `Group`, `Frame` | 중간 — 참조 관계만 | 의미적 묶음 |
| **Coverage** | `Line`, `Freedraw`, `Image`, `Embed` | 낮음 — pass-through | 탈출구 |

Core는 시간을 들여 잘 만든다. Coverage는 얇게 만들어도 된다.

## 공통 타입

```ts
// @drawcast/core/src/primitives.ts

export type PrimitiveId = string & { readonly __brand: 'PrimitiveId' };
export type Point = readonly [x: number, y: number];
export type Radians = number & { readonly __brand: 'Radians' };

export type Primitive =
  | LabelBox
  | Connector
  | Sticky
  | Group
  | Frame
  | Line
  | Freedraw
  | Image
  | Embed;

// 공통 선택적 속성
interface BaseProps {
  id: PrimitiveId;
  angle?: number;           // degrees (사용 시점에 radians 변환)
  locked?: boolean;
  opacity?: number;         // 0-100
  link?: string | null;
  style?: StyleRef;
  customData?: Record<string, unknown>;
}
```

모든 primitive는 `kind` discriminator로 식별된다. 모든 primitive는 `BaseProps`를 확장한다.

---

## Core Primitives

### `LabelBox`

**가장 중요한 primitive**. shape + 선택적 text의 복합체. Excalidraw에서 수동 JSON 작성 시 가장 실수가 많이 나오는 "텍스트가 담긴 박스"를 1급 개념으로 승격.

```ts
export interface LabelBox extends BaseProps {
  kind: 'labelBox';
  text?: string;                             // 생략 시 빈 도형
  shape: 'rectangle' | 'ellipse' | 'diamond';
  at: Point;
  fit?: 'auto' | 'fixed';                    // 기본 'auto'
  size?: readonly [w: number, h: number];    // fit='fixed' 시 사용
  padding?: number;                          // 기본 12
  textAlign?: 'left' | 'center' | 'right';   // 기본 'center'
  verticalAlign?: 'top' | 'middle' | 'bottom'; // 기본 'middle'
  rounded?: boolean;                         // rectangle/diamond만 유효. 기본 true
}
```

#### 시맨틱

- `fit: 'auto'`: `text`의 픽셀 크기 + `padding * 2`로 shape 크기 자동 산출. 최소 크기 `[80, 40]` 보장.
- `fit: 'fixed'` + `size`: 크기 고정. 텍스트가 넘치면 wrap (Excalidraw의 `autoResize: false` + `wrapText`).
- `rounded: true`: rectangle/diamond에 `roundness: {type: 3}` 적용. ellipse는 무시.
- `shape: 'ellipse'`에서는 `rounded` 필드 자체를 무시 (Excalidraw 사양).

#### 컴파일 결과

- 1개 rectangle/ellipse/diamond element (shape)
- 0~1개 text element (text가 있으면)
- 양방향 binding: `shape.boundElements = [{type: 'text', id: textId}]`, `text.containerId = shapeId`

#### 예시

```ts
{
  kind: 'labelBox',
  id: 'login-step',
  text: '로그인',
  shape: 'rectangle',
  at: [100, 100],
  style: 'process',
}
// → 크기 [약 96, 44]의 rectangle + 중앙 정렬된 text
```

---

### `Connector`

두 노드(또는 좌표)를 잇는 arrow. Binding·focus/gap을 자동 계산.

```ts
export interface Connector extends BaseProps {
  kind: 'connector';
  from: PrimitiveId | Point;
  to: PrimitiveId | Point;
  label?: string;
  routing?: 'straight' | 'elbow' | 'curved';  // 기본 'straight'
  arrowhead?: {
    start?: Arrowhead | null;
    end?: Arrowhead | null;                    // 기본 'arrow'
  };
}

export type Arrowhead =
  | 'arrow' | 'triangle' | 'bar' | 'dot'
  | 'circle' | 'diamond';
```

#### 시맨틱

- `from`/`to`가 `PrimitiveId`면 해당 LabelBox/Frame의 경계 박스를 찾아 startBinding/endBinding 구성.
- `from`/`to`가 `Point`면 자유 좌표. binding 없이 endpoint 고정.
- `label`이 있으면 arrow에 bind된 text element 추가 생성.
- `routing: 'elbow'`면 Excalidraw elbow arrow로 컴파일 — `elbowed: true`, `FixedPointBinding` 사용.
- `routing: 'curved'`면 `roundness: {type: 2}` 적용.

#### 컴파일 결과

- 1개 arrow element
- 0~1개 text element (label이 있으면, `containerId: arrowId`)
- 바인딩된 shape들의 `boundElements`에 `{type: 'arrow', id: arrowId}` 추가

#### 주의: Elbow arrow의 `fixedPoint`

`routing: 'elbow'`일 때 `fixedPoint`는 `[0.5, 0.5]`를 **살짝 피한다**. 정확히 0.5면 oscillation 버그(Excalidraw issue #9197). Compiler가 `[0.4999, 0.5001]` 또는 shape 모서리 기반 값을 자동 선택.

#### 예시

```ts
{
  kind: 'connector',
  id: 'login-to-auth',
  from: 'login-step',
  to: 'auth-check',
  label: 'submit',
  routing: 'elbow',
}
```

---

### `Sticky`

컨테이너 없는 독립 텍스트. 제목·주석·범례·자유 라벨.

```ts
export interface Sticky extends BaseProps {
  kind: 'sticky';
  text: string;                     // '\n' 으로 줄바꿈
  at: Point;
  textAlign?: 'left' | 'center' | 'right';  // 기본 'left'
  width?: number;                   // 지정 시 강제 wrap
  fontFamily?: FontFamilyName;      // 기본 theme 기본값
  fontSize?: number;                // 기본 20
}
```

#### 시맨틱

- `width` 미지정 → `autoResize: true` + 단일 줄 또는 `\n` 기준 높이 계산
- `width` 지정 → `autoResize: false` + `wrapText`로 강제 줄바꿈
- `fontFamily`, `fontSize`는 직접 지정 가능 (LabelBox와 달리 노드가 아니라 "텍스트 블록"이 본질이므로)

#### 컴파일 결과

- 1개 text element (`containerId: null`)

#### 예시

```ts
{
  kind: 'sticky',
  id: 'diagram-title',
  text: '요청 처리 흐름',
  at: [300, 20],
  textAlign: 'center',
  fontSize: 28,
}
```

---

## Structural Primitives

### `Group`

시맨틱 묶음. 시각 변화 없이 "같이 선택/이동되는 관계"만 형성.

```ts
export interface Group extends BaseProps {
  kind: 'group';
  children: PrimitiveId[];
}
```

#### 시맨틱

- `children`에 나열된 모든 primitive의 Excalidraw elements의 `groupIds` 배열에 이 group id를 push.
- 시각적 표시 없음. selection 시 같이 선택됨.
- 중첩 가능: Group이 다른 Group의 child가 되면, 내부 Group의 children 모두가 outer group id도 받음.

#### 컴파일 결과

- **0개 element 추가**. 기존 element들의 `groupIds`만 수정.

#### 예시

```ts
{
  kind: 'group',
  id: 'auth-subsystem',
  children: ['login-step', 'auth-check', 'token-issue'],
}
```

---

### `Frame`

시각 컨테이너. 제목 바와 clip 영역을 가진 명시적 그룹.

```ts
export interface Frame extends BaseProps {
  kind: 'frame';
  title?: string | null;            // Excalidraw의 'name'
  at: Point;
  size: readonly [w: number, h: number];
  children?: PrimitiveId[];         // 있으면 frameId 세팅
  magic?: boolean;                  // true면 magicframe으로 컴파일
}
```

#### 시맨틱

- `children` 목록에 있는 primitive들의 모든 element가 `frameId = frameId`를 가짐.
- Frame은 자동으로 group 효과도 가짐 (children은 같이 선택됨).
- `magic: true` → Excalidraw의 `magicframe` type.
- Excalidraw의 `FRAME_STYLE` 상수가 시각 스타일을 덮어쓰므로 `style` 필드는 대부분 무시됨.

#### 컴파일 결과

- 1개 frame 또는 magicframe element
- children의 `frameId` 필드 세팅

#### 예시

```ts
{
  kind: 'frame',
  id: 'auth-zone',
  title: '인증 영역',
  at: [50, 50],
  size: [400, 300],
  children: ['login-step', 'auth-check'],
}
```

---

## Coverage Primitives

### `Line`

좌표 기반 직선/폴리라인. arrow가 아님 (arrowhead 없음). Divider, 언더라인, 축, 괄호 등.

```ts
export interface Line extends BaseProps {
  kind: 'line';
  points: Point[];                  // scene 좌표, 2개 이상
  dashed?: boolean;
  rounded?: boolean;                // curved
  polygon?: boolean;                // 첫/끝 point 일치 시 폐곡선 fill
}
```

#### 시맨틱

- `points`는 **scene 좌표**로 받고, compiler가 `points[0]`을 `[0, 0]`으로 정규화하며 `x`, `y`를 보정.
- binding 없음. 노드에 붙이고 싶으면 `Connector`를 쓰라는 의도적 제약.
- `polygon: true`면 첫 점과 끝 점이 같아야 하며, compiler가 자동 보정.

#### 컴파일 결과

- 1개 line element (`type: 'line'`)

#### 예시

```ts
{
  kind: 'line',
  id: 'divider-1',
  points: [[100, 200], [500, 200]],
  dashed: true,
}
```

---

### `Freedraw`

손으로 그린 듯한 stroke. Pass-through.

```ts
export interface Freedraw extends BaseProps {
  kind: 'freedraw';
  at: Point;                        // origin
  points: Point[];                  // local 좌표, [0,0] 시작
  pressures?: number[];             // 0-1, points와 길이 동일
  simulatePressure?: boolean;       // 기본 true (pressure 없을 때 시뮬레이션)
}
```

#### 시맨틱

- `points[0]` 은 반드시 `[0, 0]` (compiler가 보정).
- `pressures` 길이 불일치 시 compiler가 에러 throw 또는 자동 padding.
- LLM이 직접 호출하기 어려운 primitive — 주로 사용자 수동 편집 결과를 round-trip할 때 사용.

#### 컴파일 결과

- 1개 freedraw element

---

### `Image`

이미지 삽입. 파일 경로 또는 base64.

```ts
export interface Image extends BaseProps {
  kind: 'image';
  source:
    | { type: 'file'; path: string }           // 세션 디렉토리 기준 상대 경로
    | { type: 'dataUrl'; data: string; mimeType: ImageMimeType };
  at: Point;
  size: readonly [w: number, h: number];       // 자동 크기 없음
  scale?: readonly [number, number];           // flip: [-1, 1] 등, 기본 [1, 1]
  crop?: {
    x: number; y: number;
    width: number; height: number;
    naturalWidth: number; naturalHeight: number;
  } | null;
}

export type ImageMimeType =
  | 'image/png' | 'image/jpeg'
  | 'image/svg+xml' | 'image/webp' | 'image/gif';
```

#### 시맨틱

- `source.type: 'file'`: compiler가 파일을 읽어 base64 dataURL로 변환 후 SHA-1 해시로 `fileId` 생성.
- `source.type: 'dataUrl'`: 그대로 사용, `fileId`는 데이터 해시로 생성.
- Scene serialization 시 `files` 객체에 `{[fileId]: {id, mimeType, dataURL, created, lastRetrieved}}` 추가.
- `size`는 필수 — 이미지는 자동 크기 계산 없음. 로드 후 natural size를 알려면 앱에서 pre-load 후 호출해야 함.

#### 컴파일 결과

- 1개 image element
- scene files 객체에 항목 추가

---

### `Embed`

iframe/embeddable. 외부 콘텐츠 삽입.

```ts
export interface Embed extends BaseProps {
  kind: 'embed';
  url: string;
  at: Point;
  size: readonly [w: number, h: number];
  validated?: boolean;              // 기본 undefined → Excalidraw 런타임이 검증
}
```

#### 시맨틱

- Excalidraw의 `embeddable` type으로 컴파일 (현재 기본).
- URL은 Excalidraw의 embed allowlist에 포함돼야 표시됨. 임의 URL은 placeholder로 렌더.
- 앱 내부에서는 `validateEmbeddable` prop으로 host-level 제어 가능.

#### 컴파일 결과

- 1개 embeddable element

---

## 참조 무결성 규칙

L2 primitive 간 참조 관계는 **compile 시점에 검증**된다. 위반 시 `CompileError` throw.

| 규칙 | 위반 시 |
|---|---|
| `Connector.from/to`가 `PrimitiveId`면 해당 id 존재해야 함 | `UnknownReferenceError` |
| `Group.children`의 모든 id 존재해야 함 | `UnknownReferenceError` |
| `Frame.children`의 모든 id 존재해야 함 | `UnknownReferenceError` |
| `Group`의 children은 `Group` 자체도 가능 (중첩) | — |
| `Frame`의 children이 다른 `Frame`이면 중첩 frame (허용) | — |
| 순환 참조 (A가 B의 child, B가 A의 child) | `CyclicReferenceError` |
| `Connector`의 binding 대상은 `LabelBox` 또는 `Frame`만 가능 | `UnbindableTargetError` |

## 선택적 속성의 기본값

compile 시 적용되는 기본값 (theme와 별개, primitive 자체 기본값):

| 필드 | 기본값 |
|---|---|
| `angle` | 0 |
| `locked` | false |
| `opacity` | 100 |
| `link` | null |
| `customData` | undefined |
| `LabelBox.fit` | `'auto'` |
| `LabelBox.padding` | 12 |
| `LabelBox.textAlign` | `'center'` |
| `LabelBox.verticalAlign` | `'middle'` |
| `LabelBox.rounded` | true |
| `Connector.routing` | `'straight'` |
| `Connector.arrowhead.end` | `'arrow'` |
| `Connector.arrowhead.start` | `null` |
| `Sticky.textAlign` | `'left'` |
| `Sticky.fontSize` | 20 |
| `Line.dashed` | false |
| `Line.rounded` | false |
| `Line.polygon` | false |
| `Image.scale` | `[1, 1]` |
| `Image.crop` | null |

## Scene 타입

```ts
export interface Scene {
  primitives: ReadonlyMap<PrimitiveId, Primitive>;
  theme: Theme;
}
```

Scene은 compile의 입력 단위. `primitives`는 Map으로 순서 보존 및 id 기반 O(1) lookup.

## 예시 Scene

```ts
const scene: Scene = {
  primitives: new Map([
    ['title', {
      kind: 'sticky',
      id: 'title',
      text: '요청 처리 흐름',
      at: [300, 20],
      fontSize: 28,
      textAlign: 'center',
    }],
    ['login', {
      kind: 'labelBox',
      id: 'login',
      text: '로그인',
      shape: 'rectangle',
      at: [100, 100],
      style: 'process',
    }],
    ['auth', {
      kind: 'labelBox',
      id: 'auth',
      text: '인증',
      shape: 'diamond',
      at: [300, 100],
      style: 'decision',
    }],
    ['home', {
      kind: 'labelBox',
      id: 'home',
      text: '홈',
      shape: 'ellipse',
      at: [500, 100],
      style: 'terminal',
    }],
    ['e1', {
      kind: 'connector',
      id: 'e1',
      from: 'login',
      to: 'auth',
      label: 'submit',
    }],
    ['e2', {
      kind: 'connector',
      id: 'e2',
      from: 'auth',
      to: 'home',
      label: '200 OK',
      routing: 'elbow',
    }],
  ]),
  theme: defaultTheme,
};
```

이 Scene을 `compile(scene)`하면 약 11개의 Excalidraw element가 생성된다:
- Sticky 1개 → text element × 1
- LabelBox 3개 → (shape + text) × 3 = 6개
- Connector 2개 (label 포함) → (arrow + text) × 2 = 4개
- 합계: 1 + 6 + 4 = 11개
