export const sideKeys = ["top", "right", "bottom", "left"] as const;
export const cornerKeys = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;

export type SideKey = (typeof sideKeys)[number];
export type CornerKey = (typeof cornerKeys)[number];
export type Layer = "CUT" | "FREZ" | "0" | "HOLES";
export type FrezMode = "inner" | "outer";
export type CornerReliefAxis = "horizontal" | "vertical";
export type FrezNotchPosition = "start" | "end";

export type Measurement = {
  id: string;
  amount: number;
};

export type HoleSettings = {
  placement: "inner" | "outer";
  orientation: "horizontal" | "vertical";
  sideOffset: number;
  endOffset: number;
  length: number;
};

export type HoleData = HoleSettings & {
  enabled: boolean;
  /** Whether the first hole line is rendered (Q toggles this when holes chip is focused) */
  line1Enabled?: boolean;
  /** Whether the second hole line is rendered (E toggles this when holes chip is focused) */
  line2Enabled?: boolean;
};

export type FrezLineNotches = {
  start: boolean;
  end: boolean;
};

export type FrezMeasurement = Measurement & {
  notches: FrezLineNotches;
  /** Whether the inner frez line extends into the start-side adjacent flange area */
  spanStart?: boolean;
  /** Whether the inner frez line extends into the end-side adjacent flange area */
  spanEnd?: boolean;
  holes?: HoleData;
};

export type FlangeReliefs = {
  start: boolean;
  end: boolean;
};

export type FlangeFlaps = {
  start: number;
  end: number;
};

export type FlangeMeasurement = Measurement & {
  reliefs: FlangeReliefs;
  flaps: FlangeFlaps;
  holes?: HoleData;
};

export type SideConfig = {
  flanges: FlangeMeasurement[];
  frezLines: FrezMeasurement[];
  frezMode: FrezMode;
  innerFrezLines: FrezMeasurement[];
};

export type CornerReliefAxes = {
  horizontal: boolean;
  vertical: boolean;
};

export type SheetMetalModel = {
  baseWidth: number;
  baseHeight: number;
  invertX: boolean;
  invertY: boolean;
  offsetCut: number;
  includeName: boolean;
  includeArrow: boolean;
  arrowDirection: SideKey;
  /** When true, export filename includes direction & count suffix: name_T_x18.dxf */
  includeMetadata: boolean;
  /** How many copies of this sheet part (used in filename suffix when includeMetadata is on) */
  metadataCount: number;
  sides: Record<SideKey, SideConfig>;
  cornerReliefs: Record<CornerKey, CornerReliefAxes>;
  rubberband: boolean;
};

/** Map from sheet-metal SideKey to nesting direction code for filenames */
export const SIDE_KEY_TO_DIR: Record<SideKey, string> = {
  top: "T",
  right: "R",
  bottom: "B",
  left: "L",
};

/** Reverse map: nesting direction code → sheet-metal SideKey */
export const DIR_TO_SIDE_KEY: Record<string, SideKey> = {
  T: "top",
  R: "right",
  B: "bottom",
  L: "left",
};

