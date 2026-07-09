import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Settings2 } from "lucide-react"
import { CNCSettingsPanel } from "@/features/settings/cnc-settings-panel"

interface Props {
  disabled?: boolean
}

export function CncToolPresetCard({ disabled }: Props) {
  return (
    <Card className="bg-slate-950/60 border-white/10">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Tool presets</h2>
            <p className="mt-1 text-xs text-slate-400">
              Pre-set CNC tool parameters, layer depths, offsets, and layer → tool assignments before upload.
            </p>
          </div>
          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" disabled={disabled} className="h-8 text-xs border-white/10">
                <Settings2 className="h-3.5 w-3.5 mr-1.5" />
                Configure
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl bg-background/95 border-white/10">
              <DialogHeader>
                <DialogTitle className="text-sm font-semibold tracking-wide">CNC tools</DialogTitle>
              </DialogHeader>
              <CNCSettingsPanel />
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-[11px] text-slate-500">
          Saved values are used for both single-file and batch NC generation.
        </p>
      </CardContent>
    </Card>
  )
}
