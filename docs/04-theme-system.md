# 04. Theme System

## 설계 목표

- LLM이 색상·스타일을 자유롭게 고르는 대신, **정해진 토큰**에서 선택하게 한다 (일관성 자동 확보).
- 사용자가 "전체 분위기를 손그림으로" / "정갈하게" 같은 전역 모드를 한 줄로 바꿀 수 있다.
- 특정 노드·엣지만 override도 가능하다 (탈출구).
- 기본값은 **"Excalidraw다운 손그림 톤"** — 기계적 느낌을 일부러 피한다.

## 테마 구조

```ts
// @drawcast/core/src/theme.ts

export interface Theme {
  name: string;                     // 식별자
  defaultFontFamily: FontFamilyId;  // Sticky·Connector label 기본
  defaultFontSize: number;          // Sticky 기본

  // 노드 스타일 프리셋
  nodes: Record<string, NodeStylePreset>;

  // 엣지 스타일 프리셋
  edges: Record<string, EdgeStylePreset>;

  // 전역 stroke 속성
  global: GlobalStyle;
}

export interface NodeStylePreset {
  shape?: 'rectangle' | 'ellipse' | 'diamond';
  strokeColor: string;
  backgroundColor: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  roughness: 0 | 1 | 2;
  fontFamily?: FontFamilyId;
  fontSize?: number;
  roundness?: 1 | 2 | 3 | null;
}

export interface EdgeStylePreset {
  strokeColor: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  roughness: 0 | 1 | 2;
  fontFamily?: FontFamilyId;
  fontSize?: number;
}

export interface GlobalStyle {
  roughness: 0 | 1 | 2;             // 테마 전역 roughness (프리셋에서 상속)
  fillStyle: FillStyle;              // 기본 fill style
}

export type FontFamilyId = 1 | 2 | 3 | 5 | 6 | 7 | 8 | 9;
// 1: Virgil (legacy), 2: Helvetica, 3: Cascadia, 5: Excalifont (default),
// 6: Nunito, 7: Lilita One, 8: Comic Shanns, 9: Liberation Sans

export type FillStyle = 'hachure' | 'cross-hatch' | 'solid' | 'zigzag';
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
```

## 기본 테마

### `sketchyTheme` (default)

손그림 톤. 기본값.

```ts
export const sketchyTheme: Theme = {
  name: 'sketchy',
  defaultFontFamily: 5,             // Excalifont
  defaultFontSize: 20,
  global: {
    roughness: 1,
    fillStyle: 'hachure',
  },
  nodes: {
    default: {
      strokeColor: '#1e1e1e',
      backgroundColor: '#ffffff',
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
    },
    terminal: {
      shape: 'ellipse',
      strokeColor: '#1e1e1e',
      backgroundColor: '#f5f5f5',
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
      roundness: null,
    },
    process: {
      shape: 'rectangle',
      strokeColor: '#1971c2',
      backgroundColor: '#a5d8ff',
      fillStyle: 'hachure',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
      roundness: 3,
    },
    decision: {
      shape: 'diamond',
      strokeColor: '#e8590c',
      backgroundColor: '#ffd8a8',
      fillStyle: 'hachure',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
    },
    data: {
      shape: 'rectangle',
      strokeColor: '#2f9e44',
      backgroundColor: '#b2f2bb',
      fillStyle: 'hachure',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
      roundness: 3,
    },
    accent: {
      shape: 'rectangle',
      strokeColor: '#c92a2a',
      backgroundColor: '#ffc9c9',
      fillStyle: 'hachure',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
      roundness: 3,
    },
    muted: {
      shape: 'rectangle',
      strokeColor: '#868e96',
      backgroundColor: '#f8f9fa',
      fillStyle: 'solid',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 1,
      roundness: 3,
    },
  },
  edges: {
    default: {
      strokeColor: '#1e1e1e',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
    },
    dashed: {
      strokeColor: '#1e1e1e',
      strokeWidth: 2,
      strokeStyle: 'dashed',
      roughness: 1,
    },
    muted: {
      strokeColor: '#868e96',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 1,
    },
    accent: {
      strokeColor: '#c92a2a',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
    },
  },
};
```

