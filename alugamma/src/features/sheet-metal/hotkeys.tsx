import { useNavigate } from "react-router-dom";
import { flushSync } from "react-dom";
import { useHotkey, useHotkeySequence } from "@tanstack/react-hotkeys";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useSheetMetal } from "./context";
import { useSelectedSide } from "./selected-side-context";
import { useDesignDelete } from "@/features/workspace/design-delete-context";
import { useWorkspace } from "@/features/workspace/context";
import type { SideKey } from "./types";

type SheetMetalHotkeysProps = {
  previewCanvasRef?: React.RefObject<{ centerView: () => void }>;
};

function isTextInput(e: KeyboardEvent) {
  const target = e.target as HTMLElement;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

function isInsideFlangeInput(e: KeyboardEvent) {
  const target = e.target as HTMLElement;
  return isTextInput(e) && target.hasAttribute("data-side");
}


// data-side lives on the <input> itself — query it directly, never as a descendant.
function getFlangeInputs(side: SideKey) {
  return document.querySelectorAll<HTMLInputElement>(`input[data-side="${side}"]`);
}

function focusFlangeInput(side: SideKey, index: number) {
  setTimeout(() => {
    const inputs = getFlangeInputs(side);
    if (inputs.length > index) {
      inputs[index].focus();
      inputs[index].select();
    }
  }, 0);
}

function focusLastFlangeInput(side: SideKey) {
  setTimeout(() => {
    const inputs = getFlangeInputs(side);
    if (inputs.length > 0) {
      inputs[inputs.length - 1].focus();
      inputs[inputs.length - 1].select();
    }
  }, 0);
}

export function SheetMetalHotkeys({ previewCanvasRef }: SheetMetalHotkeysProps) {
  const navigate = useNavigate();
  const { saveDesign, exportDxf, startNewDesign, model, selectedDesignId, setRubberband, addFlange, addFrez, setFlangeRelief, undo, removeFlange, removeFrez } = useSheetMetal();
  const { selectedSide, setSelectedSide, selectedFlangeIndex, setSelectedFlangeIndex } = useSelectedSide();
  const { setDesignToDelete } = useDesignDelete();
  const { selectedProjectId } = useWorkspace();
  const deleteDesign = useMutation(api.designs.deleteDesign);
  const duplicateDesign = useMutation(api.designs.duplicateDesign);

  const isSideSelected = selectedSide !== null;
  const canSave = selectedProjectId !== null;

  useHotkey("Mod+S", (e) => {
    e.preventDefault();
    if (canSave) saveDesign();
  });

  useHotkey("Mod+N", (e) => {
    e.preventDefault();
    startNewDesign();
    navigate("/sheet-metal/new");
  });

  useHotkey("Mod+D", (e) => {
    e.preventDefault();
  });

  useHotkey("Mod+Z", (e) => {
    // Don't intercept native undo inside text inputs like the design name field.
    if (isTextInput(e) && !isInsideFlangeInput(e)) return;
    e.preventDefault();
    undo();
  });

  useHotkey("Mod+Delete", (e) => {
    e.preventDefault();
    if (selectedDesignId) setDesignToDelete(selectedDesignId);
  });

  useHotkey("Mod+Shift+Delete", async (e) => {
    e.preventDefault();
    if (selectedDesignId) {
      await deleteDesign({ designId: selectedDesignId });
      navigate("/sheet-metal/new");
    }
  });

  useHotkey("Mod+R", (e) => {
    e.preventDefault();
    setRubberband(!model.rubberband);
  });

  useHotkey("Mod+F", (e) => {
    e.preventDefault();
    previewCanvasRef?.current?.centerView();
  });

  useHotkeySequence(["Mod+S", "D"], async () => {
    const designId = await saveDesign();
    if (designId && selectedProjectId) {
      const newId = await duplicateDesign({ designId });
      navigate(`/sheet-metal/${newId}`);
    }
  });

  useHotkeySequence(["Mod+S", "E"], async () => {
    await exportDxf();
  });

  // Mod+1–9: jump focus to a specific flange by index
  const numbers = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  for (let i = 0; i < numbers.length; i++) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useHotkey(`Mod+${numbers[i]}` as any, (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (isSideSelected) {
        const sideConfig = model.sides[selectedSide];
        if (sideConfig.flanges.length > i) {
          flushSync(() => setSelectedFlangeIndex(i));
          focusFlangeInput(selectedSide, i);
        }
      }
    });
  }

  // WASD: select side, auto-focus last flange input if flanges exist.
  // No ignoreInputs:false — the library's default behaviour suppresses single-key hotkeys
  // inside any text input, which is exactly what we want: WASD types freely in the design
  // name field and other plain inputs. Press Escape to blur a flange input first, then WASD.
  const handleSideSelect = (side: SideKey) => {
    const count = model.sides[side].flanges.length;
    setSelectedSide(side);
    if (count > 0) { setSelectedFlangeIndex(count - 1); focusLastFlangeInput(side); }
  };

  useHotkey("W", (e) => { e.preventDefault(); handleSideSelect("top"); });
  useHotkey("A", (e) => { e.preventDefault(); handleSideSelect("left"); });
  useHotkey("S", (e) => { e.preventDefault(); handleSideSelect("bottom"); });
  useHotkey("D", (e) => { e.preventDefault(); handleSideSelect("right"); });

  useHotkey("Escape", (e) => {
    if (isTextInput(e)) {
      (e.target as HTMLElement).blur();
    } else {
      setSelectedSide(null);
    }
  });

  // F: add flange, focus its input
  // Blur BEFORE flushSync — browser must release focus before DOM mutation,
  // otherwise .focus() on the new input is ignored.
  useHotkey("F", (e) => {
    if (isTextInput(e) && !isInsideFlangeInput(e)) return;
    e.preventDefault();
    if (isSideSelected) {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      const newIndex = model.sides[selectedSide].flanges.length;
      flushSync(() => {
        addFlange(selectedSide);
        setSelectedFlangeIndex(newIndex);
      });
      focusLastFlangeInput(selectedSide);
    }
  }, { ignoreInputs: false, enabled: isSideSelected });

  // Z: add frez, focus its input
  useHotkey("Z", (e) => {
    if (isTextInput(e) && !isInsideFlangeInput(e)) return;
    e.preventDefault();
    if (isSideSelected) {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      flushSync(() => addFrez(selectedSide));
      focusLastFlangeInput(selectedSide);
    }
  }, { ignoreInputs: false, enabled: isSideSelected });

  // Shift+F: delete the focused flange (falls back to last), refocus
  useHotkey("Shift+F", (e) => {
    if (isTextInput(e) && !isInsideFlangeInput(e)) return;
    e.preventDefault();
    if (isSideSelected) {
      const sideConfig = model.sides[selectedSide];
      if (sideConfig.flanges.length === 0) return;
      const targetIndex =
        selectedFlangeIndex !== null && selectedFlangeIndex < sideConfig.flanges.length
          ? selectedFlangeIndex
          : sideConfig.flanges.length - 1;
      removeFlange(selectedSide, targetIndex);
      const newCount = sideConfig.flanges.length - 1;
      if (newCount > 0) {
        const nextIndex = Math.min(targetIndex, newCount - 1);
        setSelectedFlangeIndex(nextIndex);
        focusFlangeInput(selectedSide, nextIndex);
      } else {
        setSelectedFlangeIndex(null);
      }
    }
  }, { ignoreInputs: false, enabled: isSideSelected });

  // Shift+Z: delete the last frez
  useHotkey("Shift+Z", (e) => {
    if (isTextInput(e) && !isInsideFlangeInput(e)) return;
    e.preventDefault();
    if (isSideSelected) {
      const sideConfig = model.sides[selectedSide];
      if (sideConfig.frezLines.length > 0) removeFrez(selectedSide, sideConfig.frezLines.length - 1);
    }
  }, { ignoreInputs: false, enabled: isSideSelected });

  // Mod+Shift+F: delete ALL flanges on selected side
  useHotkey("Mod+Shift+F", (e) => {
    if (isTextInput(e) && !isInsideFlangeInput(e)) return;
    e.preventDefault();
    if (isSideSelected) {
      const sideConfig = model.sides[selectedSide];
      for (let i = sideConfig.flanges.length - 1; i >= 0; i--) removeFlange(selectedSide, i);
      setSelectedFlangeIndex(null);
    }
  });

  // Mod+Shift+Z: delete ALL frez on selected side
  useHotkey("Mod+Shift+Z", (e) => {
    if (isTextInput(e) && !isInsideFlangeInput(e)) return;
    e.preventDefault();
    if (isSideSelected) {
      const sideConfig = model.sides[selectedSide];
      for (let i = sideConfig.frezLines.length - 1; i >= 0; i--) removeFrez(selectedSide, i);
    }
  });

  // Q/E: toggle start/end relief on focused flange
  useHotkey("Q", (e) => {
    if (isTextInput(e) && !isInsideFlangeInput(e)) return;
    e.preventDefault();
    if (isSideSelected) {
      const sideConfig = model.sides[selectedSide];
      const targetIndex =
        selectedFlangeIndex !== null && selectedFlangeIndex < sideConfig.flanges.length
          ? selectedFlangeIndex
          : sideConfig.flanges.length - 1;
      if (targetIndex >= 0) setFlangeRelief(selectedSide, targetIndex, "start", !sideConfig.flanges[targetIndex].reliefs.start);
    }
  }, { ignoreInputs: false, enabled: isSideSelected });

  useHotkey("E", (e) => {
    if (isTextInput(e) && !isInsideFlangeInput(e)) return;
    e.preventDefault();
    if (isSideSelected) {
      const sideConfig = model.sides[selectedSide];
      const targetIndex =
        selectedFlangeIndex !== null && selectedFlangeIndex < sideConfig.flanges.length
          ? selectedFlangeIndex
          : sideConfig.flanges.length - 1;
      if (targetIndex >= 0) setFlangeRelief(selectedSide, targetIndex, "end", !sideConfig.flanges[targetIndex].reliefs.end);
    }
  }, { ignoreInputs: false, enabled: isSideSelected });

  return null;
}