export type Rect = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type LineShape = {
  type: "line";
  layer: Layer;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type GeometryResult = {
  shapes: LineShape[];
  baseRect: Rect;
  bounds: Rect;
  totalWidth: number;
  totalHeight: number;
  flangeDepths: Record<SideKey, number>;
  frezOffsets: Record<SideKey, number[]>;
  warnings: string[];
};

export type Preset = {
  name: string;
  description: string;
  model: SheetMetalModel;
};

let measurementCounter = Date.now();

function nextMeasurementId() {
  measurementCounter += 1;
  return `m-${measurementCounter}`;
}

export function createDefaultHoleSettings(): HoleSettings {
  return {
    placement: "inner",
    orientation: "horizontal",
    sideOffset: 25,
    endOffset: 25,
    length: 25,
  };
}

export function createFlangeMeasurement(amount = 20, reliefs?: Partial<FlangeReliefs>, flaps?: Partial<FlangeFlaps>): FlangeMeasurement {
  return {
    id: nextMeasurementId(),
    amount,
    reliefs: {
      start: reliefs?.start ?? false,
      end: reliefs?.end ?? false,
    },
    flaps: {
      start: flaps?.start ?? 0,
      end: flaps?.end ?? 0,
    },
  };
}

export function createFrezMeasurement(amount = 24, notches?: Partial<FrezLineNotches>): FrezMeasurement {
  return {
    id: nextMeasurementId(),
    amount,
    notches: {
      start: notches?.start ?? false,
      end: notches?.end ?? false,
    },
  };
}

export function createEmptySide(): SideConfig {
  return {
    flanges: [],
    frezLines: [],
    frezMode: "inner",
    innerFrezLines: [],
  };
}

export function createInnerFrezMeasurement(amount = 24): FrezMeasurement {
  return {
    id: nextMeasurementId(),
    amount,
    notches: { start: false, end: false },
    spanStart: false,
    spanEnd: false,
  };
}

export function createEmptyCornerRelief(): CornerReliefAxes {
  return {
    horizontal: false,
    vertical: false,
  };
}

export function createEmptyModel(): SheetMetalModel {
  return {
    baseWidth: 900,
    baseHeight: 520,
    invertX: false,
    invertY: false,
    offsetCut: 3,
    includeName: true,
    includeArrow: true,
    arrowDirection: "top",
    includeMetadata: false,
    metadataCount: 1,
    sides: {
      top: createEmptySide(),
      right: createEmptySide(),
      bottom: createEmptySide(),
      left: createEmptySide(),
    },
    cornerReliefs: {
      topLeft: createEmptyCornerRelief(),
      topRight: createEmptyCornerRelief(),
      bottomRight: createEmptyCornerRelief(),
      bottomLeft: createEmptyCornerRelief(),
    },
    rubberband: true,
  };
}

function normalizeMeasurement(value: unknown, fallbackAmount = 0): Measurement {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return {
      id: typeof record.id === "string" ? record.id : nextMeasurementId(),
      amount: typeof record.amount === "number" ? record.amount : fallbackAmount,
    };
  }

  return {
    id: nextMeasurementId(),
    amount: fallbackAmount,
  };
}

export function normalizeHoleData(value: unknown): HoleData | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if ("enabled" in record) {
      return {
        enabled: record.enabled === true,
        placement: record.placement === "outer" ? "outer" : "inner",
        orientation: record.orientation === "vertical" ? "vertical" : "horizontal",
        sideOffset: typeof record.sideOffset === "number" ? record.sideOffset : 25,
        endOffset: typeof record.endOffset === "number" ? record.endOffset : 25,
        length: typeof record.length === "number" ? record.length : 25,
        line1Enabled: typeof record.line1Enabled === "boolean" ? record.line1Enabled : true,
        line2Enabled: typeof record.line2Enabled === "boolean" ? record.line2Enabled : true,
      };
    }
  }
  return undefined;
}

export function normalizeFlangeReliefs(value: unknown, fallbackEnabled = false): FlangeReliefs {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if ("start" in record || "end" in record) {
      return {
        start: record.start === true,
        end: record.end === true,
      };
    }
  }

  return {
    start: fallbackEnabled,
    end: fallbackEnabled,
  };
}

export function normalizeFlangeFlaps(value: unknown, fallbackAmount = 0): FlangeFlaps {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if ("start" in record || "end" in record) {
      return {
        start: typeof record.start === "number" ? record.start : fallbackAmount,
        end: typeof record.end === "number" ? record.end : fallbackAmount,
      };
    }
  }

  return {
    start: fallbackAmount,
    end: fallbackAmount,
  };
}

export function normalizeFlangeMeasurement(value: unknown): FlangeMeasurement {
  const measurement = normalizeMeasurement(value, 20);

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return {
      ...measurement,
      reliefs: normalizeFlangeReliefs(record.reliefs, false),
      flaps: normalizeFlangeFlaps(record.flaps, 0),
      holes: normalizeHoleData(record.holes),
    };
  }

  return {
    ...measurement,
    reliefs: normalizeFlangeReliefs(undefined, false),
    flaps: normalizeFlangeFlaps(undefined, 0),
    holes: undefined,
  };
}

export function normalizeFrezLineNotches(value: unknown, fallbackEnabled = true): FrezLineNotches {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if ("start" in record || "end" in record) {
      return {
        start: record.start === true,
        end: record.end === true,
      };
    }
  }

  return {
    start: fallbackEnabled,
    end: fallbackEnabled,
  };
}

export function normalizeFrezMeasurement(value: unknown): FrezMeasurement {
  const measurement = normalizeMeasurement(value, 24);

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return {
      ...measurement,
      notches: normalizeFrezLineNotches(record.notches, true),
      spanStart: record.spanStart === true,
      spanEnd: record.spanEnd === true,
      holes: normalizeHoleData(record.holes),
    };
  }

  return {
    ...measurement,
    notches: normalizeFrezLineNotches(undefined, true),
    spanStart: false,
    spanEnd: false,
    holes: undefined,
  };
}

