import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useMutation, useQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { buildDxf } from "@/features/sheet-metal/dxf";
import { computeSheetMetalGeometry } from "@/features/sheet-metal/geometry";
import { presetLibrary } from "@/features/sheet-metal/presets";
import {
  createFrezMeasurement,
  createFlangeMeasurement,
  normalizeSheetMetalModel,
  type CornerKey,
  type CornerReliefAxis,
  type FrezMode,
  type FrezNotchPosition,
  type Measurement,
  type SheetMetalModel,
  type SideKey,
} from "@/features/sheet-metal/types";
import { useWorkspace } from "@/features/workspace/context";

function replaceMeasurement<T extends { amount: number }>(items: T[], index: number, amount: number) {
  return items.map((item, itemIndex) =>
    itemIndex === index ? { ...item, amount: Math.max(0, Math.round(amount)) } : item,
  );
}

function removeMeasurement<T>(items: T[], index: number) {
  return items.filter((_, itemIndex) => itemIndex !== index);
}

type SavedDesignSummary = {
  id: Id<"designs">;
  name: string;
  exportName: string;
  model: SheetMetalModel;
  createdAt: number;
  updatedAt: number;
  lastExportedAt: number | null;
  isStarred: boolean;
  updatedByName: string;
};

type SheetMetalStatus = {
  tone: "info" | "success" | "error";
  message: string;
};

type SheetMetalContextType = {
  model: SheetMetalModel;
  designName: string;
  setDesignName: (name: string) => void;
  geometry: ReturnType<typeof computeSheetMetalGeometry>;
  selectedDesignId: Id<"designs"> | null;
  savedDesigns: SavedDesignSummary[];
  isSaving: boolean;
  setBaseValue: (key: "baseWidth" | "baseHeight", value: number) => void;
  setOffsetCut: (value: number) => void;
  setIncludeName: (value: boolean) => void;
  setIncludeArrow: (value: boolean) => void;
  setArrowDirection: (direction: SideKey) => void;
  setInvert: (axis: "invertX" | "invertY", value: boolean) => void;
  addFlange: (side: SideKey) => void;
  addFrez: (side: SideKey) => void;
  updateFlange: (side: SideKey, index: number, amount: number) => void;
  updateFrez: (side: SideKey, index: number, amount: number) => void;
  removeFlange: (side: SideKey, index: number) => void;
  removeFrez: (side: SideKey, index: number) => void;
  setFrezMode: (side: SideKey, mode: FrezMode) => void;
  setFrezNotch: (side: SideKey, index: number, position: FrezNotchPosition, value: boolean) => void;
  setFlangeRelief: (side: SideKey, index: number, position: "start" | "end", value: boolean) => void;
  setCornerRelief: (corner: CornerKey, axis: CornerReliefAxis, value: boolean) => void;
  loadPreset: (index: number) => void;
  startNewDesign: () => void;
  loadSavedDesign: (designId: Id<"designs">) => void;
  saveDesign: (options?: { markExported?: boolean }) => Promise<Id<"designs"> | null>;
  exportDxf: () => Promise<Id<"designs"> | null>;
  setRubberband: (value: boolean) => void;
  undo: () => void;
};

const SheetMetalContext = createContext<SheetMetalContextType | null>(null);

function cloneModel(model: SheetMetalModel) {
  return structuredClone(normalizeSheetMetalModel(model));
}

function buildPresetDraft(index: number) {
  const preset = presetLibrary[index] ?? presetLibrary[0];

  return {
    model: cloneModel(preset.model),
    designName: preset.name,
  };
}

function sanitizeFileName(name: string) {
  return name.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "-") || "alugamma";
}

export function useSheetMetal() {
  const context = useContext(SheetMetalContext);
  if (!context) {
    throw new Error("useSheetMetal must be used within a SheetMetalProvider");
  }
  return context;
}