### `cleanTheme` (alternative)

정갈한 톤. roughness 0, solid fill.

```ts
export const cleanTheme: Theme = {
  name: 'clean',
  defaultFontFamily: 2,             // Helvetica
  defaultFontSize: 18,
  global: {
    roughness: 0,
    fillStyle: 'solid',
  },
  nodes: {
    default: { /* roughness 0, solid fill */ },
    // ...나머지도 roughness 0, solid fill로
  },
  edges: {
    default: { /* 동일 */ },
  },
};
```

### `monoTheme` (alternative)

흑백 스케치. 색 없이 구조만.

```ts
export const monoTheme: Theme = {
  name: 'mono',
  defaultFontFamily: 5,
  defaultFontSize: 20,
  global: { roughness: 1, fillStyle: 'hachure' },
  nodes: {
    default: {
      strokeColor: '#1e1e1e',
      backgroundColor: 'transparent',
      fillStyle: 'hachure',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
    },
    // 모든 프리셋이 동일, backgroundColor만 gray shade로 구분
  },
  edges: { default: { /* ... */ } },
};
```

## StyleRef — primitive에서의 참조

```ts
// @drawcast/core/src/primitives.ts
export type StyleRef =
  | string                          // preset name (e.g. 'process')
  | StyleOverride;                  // 인라인 override

export interface StyleOverride {
  preset?: string;                  // base preset (있으면 그 위에 덮어쓰기)
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: FillStyle;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  roughness?: 0 | 1 | 2;
  fontFamily?: FontFamilyId;
  fontSize?: number;
  roundness?: 1 | 2 | 3 | null;
}
```

### 사용 예시

```ts
// 프리셋만 지정
{ kind: 'labelBox', style: 'process', ... }

// 프리셋 + 부분 override
{ kind: 'labelBox', style: { preset: 'process', backgroundColor: '#ffec99' }, ... }

// 완전 인라인 (프리셋 없이)
{ kind: 'labelBox', style: { strokeColor: '#c92a2a', backgroundColor: '#ffc9c9' }, ... }

// 생략 → 'default' 프리셋
{ kind: 'labelBox', ... }
```

## Compile 시 Style 해석

```ts
// @drawcast/core/src/compile/resolveStyle.ts

export function resolveNodeStyle(
  ref: StyleRef | undefined,
  theme: Theme
): ResolvedNodeStyle {
  const defaultPreset = theme.nodes.default;

  if (ref === undefined) {
    return applyGlobal(defaultPreset, theme.global);
  }

  if (typeof ref === 'string') {
    const preset = theme.nodes[ref];
    if (!preset) {
      // Unknown preset → warning + fallback to default
      return applyGlobal(defaultPreset, theme.global);
    }
    return applyGlobal(preset, theme.global);
  }

  // Inline override
  const base = ref.preset ? theme.nodes[ref.preset] ?? defaultPreset : defaultPreset;
  const merged: NodeStylePreset = {
    ...applyGlobal(base, theme.global),
    ...ref,                         // override wins
  };
  return merged;
}

function applyGlobal(
  preset: NodeStylePreset,
  global: GlobalStyle
): NodeStylePreset {
  return {
    ...preset,
    // global은 preset에서 명시적 지정 안 했을 때만 적용
    roughness: preset.roughness ?? global.roughness,
    fillStyle: preset.fillStyle ?? global.fillStyle,
  };
}
```

Edge도 동일 패턴 (`resolveEdgeStyle`).

## Shape 추론

LabelBox에서 `shape` 필드를 생략하면 테마 프리셋의 `shape`를 사용.

```ts
{ kind: 'labelBox', text: '시작', style: 'terminal' }
// preset 'terminal'이 shape: 'ellipse'를 지정 → 자동으로 ellipse
```

명시적 shape 지정은 preset 지정을 override:

```ts
{ kind: 'labelBox', text: '시작', shape: 'rectangle', style: 'terminal' }
// rectangle이 우선
```

## 전역 모드 전환

앱에서 Theme를 바꾸는 것은 scene의 `theme` 필드를 교체하는 한 줄:

```ts
scene.theme = cleanTheme;
compile(scene);  // 모든 primitive가 새 테마로 재컴파일
```

