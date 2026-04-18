// Shared state for the 3-pass compile. Holds the output element list,
// the files map, warnings, and a per-primitive registry that later passes
// consult to resolve references. See docs/03-compile-pipeline.md §36-66.

import type { Primitive, PrimitiveId } from '../primitives.js';
import type { Theme } from '../theme.js';
import type {
  BinaryFiles,
  BoundElement,
  ExcalidrawElement,
} from '../types/excalidraw.js';
import type { CompileWarning } from './warnings.js';

/**
 * Everything we remember about a primitive after its first pass. Later
 * passes (Connector binding, Group / Frame mutation) key into this map.
 */
export interface PrimitiveRecord {
  kind: Primitive['kind'];
  /** Every Excalidraw element id this primitive produced. */
  elementIds: string[];
  /** The element that accepts binding (shape for LabelBox, arrow for Connector…). */
  primaryId: string;
  bbox: { x: number; y: number; w: number; h: number };
}

/** Compile output shape. */
export interface CompileResult {
  elements: ExcalidrawElement[];
  files: BinaryFiles;
  warnings: CompileWarning[];
}

/**
 * Shared mutable state threaded through every emitter. Kept deliberately
 * narrow: emitters push elements, register records, and mutate existing
 * elements via `addBoundElement` / `getElementById`.
 */
export class CompileContext {
  readonly theme: Theme;
  readonly elements: ExcalidrawElement[] = [];
  readonly files: BinaryFiles = {};
  readonly warnings: CompileWarning[] = [];
  readonly registry = new Map<PrimitiveId, PrimitiveRecord>();

  private readonly byId = new Map<string, ExcalidrawElement>();

  constructor(theme: Theme) {
    this.theme = theme;
  }

  /** Append an element to the output list and index it by id. */
  emit(element: ExcalidrawElement): void {
    this.elements.push(element);
    this.byId.set(element.id, element);
  }

  /** Save a primitive -> produced-elements mapping for later passes. */
  registerPrimitive(id: PrimitiveId, record: PrimitiveRecord): void {
    this.registry.set(id, record);
  }

  /** Look up a primitive's record, or `undefined` if the primitive isn't registered yet. */
  getRecord(id: PrimitiveId): PrimitiveRecord | undefined {
    return this.registry.get(id);
  }

  /** Look up an emitted element by its Excalidraw id (for Group/Frame mutation). */
  getElementById(id: string): ExcalidrawElement | undefined {
    return this.byId.get(id);
  }

  /**
   * Ensure `ownerId` lists `{ type, id: boundId }` in its `boundElements`.
   * Dedupes if the same entry already exists — restoring would silently drop
   * it anyway but we keep the input clean. No-op if the owner isn't found.
   */
  addBoundElement(
    ownerId: string,
    boundId: string,
    type: 'text' | 'arrow',
  ): void {
    const owner = this.byId.get(ownerId);
    if (!owner) return;
    const existing: BoundElement[] = owner.boundElements ?? [];
    const already = existing.some((b) => b.type === type && b.id === boundId);
    if (already) return;
    owner.boundElements = [...existing, { type, id: boundId }];
  }

  /** Record a non-fatal warning. */
  pushWarning(w: CompileWarning): void {
    this.warnings.push(w);
  }

  /**
   * Freeze the context into a result value. The compile entry point is the
   * only caller — after `finalize`, the context should be considered consumed.
   */
  finalize(): CompileResult {
    return {
      elements: this.elements,
      files: this.files,
      warnings: this.warnings,
    };
  }
}
