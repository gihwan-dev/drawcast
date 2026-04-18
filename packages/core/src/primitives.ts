// L2 primitive types. See docs/02-l2-primitives.md.
// Nine primitives form a discriminated union via `kind`.

import type { Arrowhead, FontFamilyId, StyleRef, Theme } from './theme.js';

export type PrimitiveId = string & { readonly __brand: 'PrimitiveId' };
export type Point = readonly [x: number, y: number];
// Radians is for emit-time; primitives carry angle in degrees (see BaseProps).
export type Radians = number & { readonly __brand: 'Radians' };

// Re-export theme-owned types here so consumers can import from '@drawcast/core'.
export type { Arrowhead, FontFamilyId, StyleRef };

interface BaseProps {
  id: PrimitiveId;
  // degrees in L2; compiler converts to radians on emit.
  angle?: number;
  locked?: boolean;
  // 0-100
  opacity?: number;
  link?: string | null;
  style?: StyleRef;
  customData?: Record<string, unknown>;
}

export interface LabelBox extends BaseProps {
  kind: 'labelBox';
  text?: string;
  shape: 'rectangle' | 'ellipse' | 'diamond';
  at: Point;
  fit?: 'auto' | 'fixed';
  size?: readonly [width: number, height: number];
  rounded?: boolean;
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  fontSize?: number;
  fontFamily?: FontFamilyId;
}

export interface Connector extends BaseProps {
  kind: 'connector';
  from: PrimitiveId | Point;
  to: PrimitiveId | Point;
  label?: string;
  routing?: 'straight' | 'elbow' | 'curved';
  arrowhead?: {
    start?: Arrowhead | null;
    end?: Arrowhead | null;
  };
}

export interface Sticky extends BaseProps {
  kind: 'sticky';
  text: string;
  at: Point;
  width?: number;
  fontSize?: number;
  fontFamily?: FontFamilyId;
  textAlign?: 'left' | 'center' | 'right';
}

export interface Group extends BaseProps {
  kind: 'group';
  children: readonly PrimitiveId[];
}

export interface Frame extends BaseProps {
  kind: 'frame';
  title?: string;
  at: Point;
  size: readonly [width: number, height: number];
  children: readonly PrimitiveId[];
  magic?: boolean;
}

export interface Line extends BaseProps {
  kind: 'line';
  at: Point;
  // points length is unbounded; readonly array rather than a tuple.
  points: readonly Point[];
  dashed?: boolean;
  rounded?: boolean;
  polygon?: boolean;
}

export interface Freedraw extends BaseProps {
  kind: 'freedraw';
  at: Point;
  points: readonly Point[];
  // pressures[i] aligns with points[i]; length must match points.
  pressures?: readonly number[];
  simulatePressure?: boolean;
}

export interface Image extends BaseProps {
  kind: 'image';
  at: Point;
  size: readonly [width: number, height: number];
  source:
    | { kind: 'path'; path: string }
    | { kind: 'data'; dataURL: string; mimeType: string };
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
    naturalWidth: number;
    naturalHeight: number;
  };
  scale?: readonly [x: number, y: number];
}

export interface Embed extends BaseProps {
  kind: 'embed';
  at: Point;
  size: readonly [width: number, height: number];
  url: string;
  validated?: boolean;
}

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

export interface Scene {
  primitives: ReadonlyMap<PrimitiveId, Primitive>;
  theme: Theme;
}
