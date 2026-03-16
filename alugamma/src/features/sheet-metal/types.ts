export const sideKeys = ["top", "right", "bottom", "left"] as const;
export const cornerKeys = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;

export type SideKey = (typeof sideKeys)[number];
export type CornerKey = (typeof cornerKeys)[number];
export type Layer = "CUT" | "FREZ" | "0";
export type FrezMode = "inner" | "outer";
export type CornerReliefAxis = "horizontal" | "vertical";
export type FrezNotchPosition = "start" | "end";

export type Measurement = {
  id: string;
  amount: number;
};

export type FrezLineNotches = {
  start: boolean;
  end: boolean;
};

export type FrezMeasurement = Measurement & {
  notches: FrezLineNotches;
};

export type FlangeReliefs = {
  start: boolean;
  end: boolean;
};

export type FlangeMeasurement = Measurement & {
  reliefs: FlangeReliefs;
};

export type SideConfig = {
  flanges: FlangeMeasurement[];
  frezLines: FrezMeasurement[];
  frezMode: FrezMode;
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
  sides: Record<SideKey, SideConfig>;
  cornerReliefs: Record<CornerKey, CornerReliefAxes>;
  rubberband: boolean;
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

let measurementCounter = 0;

function nextMeasurementId() {
  measurementCounter += 1;
  return `m-${measurementCounter}`;
}

export function createFlangeMeasurement(amount = 20, reliefs?: Partial<FlangeReliefs>): FlangeMeasurement {
  return {
    id: nextMeasurementId(),
    amount,
    reliefs: {
      start: reliefs?.start ?? false,
      end: reliefs?.end ?? false,
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

export function normalizeFlangeMeasurement(value: unknown): FlangeMeasurement {
  const measurement = normalizeMeasurement(value, 20);

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return {
      ...measurement,
      reliefs: normalizeFlangeReliefs(record.reliefs, false),
    };
  }

  return {
    ...measurement,
    reliefs: normalizeFlangeReliefs(undefined, false),
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
    };
  }

  return {
    ...measurement,
    notches: normalizeFrezLineNotches(undefined, true),
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

    return {
      flanges,
      frezLines,
      frezMode: record.frezMode === "outer" ? "outer" : "inner",
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
