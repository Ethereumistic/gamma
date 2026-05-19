// src/features/cnc-pipeline/components/DXFDropZone.tsx

import { useRef } from "react"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

interface Props {
  onFile?: (file: File) => void
  onFiles?: (files: File[]) => void   // NEW: bulk callback
  disabled?: boolean
  compact?: boolean
  multiple?: boolean                  // NEW: enables multi-file
}

export function DXFDropZone({ onFile, onFiles, disabled, compact, multiple }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (disabled) return
    if (onFiles && multiple) {
      const files = Array.from(e.dataTransfer.files).filter(f =>
        f.name.toLowerCase().endsWith(".dxf"),
      )
      if (files.length > 0) onFiles(files)
    } else {
      const file = e.dataTransfer.files[0]
      if (file && file.name.toLowerCase().endsWith(".dxf")) onFile?.(file)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return
    if (onFiles && multiple) {
      const files = Array.from(e.target.files ?? []).filter(f =>
        f.name.toLowerCase().endsWith(".dxf"),
      )
      if (files.length > 0) onFiles(files)
    } else {
      const file = e.target.files?.[0]
      if (file) onFile?.(file)
    }
  }

  if (compact) {
    return (
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className={`flex items-center justify-center p-1.5 h-8 w-8 ml-2 border border-dashed border-white/20 rounded transition-colors cursor-pointer shrink-0 ${disabled ? "opacity-50 cursor-not-allowed" : "hover:border-emerald-500/50 hover:bg-emerald-500/10"}`}
        onClick={() => !disabled && inputRef.current?.click()}
        title="Drop or click to browse for a new DXF file"
      >
        <Plus className="h-4 w-4 text-slate-400" />
        <input ref={inputRef} type="file" accept=".dxf" className="hidden" onChange={handleChange} multiple={multiple} />
      </div>
    )
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      className="border-2 border-dashed border-slate-700 hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-colors rounded-xl flex flex-col items-center justify-center p-12 w-[600px] max-w-full h-[400px]"
    >
      <div className="mb-6 flex flex-col items-center gap-3">
        <span className="text-5xl text-slate-500 mb-2">📄</span>
        <h3 className="text-xl font-semibold text-slate-300">{multiple ? "Drop your DXF files here" : "Drop your DXF file here"}</h3>
        <p className="text-sm text-slate-500">or click the button below to browse your files</p>
      </div>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="border-slate-700 hover:bg-emerald-500/10 hover:text-emerald-400 hover:border-emerald-500/50"
      >
        Browse Files
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".dxf"
        style={{ display: "none" }}
        onChange={handleChange}
        multiple={multiple}
      />
    </div>
  )
}
