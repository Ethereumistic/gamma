// src/features/cnc-pipeline/components/ScenarioCard.tsx

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { GenerateResponse } from "../types"

const SCENARIO_LABELS: Record<string, string> = {
  most_common: "FREZ → CUT",
  common:      "HOLES → FREZ → CUT",
  rare:        "FREZ → FREZ_135 → CUT",
  very_rare:   "HOLES → FREZ → FREZ_135 → CUT",
  cut_only:    "CUT only",
}

interface Props {
  data: GenerateResponse
}

export function ScenarioCard({ data }: Props) {
  return (
    <Card className="bg-transparent border-white/10">
      <CardHeader>
        <CardTitle>Analysis — {data.filename}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-slate-300"><strong>Scenario:</strong> {SCENARIO_LABELS[data.scenario] ?? data.scenario}</p>
        <p className="text-slate-300"><strong>Layers detected:</strong> {data.layers_detected.join(", ")}</p>
        <p className="text-slate-300"><strong>Tools:</strong> T{data.tools_used.join(" → T")}</p>
        <p className="text-slate-300"><strong>Contours:</strong> {data.contour_count}</p>
        <p className="text-slate-300"><strong>Lifts:</strong> {data.lift_count}</p>
        <p className="text-slate-300"><strong>Est. time:</strong> {Math.round(data.estimated_time)}s</p>
        {data.warnings.length > 0 && (
          <div className="mt-4">
            <p className="mb-2"><strong>Warnings:</strong></p>
            <ul className="flex flex-col gap-2">
              {data.warnings.map((w, i) => (
                <li key={i}><Badge variant="destructive">{w}</Badge></li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
