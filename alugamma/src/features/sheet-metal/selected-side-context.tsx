import { createContext, useContext, useState, type ReactNode } from "react";

import type { SideKey } from "./types";

type SelectedSideContextValue = {
  selectedSide: SideKey | null;
  setSelectedSide: (side: SideKey | null) => void;
  selectedFlangeIndex: number | null;
  setSelectedFlangeIndex: (index: number | null) => void;
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

  const setSelectedSide = (side: SideKey | null) => {
    setSelectedSideInternal(side);
    setSelectedFlangeIndex(null);
  };

  return (
    <SelectedSideContext.Provider value={{ selectedSide, setSelectedSide, selectedFlangeIndex, setSelectedFlangeIndex }}>
      {children}
    </SelectedSideContext.Provider>
  );
}
