// src/features/cnc-pipeline/hooks/useBackendHealth.ts

import { useState, useEffect } from "react"
import { checkHealth } from "../api"

export function useBackendHealth(): boolean {
  const [online, setOnline] = useState(false)

  useEffect(() => {
    const check = () => checkHealth().then(setOnline)
    check()
    const id = setInterval(check, 5000)
    return () => clearInterval(id)
  }, [])

  return online
}
