// Resolve StyleRef -> concrete node/edge style, honouring Theme `global`
// overrides and inline `StyleOverride`. A missing string preset falls back
// to `default` with a warning so downstream emit never crashes.
// See docs/03-compile-pipeline.md (§ "emit 공통 - style").

import type { PrimitiveId } from '../primitives.js';
import type {
  EdgeStylePreset,
  GlobalStyle,
  NodeStylePreset,
  StyleOverride,
  StyleRef,
  Theme,
} from '../theme.js';
import type { CompileWarning } from './warnings.js';

/**
 * Concrete style for a shape element. Derived by merging
 * theme preset <- global <- inline override.
 */
export type ResolvedNodeStyle = NodeStylePreset;

/** Concrete style for an arrow/line element. */
export type ResolvedEdgeStyle = EdgeStylePreset;

/**
 * Layer theme-level `global` overrides on top of a node preset. Only keys
 * actually defined on `global` are applied — presets stay untouched for
 * dimensions the theme didn't opinionate on.
 */
export function applyGlobal(
  preset: NodeStylePreset,
  global: GlobalStyle,
): NodeStylePreset {
  const out: NodeStylePreset = { ...preset };
  if (global.strokeColor !== undefined) out.strokeColor = global.strokeColor;
  if (global.backgroundColor !== undefined)
    out.backgroundColor = global.backgroundColor;
  if (global.fillStyle !== undefined) out.fillStyle = global.fillStyle;
  if (global.roughness !== undefined) out.roughness = global.roughness;
  // `opacity` is not a preset field — it lives on the element directly.
  return out;
}

/**
 * Same as `applyGlobal` but for edge presets (no shape/roundness keys).
 */
function applyGlobalEdge(
  preset: EdgeStylePreset,
  global: GlobalStyle,
): EdgeStylePreset {
  const out: EdgeStylePreset = { ...preset };
  if (global.strokeColor !== undefined) out.strokeColor = global.strokeColor;
  if (global.roughness !== undefined) out.roughness = global.roughness;
  return out;
}

function applyNodeOverride(
  preset: NodeStylePreset,
  override: StyleOverride,
): NodeStylePreset {
  const out: NodeStylePreset = { ...preset };
  if (override.strokeColor !== undefined) out.strokeColor = override.strokeColor;
  if (override.backgroundColor !== undefined)
    out.backgroundColor = override.backgroundColor;
  if (override.fillStyle !== undefined) out.fillStyle = override.fillStyle;
  if (override.strokeWidth !== undefined) out.strokeWidth = override.strokeWidth;
  if (override.strokeStyle !== undefined) out.strokeStyle = override.strokeStyle;
  if (override.roughness !== undefined) out.roughness = override.roughness;
  if (override.fontFamily !== undefined) out.fontFamily = override.fontFamily;
  if (override.fontSize !== undefined) out.fontSize = override.fontSize;
  if (override.roundness !== undefined) out.roundness = override.roundness;
  return out;
}

function applyEdgeOverride(
  preset: EdgeStylePreset,
  override: StyleOverride,
): EdgeStylePreset {
  const out: EdgeStylePreset = { ...preset };
  if (override.strokeColor !== undefined) out.strokeColor = override.strokeColor;
  if (override.strokeWidth !== undefined) out.strokeWidth = override.strokeWidth;
  if (override.strokeStyle !== undefined) out.strokeStyle = override.strokeStyle;
  if (override.roughness !== undefined) out.roughness = override.roughness;
  if (override.fontFamily !== undefined) out.fontFamily = override.fontFamily;
  if (override.fontSize !== undefined) out.fontSize = override.fontSize;
  return out;
}

interface Pusher {
  pushWarning(w: CompileWarning): void;
}

function lookupNodePreset(
  name: string,
  theme: Theme,
  primitiveId: PrimitiveId | undefined,
  warner: Pusher,
): NodeStylePreset {
  const preset = theme.nodes[name];
  if (preset) return preset;
  const fallback = theme.nodes['default'];
  const warning: CompileWarning = {
    code: 'STYLE_PRESET_MISSING',
    message: `Node style preset '${name}' not found in theme '${theme.name}'; falling back to 'default'.`,
    ...(primitiveId !== undefined ? { primitiveId } : {}),
  };
  warner.pushWarning(warning);
  // Every built-in theme ships a `default` preset; safety net for custom themes
  // missing it: synthesise the absolute baseline.
  if (fallback) return fallback;
  return {
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
  };
}

function lookupEdgePreset(
  name: string,
  theme: Theme,
  primitiveId: PrimitiveId | undefined,
  warner: Pusher,
): EdgeStylePreset {
  const preset = theme.edges[name];
  if (preset) return preset;
  const fallback = theme.edges['default'];
  const warning: CompileWarning = {
    code: 'STYLE_PRESET_MISSING',
    message: `Edge style preset '${name}' not found in theme '${theme.name}'; falling back to 'default'.`,
    ...(primitiveId !== undefined ? { primitiveId } : {}),
  };
  warner.pushWarning(warning);
  if (fallback) return fallback;
  return {
    strokeColor: '#1e1e1e',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
  };
}

/**
 * Resolve a node `StyleRef` to a concrete preset. Inline overrides may
 * optionally specify `preset:` to pick the base; otherwise `default` is used.
 */
export function resolveNodeStyle(
  ref: StyleRef | undefined,
  theme: Theme,
  primitiveId: PrimitiveId | undefined,
  warner: Pusher,
): ResolvedNodeStyle {
  let base: NodeStylePreset;
  let override: StyleOverride | undefined;

  if (typeof ref === 'string') {
    base = lookupNodePreset(ref, theme, primitiveId, warner);
  } else if (ref && typeof ref === 'object') {
    const presetName = ref.preset ?? 'default';
    base = lookupNodePreset(presetName, theme, primitiveId, warner);
    override = ref;
  } else {
    base = lookupNodePreset('default', theme, primitiveId, warner);
  }

  let merged = applyGlobal(base, theme.global);
  if (override) merged = applyNodeOverride(merged, override);
  return merged;
}

/**
 * Resolve an edge `StyleRef`. Same shape as `resolveNodeStyle` but against
 * `theme.edges`. Edges don't respect `global.backgroundColor`/`fillStyle`.
 */
export function resolveEdgeStyle(
  ref: StyleRef | undefined,
  theme: Theme,
  primitiveId: PrimitiveId | undefined,
  warner: Pusher,
): ResolvedEdgeStyle {
  let base: EdgeStylePreset;
  let override: StyleOverride | undefined;

  if (typeof ref === 'string') {
    base = lookupEdgePreset(ref, theme, primitiveId, warner);
  } else if (ref && typeof ref === 'object') {
    const presetName = ref.preset ?? 'default';
    base = lookupEdgePreset(presetName, theme, primitiveId, warner);
    override = ref;
  } else {
    base = lookupEdgePreset('default', theme, primitiveId, warner);
  }

  let merged = applyGlobalEdge(base, theme.global);
  if (override) merged = applyEdgeOverride(merged, override);
  return merged;
}
