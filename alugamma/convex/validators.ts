import { v } from "convex/values";

export const organizationRoleValidator = v.union(v.literal("owner"), v.literal("admin"), v.literal("member"));
export const projectRoleValidator = v.union(v.literal("owner"), v.literal("editor"));
export const inviteStatusValidator = v.union(v.literal("pending"), v.literal("accepted"), v.literal("revoked"), v.literal("expired"), v.literal("declined"));
export const frezModeValidator = v.union(v.literal("inner"), v.literal("outer"));
export const cornerReliefAxesValidator = v.object({
  horizontal: v.boolean(),
  vertical: v.boolean(),
});
export const cornerReliefEntryValidator = v.union(
  cornerReliefAxesValidator,
  v.literal("none"),
  v.literal("horizontal"),
  v.literal("vertical"),
  v.boolean(),
);
export const frezLineNotchesValidator = v.object({
  start: v.boolean(),
  end: v.boolean(),
});
export const measurementValidator = v.object({
  id: v.string(),
  amount: v.number(),
});
export const flangeReliefsValidator = v.object({
  start: v.boolean(),
  end: v.boolean(),
});
export const flangeMeasurementValidator = v.union(
  measurementValidator,
  v.object({
    id: v.string(),
    amount: v.number(),
    reliefs: flangeReliefsValidator,
    flaps: v.optional(
      v.object({
        start: v.optional(v.number()),
        end: v.optional(v.number()),
      }),
    ),
  }),
);
export const frezMeasurementValidator = v.union(
  measurementValidator,
  v.object({
    id: v.string(),
    amount: v.number(),
    notches: frezLineNotchesValidator,
    spanStart: v.optional(v.boolean()),
    spanEnd: v.optional(v.boolean()),
  }),
);

export const projectDefaultsValidator = v.object({
  baseWidth: v.number(),
  baseHeight: v.number(),
  offsetCut: v.number(),
  flangeDefaults: v.object({
    count1: v.array(v.number()),
    count2: v.array(v.number()),
    count3: v.array(v.number()),
  }),
  frezDefaults: v.object({
    count1: v.array(v.number()),
    count2: v.array(v.number()),
    count3: v.array(v.number()),
  }),
  holeDefaults: v.optional(v.object({
    placement: v.union(v.literal("inner"), v.literal("outer")),
    orientation: v.union(v.literal("horizontal"), v.literal("vertical")),
    sideOffset: v.number(),
    endOffset: v.number(),
    length: v.number(),
  })),
});

export const sideConfigValidator = v.object({
  flanges: v.array(flangeMeasurementValidator),
  frezLines: v.array(frezMeasurementValidator),
  frezMode: frezModeValidator,
  innerFrezLines: v.optional(v.array(frezMeasurementValidator)),
});

export const sheetModelValidator = v.object({
  baseWidth: v.number(),
  baseHeight: v.number(),
  invertX: v.boolean(),
  invertY: v.boolean(),
  offsetCut: v.optional(v.number()),
  includeName: v.optional(v.boolean()),
  includeArrow: v.optional(v.boolean()),
  arrowDirection: v.optional(v.union(v.literal("top"), v.literal("right"), v.literal("bottom"), v.literal("left"))),
  sides: v.object({
    top: sideConfigValidator,
    right: sideConfigValidator,
    bottom: sideConfigValidator,
    left: sideConfigValidator,
  }),
  cornerReliefs: v.object({
    topLeft: cornerReliefEntryValidator,
    topRight: cornerReliefEntryValidator,
    bottomRight: cornerReliefEntryValidator,
    bottomLeft: cornerReliefEntryValidator,
  }),
  rubberband: v.optional(v.boolean()),
});