export function SheetMetalProvider({ children }: { children: ReactNode }) {
  const { selectedProjectId, selectedProject } = useWorkspace();
  const defaultDraft = buildPresetDraft(1);
  const [model, setRawModel] = useState<SheetMetalModel>(() => defaultDraft.model);
  const [history, setHistory] = useState<SheetMetalModel[]>([]);

  const setModel = (value: React.SetStateAction<SheetMetalModel>) => {
    setRawModel((current) => {
      const nextModel = typeof value === "function" ? (value as any)(current) : value;
      if (nextModel !== current) {
        setHistory((prev) => {
          const h = [...prev, current];
          if (h.length > 50) h.shift();
          return h;
        });
      }
      return nextModel;
    });
  };

  function undo() {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const h = [...prev];
      const last = h.pop()!;
      setRawModel(last);
      return h;
    });
  }
  const [designName, setDesignName] = useState(defaultDraft.designName);
  const [selectedDesignId, setSelectedDesignId] = useState<Id<"designs"> | null>(null);
  const [isNewDesign, setIsNewDesign] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const saveDesignMutation = useMutation(api.designs.saveDesign);
  const rawSavedDesigns =
    (useQuery(api.designs.listByProject, selectedProjectId ? { projectId: selectedProjectId } : "skip") as
      | SavedDesignSummary[]
      | undefined) ?? [];
  const savedDesigns = useMemo(
    () => rawSavedDesigns.map((design) => ({ ...design, model: normalizeSheetMetalModel(design.model) })),
    [rawSavedDesigns],
  );
  const geometry = computeSheetMetalGeometry(model);

  function applyProjectDefaults(draftModel: SheetMetalModel) {
    if (!selectedProject?.defaults) return draftModel;
    const def = selectedProject.defaults;
    return {
      ...draftModel,
      baseWidth: def.baseWidth,
      baseHeight: def.baseHeight,
      offsetCut: def.offsetCut,
    };
  }

  useEffect(() => {
    const nextDraft = selectedProjectId ? buildPresetDraft(0) : buildPresetDraft(1);
    setRawModel(applyProjectDefaults(nextDraft.model));
    setHistory([]);
    setDesignName(nextDraft.designName);
    setSelectedDesignId(null);
    setIsNewDesign(true);
  }, [selectedProjectId, selectedProject?.defaults]);

  function setBaseValue(key: "baseWidth" | "baseHeight", value: number) {
    setModel((current) => ({
      ...current,
      [key]: Math.max(1, Math.round(value)),
    }));
  }

  function setInvert(axis: "invertX" | "invertY", value: boolean) {
    setModel((current) => ({
      ...current,
      [axis]: value,
    }));
  }

  function setOffsetCut(value: number) {
    setModel((current) => ({
      ...current,
      offsetCut: value,
    }));
  }

  function setIncludeName(value: boolean) {
    setModel((current) => ({
      ...current,
      includeName: value,
    }));
  }

  function setIncludeArrow(value: boolean) {
    setModel((current) => ({
      ...current,
      includeArrow: value,
    }));
  }

  function setArrowDirection(direction: SideKey) {
    setModel((current) => ({
      ...current,
      arrowDirection: direction,
    }));
  }

  function patchSide(
    side: SideKey,
    updater: (draft: SheetMetalModel["sides"][SideKey]) => SheetMetalModel["sides"][SideKey],
  ) {
    setModel((current) => ({
      ...current,
      sides: { ...current.sides, [side]: updater(current.sides[side]) },
    }));
  }

  function addFlange(side: SideKey) {
    patchSide(side, (draft) => {
      const newCount = draft.flanges.length + 1;

      const defaults = selectedProject?.defaults?.flangeDefaults;
      const presets = [
        defaults?.count1 ?? [20],
        defaults?.count2 ?? [25, 20],
        defaults?.count3 ?? [60, 40, 20],
      ];

      if (newCount <= presets.length) {
        const newPreset = presets[newCount - 1];
        const prevPreset = newCount > 1 ? presets[newCount - 2] : [];

        // Check if all existing flanges still match the previous preset's amounts.
        // If they do, the user hasn't customized them — apply the full new preset.
        // If any amount diverges, the user typed something custom — preserve it and
        // only append a new flange with the last slot's default.
        const existingMatchPreset = draft.flanges.every(
          (f, i) => f.amount === (prevPreset[i] ?? 0)
        );

        if (existingMatchPreset) {
          const updatedFlanges = newPreset.map((amount, i) =>
            i < draft.flanges.length
              ? { ...draft.flanges[i], amount }
              : createFlangeMeasurement(amount)
          );
          return { ...draft, flanges: updatedFlanges };
        }
      }

      // User has custom amounts or we're beyond preset range — just append with a sensible default.
      const newFlangeAmount =
        newCount <= presets.length
          ? (presets[newCount - 1][newCount - 1] ?? 20)
          : 20;
      return { ...draft, flanges: [...draft.flanges, createFlangeMeasurement(newFlangeAmount)] };
    });
  }

  function addFrez(side: SideKey) {
    patchSide(side, (draft) => {
      const newCount = draft.frezLines.length + 1;

      const defaults = selectedProject?.defaults?.frezDefaults;
      const presets = [
        defaults?.count1 ?? [24],
        defaults?.count2 ?? [24, 24],
        defaults?.count3 ?? [24, 24, 24],
      ];

      if (newCount <= presets.length) {
        const newPreset = presets[newCount - 1];
        const prevPreset = newCount > 1 ? presets[newCount - 2] : [];

        const existingMatchPreset = draft.frezLines.every(
          (f, i) => f.amount === (prevPreset[i] ?? 0)
        );

        if (existingMatchPreset) {
          const updatedFrez = newPreset.map((amount, i) =>
            i < draft.frezLines.length
              ? { ...draft.frezLines[i], amount }
              : createFrezMeasurement(amount)
          );
          return { ...draft, frezLines: updatedFrez };
        }
      }

      const newFrezAmount =
        newCount <= presets.length
          ? (presets[newCount - 1][newCount - 1] ?? 24)
          : 24;
      return { ...draft, frezLines: [...draft.frezLines, createFrezMeasurement(newFrezAmount)] };
    });
  }

  function updateFlange(side: SideKey, index: number, amount: number) {
    patchSide(side, (draft) => ({ ...draft, flanges: replaceMeasurement(draft.flanges, index, amount) }));
  }

  function updateFrez(side: SideKey, index: number, amount: number) {
    patchSide(side, (draft) => ({ ...draft, frezLines: replaceMeasurement(draft.frezLines, index, amount) }));
  }

  function removeFlange(side: SideKey, index: number) {
    patchSide(side, (draft) => ({ ...draft, flanges: removeMeasurement(draft.flanges, index) }));
  }

  function removeFrez(side: SideKey, index: number) {
    patchSide(side, (draft) => ({ ...draft, frezLines: removeMeasurement(draft.frezLines, index) }));
  }

  function setFrezMode(side: SideKey, mode: FrezMode) {
    patchSide(side, (draft) => ({ ...draft, frezMode: mode }));
  }

  function setFrezNotch(side: SideKey, index: number, position: FrezNotchPosition, value: boolean) {
    patchSide(side, (draft) => ({
      ...draft,
      frezLines: draft.frezLines.map((line, lineIndex) =>
        lineIndex === index
          ? {
            ...line,
            notches: {
              ...line.notches,
              [position]: value,
            },
          }
          : line,
      ),
    }));
  }

  function setFlangeRelief(side: SideKey, index: number, position: "start" | "end", value: boolean) {
    patchSide(side, (draft) => ({
      ...draft,
      flanges: draft.flanges.map((flange, flangeIndex) =>
        flangeIndex === index
          ? {
            ...flange,
            reliefs: {
              ...flange.reliefs,
              [position]: value,
            },
          }
          : flange,
      ),
    }));
  }

  function setCornerRelief(corner: CornerKey, axis: CornerReliefAxis, value: boolean) {
    setModel((current) => ({
      ...current,
      cornerReliefs: {
        ...current.cornerReliefs,
        [corner]: {
          ...current.cornerReliefs[corner],
          [axis]: value,
        },
      },
    }));
  }

  function setRubberband(value: boolean) {
    setModel((current) => ({
      ...current,
      rubberband: value,
    }));
  }

  function loadPreset(index: number) {
    const draft = buildPresetDraft(index);
    setRawModel(draft.model);
    setHistory([]);
    setDesignName(draft.designName);
    setSelectedDesignId(null);
    toast.info(`Loaded preset "${draft.designName}".`);
  }

  function startNewDesign() {
    const draft = buildPresetDraft(0);
    setRawModel(applyProjectDefaults(draft.model));
    setHistory([]);
    setDesignName(draft.designName);
    setSelectedDesignId(null);
    setIsNewDesign(true);
    toast.info("Started a new blank design draft.");
  }

  function loadSavedDesign(designId: Id<"designs">) {
    const design = savedDesigns.find((item) => item.id === designId);

    if (!design) {
      toast.error("Saved design not found in the selected project.");
      return;
    }

    setRawModel(cloneModel(design.model));
    setHistory([]);
    setDesignName(design.name);
    setSelectedDesignId(design.id);
    setIsNewDesign(false);
    toast.success(`Loaded "${design.name}".`);
  }

  async function saveDesign(options?: { markExported?: boolean }) {
    if (!selectedProjectId) {
      toast.error("Select a project before saving or exporting.");
      return null;
    }

    const trimmedDesignName = designName.trim();

    if (trimmedDesignName.length < 2) {
      toast.error("Design name must be at least 2 characters.");
      return null;
    }

    const normalizedModel = normalizeSheetMetalModel(model);

    setIsSaving(true);
    const loadingToastId = toast.loading(options?.markExported ? "Saving design and recording export..." : "Saving design...");

    try {
      const result = await saveDesignMutation({
        designId: selectedDesignId ?? undefined,
        projectId: selectedProjectId,
        name: trimmedDesignName,
        exportName: trimmedDesignName,
        model: normalizedModel,
        markExported: options?.markExported ?? false,
      });

      setModel(normalizedModel);
      setSelectedDesignId(result.designId);
      toast.success(options?.markExported ? "Design saved and export registered." : "Design saved.", { id: loadingToastId });

      return result.designId;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save the current design.", { id: loadingToastId });
      return null;
    } finally {
      setIsSaving(false);
    }
  }

  async function exportDxf() {
    const persistedDesignId = await saveDesign({ markExported: true });
    if (!persistedDesignId) {
      return null;
    }

    const contents = buildDxf(geometry, designName, model);
    const blob = new Blob([contents], { type: "application/dxf" });
    const link = document.createElement("a");

    link.href = URL.createObjectURL(blob);
    link.download = `${sanitizeFileName(designName)}.dxf`;
    link.click();
    URL.revokeObjectURL(link.href);

    return persistedDesignId;
  }

  return (
    <SheetMetalContext.Provider
      value={{
        model,
        designName,
        setDesignName,
        geometry,
        selectedDesignId,
        savedDesigns,
        isSaving,
        setBaseValue,
        setOffsetCut,
        setIncludeName,
        setIncludeArrow,
        setArrowDirection,
        setInvert,
        addFlange,
        addFrez,
        updateFlange,
        updateFrez,
        removeFlange,
        removeFrez,
        setFrezMode,
        setFrezNotch,
        setFlangeRelief,
        setCornerRelief,
        loadPreset,
        startNewDesign,
        loadSavedDesign,
        saveDesign,
        exportDxf,
        setRubberband,
        undo,
      }}
    >
      {children}
    </SheetMetalContext.Provider>
  );
}