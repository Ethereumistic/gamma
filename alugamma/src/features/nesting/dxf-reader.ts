// ────────────────────────────────────────────────────────────────────────────────
// Nesting Feature — DXF Reader
// Browser-side DXF parser for extracting bounding boxes and CUT line segments
// from imported DXF files.
//
// Plan refs: PLAN_01 (parser), PLAN_0 §8.3
// ────────────────────────────────────────────────────────────────────────────────

import { LAYER_CUT, LAYER_ZERO, CUT_OFFSET } from "./constants";
import type { Segment, Rect, NestPart, PartDirection } from "./types";
import { parseFilename, computeCutDimensions, createNestPart } from "./types";
import { computeSheetMetalGeometry } from "@/features/sheet-metal/geometry";
import { buildDxf } from "@/features/sheet-metal/dxf";
import { SIDE_KEY_TO_DIR, type SheetMetalModel } from "@/features/sheet-metal/types";

// ── DXF Entity Representation ─────────────────────────────────────────────
// Unlike a simple Map, we need to support multiple values with the same
// group code (e.g., LWPOLYLINE has many code-10 entries for vertices).
// We store code/value pairs as an ordered array and also provide a
// single-value map for codes that only appear once.

type DxfEntity = {
  type: string;
  layer: string;
  /** All code/value pairs in order of appearance */
  pairs: Array<{ code: number; value: string | number }>;
  /** Fast lookup for single-value codes */
  firstValue: Map<number, string | number>;
};

// ── DXF Parser ─────────────────────────────────────────────────────────────

function parseDxfEntities(dxfContent: string): DxfEntity[] {
  const lines = dxfContent.split(/\r?\n/);
  const entities: DxfEntity[] = [];
  let currentEntity: DxfEntity | null = null;
  let inEntities = false;
  let i = 0;

  while (i < lines.length - 1) {
    const codeLine = lines[i]?.trim() ?? "";
    const valueLine = lines[i + 1]?.trim() ?? "";
    i += 2;

    const code = parseInt(codeLine, 10);
    if (isNaN(code)) continue;

    if (code === 2 && valueLine === "ENTITIES") {
      inEntities = true;
      continue;
    }

    if (code === 0 && valueLine === "ENDSEC") {
      if (currentEntity) {
        entities.push(currentEntity);
        currentEntity = null;
      }
      inEntities = false;
      continue;
    }

    if (!inEntities) continue;

    // New entity starts
    if (code === 0 && valueLine !== "" && valueLine !== "ENDSEC" && valueLine !== "SECTION") {
      // Save previous entity
      if (currentEntity) {
        entities.push(currentEntity);
      }
      currentEntity = {
        type: valueLine,
        layer: "",
        pairs: [],
        firstValue: new Map(),
      };
      continue;
    }

    if (!currentEntity) continue;

    const numVal = Number(valueLine);
    const parsed: string | number = isNaN(numVal) ? valueLine : numVal;

    currentEntity.pairs.push({ code, value: parsed });
    currentEntity.firstValue.set(code, parsed);

    // Track layer (code 8)
    if (code === 8) {
      currentEntity.layer = String(parsed);
    }
  }

  if (currentEntity) {
    entities.push(currentEntity);
  }

  return entities;
}

// ── Helper: collect all values for a group code ─────────────────────────────

function getAllValues(entity: DxfEntity, code: number): number[] {
  const values: number[] = [];
  for (const pair of entity.pairs) {
    if (pair.code === code) {
      values.push(Number(pair.value));
    }
  }
  return values;
}

// ── Extract segments from a DXF entity ─────────────────────────────────────

