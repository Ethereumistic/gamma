import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

export interface CutDedupSettings {
  enabled: boolean
  joinLines: boolean
  tolerance: number
}

interface Props {
  value: CutDedupSettings
  onChange: (value: CutDedupSettings) => void
  disabled?: boolean
}

export function CutDedupSettingsCard({ value, onChange, disabled }: Props) {
  const patch = (partial: Partial<CutDedupSettings>) => {
    onChange({ ...value, ...partial })
  }

  return (
    <Card className="bg-slate-950/60 border-white/10">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-white">CUT deduplication</h2>
            <p className="mt-1 text-xs text-slate-400">
              Optional CNC-prep step between nesting DXF export and NC generation.
            </p>
          </div>
          <Switch
            checked={value.enabled}
            onCheckedChange={(checked) => patch({ enabled: checked })}
            disabled={disabled}
            aria-label="Enable CUT deduplication"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="flex items-center justify-between gap-4 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
          <div>
            <Label className="text-xs text-slate-200">Rejoin CUT lines</Label>
            <p className="text-[11px] text-slate-500">
              Emits connected CUT spans as polylines instead of exploded lines.
            </p>
          </div>
          <Switch
            checked={value.joinLines}
            onCheckedChange={(checked) => patch({ joinLines: checked })}
            disabled={disabled || !value.enabled}
            aria-label="Rejoin CUT lines after deduplication"
          />
        </div>

        <div className="grid grid-cols-[1fr_96px] items-center gap-3">
          <div>
            <Label htmlFor="cut-dedup-tol" className="text-xs text-slate-200">
              Tolerance
            </Label>
            <p className="text-[11px] text-slate-500">Default: 0.01 mm</p>
          </div>
          <Input
            id="cut-dedup-tol"
            type="number"
            min="0.0001"
            step="0.001"
            value={value.tolerance}
            onChange={(e) => patch({ tolerance: Number(e.target.value) || 0.01 })}
            disabled={disabled || !value.enabled}
            className="h-8 bg-black/20 border-white/10 text-xs text-white"
          />
        </div>
      </CardContent>
    </Card>
  )
}
