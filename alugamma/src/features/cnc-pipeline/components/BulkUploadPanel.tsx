import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  Check,
  AlertCircle,
  Loader2,
  FileCode,
  Download,
  Save,
} from "lucide-react"
import type { BulkState, BulkItemStatus } from "../hooks/useBulkGenerate"

interface Props {
  state: BulkState
  onCancel: () => void
  onClear: () => void
  onDownload: () => void
  onSaveAll: () => void
  hasProject: boolean // whether a project is selected (enables save)
}

const STATUS_DISPLAY: Record<
  BulkItemStatus,
  { icon: React.ReactNode; color: string }
> = {
  pending: {
    icon: <span className="text-slate-600 text-xs">⏳</span>,
    color: "text-slate-600",
  },
  uploading: {
    icon: (
      <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin" />
    ),
    color: "text-blue-400",
  },
  generating: {
    icon: (
      <Loader2 className="h-3.5 w-3.5 text-amber-400 animate-spin" />
    ),
    color: "text-amber-400",
  },
  saving: {
    icon: (
      <Loader2 className="h-3.5 w-3.5 text-emerald-400 animate-spin" />
    ),
    color: "text-emerald-400",
  },
  done: {
    icon: <Check className="h-3.5 w-3.5 text-emerald-400" />,
    color: "text-emerald-400",
  },
  error: {
    icon: <AlertCircle className="h-3.5 w-3.5 text-red-400" />,
    color: "text-red-400",
  },
}

export function BulkUploadPanel({
  state,
  onCancel,
  onClear,
  onDownload,
  onSaveAll,
  hasProject,
}: Props) {
  if (state.items.length === 0) return null

  const progress =
    state.totalCount > 0
      ? ((state.completedCount + state.errorCount) / state.totalCount) * 100
      : 0

  const allDone =
    !state.isProcessing &&
    state.completedCount + state.errorCount === state.totalCount
  const hasCompletedItems = state.completedCount > 0

  return (
    <Card className="bg-transparent border-white/10 shadow-none">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-white">
            {state.isProcessing
              ? `Processing (${state.completedCount + state.errorCount}/${state.totalCount})`
              : `Queue (${state.completedCount} done${state.errorCount > 0 ? `, ${state.errorCount} failed` : ""})`}
          </CardTitle>
          <div className="flex items-center gap-2">
            {!allDone && state.isProcessing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onCancel}
                className="text-red-400 hover:text-red-300 text-xs h-7"
              >
                Cancel
              </Button>
            )}
            {allDone && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClear}
                className="text-xs h-7"
              >
                Clear
              </Button>
            )}
          </div>
        </div>
        <Progress value={progress} className="h-1" />
      </CardHeader>
      <CardContent className="pt-2">
        {/* Queue items */}
        <div className="max-h-[300px] overflow-y-auto space-y-0.5">
          {state.items.map((item) => {
            const display = STATUS_DISPLAY[item.status]
            return (
              <div
                key={item.id}
                className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-white/5 text-xs"
              >
                {display.icon}
                <FileCode className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <span className="truncate flex-1 text-slate-300">
                  {item.name}
                </span>
                {item.status === "error" && item.error && (
                  <span className="text-red-400 text-[10px] truncate max-w-[200px]">
                    {item.error}
                  </span>
                )}
                {item.status === "done" && (
                  <span className="text-emerald-400 text-[10px] font-mono">
                    {item.ncText?.split("\n").length} lines
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/* Action buttons shown when queue is complete */}
        {allDone && hasCompletedItems && (
          <div className="flex items-center gap-2 pt-3 border-t border-white/10 mt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onDownload}
              className="text-xs border-emerald-500/50 hover:bg-emerald-500/10 hover:text-emerald-400 h-7"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Download .ZIP
            </Button>
            {hasProject && (
              <Button
                variant="outline"
                size="sm"
                onClick={onSaveAll}
                className="text-xs border-blue-500/50 hover:bg-blue-500/10 hover:text-blue-400 h-7"
              >
                <Save className="h-3.5 w-3.5 mr-1.5" />
                Save all to project
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}