export function normalizeCornerReliefAxes(value: unknown): CornerReliefAxes {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if ("horizontal" in record || "vertical" in record) {
      return {
        horizontal: record.horizontal === true,
        vertical: record.vertical === true,
      };
    }
  }

  if (value === "horizontal" || value === true) {
    return { horizontal: true, vertical: false };
  }

  if (value === "vertical") {
    return { horizontal: false, vertical: true };
  }

  return createEmptyCornerRelief();
}

function normalizeSideConfig(value: unknown): SideConfig {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const flanges = Array.isArray(record.flanges) ? record.flanges.map((item) => normalizeFlangeMeasurement(item)) : [];
    const frezLines = Array.isArray(record.frezLines)
      ? record.frezLines.map((item) => normalizeFrezMeasurement(item))
      : [];
    const innerFrezLines = Array.isArray(record.innerFrezLines)
      ? record.innerFrezLines.map((item) => normalizeFrezMeasurement(item))
      : [];

    return {
      flanges,
      frezLines,
      frezMode: record.frezMode === "outer" ? "outer" : "inner",
      innerFrezLines,
    };
  }

  return createEmptySide();
}

export function normalizeSheetMetalModel(model: SheetMetalModel): SheetMetalModel {
  return {
    ...model,
    offsetCut: typeof model.offsetCut === "number" ? model.offsetCut : 3,
    includeName: typeof model.includeName === "boolean" ? model.includeName : true,
    includeArrow: typeof model.includeArrow === "boolean" ? model.includeArrow : true,
    arrowDirection: sideKeys.includes(model.arrowDirection) ? model.arrowDirection : "top",
    includeMetadata: typeof model.includeMetadata === "boolean" ? model.includeMetadata : false,
    metadataCount: typeof model.metadataCount === "number" && model.metadataCount >= 1 ? Math.round(model.metadataCount) : 1,
    sides: {
      top: normalizeSideConfig(model.sides.top),
      right: normalizeSideConfig(model.sides.right),
      bottom: normalizeSideConfig(model.sides.bottom),
      left: normalizeSideConfig(model.sides.left),
    },
    cornerReliefs: {
      topLeft: normalizeCornerReliefAxes(model.cornerReliefs.topLeft),
      topRight: normalizeCornerReliefAxes(model.cornerReliefs.topRight),
      bottomRight: normalizeCornerReliefAxes(model.cornerReliefs.bottomRight),
      bottomLeft: normalizeCornerReliefAxes(model.cornerReliefs.bottomLeft),
    },
    rubberband: typeof model.rubberband === "boolean" ? model.rubberband : true,
  };
}

export type FeatureKind = "flange" | "innerFrez" | "holes";

export type FeatureRef = {
  kind: FeatureKind;
  /** Index into the respective array (flanges[] or innerFrezLines[]) */
  arrayIndex: number;
  /** 1-based unified position across all features on this side */
  position: number;
  id: string;
  /** For holes entries: reference back to the parent feature kind */
  parentKind?: "flange" | "innerFrez";
};

export function getUnifiedFeatures(side: SideConfig): FeatureRef[] {
  const items: { kind: FeatureKind; arrayIndex: number; id: string; parentKind?: "flange" | "innerFrez" }[] = [];
  for (let i = 0; i < side.flanges.length; i++) {
    items.push({ kind: "flange", arrayIndex: i, id: side.flanges[i].id });
    if (side.flanges[i].holes?.enabled) {
      items.push({ kind: "holes", arrayIndex: i, id: side.flanges[i].id + "-holes", parentKind: "flange" });
    }
  }
  for (let i = 0; i < side.innerFrezLines.length; i++) {
    items.push({ kind: "innerFrez", arrayIndex: i, id: side.innerFrezLines[i].id });
    if (side.innerFrezLines[i].holes?.enabled) {
      items.push({ kind: "holes", arrayIndex: i, id: side.innerFrezLines[i].id + "-holes", parentKind: "innerFrez" });
    }
  }
  items.sort((a, b) => {
    const numA = parseInt(a.id.replace(/-holes$/, "").replace(/\D/g, ""), 10) || 0;
    const numB = parseInt(b.id.replace(/-holes$/, "").replace(/\D/g, ""), 10) || 0;
    // Same base ID: parent comes before holes
    if (numA === numB) {
      if (a.kind === "holes" && b.kind !== "holes") return 1;
      if (a.kind !== "holes" && b.kind === "holes") return -1;
    }
    return numA - numB;
  });
  return items.map((item, index) => ({
    ...item,
    position: index + 1,
  }));
}

export function getFeatureByPosition(side: SideConfig, position: number): FeatureRef | null {
  return getUnifiedFeatures(side).find(f => f.position === position) ?? null;
}
