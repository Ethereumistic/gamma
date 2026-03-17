// src/features/cnc-pipeline/components/BackendStatus.tsx

import { useBackendHealth } from "../hooks/useBackendHealth"

export function BackendStatus() {
  const online = useBackendHealth()
  return (
    <div
      className={`h-2 w-2 shrink-0 rounded-full ${online
          ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
          : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"
        }`}
      title={online ? "Backend online" : "Backend offline — run uvicorn main:app --port 8765"}
    />
  )
}