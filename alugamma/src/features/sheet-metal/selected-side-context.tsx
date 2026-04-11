import { createContext, useContext, useState, type ReactNode } from "react";

import type { SideKey } from "./types";

type SelectedSideContextValue = {
  selectedSide: SideKey | null;
  setSelectedSide: (side: SideKey | null) => void;
  selectedFlangeIndex: number | null;
  setSelectedFlangeIndex: (index: number | null) => void;
  selectedInnerFrezIndex: number | null;
  setSelectedInnerFrezIndex: (index: number | null) => void;
  /** Index into the unified features list for the holes chip; refers to the parent feature */
  selectedHolesIndex: number | null;
  setSelectedHolesIndex: (index: number | null) => void;
};

const SelectedSideContext = createContext<SelectedSideContextValue | null>(null);

export function useSelectedSide() {
  const context = useContext(SelectedSideContext);
  if (!context) {
    throw new Error("useSelectedSide must be used within a SelectedSideProvider");
  }
  return context;
}

export function SelectedSideProvider({ children }: { children: ReactNode }) {
  const [selectedSide, setSelectedSideInternal] = useState<SideKey | null>(null);
  const [selectedFlangeIndex, setSelectedFlangeIndex] = useState<number | null>(null);
  const [selectedInnerFrezIndex, setSelectedInnerFrezIndex] = useState<number | null>(null);
  const [selectedHolesIndex, setSelectedHolesIndex] = useState<number | null>(null);

  const setSelectedSide = (side: SideKey | null) => {
    setSelectedSideInternal(side);
    setSelectedFlangeIndex(null);
    setSelectedInnerFrezIndex(null);
    setSelectedHolesIndex(null);
  };

  return (
    <SelectedSideContext.Provider value={{ selectedSide, setSelectedSide, selectedFlangeIndex, setSelectedFlangeIndex, selectedInnerFrezIndex, setSelectedInnerFrezIndex, selectedHolesIndex, setSelectedHolesIndex }}>
      {children}
    </SelectedSideContext.Provider>
  );
}
