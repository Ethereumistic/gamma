import { useNavigate } from "react-router-dom";
import { flushSync } from "react-dom";
import { useState } from "react";
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

function isNumericInput(e: KeyboardEvent) {
  const target = e.target as HTMLElement;
  if (target.tagName !== "INPUT") return false;
  const inMode = target.getAttribute("inputmode") || (target as HTMLInputElement).inputMode;
  if (inMode === "numeric") return true;
  const type = target.getAttribute("type") || (target as HTMLInputElement).type;
  if (type === "number") return true;
  return false;
}

function isPlainTextInput(e: KeyboardEvent) {
  return isTextInput(e) && !isNumericInput(e);
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
  const { saveDesign, exportDxf, startNewDesign, model, selectedDesignId, setRubberband, addFlange, addFrez, addInnerFrez, setFlangeRelief, setFlangeFlap, setInnerFrezNotch, undo, removeFlange, removeFrez, removeInnerFrez } = useSheetMetal();
  const { selectedSide, setSelectedSide, selectedFlangeIndex, setSelectedFlangeIndex, selectedInnerFrezIndex, setSelectedInnerFrezIndex } = useSelectedSide();
  const [lastQ, setLastQ] = useState(0);
  const [lastE, setLastE] = useState(0);
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
    // Don't intercept native undo inside plain text inputs like the design name field.
    if (isPlainTextInput(e)) return;
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

  useHotkey("W", (e) => { if (isPlainTextInput(e)) return; e.preventDefault(); handleSideSelect("top"); }, { ignoreInputs: false });
  useHotkey("A", (e) => { if (isPlainTextInput(e)) return; e.preventDefault(); handleSideSelect("left"); }, { ignoreInputs: false });
  useHotkey("S", (e) => { if (isPlainTextInput(e)) return; e.preventDefault(); handleSideSelect("bottom"); }, { ignoreInputs: false });
  useHotkey("D", (e) => { if (isPlainTextInput(e)) return; e.preventDefault(); handleSideSelect("right"); }, { ignoreInputs: false });

  useHotkey("ArrowUp", (e) => { if (isPlainTextInput(e)) return; e.preventDefault(); handleSideSelect("top"); }, { ignoreInputs: false });
  useHotkey("ArrowLeft", (e) => { if (isPlainTextInput(e)) return; e.preventDefault(); handleSideSelect("left"); }, { ignoreInputs: false });
  useHotkey("ArrowDown", (e) => { if (isPlainTextInput(e)) return; e.preventDefault(); handleSideSelect("bottom"); }, { ignoreInputs: false });
  useHotkey("ArrowRight", (e) => { if (isPlainTextInput(e)) return; e.preventDefault(); handleSideSelect("right"); }, { ignoreInputs: false });

  useHotkey("Escape", (e) => {
    if (isTextInput(e)) {
      (e.target as HTMLElement).blur();
    } else {
      setSelectedSide(null);
    }
  });

  // F: add flange, focus its input. Clears any inner frez focus.
  useHotkey("F", (e) => {
    if (isPlainTextInput(e)) return;
    e.preventDefault();
    if (isSideSelected) {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      const newIndex = model.sides[selectedSide].flanges.length;
      flushSync(() => {
        addFlange(selectedSide);
        setSelectedFlangeIndex(newIndex);
        setSelectedInnerFrezIndex(null);
      });
      focusLastFlangeInput(selectedSide);
    }
  }, { ignoreInputs: false, enabled: isSideSelected });

  // Z: add inner frez, set it as focused (clears flange focus so Q/E act on it)
  useHotkey("Z", (e) => {
    if (isPlainTextInput(e)) return;
    e.preventDefault();
    if (isSideSelected) {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      const newIndex = model.sides[selectedSide].innerFrezLines.length;
      flushSync(() => {
        addInnerFrez(selectedSide);
        setSelectedInnerFrezIndex(newIndex);
        setSelectedFlangeIndex(null);
      });
      focusLastFlangeInput(selectedSide);
    }
  }, { ignoreInputs: false, enabled: isSideSelected });

  // Shift+F: delete the focused flange (falls back to last), refocus
  useHotkey("Shift+F", (e) => {
    if (isPlainTextInput(e)) return;
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

  // Shift+Z: delete the last inner frez
  useHotkey("Shift+Z", (e) => {
    if (isPlainTextInput(e)) return;
    e.preventDefault();
    if (isSideSelected) {
      const sideConfig = model.sides[selectedSide];
      if (sideConfig.innerFrezLines.length > 0) removeInnerFrez(selectedSide, sideConfig.innerFrezLines.length - 1);
    }
  }, { ignoreInputs: false, enabled: isSideSelected });

  // Mod+Shift+F: delete ALL flanges on selected side
  useHotkey("Mod+Shift+F", (e) => {
    if (isPlainTextInput(e)) return;
    e.preventDefault();
    if (isSideSelected) {
      const sideConfig = model.sides[selectedSide];
      for (let i = sideConfig.flanges.length - 1; i >= 0; i--) removeFlange(selectedSide, i);
      setSelectedFlangeIndex(null);
    }
  });

  // Mod+Shift+Z: delete ALL inner frez on selected side
  useHotkey("Mod+Shift+Z", (e) => {
    if (isPlainTextInput(e)) return;
    e.preventDefault();
    if (isSideSelected) {
      const sideConfig = model.sides[selectedSide];
      for (let i = sideConfig.innerFrezLines.length - 1; i >= 0; i--) removeInnerFrez(selectedSide, i);
    }
  });

  // Q: toggle start notch on focused inner frez, OR start relief on focused flange
  useHotkey("Q", (e) => {
    if (isPlainTextInput(e)) return;
    e.preventDefault();
    if (!isSideSelected) return;
    const sideConfig = model.sides[selectedSide];

    // Inner frez is focused — toggle its start notch
    if (selectedInnerFrezIndex !== null && selectedInnerFrezIndex < sideConfig.innerFrezLines.length) {
      const current = sideConfig.innerFrezLines[selectedInnerFrezIndex].notches.start;
      setInnerFrezNotch(selectedSide, selectedInnerFrezIndex, "start", !current);
      return;
    }

    // Fallback: flange relief (existing double-tap logic)
    const targetIndex =
      selectedFlangeIndex !== null && selectedFlangeIndex < sideConfig.flanges.length
        ? selectedFlangeIndex
        : sideConfig.flanges.length - 1;
    const now = Date.now();
    if (now - lastQ < 400 && targetIndex >= 0) {
      if (!sideConfig.flanges[targetIndex].reliefs.start) {
        setFlangeRelief(selectedSide, targetIndex, "start", true);
      }
      setTimeout(() => {
        const el = document.getElementById(`flap-start-${selectedSide}-${targetIndex}`);
        if (el) el.focus();
      }, 50);
      setLastQ(0);
    } else {
      if (targetIndex >= 0) setFlangeRelief(selectedSide, targetIndex, "start", !sideConfig.flanges[targetIndex].reliefs.start);
      setLastQ(now);
    }
  }, { ignoreInputs: false, enabled: isSideSelected });

  // E: toggle end notch on focused inner frez, OR end relief on focused flange
  useHotkey("E", (e) => {
    if (isPlainTextInput(e)) return;
    e.preventDefault();
    if (!isSideSelected) return;
    const sideConfig = model.sides[selectedSide];

    // Inner frez is focused — toggle its end notch
    if (selectedInnerFrezIndex !== null && selectedInnerFrezIndex < sideConfig.innerFrezLines.length) {
      const current = sideConfig.innerFrezLines[selectedInnerFrezIndex].notches.end;
      setInnerFrezNotch(selectedSide, selectedInnerFrezIndex, "end", !current);
      return;
    }

    // Fallback: flange relief (existing double-tap logic)
    const targetIndex =
      selectedFlangeIndex !== null && selectedFlangeIndex < sideConfig.flanges.length
        ? selectedFlangeIndex
        : sideConfig.flanges.length - 1;
    const now = Date.now();
    if (now - lastE < 400 && targetIndex >= 0) {
      if (!sideConfig.flanges[targetIndex].reliefs.end) {
        setFlangeRelief(selectedSide, targetIndex, "end", true);
      }
      setTimeout(() => {
        const el = document.getElementById(`flap-end-${selectedSide}-${targetIndex}`);
        if (el) el.focus();
      }, 50);
      setLastE(0);
    } else {
      if (targetIndex >= 0) setFlangeRelief(selectedSide, targetIndex, "end", !sideConfig.flanges[targetIndex].reliefs.end);
      setLastE(now);
    }
  }, { ignoreInputs: false, enabled: isSideSelected });

  return null;
}