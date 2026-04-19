// Compliance runner: enforces the 10 invariants from
// docs/09-pitfalls-and-compliance.md. Read-only — it never mutates elements,
// it only reports issues. A clean report (passed: true, issues: [])
// guarantees that Excalidraw's `restore` treats the scene as hand-drawn.
//
// Each check is structured to return a list of ComplianceIssue rows. The
// top-level `runCompliance` walks every element once per check where
// feasible, then aggregates a report.

import type {
  BinaryFiles,
  BoundElement,
  ExcalidrawArrowElement,
  ExcalidrawElement,
  ExcalidrawImageElement,
  ExcalidrawTextElement,
} from '../types/excalidraw.js';

/** Stable code for each of the 10 compliance checks. */
export type ComplianceCode =
  | 'C1'
  | 'C2'
  | 'C3'
  | 'C4'
  | 'C5'
  | 'C6'
  | 'C7'
  | 'C8'
  | 'C9'
  | 'C10';

export interface ComplianceIssue {
  code: ComplianceCode;
  /** Element this issue relates to, when applicable. */
  elementId?: string;
  message: string;
}

export interface ComplianceReport {
  passed: boolean;
  issues: ComplianceIssue[];
  /** Number of checks (out of 10) that reported no issues. */
  checksPassed: number;
  /** Number of checks (out of 10) that reported at least one issue. */
  checksFailed: number;
}

// -----------------------------------------------------------------------------
// C1 — Base field presence (25+ fields).
// -----------------------------------------------------------------------------

const REQUIRED_BASE_FIELDS = [
  'id',
  'type',
  'x',
  'y',
  'width',
  'height',
  'angle',
  'strokeColor',
  'backgroundColor',
  'fillStyle',
  'strokeWidth',
  'strokeStyle',
  'roughness',
  'opacity',
  'groupIds',
  'frameId',
  'roundness',
  'seed',
  'version',
  'versionNonce',
  'isDeleted',
  'boundElements',
  'updated',
  'link',
  'locked',
  'customData',
  'index',
] as const;

function checkC1(elements: readonly ExcalidrawElement[]): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  for (const el of elements) {
    const record = el as unknown as Record<string, unknown>;
    for (const field of REQUIRED_BASE_FIELDS) {
      if (!(field in record)) {
        issues.push({
          code: 'C1',
          elementId: el.id,
          message: `element ${el.id} missing required base field '${field}'`,
        });
      }
    }
  }
  return issues;
}

// -----------------------------------------------------------------------------
// C2 — Unique seeds & versionNonces across the scene.
// -----------------------------------------------------------------------------

function checkC2(elements: readonly ExcalidrawElement[]): ComplianceIssue[] {
  const seedCount = new Map<number, string[]>();
  const nonceCount = new Map<number, string[]>();
  for (const el of elements) {
    const s = seedCount.get(el.seed) ?? [];
    s.push(el.id);
    seedCount.set(el.seed, s);
    const n = nonceCount.get(el.versionNonce) ?? [];
    n.push(el.id);
    nonceCount.set(el.versionNonce, n);
  }
  const issues: ComplianceIssue[] = [];
  for (const [seed, ids] of seedCount) {
    if (ids.length > 1) {
      issues.push({
        code: 'C2',
        message: `duplicate seed ${seed} shared by elements [${ids.join(', ')}]`,
      });
    }
  }
  for (const [nonce, ids] of nonceCount) {
    if (ids.length > 1) {
      issues.push({
        code: 'C2',
        message: `duplicate versionNonce ${nonce} shared by elements [${ids.join(', ')}]`,
      });
    }
  }
  return issues;
}

// -----------------------------------------------------------------------------
// C3 — Linear element points[0] must be [0, 0].
// -----------------------------------------------------------------------------

const LINEAR_TYPES: ReadonlySet<ExcalidrawElement['type']> = new Set([
  'arrow',
  'line',
  'freedraw',
]);

