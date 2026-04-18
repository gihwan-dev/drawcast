# 08. Excalidraw Reference

> **이 문서는 구현 중 참조하기 위한 퀵 레퍼런스다.** 리서치 원문에 해당하는 상세 분석은 `research/excalidraw-internals.md`에 보존하고, 이 문서는 **자주 들춰보는 값·표·규칙**에 집중한다.

## Element 타입 목록

```
"rectangle" | "diamond" | "ellipse"    — generic shapes
"text"                                  — 자유 또는 container-bound
"line" | "arrow"                        — linear elements
"freedraw"                              — 손그림 stroke
"image"                                 — fileId 참조
"frame" | "magicframe"                  — 시각 컨테이너
"embeddable" | "iframe"                 — 외부 콘텐츠
"selection"                             — 임시. emit 금지
```

## 공통 필드 템플릿 (`_ExcalidrawElementBase`)

모든 element가 가져야 하는 25+ 필드. 생성은 `packages/element/src/newElement.ts::_newElementBase`를 레퍼런스로.

| 필드 | 타입 | 기본값 | 비고 |
|---|---|---|---|
| `id` | `string` | `randomId()` | 전역 유일 (nanoid 계열) |
| `type` | literal | — | discriminator |
| `x`, `y` | `number` | — | scene 좌표 (음수 허용) |
| `width`, `height` | `number` | — | **반드시 양수**로 normalize |
| `angle` | `Radians` | `0` | **라디안**, 도 아님 |
| `strokeColor` | `string` | `"#1e1e1e"` | hex/CSS |
| `backgroundColor` | `string` | `"transparent"` | |
| `fillStyle` | `FillStyle` | `"solid"` | ← 과거 `"hachure"`에서 변경됨 |
| `strokeWidth` | `number` | `2` | 1/2/4 권장 |
| `strokeStyle` | literal | `"solid"` | |
| `roughness` | `0|1|2` | `1` | |
| `opacity` | `number` | `100` | **0~100**, 0~1 아님 |
| `groupIds` | `string[]` | `[]` | innermost → outermost |
| `frameId` | `string|null` | `null` | |
| `roundness` | `object|null` | `null` | 아래 roundness 테이블 |
| `seed` | `number` | `randomInteger()` | 서로 다른 32-bit 정수 |
| `version` | `number` | `1` | mutation마다 +1 |
| `versionNonce` | `number` | `randomInteger()` | mutation마다 새 값 |
| `isDeleted` | `boolean` | `false` | |
| `boundElements` | `BoundElement[]|null` | `[]` | `[]` 권장 |
| `updated` | `number` | `Date.now()` | **0·1 금지** |
| `link` | `string|null` | `null` | URL |
| `locked` | `boolean` | `false` | |
| `customData` | `object|undefined` | `undefined` | host 확장용 |
| `index` | `FractionalIndex|null` | `null` | `null`로 두면 auto-fill |

## Type별 고유 필드

### `rectangle` / `diamond` / `ellipse`
고유 필드 **없음**. `_ExcalidrawElementBase`만 사용. 차이는 렌더러와 충돌 판정에서만 발생.

### `text`

| 필드 | 타입 | 기본값 | 비고 |
|---|---|---|---|
| `text` | `string` | — | wrap된 최종 렌더 문자열 |
| `originalText` | `string` | — | 사용자 raw 입력 (wrap 전) |
| `fontSize` | `number` | `20` | `DEFAULT_FONT_SIZE` |
| `fontFamily` | `1|2|3|5|6|7|8|9` | `5` (Excalifont) | |
| `textAlign` | `"left"|"center"|"right"` | `"left"` (free) / `"center"` (bound) | |
| `verticalAlign` | `"top"|"middle"|"bottom"` | `"top"` (free) / `"middle"` (bound) | |
| `containerId` | `string|null` | `null` | bound 시 container id |
| `lineHeight` | `number` (branded) | `1.25` (Excalifont) | unitless multiplier |
| `autoResize` | `boolean` | `true` (free) / `false` (bound) | |
| `baseline` | `number` | — | **legacy, 0 또는 생략** |

`autoResize` 모드:
- `true` → `measureText` 결과에 맞춰 `width`/`height` 자동, 수동 resize 불가
- `false` → `width` 고정, `wrapText(originalText, ..., width)` 결과가 `text`, `height`는 줄 수 × `lineHeight × fontSize`

### `arrow` / `line`

