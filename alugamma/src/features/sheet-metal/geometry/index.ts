/**
 * geometry/index.ts — Barrel export for the geometry module.
 */

export { EPS, clamp, isNearlyEqual, sumMeasurements, getCumulativeOffsets, getFlangeDepths, getFrezOffsets, getResolvedFrezPositions, getCornerShoulderOffset, collectWarnings } from "./math";
export { type HorizontalNotch, type VerticalNotch, type NotchArrays, addFrezDrivenHorizontalNotches, addFrezDrivenVerticalNotches, offsetHorizontalNotches, offsetVerticalNotches } from "./notches";
export { addLine, addHorizontalCutEdge, addVerticalCutEdge, clipHorizontalSpan, clipVerticalSpan } from "./edges";
export { addHoleLines, processHoles } from "./holes";
export { isInsideMetalHorizontal, isInsideMetalVertical, getHorizontalCritXs, getVerticalCritYs, addTrimmableHorizontalLine, addTrimmableVerticalLine, addTrimmableDiagonalLine } from "./trim";