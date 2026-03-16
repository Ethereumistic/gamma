// src/features/cnc-pipeline/components/LayerControls.tsx

import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

// One fixed color per layer name — these are just for visual distinction in the viewer
export const LAYER_COLORS: Record<string, string> = {
  CUT:      "#22c55e",   // green
  FREZ:     "#a855f7",   // purple
  FREZ_135: "#f97316",   // orange
  HOLES:    "#f9ca01",   // yellow
  SHEETS:   "#6b7280",   // gray
  "0":      "#71717a",   // zinc
}

interface Props {
  layers:   string[]
  visible:  Record<string, boolean>
  onChange: (layer: string, value: boolean) => void
}

export function LayerControls({ layers, visible, onChange }: Props) {
  return (
    <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
      {layers.map((layer) => (
        <div key={layer} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: 2,
              background: LAYER_COLORS[layer] ?? "#fff",
            }}
          />
          <Checkbox
            id={`layer-${layer}`}
            checked={visible[layer] ?? true}
            onCheckedChange={(v) => onChange(layer, !!v)}
            className="border-white/50"
          />
          <Label htmlFor={`layer-${layer}`} className="text-slate-300 cursor-pointer">{layer}</Label>
        </div>
      ))}
    </div>
  )
}