| 필드 | 타입 | 기본값 | 비고 |
|---|---|---|---|
| `points` | `LocalPoint[]` | — | **`points[0] === [0, 0]`** 필수 |
| `lastCommittedPoint` | `LocalPoint|null` | `null` | 완성 상태면 `null` |
| `startArrowhead` | `Arrowhead|null` | `null` (line) / `null` (arrow) | |
| `endArrowhead` | `Arrowhead|null` | `null` (line) / `"arrow"` (arrow) | |
| `polygon` | `boolean` | `false` | 첫/끝 point 일치 → 폐곡선 fill |

`arrow` 전용:

| 필드 | 타입 | 기본값 | 비고 |
|---|---|---|---|
| `startBinding` | `PointBinding|FixedPointBinding|null` | `null` | |
| `endBinding` | `PointBinding|FixedPointBinding|null` | `null` | |
| `elbowed` | `boolean` | `false` | `true`면 FixedPointBinding 필수 |
| `fixedSegments` | `Segment[]|null` | `null` | elbow 사용자 수정 세그먼트 |
| `startIsSpecial` | `boolean` | `false` | elbow 라우팅 힌트 |
| `endIsSpecial` | `boolean` | `false` | |

`Arrowhead`: `"arrow" | "bar" | "dot" | "triangle" | "circle" | "diamond" | null`

### `freedraw`

| 필드 | 타입 | 기본값 | 비고 |
|---|---|---|---|
| `points` | `LocalPoint[]` | — | `points[0] === [0, 0]` |
| `pressures` | `number[]` | — | **points와 길이 동일** (0~1) |
| `simulatePressure` | `boolean` | `true` | pressures 없을 때 시뮬레이션 |
| `lastCommittedPoint` | `LocalPoint|null` | `null` | |

### `image`

| 필드 | 타입 | 기본값 | 비고 |
|---|---|---|---|
| `fileId` | `FileId|null` | — | `files` map의 key |
| `status` | `"pending"|"saved"|"error"` | `"saved"` | dataURL 준비 완료 시 |
| `scale` | `[number, number]` | `[1, 1]` | `[-1, 1]` 등 flip |
| `crop` | `object|null` | `null` | `{x,y,width,height,naturalWidth,naturalHeight}` |

### `frame` / `magicframe`

| 필드 | 타입 | 기본값 | 비고 |
|---|---|---|---|
| `name` | `string|null` | `null` | UI에서 "Frame 1" 자동 생성 |

**시각 스타일은 `FRAME_STYLE` 상수가 override** (`packages/common/src/constants.ts`). `strokeColor`·`backgroundColor`·`roundness` 등 명시해도 무시됨. 자식은 `element.frameId === frame.id`로 연결 (역참조 없음).

### `embeddable` / `iframe`

| 필드 | 타입 | 기본값 | 비고 |
|---|---|---|---|
| `link` | `string\|null` | — | 외부 URL |
| `validated` | `boolean\|undefined` | `undefined` | iframe 허용 여부 캐싱 |

## 폰트 ID 매핑

```
1  Virgil              (legacy, 신규 생성 금지)
2  Helvetica           (system font, 번들 X)
3  Cascadia            (monospace)
4  ── (reserved)      (Obsidian custom font 관례)
5  Excalifont          ← DEFAULT
6  Nunito
7  Lilita One
8  Comic Shanns
9  Liberation Sans
```

- 기본값: `DEFAULT_FONT_FAMILY = 5` (Excalifont).
- 0.17.x에서 Virgil → Excalifont로 default 교체. Virgil은 legacy로만 유지.
- CJK 폴백: Xiaolai (`CJK_HAND_DRAWN_FALLBACK_FONT`).
- Obsidian 플러그인은 `Fonts.register()`로 사용자 커스텀 폰트 등록 가능 (관례상 ID 4 또는 999+).

## Roundness 테이블

```ts
type Roundness = null | { type: 1 | 2 | 3, value?: number };
```

| type | 이름 | 용도 | 지원 shape |
|---|---|---|---|
| `null` | sharp | 각진 corner | 모든 타입 |
| `1` | LEGACY | 옛 25%-of-smallest-side | rectangle, diamond (deprecated) |
| `2` | PROPORTIONAL_RADIUS | 선형 요소 곡선화, 작은 shape | arrow, line (curved), small rect |
| `3` | ADAPTIVE_RADIUS | 큰 shape의 픽셀 radius | rectangle, diamond (UI default) |

지원 매트릭스:

