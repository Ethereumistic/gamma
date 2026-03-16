import {
  createEmptyModel,
  createFrezMeasurement,
  createFlangeMeasurement,
  type Preset,
  type SheetMetalModel,
} from "@/features/sheet-metal/types";

function makeModel(builder: (model: SheetMetalModel) => SheetMetalModel) {
  return builder(createEmptyModel());
}

export const presetLibrary: Preset[] = [
  {
    name: "Blank panel",
    description: "Base rectangle only. Start from zero operations.",
    model: createEmptyModel(),
  },
  {
    name: "Prototype relief",
    description: "Approximates the screenshot with one vertical and one horizontal relief.",
    model: makeModel((model) => ({
      ...model,
      baseWidth: 1040,
      baseHeight: 610,
      invertX: false,
      invertY: false,
      sides: {
        top: {
          flanges: [createFlangeMeasurement(26)],
          frezLines: [],
          frezMode: "inner",
        },
        right: {
          flanges: [createFlangeMeasurement(28)],
          frezLines: [],
          frezMode: "inner",
        },
        bottom: {
          flanges: [createFlangeMeasurement(142)],
          frezLines: [createFrezMeasurement(116, { start: true, end: true })],
          frezMode: "inner",
        },
        left: {
          flanges: [createFlangeMeasurement(30)],
          frezLines: [createFrezMeasurement(220, { start: true, end: true })],
          frezMode: "inner",
        },
      },
      cornerReliefs: {
        topLeft: { horizontal: false, vertical: false },
        topRight: { horizontal: false, vertical: false },
        bottomRight: { horizontal: false, vertical: false },
        bottomLeft: { horizontal: false, vertical: false },
      },
    })),
  },
];
