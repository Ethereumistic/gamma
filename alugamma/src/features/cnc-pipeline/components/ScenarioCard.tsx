// src/features/cnc-pipeline/components/ScenarioCard.tsx

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { GenerateResponse } from "../types"

const SCENARIO_LABELS: Record<string, string> = {
  most_common: "FREZ → CUT",
  common: "HOLES → FREZ → CUT",
  rare: "FREZ → FREZ_135 → CUT",
  very_rare: "HOLES → FREZ → FREZ_135 → CUT",
  cut_only: "CUT only",
}

interface Props {
  data: GenerateResponse
}

export function ScenarioCard({ data }: Props) {
  return (
    <Card className="bg-transparent border-white/10 shrink-0 shadow-none">
      <CardHeader className="py-2.5 px-4 border-b border-white/5">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate">
          Analysis — {data.filename}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 flex flex-col gap-2.5 text-xs">
        <div className="flex justify-between items-center"><span className="text-slate-500">Scenario</span> <span className="text-slate-200 font-medium">{SCENARIO_LABELS[data.scenario] ?? data.scenario}</span></div>
        <div className="flex justify-between items-center"><span className="text-slate-500">Layers</span> <span className="text-slate-200 font-medium">{data.layers_detected.join(", ")}</span></div>
        <div className="flex justify-between items-center"><span className="text-slate-500">Tools</span> <span className="text-slate-200 font-medium font-mono text-[11px]">T{data.tools_used.join(" → T")}</span></div>
        <div className="flex justify-between items-center"><span className="text-slate-500">Contours</span> <span className="text-slate-200 font-medium">{data.contour_count}</span></div>
        <div className="flex justify-between items-center"><span className="text-slate-500">Lifts</span> <span className="text-slate-200 font-medium">{data.lift_count}</span></div>
        <div className="flex justify-between items-center"><span className="text-slate-500">Est. time</span> <span className="text-slate-200 font-medium">{Math.round(data.estimated_time)}s</span></div>

        {data.warnings.length > 0 && (
          <div className="mt-2 flex flex-col gap-1.5 border-t border-white/5 pt-3">
            {data.warnings.map((w, i) => (
              <Badge key={i} variant="destructive" className="text-[9px] uppercase tracking-wide leading-tight py-0.5 px-1.5 block text-center">
                {w}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}