| shape | `null` | `{type:1}` | `{type:2}` | `{type:3}` |
|---|---|---|---|---|
| rectangle | ✓ | ✓ (legacy) | ⚠ 이상한 radius | ✓ (권장) |
| diamond | ✓ | ✓ (legacy) | ⚠ | ✓ |
| ellipse | ✓ | 무시 | 무시 | 무시 |
| arrow (smooth) | ✓ | — | ✓ (curved) | — |
| arrow (elbow) | ✓ | — | — | — |
| line (straight) | ✓ | — | — | — |
| line (curved) | — | — | ✓ | — |
| text/image/frame/embed/iframe/magicframe | ✓ | — | — | — |

## Binding 객체

```ts
// 일반 arrow
type PointBinding = {
  elementId: string;      // bound shape id
  focus: number;          // 대략 -1..1
  gap: number;            // 픽셀
};

// Elbow arrow
type FixedPointBinding = PointBinding & {
  fixedPoint: [number, number];  // [0..1, 0..1] shape AABB normalized
  mode: "orbit" | "inside";
};
```

### focus 의미

- `focus ≈ 0`: 정면 접근 (shape 경계 중점)
- `|focus| → 1`: shape 가장자리/코너 근처
- `|focus| > 1`: shape를 빗나감 (free arrow처럼 처리)

**L2 전략**: 정밀 계산하지 말고 `focus: 0, gap: 4`로 두면 Excalidraw가 첫 상호작용에서 정확한 값으로 재수렴한다.

### fixedPoint 의미

Shape AABB 안의 normalized 좌표:
- `[0, 0]` = top-left
- `[1, 1]` = bottom-right
- `[0.5, 0.5]` = 정중앙 **→ oscillation 버그**. `[0.4999, 0.5001]`로 살짝 피할 것.

## BoundElements 배열

```ts
type BoundElement = { type: "text" | "arrow", id: string };
```

