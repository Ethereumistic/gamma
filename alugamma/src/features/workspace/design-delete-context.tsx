import { createContext, useContext, useState, type ReactNode } from "react";

import type { Id } from "../../../convex/_generated/dataModel";

type DesignDeleteContextValue = {
  designToDelete: Id<"designs"> | null;
  setDesignToDelete: (id: Id<"designs"> | null) => void;
};

const DesignDeleteContext = createContext<DesignDeleteContextValue | null>(null);

export function useDesignDelete() {
  const context = useContext(DesignDeleteContext);
  if (!context) {
    throw new Error("useDesignDelete must be used within a DesignDeleteProvider");
  }
  return context;
}

export function DesignDeleteProvider({ children }: { children: ReactNode }) {
  const [designToDelete, setDesignToDelete] = useState<Id<"designs"> | null>(null);

  return (
    <DesignDeleteContext.Provider value={{ designToDelete, setDesignToDelete }}>
      {children}
    </DesignDeleteContext.Provider>
  );
}