function extractSegmentsFromEntity(entity: DxfEntity): Segment[] {
  const cv = entity.firstValue;
  const segments: Segment[] = [];

  switch (entity.type) {
    case "LINE": {
      const x1 = Number(cv.get(10)) || 0;
      const y1 = Number(cv.get(20)) || 0;
      const x2 = Number(cv.get(11)) || 0;
      const y2 = Number(cv.get(21)) || 0;
      segments.push({ x1, y1, x2, y2 });
      break;
    }

    case "LWPOLYLINE": {
      // Vertices stored as repeated group code 10 (X) and 20 (Y)
      const allX = getAllValues(entity, 10);
      const allY = getAllValues(entity, 20);
      const closed = (Number(cv.get(70)) || 0) & 1;

      for (let vi = 0; vi < allX.length - 1; vi++) {
        segments.push({
          x1: allX[vi],
          y1: allY[vi],
          x2: allX[vi + 1],
          y2: allY[vi + 1],
        });
      }
      if (closed && allX.length > 1) {
        segments.push({
          x1: allX[allX.length - 1],
          y1: allY[allY.length - 1],
          x2: allX[0],
          y2: allY[0],
        });
      }
      break;
    }

    case "POLYLINE": {
      // POLYLINE uses VERTEX sub-entities after it. We handle this
      // by collecting VERTEX data in the parser. For now, we need to
      // look at the following entities until the next SEQEND.
      // This is handled differently in our parser — skip for now.
      break;
    }

    case "ARC": {
      const cx = Number(cv.get(10)) || 0;
      const cy = Number(cv.get(20)) || 0;
      const r = Number(cv.get(40)) || 0;
      const startAngle = (Number(cv.get(50)) || 0) * (Math.PI / 180);
      const endAngle = (Number(cv.get(51)) || 360) * (Math.PI / 180);
      const divisions = 64;
      let a0 = startAngle;
      let a1 = endAngle;
      if (a1 <= a0) a1 += 2 * Math.PI;

      for (let d = 0; d < divisions; d++) {
        const angle1 = a0 + (a1 - a0) * (d / divisions);
        const angle2 = a0 + (a1 - a0) * ((d + 1) / divisions);
        segments.push({
          x1: cx + r * Math.cos(angle1),
          y1: cy + r * Math.sin(angle1),
          x2: cx + r * Math.cos(angle2),
          y2: cy + r * Math.sin(angle2),
        });
      }
      break;
    }

    case "CIRCLE": {
      const cx = Number(cv.get(10)) || 0;
      const cy = Number(cv.get(20)) || 0;
      const r = Number(cv.get(40)) || 0;
      const divisions = 64;
      for (let d = 0; d < divisions; d++) {
        const angle1 = (2 * Math.PI * d) / divisions;
        const angle2 = (2 * Math.PI * (d + 1)) / divisions;
        segments.push({
          x1: cx + r * Math.cos(angle1),
          y1: cy + r * Math.sin(angle1),
          x2: cx + r * Math.cos(angle2),
          y2: cy + r * Math.sin(angle2),
        });
      }
      break;
    }

    case "SPLINE": {
      // Approximate spline as line segments between control points
      const allX = getAllValues(entity, 10);
      const allY = getAllValues(entity, 20);
      for (let si = 0; si < allX.length - 1; si++) {
        segments.push({
          x1: allX[si],
          y1: allY[si],
          x2: allX[si + 1],
          y2: allY[si + 1],
        });
      }
      break;
    }

    case "ELLIPSE": {
      const cx = Number(cv.get(10)) || 0;
      const cy = Number(cv.get(20)) || 0;
      const majorX = Number(cv.get(11)) || 1;
      const majorY = Number(cv.get(21)) || 0;
      const ratio = Number(cv.get(40)) || 1;
      const startParam = Number(cv.get(41)) || 0;
      const endParam = Number(cv.get(42)) || 2 * Math.PI;
      const divisions = 64;
      const r = Math.sqrt(majorX * majorX + majorY * majorY);

      for (let d = 0; d < divisions; d++) {
        const p1 = startParam + (endParam - startParam) * (d / divisions);
        const p2 = startParam + (endParam - startParam) * ((d + 1) / divisions);
        segments.push({
          x1: cx + r * Math.cos(p1),
          y1: cy + r * ratio * Math.sin(p1),
          x2: cx + r * Math.cos(p2),
          y2: cy + r * ratio * Math.sin(p2),
        });
      }
      break;
    }
  }

  return segments;
}

// ── Extract bounding box from an entity ────────────────────────────────────

