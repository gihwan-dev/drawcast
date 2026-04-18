// Theme system: style tokens + three built-in presets (sketchy/clean/mono).
// See docs/04-theme-system.md.

// FontFamilyId and Arrowhead live here (not in primitives.ts) so the dependency
// graph is one-way: primitives.ts imports from theme.ts only.
// 1: Virgil (legacy), 2: Helvetica, 3: Cascadia, 5: Excalifont (default),
// 6: Nunito, 7: Lilita One, 8: Comic Shanns, 9: Liberation Sans.
export type FontFamilyId = 1 | 2 | 3 | 5 | 6 | 7 | 8 | 9;

export type Arrowhead =
  | 'arrow'
  | 'triangle'
  | 'bar'
  | 'dot'
  | 'circle'
  | 'diamond';

export type FillStyle = 'hachure' | 'cross-hatch' | 'solid' | 'zigzag';
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
export type Roughness = 0 | 1 | 2;
export type RoundnessLevel = 1 | 2 | 3 | null;

export interface NodeStylePreset {
  shape?: 'rectangle' | 'ellipse' | 'diamond';
  strokeColor: string;
  backgroundColor: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  roughness: Roughness;
  fontFamily?: FontFamilyId;
  fontSize?: number;
  roundness?: RoundnessLevel;
}

export interface EdgeStylePreset {
  strokeColor: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  roughness: Roughness;
  fontFamily?: FontFamilyId;
  fontSize?: number;
  arrowheadStart?: Arrowhead | null;
  arrowheadEnd?: Arrowhead | null;
}

export interface GlobalStyle {
  strokeColor?: string;
  backgroundColor?: string;
  opacity?: number;
  roughness?: Roughness;
  fillStyle?: FillStyle;
}

export interface Theme {
  name: string;
  defaultFontFamily: FontFamilyId;
  defaultFontSize: number;
  nodes: Record<string, NodeStylePreset>;
  edges: Record<string, EdgeStylePreset>;
  global: GlobalStyle;
}

export interface StyleOverride {
  preset?: string;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: FillStyle;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  roughness?: Roughness;
  fontFamily?: FontFamilyId;
  fontSize?: number;
  roundness?: RoundnessLevel;
}

export type StyleRef = string | StyleOverride;

// -----------------------------------------------------------------------------
// Built-in themes
// -----------------------------------------------------------------------------

export const sketchyTheme = {
  name: 'sketchy',
  defaultFontFamily: 5,
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
} as const satisfies Theme;

export const cleanTheme = {
  name: 'clean',
  defaultFontFamily: 2,
  defaultFontSize: 18,
  global: {
    roughness: 0,
    fillStyle: 'solid',
  },
  nodes: {
    default: {
      strokeColor: '#1e1e1e',
      backgroundColor: '#ffffff',
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 0,
    },
    terminal: {
      shape: 'ellipse',
      strokeColor: '#1e1e1e',
      backgroundColor: '#f5f5f5',
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 0,
      roundness: null,
    },
    process: {
      shape: 'rectangle',
      strokeColor: '#1971c2',
      backgroundColor: '#a5d8ff',
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 0,
      roundness: 3,
    },
    decision: {
      shape: 'diamond',
      strokeColor: '#e8590c',
      backgroundColor: '#ffd8a8',
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 0,
    },
    data: {
      shape: 'rectangle',
      strokeColor: '#2f9e44',
      backgroundColor: '#b2f2bb',
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 0,
      roundness: 3,
    },
    accent: {
      shape: 'rectangle',
      strokeColor: '#c92a2a',
      backgroundColor: '#ffc9c9',
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 0,
      roundness: 3,
    },
    muted: {
      shape: 'rectangle',
      strokeColor: '#868e96',
      backgroundColor: '#f8f9fa',
      fillStyle: 'solid',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 0,
      roundness: 3,
    },
  },
  edges: {
    default: {
      strokeColor: '#1e1e1e',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 0,
    },
    dashed: {
      strokeColor: '#1e1e1e',
      strokeWidth: 2,
      strokeStyle: 'dashed',
      roughness: 0,
    },
    muted: {
      strokeColor: '#868e96',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 0,
    },
    accent: {
      strokeColor: '#c92a2a',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 0,
    },
  },
} as const satisfies Theme;

export const monoTheme = {
  name: 'mono',
  defaultFontFamily: 5,
  defaultFontSize: 20,
  global: {
    roughness: 1,
    fillStyle: 'hachure',
  },
  nodes: {
    default: {
      strokeColor: '#1e1e1e',
      backgroundColor: '#ffffff',
      fillStyle: 'hachure',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
    },
    terminal: {
      shape: 'ellipse',
      strokeColor: '#1e1e1e',
      backgroundColor: '#f5f5f5',
      fillStyle: 'hachure',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
      roundness: null,
    },
    process: {
      shape: 'rectangle',
      strokeColor: '#1e1e1e',
      backgroundColor: '#e9ecef',
      fillStyle: 'hachure',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
      roundness: 3,
    },
    decision: {
      shape: 'diamond',
      strokeColor: '#1e1e1e',
      backgroundColor: '#dee2e6',
      fillStyle: 'hachure',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
    },
    data: {
      shape: 'rectangle',
      strokeColor: '#1e1e1e',
      backgroundColor: '#ced4da',
      fillStyle: 'hachure',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
      roundness: 3,
    },
    accent: {
      shape: 'rectangle',
      strokeColor: '#1e1e1e',
      backgroundColor: '#adb5bd',
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
      fillStyle: 'hachure',
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
      strokeColor: '#1e1e1e',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
    },
  },
} as const satisfies Theme;