이 덕분에 "같은 다이어그램을 손그림 vs 정갈한 톤으로 각각 보기" 같은 기능이 공짜로 생긴다.

### UI에서의 노출 (추상)

앱 우측 패널 상단에 테마 선택 드롭다운. 테마 바꾸면 Excalidraw가 실시간 재렌더.

## 커스텀 테마 등록

사용자가 자기 테마를 정의할 수 있도록 API 제공:

```ts
// @drawcast/core
export function createTheme(partial: PartialTheme): Theme {
  return deepMerge(sketchyTheme, partial);
}

const myTheme = createTheme({
  name: 'my-company',
  nodes: {
    process: {
      strokeColor: '#company-blue',
      backgroundColor: '#company-lightblue',
    },
  },
});
```

MVP에서는 빌트인 3개 테마(sketchy, clean, mono)만 제공. 사용자 테마는 향후 지원.

## MCP에서의 테마 노출

LLM이 테마·프리셋 이름을 알 수 있게 tool description에 나열:

```ts
// draw_upsert_box tool schema
{
  properties: {
    style: {
      description: `스타일 프리셋 이름 또는 인라인 override 객체.
프리셋: ${Object.keys(scene.theme.nodes).join(', ')}.
프리셋 미지정 시 'default' 사용.`,
      oneOf: [
        { type: 'string' },
        { type: 'object', properties: { /* ... */ } },
      ],
    },
  },
}
```

추가로 `draw_list_style_presets()` tool을 노출해서 LLM이 필요 시 조회 가능하게:

```
draw_list_style_presets() →
{
  theme: 'sketchy',
  nodes: ['default', 'terminal', 'process', 'decision', 'data', 'accent', 'muted'],
  edges: ['default', 'dashed', 'muted', 'accent'],
}
```

## 테마 프리셋 네이밍 원칙

프리셋 이름은 **의미 기반**이지 시각 기반이 아니다. `'blue-box'`가 아니라 `'process'`. 이유:

1. 테마를 바꿔도 의미가 유지됨 ("process"는 어느 테마에서든 process 역할을 하는 노드)
2. LLM이 색을 고르는 대신 **역할을 고르게** 유도 → 일관성 자동 확보
3. 문서 자체가 가독성 있음

플로우차트에서 일반적으로 사용되는 역할:
- `terminal`: 시작/끝 (Excalidraw의 ellipse)
- `process`: 일반 작업 (rectangle)
- `decision`: 분기 (diamond)
- `data`: 저장·입출력
- `accent`: 강조/오류 경로
- `muted`: 부가 정보, 보조

시퀀스 다이어그램·마인드맵 등은 향후 L4 template이 자체 프리셋 추가.

## 테스트

```ts
describe('theme resolution', () => {
  it('returns default preset when style undefined', () => {
    const style = resolveNodeStyle(undefined, sketchyTheme);
    expect(style.strokeColor).toBe('#1e1e1e');
  });

  it('returns preset when string ref', () => {
    const style = resolveNodeStyle('process', sketchyTheme);
    expect(style.backgroundColor).toBe('#a5d8ff');
  });

  it('merges inline override over preset', () => {
    const style = resolveNodeStyle(
      { preset: 'process', backgroundColor: '#ffec99' },
      sketchyTheme
    );
    expect(style.strokeColor).toBe('#1971c2');  // preset 값
    expect(style.backgroundColor).toBe('#ffec99');  // override 값
  });

  it('falls back to default when preset unknown', () => {
    const style = resolveNodeStyle('nonexistent', sketchyTheme);
    expect(style.strokeColor).toBe('#1e1e1e');
  });

  it('applies global roughness when preset omits', () => {
    const theme = { ...sketchyTheme, global: { ...sketchyTheme.global, roughness: 2 } };
    const { default: _, ...rest } = theme.nodes;
    const customTheme = {
      ...theme,
      nodes: {
        ...rest,
        noRoughness: { ...sketchyTheme.nodes.default, roughness: undefined as any },
      },
    };
    const style = resolveNodeStyle('noRoughness', customTheme);
    expect(style.roughness).toBe(2);
  });
});
```
