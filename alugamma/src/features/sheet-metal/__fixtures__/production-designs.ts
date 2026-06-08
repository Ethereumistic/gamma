// ────────────────────────────────────────────────────────────────────────────────
// Sheet-Metal — Production Design Fixtures
//
// Real production `SheetMetalModel` values, copy-pasted from Convex
// `designs` table rows. These models represent the two parts that the
// user explicitly approved for use as golden-test fixtures:
//
//   - "flappy-flaps" (jx78pewhfhd2xf5t7mjc3hq73d84cdjt) — square part
//     with bottom/left/right flanges (with reliefs + flaps) and a
//     single inner-frez line on top with spanStart + notch at the
//     right-hand end.  Tests: reliefs, flaps, inner frez with spans
//     and notches.
//
//   - "gabrovo" (jx743me73n9e80t30am5gdnq19853wa4) — wider part
//     (1000×500) with two stacked flanges on the left, two stacked
//     flanges on the right, and a single top flange that has a
//     HOLES pattern (two lines) and reliefs at both ends.  Tests:
//     multi-flange stacking, holes layer, top relief with flaps.
//
// These models are the source of truth for `dxf-golden.test.ts` and
// the polyline-closure algorithm tests. They are NOT modified when
// the test fixtures are regenerated — if you want to add new
// fixtures, append a new entry to `PRODUCTION_DESIGNS`.
//
// Exported shape mirrors `convex/designs.ts:getDesign` so that tests
// can pass them straight into `computeSheetMetalGeometry`.
// ────────────────────────────────────────────────────────────────────────────────

import type { SheetMetalModel } from "@/features/sheet-metal/types";

export type ProductionDesignFixture = {
  id: string;
  name: string;
  exportName: string;
  model: SheetMetalModel;
};

// ── Fixture 1: flappy-flaps ──────────────────────────────────────────────────

const flappyFlaps: SheetMetalModel = {
  baseWidth: 500,
  baseHeight: 500,
  offsetCut: 3,
  invertX: false,
  invertY: false,
  includeName: true,
  includeArrow: true,
  arrowDirection: "top",
  includeMetadata: false,
  metadataCount: 8,
  rubberband: false,
  sides: {
    bottom: {
      frezMode: "inner",
      flanges: [
        {
          id: "m-7",
          amount: 120,
          reliefs: { start: true, end: false },
          flaps: { start: 20, end: 0 },
        },
      ],
      frezLines: [],
      innerFrezLines: [],
    },
    left: {
      frezMode: "inner",
      flanges: [
        {
          id: "m-8",
          amount: 120,
          reliefs: { start: false, end: false },
          flaps: { start: 0, end: 0 },
        },
      ],
      frezLines: [],
      innerFrezLines: [],
    },
    right: {
      frezMode: "inner",
      flanges: [
        {
          id: "m-9",
          amount: 20,
          reliefs: { start: false, end: true },
          flaps: { start: 0, end: 0 },
        },
      ],
      frezLines: [],
      innerFrezLines: [],
    },
    top: {
      frezMode: "inner",
      flanges: [],
      frezLines: [],
      innerFrezLines: [
        {
          id: "m-7",
          amount: 44,
          notches: { start: false, end: true },
          spanStart: true,
        },
      ],
    },
  },
  cornerReliefs: {
    topLeft: { horizontal: false, vertical: false },
    topRight: { horizontal: false, vertical: false },
    bottomRight: { horizontal: false, vertical: false },
    bottomLeft: { horizontal: false, vertical: false },
  },
};

// ── Fixture 2: gabrovo ───────────────────────────────────────────────────────

const gabrovo: SheetMetalModel = {
  baseWidth: 1000,
  baseHeight: 500,
  offsetCut: 3,
  invertX: false,
  invertY: false,
  includeName: true,
  includeArrow: true,
  arrowDirection: "top",
  includeMetadata: false,
  metadataCount: 20,
  rubberband: true,
  sides: {
    bottom: {
      frezMode: "inner",
      flanges: [],
      frezLines: [],
      innerFrezLines: [],
    },
    left: {
      frezMode: "inner",
      flanges: [
        {
          id: "m-1776507120317",
          amount: 20,
          reliefs: { start: false, end: false },
          flaps: { start: 0, end: 0 },
        },
        {
          id: "m-1776507120318",
          amount: 50,
          reliefs: { start: false, end: false },
          flaps: { start: 0, end: 0 },
        },
      ],
      frezLines: [],
      innerFrezLines: [],
    },
    right: {
      frezMode: "inner",
      flanges: [
        {
          id: "m-1776507120320",
          amount: 25,
          reliefs: { start: false, end: false },
          flaps: { start: 0, end: 0 },
        },
        {
          id: "m-1776507120321",
          amount: 20,
          reliefs: { start: false, end: false },
          flaps: { start: 0, end: 0 },
        },
      ],
      frezLines: [],
      innerFrezLines: [],
    },
    top: {
      frezMode: "inner",
      flanges: [
        {
          id: "m-1776507120316",
          amount: 60,
          reliefs: { start: true, end: true },
          flaps: { start: 0, end: 0 },
          holes: {
            enabled: true,
            placement: "inner",
            orientation: "horizontal",
            sideOffset: 25,
            endOffset: 25,
            length: 25,
            line1Enabled: true,
            line2Enabled: true,
          },
        },
      ],
      frezLines: [],
      innerFrezLines: [],
    },
  },
  cornerReliefs: {
    topLeft: { horizontal: false, vertical: false },
    topRight: { horizontal: false, vertical: false },
    bottomRight: { horizontal: false, vertical: false },
    bottomLeft: { horizontal: false, vertical: false },
  },
};

// ── Exported list ────────────────────────────────────────────────────────────

export const PRODUCTION_DESIGNS: ProductionDesignFixture[] = [
  {
    id: "jx78pewhfhd2xf5t7mjc3hq73d84cdjt",
    name: "flappy-flaps",
    exportName: "flappy-flaps_T_x8",
    model: flappyFlaps,
  },
  {
    id: "jx743me73n9e80t30am5gdnq19853wa4",
    name: "gabrovo",
    exportName: "gabrovo_T_x20",
    model: gabrovo,
  },
];