function extractBboxFromEntity(entity: DxfEntity): Rect | null {
  const cv = entity.firstValue;

  switch (entity.type) {
    case "LINE": {
      const x1 = Number(cv.get(10)) || 0;
      const y1 = Number(cv.get(20)) || 0;
      const x2 = Number(cv.get(11)) || 0;
      const y2 = Number(cv.get(21)) || 0;
      return {
        x0: Math.min(x1, x2),
        y0: Math.min(y1, y2),
        x1: Math.max(x1, x2),
        y1: Math.max(y1, y2),
      };
    }

    case "LWPOLYLINE": {
      const allX = getAllValues(entity, 10);
      const allY = getAllValues(entity, 20);
      if (allX.length === 0) return null;
      return {
        x0: Math.min(...allX),
        y0: Math.min(...allY),
        x1: Math.max(...allX),
        y1: Math.max(...allY),
      };
    }

    case "ARC":
    case "CIRCLE": {
      const cx = Number(cv.get(10)) || 0;
      const cy = Number(cv.get(20)) || 0;
      const r = Number(cv.get(40)) || 0;
      return { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r };
    }

    case "SPLINE": {
      const allX = getAllValues(entity, 10);
      const allY = getAllValues(entity, 20);
      if (allX.length === 0) return null;
      return {
        x0: Math.min(...allX),
        y0: Math.min(...allY),
        x1: Math.max(...allX),
        y1: Math.max(...allY),
      };
    }

    default:
      return null;
  }
}

// ── Merge bounding rects ────────────────────────────────────────────────────