- **`type: "line"` 불법** (issue #8146). `"text"` 또는 `"arrow"`만.
- **양방향 필수**:
  - text↔container: `text.containerId = c.id` AND `c.boundElements ∋ {type:"text", id: t.id}`
  - arrow↔shape: `arrow.startBinding/endBinding.elementId = s.id` AND `s.boundElements ∋ {type:"arrow", id: a.id}`
  - arrow↔label: label text의 `containerId = arrow.id` AND `arrow.boundElements ∋ {type:"text", id: label.id}`

## 파일 포맷

### `.excalidraw` (full file)

```jsonc
{
  "type": "excalidraw",        // EXPORT_DATA_TYPES.excalidraw
  "version": 2,                // VERSIONS.excalidraw
  "source": "https://excalidraw.com",
  "elements": [/* ... */],
  "appState": {
    "viewBackgroundColor": "#ffffff",
    "gridSize": null,
    "gridStep": 5
  },
  "files": {
    "<fileId>": {
      "id": "<fileId>",
      "mimeType": "image/png",
      "dataURL": "data:image/png;base64,...",
      "created": 1713456789012,
      "lastRetrieved": 1713456789012
    }
  }
}
```

### Clipboard

```jsonc
{
  "type": "excalidraw/clipboard",
  "elements": [/* ... */],
  "files": { /* optional */ }
}
```

`appState`, `version`, `source` 없음.

### `.excalidrawlib` (라이브러리)

```jsonc
{
  "type": "excalidrawlib",
  "version": 2,
  "source": "https://excalidraw.com",
  "libraryItems": [{ "id", "status", "elements", "created" }]
}
```

### Obsidian `.excalidraw.md`

```markdown
---
excalidraw-plugin: parsed
tags: [excalidraw]
---

==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠==

# Text Elements
텍스트 1 ^blockId1
텍스트 2 ^blockId2

%%
# Drawing
```json
{ /* .excalidraw JSON */ }
```
%%
```

- front matter에 `excalidraw-plugin: parsed` 필수
- 1.6.13+ 기본은 **LZ-string 압축 base64** (설정에서 평문 전환 가능)
- excalidraw.com은 이 포맷 인식 못 함 (별도 어댑터로 변환 필요)

## files 객체 스키마

```ts
type BinaryFiles = {
  [fileId: FileId]: {
    id: FileId;
    mimeType: "image/png" | "image/jpeg" | "image/svg+xml" | "image/webp" | "image/gif";
    dataURL: `data:${mimeType};base64,${string}`;
    created: number;        // Date.now() ms
    lastRetrieved?: number;
  }
};
```

- `fileId`는 기본적으로 **SHA-1(file bytes)** hex
- host가 `generateIdForFile` prop으로 override 가능
- `filterOutDeletedFiles`가 살아있는 image만 참조하는 파일을 남김

## MIME Types

```
application/vnd.excalidraw+json        — .excalidraw 파일
application/vnd.excalidrawlib+json     — 라이브러리
# clipboard는 정확한 custom MIME보다는 text/plain에 JSON으로 쓰는 경로가 실용적
```

## FillStyle / StrokeStyle

```
FillStyle:   "hachure" | "cross-hatch" | "solid" | "zigzag"
              └ 평행선 ┘└ 교차 ┘└ 단색 ┘└ 지그재그(최신)
              DEFAULT: "solid"

StrokeStyle: "solid" | "dashed" | "dotted"
              dashed 패턴: ~[8, 4] 픽셀
              dotted 패턴: ~[1.5, 6] 픽셀 (strokeWidth에 따라 조정)
              DEFAULT: "solid"
```

## Arrowhead 종류

```
"arrow"      — 표준 화살촉 (default for arrow)
"triangle"   — 속찬 삼각형
"bar"        — T자 끝
"dot"        — 작은 원
"circle"     — 큰 원
"diamond"    — 마름모
null         — 없음
```

Line의 default는 양쪽 `null`. Arrow의 default는 start `null`, end `"arrow"`.

## 핵심 소스 경로

| 파일 | 역할 | L2에서의 활용 |
|---|---|---|
| `packages/element/src/newElement.ts` | Factory 함수들, `_newElementBase` | 기본값 테이블 복제 |
| `packages/element/src/types.ts` | 모든 타입 정의 | `import type`으로 재사용 |
| `packages/element/src/textElement.ts` | `measureText`, `wrapText`, binding text layout | 측정·wrap 로직 참고 |
| `packages/element/src/binding.ts` | Arrow binding, focus/gap | 대략적 binding 생성 |
| `packages/element/src/bounds.ts` | AABB 계산 | linear element width/height |
| `packages/element/src/linearElementEditor.ts` | Points 정규화 | `[0,0]` 정규화 복제 |
| `packages/excalidraw/data/restore.ts` | 로드 시 보정·마이그레이션 | 관용 허용치 이해 |
| `packages/excalidraw/data/json.ts` | `serializeAsJSON`, `saveAsJSON` | 파일 포맷 |
| `packages/excalidraw/clipboard.ts` | `serializeAsClipboardJSON`, `parseClipboard` | 클립보드 포맷 |
| `packages/excalidraw/data/transform.ts` | `convertToExcalidrawElements` (skeleton API) | **대안 경로** |
| `packages/common/src/constants.ts` | `DEFAULT_ELEMENT_PROPS`, `FONT_FAMILY`, `ROUNDNESS`, `FRAME_STYLE`, `MIME_TYPES`, `VERSIONS` | 상수 참조 |
| `packages/common/src/font-metadata.ts` | `FONT_METADATA` (per-font metrics) | 텍스트 측정 정적 데이터 |

## `convertToExcalidrawElements` (대안 경로)

Excalidraw가 직접 제공하는 **공식 programmatic factory** (`packages/excalidraw/data/transform.ts`). Skeleton 객체를 받아 L1 element를 생성한다.

```ts
import { convertToExcalidrawElements } from '@excalidraw/excalidraw';

const elements = convertToExcalidrawElements([
  {
    type: 'rectangle',
    x: 100, y: 100,
    label: { text: 'Hello' },
  },
  {
    type: 'arrow',
    x: 200, y: 200,
    start: { type: 'rectangle' },
    end: { type: 'ellipse' },
  },
]);
```

장점:
- text↔container binding, points 정규화, 0.5px offset 트릭 **자동**
- Excalidraw 버전 업 시 자동 호환

단점:
- Skeleton의 표현력이 제한적 (frame nesting, 복잡한 focus/gap 제어 안 됨)
- 런타임 의존 (browser DOM 필요 — text measurement)

**L2 전략**: 대부분의 케이스는 자체 compile로 처리하되, 특별히 복잡한 edge case나 Excalidraw 버전 호환이 걱정되는 경로에서는 skeleton → convertToExcalidrawElements를 내부적으로 호출하는 fallback을 둔다.

### Skeleton API 활용 가능 지점

- 빠른 프로토타이핑: compile 구현 전 MCP tool이 skeleton을 먼저 만들고 convertToExcalidrawElements를 호출
- 회귀 테스트: 동일 skeleton을 L2 compile과 convertToExcalidrawElements 양쪽에 넣어 결과 비교
- 호환성 검증: Excalidraw 버전 업 후 skeleton API 결과와 L2 결과의 diff로 regression 감지

## Restore의 보정 범위

로드 시 `restore.ts`가 자동으로 고치는 것들. **emit할 때 이걸 믿고 생략하면 안 된다** — `updateScene`(live 로드) 경로에서는 restore가 건너뛰어지기도 한다.

| 상황 | 보정 |
|---|---|
| 필드 누락 (boundElements 등) | default로 채움 |
| `roundness`가 boolean (구버전) | object로 변환 |
| `fontFamily`가 문자열 `"16px Virgil"` | `{fontSize, fontFamily}`로 분리 |
| `points[0] !== [0,0]` | `getNormalizeElementPointsAndCoords`로 정규화 |
| `lastCommittedPoint` 누락 | `null` |
| 양방향 boundElements 불일치 | **한쪽을 끊어버림** ← 위험 |
| `version`이 local보다 작음 | `bumpElementVersions`로 증가 |
| `fontFamily`가 알 수 없는 정수 | Excalifont 폴백 |
| `index` 잘못됨 | `syncInvalidIndices`로 재할당 |
| Orphan binding (`elementId` 없음) | `null`로 |

## Version 상수

- `VERSIONS.excalidraw = 2` — 파일 스키마 버전
- `VERSIONS.excalidrawLibrary = 2`
- 현재 npm `@excalidraw/excalidraw` 메이저: **0.18.x**
- 0.17 → 0.18 주요 변화: `ref` prop 제거 (`excalidrawAPI` callback), 폰트 구조 개편, elbow arrow 정착

## 0.17+ 추가 필드 체크리스트

L2가 emit할 때 최신 버전 호환 위해 확인:

- [x] `crop` (image) — `null` 또는 crop 객체
- [x] `polygon` (line) — `boolean`
- [x] `elbowed` (arrow) — `boolean`
- [x] `fixedSegments` (elbow arrow) — `[]` 또는 array
- [x] `startIsSpecial`, `endIsSpecial` (elbow arrow) — `boolean`
- [x] `validated` (embeddable/iframe) — `boolean | undefined`
- [x] `lineHeight` (text) — branded number (unitless multiplier)
- [x] `autoResize` (text) — `boolean`
- [x] `originalText` (text) — `string`
- [x] `index` (모든 element) — `FractionalIndex | null`

## ExcalidrawFrameLikeElement

`frame`과 `magicframe` 둘 다 `isFrameLikeElement` true를 반환. 자식 관리·clip 로직 동일. 차이는 시각 스타일 상수와 magicframe의 AI-generation 용도.

```ts
function isFrameLikeElement(el: ExcalidrawElement): boolean {
  return el.type === 'frame' || el.type === 'magicframe';
}
```

## 텍스트 측정 관련 API

```ts
// packages/element/src/textElement.ts
measureText(text, fontString, lineHeight): { width, height }
wrapText(originalText, fontString, maxWidth): string  // \n 삽입된 결과
getBoundTextMaxWidth(container): number
redrawTextBoundingBox(text, container, elementsMap): void
getContainerElement(text, elementsMap): Element | null
getBoundTextElement(container, elementsMap): TextElement | null

// packages/common/src/utils.ts
getFontString({fontSize, fontFamily, lineHeight}): string
// → "20px Excalifont, Xiaolai, sans-serif, \"Segoe UI Emoji\""
```

## Collab/Sync 관련 값 규칙

- `seed`: **element마다 서로 다른** 32-bit 정수. 동일 seed + 동일 dimension = 동일 rough stroke.
- `version`: `1`부터 시작. mutation마다 `+1`. **너무 큰 값 금지** (issue #1639 — collab 재협상 깨짐).
- `versionNonce`: mutation마다 **새** 32-bit 정수. `version` 동률 시 tiebreak.
- `updated`: `Date.now()`. **`0`·`1` 금지** — `DELETED_ELEMENT_TIMEOUT = 24h` 비교에서 항상 패배.

## 빠른 Sanity Check

L2가 emit한 JSON을 Excalidraw에 로드했을 때 정상인지 확인하는 1분짜리 체크:

1. 다이어그램이 "손으로 그린 것처럼" 로드되는가 (로드 직후 스타일 점프 없음)
2. 모든 text가 container 안에 정렬돼 있는가
3. 모든 arrow가 shape 경계에서 정확히 만나는가
4. shape를 드래그하면 arrow·label이 따라오는가
5. Frame 안의 요소가 frame 드래그 시 같이 이동하는가
6. Export → JSON → 다시 import 후 동일하게 렌더되는가
7. 콘솔에 경고·에러 없는가

하나라도 실패하면 `09-pitfalls-and-compliance.md`의 체크리스트로.
