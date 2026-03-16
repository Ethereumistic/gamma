// src/features/cnc-pipeline/components/DXFDropZone.tsx

import { useRef } from "react"
import { Button } from "@/components/ui/button"

interface Props {
  onFile: (file: File) => void
  disabled?: boolean
}

export function DXFDropZone({ onFile, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.name.toLowerCase().endsWith(".dxf")) onFile(file)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onFile(file)
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      style={{ border: "2px dashed", padding: "2rem", textAlign: "center" }}
      className="border-slate-800 rounded-md"
    >
      <p className="mb-4">Drop a .dxf file here or</p>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        Browse
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".dxf"
        style={{ display: "none" }}
        onChange={handleChange}
      />
    </div>
  )
}
