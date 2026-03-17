// src/features/cnc-pipeline/components/LayerControls.tsx

import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

// One fixed color per layer name — for visual distinction in the viewer
export const LAYER_COLORS: Record<string, string> = {
  CUT: "#22c55e",   // green
  FREZ: "#a855f7",   // purple
  FREZ_135: "#f97316",   // orange
  HOLES: "#f9ca01",   // yellow
  SHEETS: "#38bdf8",   // sky blue  — visible on dark bg
  "0": "#94a3b8",   // slate     — visible on dark bg
}

// Layers that are included in CNC toolpath generation
const CNC_LAYERS = new Set(["CUT", "FREZ", "FREZ_135", "HOLES"])

interface Props {
  layers: string[]
  visible: Record<string, boolean>
  onChange: (layer: string, value: boolean) => void
}

export function LayerControls({ layers, visible, onChange }: Props) {
  const cncLayers = layers.filter((l) => CNC_LAYERS.has(l))
  const refLayers = layers.filter((l) => !CNC_LAYERS.has(l))

  const renderLayer = (layer: string, isRef: boolean) => (
    <div
      key={layer}
      style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
      title={isRef ? "Reference only — not included in CNC output" : undefined}
    >
      {/* Color swatch */}
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: 2,
          background: isRef
            ? (LAYER_COLORS[layer] ?? "#fff") + "66"
            : (LAYER_COLORS[layer] ?? "#fff"),
          border: isRef ? "1px dashed " + (LAYER_COLORS[layer] ?? "#fff") + "99" : "none",
          flexShrink: 0,
        }}
      />
      <Checkbox
        id={`layer-${layer}`}
        checked={visible[layer] ?? true}
        onCheckedChange={(v) => onChange(layer, !!v)}
        className="border-white/50"
      />
      <Label
        htmlFor={`layer-${layer}`}
        className="cursor-pointer"
        style={{
          color: isRef ? "#64748b" : "#cbd5e1",
          fontSize: isRef ? "0.8rem" : undefined,
        }}
      >
        {layer}
        {isRef && (
          <span
            style={{
              marginLeft: 4,
              fontSize: "0.7rem",
              color: "#475569",
              fontStyle: "italic",
            }}
          >
            ref
          </span>
        )}
      </Label>
    </div>
  )

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {/* CNC layers row */}
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        {cncLayers.map((l) => renderLayer(l, false))}
      </div>

      {/* Reference layers row — only rendered if any exist */}
      {refLayers.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: "1rem",
            flexWrap: "wrap",
            paddingTop: "0.35rem",
            borderTop: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          {refLayers.map((l) => renderLayer(l, true))}
        </div>
      )}
    </div>
  )
}