function mergeRect(a: Rect, b: Rect): Rect {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

function emptyRect(): Rect {
  return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
}

// ── Parse a DXF file content and extract geometry ──────────────────────────

export type ParsedDxfPart = {
  l0Bbox: Rect;
  l0Width: number;
  l0Height: number;
  cutLines: Segment[];
};

export function parseDxfContent(dxfContent: string): ParsedDxfPart | null {
  try {
    const entities = parseDxfEntities(dxfContent);
    if (entities.length === 0) return null;

    let l0Bbox: Rect | null = null;
    const cutLines: Segment[] = [];

    for (const entity of entities) {
      const layer = entity.layer;

      // Check if this entity belongs to Layer 0 or CUT
      const isL0 = layer === LAYER_ZERO || layer === "0";
      const isCUT = layer === LAYER_CUT;

      // Extract bounding box for Layer 0 entities
      if (isL0) {
        const bbox = extractBboxFromEntity(entity);
        if (bbox) {
          l0Bbox = l0Bbox ? mergeRect(l0Bbox, bbox) : bbox;
        }
      }

      // Extract CUT layer line segments from any entity on CUT layer
      if (isCUT) {
        const segs = extractSegmentsFromEntity(entity);
        cutLines.push(...segs);
      }
    }

    // If no Layer 0 bbox found, try all entities to get overall bounds
    if (!l0Bbox) {
      for (const entity of entities) {
        const bbox = extractBboxFromEntity(entity);
        if (bbox) {
          l0Bbox = l0Bbox ? mergeRect(l0Bbox, bbox) : bbox;
        }
      }
    }

    if (!l0Bbox) return null;

    const l0Width = l0Bbox.x1 - l0Bbox.x0;
    const l0Height = l0Bbox.y1 - l0Bbox.y0;

    // Normalize cut lines to local coordinates (relative to Layer 0 bbox origin)
    const localCutLines = cutLines.map((seg) => ({
      x1: seg.x1 - l0Bbox!.x0,
      y1: seg.y1 - l0Bbox!.y0,
      x2: seg.x2 - l0Bbox!.x0,
      y2: seg.y2 - l0Bbox!.y0,
    }));

    return {
      l0Bbox: { x0: 0, y0: 0, x1: l0Width, y1: l0Height },
      l0Width,
      l0Height,
      cutLines: localCutLines,
    };
  } catch (e) {
    console.error("Error parsing DXF:", e);
    return null;
  }
}

// ── Create NestPart from file ──────────────────────────────────────────────

export async function createNestPartFromFile(
  file: File,
): Promise<NestPart | null> {
  try {
    const parsed = parseFilename(file.name);
    const dxfContent = await file.text();
    const geometry = parseDxfContent(dxfContent);

    // If DXF parsing fails, create a part with placeholder dimensions
    const l0Width = geometry?.l0Width ?? 500;
    const l0Height = geometry?.l0Height ?? 500;
    const l0Bbox = geometry?.l0Bbox ?? { x0: 0, y0: 0, x1: l0Width, y1: l0Height };
    const cutLines = geometry?.cutLines ?? [];
    const { cutWidth, cutHeight } = computeCutDimensions(l0Width, l0Height);

    if (!geometry) {
      console.warn(`Could not parse DXF geometry from ${file.name} — using default dimensions`);
    }

    return createNestPart({
      name: parsed.name,
      filename: file.name.replace(/\.[^.]+$/, ""),
      direction: parsed.direction,
      count: parsed.count,
      l0Width,
      l0Height,
      cutWidth,
      cutHeight,
      source: "custom-dxf",
      cutLines,
      l0Bbox,
      dxfContent,
    });
  } catch (e) {
    console.error(`Error creating NestPart from ${file.name}:`, e);
    // Last resort: create a fallback part from just the filename
    const parsed = parseFilename(file.name);
    return createNestPart({
      name: parsed.name,
      filename: file.name.replace(/\.[^.]+$/, ""),
      direction: parsed.direction,
      count: parsed.count,
      l0Width: 500,
      l0Height: 500,
      source: "custom-dxf",
    });
  }
}

// ── Create NestPart from sheet-metal geometry ──────────────────────────────

export function createNestPartFromGeometry(
  name: string,
  direction: PartDirection,
  count: number,
  l0Width: number,
  l0Height: number,
  cutLines: Segment[],
  designId?: string,
  dxfContent?: string,
): NestPart {
  const { cutWidth, cutHeight } = computeCutDimensions(l0Width, l0Height);

  return createNestPart({
    name,
    filename: direction ? `${name}_${direction}_x${count}` : `${name}_x${count}`,
    direction,
    count,
    l0Width,
    l0Height,
    cutWidth,
    cutHeight,
    source: "sheet-metal",
    cutLines,
    l0Bbox: { x0: 0, y0: 0, x1: l0Width, y1: l0Height },
    dxfContent,
    designId,
  });
}

// ── Create NestPart from a saved sheet-metal design ──────────────────────
//
// This bridges the sheet-metal design system to the nesting system.
// It regenerates the DXF geometry from the parametric model on the fly
// (no file storage needed — the model IS the source of truth).

export function createNestPartFromDesign(
  design: {
    id: string;
    name: string;
    exportName: string;
    model: SheetMetalModel;
  },
  overrides?: {
    count?: number;
    direction?: PartDirection;
  },
): NestPart {
  // Regenerate geometry from the parametric model — pure deterministic function
  const geometry = computeSheetMetalGeometry(design.model);
  const dxfContent = buildDxf(geometry, design.exportName, design.model);

  // The geometry bounds include offsetCut (e.g. 3mm margin on all sides).
  // Nesting expects l0Width/l0Height = the Layer 0 outline WITHOUT that margin, so
  // we subtract 2 * offsetCut to get the nominal part dimensions.
  const offsetCut = design.model.offsetCut ?? 3;
  const l0Width = geometry.totalWidth - 2 * offsetCut;
  const l0Height = geometry.totalHeight - 2 * offsetCut;

  // Extract CUT line segments from geometry.
  // In the geometry coordinate system, the L0 outline starts at (0, 0),
  // so no coordinate shift is needed — absolute coordinates are already
  // local-relative-to-L0-origin. CUT lines extend offsetCut beyond L0.
  const cutLines: Segment[] = geometry.shapes
    .filter((s) => s.layer === "CUT")
    .map((s) => ({
      x1: s.x1,
      y1: s.y1,
      x2: s.x2,
      y2: s.y2,
    }));

  // Determine direction from model metadata or arrow
  const direction: PartDirection =
    overrides?.direction ??
    (design.model.includeMetadata
      ? (SIDE_KEY_TO_DIR[design.model.arrowDirection] as PartDirection)
      : null);

  // Determine count from model metadata or override
  const count = overrides?.count ?? (design.model.includeMetadata ? (design.model.metadataCount || 1) : 1);

  return createNestPartFromGeometry(
    design.exportName,
    direction,
    count,
    l0Width,
    l0Height,
    cutLines,
    design.id,
    dxfContent,
  );
}