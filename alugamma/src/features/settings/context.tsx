import { createContext, useContext, useState, type ReactNode } from "react";

export type SettingsTab = "hotkeys" | "cnc";

type SettingsContextValue = {
  settingsOpen: boolean;
  activeTab: SettingsTab;
  openSettings: (tab?: SettingsTab) => void;
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
  const [activeTab, setActiveTab] = useState<SettingsTab>("cnc");

  const openSettings = (tab?: SettingsTab) => {
    setActiveTab(tab ?? "cnc");
    setSettingsOpen(true);
  };

  const closeSettings = () => {
    setSettingsOpen(false);
  };

  return (
    <SettingsContext.Provider value={{ settingsOpen, activeTab, openSettings, closeSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}
