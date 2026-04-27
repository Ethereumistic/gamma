/**
 * formula/state.ts — React hook for bi-directional formula state.
 *
 * This hook manages the formula bar state, keeping formula string and
 * SheetMetalModel synchronized:
 *
 * 1. User types formula → parser runs → model updates
 * 2. User presses hotkey → token appended → parser runs → model updates
 * 3. External model change → serializer produces new formula → bar updates
 *
 * The `lastValidModel` is preserved so incomplete formulas don't blank the canvas.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { type SheetMetalModel, createEmptyModel } from "@/features/sheet-metal/types";

import { type ParseError, DEFAULT_BASE_WIDTH, DEFAULT_BASE_HEIGHT } from "./grammar";
import { parseFormula } from "./parser";
import { serializeFormula } from "./serializer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FormulaState = {
  /** The current formula string shown in the bar */
  formula: string;
  /** The model derived from the formula (last valid) */
  model: SheetMetalModel;
  /** Parse errors (empty if formula is valid) */
  errors: ParseError[];
  /** Optional filename prefix extracted from formula */
  filename: string | null;
  /** Update the formula from user typing */
  setFormula: (formula: string) => void;
  /** Append a token (used by hotkeys) and parse immediately */
  applyToken: (token: string) => void;
  /** Set the model from external source (sidebar forms) — serializes to formula */
  setModel: (model: SheetMetalModel) => void;
};

// ---------------------------------------------------------------------------
// Debounce utility
// ---------------------------------------------------------------------------

function useDebouncedCallback<T extends (...args: any[]) => void>(
  callback: T,
  delay: number,
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return useCallback(
    ((...args: Parameters<T>) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => callback(...args), delay);
    }) as T,
    [callback, delay],
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFormulaState(initialModel?: SheetMetalModel): FormulaState {
  const [formula, setFormulaRaw] = useState(() =>
    initialModel ? serializeFormula(initialModel) : `${DEFAULT_BASE_WIDTH}x${DEFAULT_BASE_HEIGHT}`,
  );
  const [model, setModel] = useState<SheetMetalModel>(() =>
    initialModel ?? createEmptyModel(),
  );
  const [errors, setErrors] = useState<ParseError[]>([]);
  const [filename, setFilename] = useState<string | null>(null);

  // Track whether the last change came from setModel (to avoid re-serializing)
  const fromModelRef = useRef(false);

  const parseAndUpdate = useCallback((raw: string) => {
    // Skip parsing if this update was triggered by setModel
    if (fromModelRef.current) {
      fromModelRef.current = false;
      return;
    }

    const result = parseFormula(raw);
    setModel(result.model);
    setErrors(result.errors);
    setFilename(result.filename);
  }, []);

  // Debounced parse for typing
  const debouncedParse = useDebouncedCallback(parseAndUpdate, 100);

  const setFormula = useCallback(
    (raw: string) => {
      setFormulaRaw(raw);
      debouncedParse(raw);
    },
    [debouncedParse],
  );

  const applyToken = useCallback(
    (token: string) => {
      // Immediate (no debounce) for hotkey responsiveness
      const newFormula = formula ? `${formula} ${token}` : token;
      setFormulaRaw(newFormula);
      // Cancel any pending debounce
      parseAndUpdate(newFormula);
    },
    [formula, parseAndUpdate],
  );

  const setModelFromExternal = useCallback(
    (newModel: SheetMetalModel) => {
      fromModelRef.current = true;
      const newFormula = serializeFormula(newModel);
      setFormulaRaw(newFormula);
      setModel(newModel);
      setErrors([]);
      // Keep filename if it was set externally
    },
    [],
  );

  return {
    formula,
    model,
    errors,
    filename,
    setFormula,
    applyToken,
    setModel: setModelFromExternal,
  };
}