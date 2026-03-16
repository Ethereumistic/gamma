import { createContext, useContext, useState, type ReactNode } from "react";

type SettingsContextValue = {
  settingsOpen: boolean;
  openSettings: (tab?: "hotkeys") => void;
  closeSettings: () => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const openSettings = (_tab?: "hotkeys") => {
    setSettingsOpen(true);
  };

  const closeSettings = () => {
    setSettingsOpen(false);
  };

  return (
    <SettingsContext.Provider value={{ settingsOpen, openSettings, closeSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}