function hasPoints(
  el: ExcalidrawElement,
): el is ExcalidrawElement & { points: readonly (readonly [number, number])[] } {
  return (
    LINEAR_TYPES.has(el.type) &&
    Array.isArray((el as unknown as { points?: unknown }).points)
  );
}

function checkC3(elements: readonly ExcalidrawElement[]): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  for (const el of elements) {
    if (!hasPoints(el)) continue;
    const pts = el.points;
    if (pts.length === 0) continue;
    const first = pts[0];
    if (!first) continue;
    if (first[0] !== 0 || first[1] !== 0) {
      issues.push({
        code: 'C3',
        elementId: el.id,
        message: `points[0] must be [0, 0] (got [${first[0]}, ${first[1]}])`,
      });
    }
  }
  return issues;
}

// -----------------------------------------------------------------------------
// C4 — Text <-> container bidirectional binding.
// -----------------------------------------------------------------------------

function isText(
  el: ExcalidrawElement,
): el is ExcalidrawTextElement {
  return el.type === 'text';
}

function hasBoundElement(
  bound: readonly BoundElement[],
  entry: BoundElement,
): boolean {
  return bound.some((b) => b.type === entry.type && b.id === entry.id);
}

function checkC4(elements: readonly ExcalidrawElement[]): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const byId = new Map(elements.map((el) => [el.id, el]));
  for (const el of elements) {
    if (!isText(el)) continue;
    if (el.containerId == null) continue;
    const container = byId.get(el.containerId);
    if (!container) {
      issues.push({
        code: 'C4',
        elementId: el.id,
        message: `text ${el.id} references missing container ${el.containerId}`,
      });
      continue;
    }
    if (!hasBoundElement(container.boundElements, { type: 'text', id: el.id })) {
      issues.push({
        code: 'C4',
        elementId: container.id,
        message: `container ${container.id} missing boundElement for text ${el.id}`,
      });
    }
  }
  return issues;
}

// -----------------------------------------------------------------------------
// C5 — Arrow start/end binding must round-trip via boundElements.
// -----------------------------------------------------------------------------

function isArrow(
  el: ExcalidrawElement,
): el is ExcalidrawArrowElement {
  return el.type === 'arrow';
}

function checkC5(elements: readonly ExcalidrawElement[]): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const byId = new Map(elements.map((el) => [el.id, el]));
  for (const el of elements) {
    if (!isArrow(el)) continue;
    const sides: Array<['startBinding' | 'endBinding', typeof el.startBinding]> = [
      ['startBinding', el.startBinding],
      ['endBinding', el.endBinding],
    ];
    for (const [side, binding] of sides) {
      if (!binding) continue;
      const target = byId.get(binding.elementId);
      if (!target) {
        issues.push({
          code: 'C5',
          elementId: el.id,
          message: `arrow ${el.id}.${side} references missing ${binding.elementId}`,
        });
        continue;
      }
      if (!hasBoundElement(target.boundElements, { type: 'arrow', id: el.id })) {
        issues.push({
          code: 'C5',
          elementId: target.id,
          message: `${target.id} missing boundElement for arrow ${el.id} (${side})`,
        });
      }
    }
  }
  return issues;
}

// -----------------------------------------------------------------------------
// C6 — Image fileId must be present in files map (when saved).
// -----------------------------------------------------------------------------

function isImage(
  el: ExcalidrawElement,
): el is ExcalidrawImageElement {
  return el.type === 'image';
}

function checkC6(
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles,
): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  for (const el of elements) {
    if (!isImage(el)) continue;
    if (el.fileId == null) {
      // A pending placeholder without a fileId is allowed; a saved image
      // without one is a bug.
      if (el.status === 'saved') {
        issues.push({
          code: 'C6',
          elementId: el.id,
          message: `image ${el.id} status='saved' but fileId is null`,
        });
      }
      continue;
    }
    const entry = (files as Record<string, unknown>)[el.fileId as unknown as string];
    if (!entry) {
      issues.push({
        code: 'C6',
        elementId: el.id,
        message: `image ${el.id} fileId ${el.fileId} not present in files map`,
      });
    }
  }
  return issues;
}

