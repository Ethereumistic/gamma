// src/features/cnc-pipeline/components/BackendStatus.tsx

import { useBackendHealth } from "../hooks/useBackendHealth"
import { Badge } from "@/components/ui/badge"

export function BackendStatus() {
  const online = useBackendHealth()
  return (
    <Badge variant={online ? "default" : "destructive"}>
      {online ? "Backend online" : "Backend offline — run uvicorn main:app --port 8765"}
    </Badge>
  )
}
