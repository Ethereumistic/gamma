// src/features/cnc-pipeline/components/LayerControls.tsx

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

  const renderLayer = (layer: string, isRef: boolean) => {
    const isActive = visible[layer] ?? true
    const color = LAYER_COLORS[layer] ?? "#fff"

    return (
      <button
        key={layer}
        onClick={() => onChange(layer, !isActive)}
        className={`flex items-center gap-1.5 outline-none transition-all ${isActive ? "opacity-100" : "opacity-40 hover:opacity-70 grayscale-[50%]"
          }`}
        title={isRef ? "Reference only — not included in CNC output" : `Toggle ${layer} layer`}
      >
        <div
          className={`w-3 h-3 rounded-[2px] shrink-0 ${isRef ? "border border-dashed" : "border"}`}
          style={{
            backgroundColor: isActive ? (isRef ? color + "66" : color) : "transparent",
            borderColor: isActive ? (isRef ? color + "99" : color) : "#64748b",
          }}
        />
        <span className={`text-[10px] font-medium uppercase tracking-wider ${isRef ? "text-slate-500" : "text-slate-300"}`}>
          {layer}
          {isRef && <span className="ml-1 text-[9px] lowercase italic text-slate-600">ref</span>}
        </span>
      </button>
    )
  }

  return (
    <div className="flex items-center gap-4">
      {cncLayers.length > 0 && (
        <div className="flex items-center gap-3">
          {cncLayers.map((l) => renderLayer(l, false))}
        </div>
      )}

      {refLayers.length > 0 && (
        <>
          {cncLayers.length > 0 && <div className="h-3 w-px bg-white/10" />}
          <div className="flex items-center gap-3">
            {refLayers.map((l) => renderLayer(l, true))}
          </div>
        </>
      )}
    </div>
  )
}