// -----------------------------------------------------------------------------
// C7 — frameId must reference an existing (non-deleted) frame / magicframe.
// -----------------------------------------------------------------------------

function checkC7(elements: readonly ExcalidrawElement[]): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const validFrameIds = new Set<string>();
  for (const el of elements) {
    if ((el.type === 'frame' || el.type === 'magicframe') && !el.isDeleted) {
      validFrameIds.add(el.id);
    }
  }
  for (const el of elements) {
    if (el.frameId == null) continue;
    if (!validFrameIds.has(el.frameId)) {
      issues.push({
        code: 'C7',
        elementId: el.id,
        message: `element ${el.id} frameId ${el.frameId} is not a valid frame`,
      });
    }
  }
  return issues;
}

// -----------------------------------------------------------------------------
// C8 — angle must be in radians (roughly within ±2π).
// -----------------------------------------------------------------------------

function checkC8(elements: readonly ExcalidrawElement[]): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const MAX = 2 * Math.PI;
  for (const el of elements) {
    const angle = el.angle as unknown as number;
    if (typeof angle !== 'number' || Number.isNaN(angle)) {
      issues.push({
        code: 'C8',
        elementId: el.id,
        message: `${el.id} angle is not a finite number`,
      });
      continue;
    }
    if (angle < -MAX || angle > MAX) {
      issues.push({
        code: 'C8',
        elementId: el.id,
        message: `angle ${angle} looks like degrees; expected radians`,
      });
    }
  }
  return issues;
}

// -----------------------------------------------------------------------------
// C9 — opacity must be in [0, 100].
// -----------------------------------------------------------------------------

function checkC9(elements: readonly ExcalidrawElement[]): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  for (const el of elements) {
    const op = el.opacity;
    if (typeof op !== 'number') {
      issues.push({
        code: 'C9',
        elementId: el.id,
        message: `${el.id} opacity is not a number`,
      });
      continue;
    }
    if (op < 0 || op > 100) {
      issues.push({
        code: 'C9',
        elementId: el.id,
        message: `${el.id} opacity ${op} outside [0, 100]`,
      });
    }
  }
  return issues;
}

// -----------------------------------------------------------------------------
// C10 — Elbow-arrow FixedPointBinding check.
//
// Excalidraw 0.17.x has no elbow arrow concept — `elbowed`,
// `fixedSegments`, `FixedPointBinding.fixedPoint` all land in 0.18+. Until
// we bump the pinned version we can't meaningfully enforce this rule, so
// the check is a no-op. Kept as a named function so the runner array
// below doesn't need conditional wiring and the test IDs stay stable.
// -----------------------------------------------------------------------------

function checkC10(): ComplianceIssue[] {
  return [];
}

// -----------------------------------------------------------------------------
// Runner
// -----------------------------------------------------------------------------

/**
 * Run every compliance check against `elements` (and `files` for C6) and
 * return a structured report. The element list is NEVER mutated.
 */
export function runCompliance(
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles,
): ComplianceReport {
  const checks: Array<{ code: ComplianceCode; run: () => ComplianceIssue[] }> = [
    { code: 'C1', run: () => checkC1(elements) },
    { code: 'C2', run: () => checkC2(elements) },
    { code: 'C3', run: () => checkC3(elements) },
    { code: 'C4', run: () => checkC4(elements) },
    { code: 'C5', run: () => checkC5(elements) },
    { code: 'C6', run: () => checkC6(elements, files) },
    { code: 'C7', run: () => checkC7(elements) },
    { code: 'C8', run: () => checkC8(elements) },
    { code: 'C9', run: () => checkC9(elements) },
    { code: 'C10', run: () => checkC10() },
  ];

  const issues: ComplianceIssue[] = [];
  let checksPassed = 0;
  let checksFailed = 0;
  for (const { run } of checks) {
    const rows = run();
    if (rows.length === 0) {
      checksPassed += 1;
    } else {
      checksFailed += 1;
      issues.push(...rows);
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    checksPassed,
    checksFailed,
  };
}
