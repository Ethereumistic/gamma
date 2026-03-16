import { Settings2 } from "lucide-react";
import { useState, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SheetMetalModel, SideKey } from "@/features/sheet-metal/types";
import { useWorkspace } from "@/features/workspace/context";

const allSideKeys: SideKey[] = ["top", "right", "bottom", "left"];

type ExportSettingsDialogProps = {
  model: SheetMetalModel;
  onSetIncludeName: (value: boolean) => void;
  onSetIncludeArrow: (value: boolean) => void;
  onSetArrowDirection: (direction: SideKey) => void;
  onSetRubberband: (value: boolean) => void;
};

export function ExportSettingsDialog({
  model,
  onSetIncludeName,
  onSetIncludeArrow,
  onSetArrowDirection,
  onSetRubberband,
}: ExportSettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const { selectedProjectId, selectedProject } = useWorkspace();
  const updateProjectDefaults = useMutation(api.workspaces.updateProjectDefaults);

  const [baseWidth, setBaseWidth] = useState(900);
  const [baseHeight, setBaseHeight] = useState(520);
  const [offsetCut, setOffsetCut] = useState(3);
  const [flange1, setFlange1] = useState("20");
  const [flange2, setFlange2] = useState("25, 20");
  const [flange3, setFlange3] = useState("60, 40, 20");
  const [frez1, setFrez1] = useState("24");
  const [frez2, setFrez2] = useState("24, 24");
  const [frez3, setFrez3] = useState("24, 24, 24");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (selectedProject?.defaults) {
      const d = selectedProject.defaults;
      setBaseWidth(d.baseWidth ?? 900);
      setBaseHeight(d.baseHeight ?? 520);
      setOffsetCut(d.offsetCut ?? 3);
      setFlange1(d.flangeDefaults?.count1?.join(", ") ?? "20");
      setFlange2(d.flangeDefaults?.count2?.join(", ") ?? "25, 20");
      setFlange3(d.flangeDefaults?.count3?.join(", ") ?? "60, 40, 20");
      setFrez1(d.frezDefaults?.count1?.join(", ") ?? "24");
      setFrez2(d.frezDefaults?.count2?.join(", ") ?? "24, 24");
      setFrez3(d.frezDefaults?.count3?.join(", ") ?? "24, 24, 24");
    }
  }, [selectedProject?.defaults, open]);

  async function handleSaveDefaults() {
    if (!selectedProjectId) return;
    setIsSaving(true);
    try {
      const parseList = (str: string, fallback: number[]) => {
        const parsed = str.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n));
        return parsed.length > 0 ? parsed : fallback;
      };

      await updateProjectDefaults({
        projectId: selectedProjectId,
        defaults: {
          baseWidth,
          baseHeight,
          offsetCut,
          flangeDefaults: {
            count1: parseList(flange1, [20]),
            count2: parseList(flange2, [25, 20]),
            count3: parseList(flange3, [60, 40, 20]),
          },
          frezDefaults: {
            count1: parseList(frez1, [24]),
            count2: parseList(frez2, [24, 24]),
            count3: parseList(frez3, [24, 24, 24]),
          },
        }
      });
      setOpen(false);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-white"
          title="Project & Export settings"
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="border-white/10 bg-card/95 backdrop-blur-xl sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Settings</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Configure project defaults and DXF export options.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="defaults" className="mt-2 w-full">
          <TabsList className="grid w-full grid-cols-2 bg-black/40">
            <TabsTrigger value="defaults" className="text-xs data-[state=active]:bg-white/10 data-[state=active]:text-white">Project Defaults</TabsTrigger>
            <TabsTrigger value="export" className="text-xs data-[state=active]:bg-white/10 data-[state=active]:text-white">DXF Export</TabsTrigger>
          </TabsList>
          
          <TabsContent value="defaults" className="mt-4 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Base W</label>
                <Input type="number" value={baseWidth} onChange={(e) => setBaseWidth(Number(e.target.value))} className="h-8 bg-black/20 text-xs" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Base H</label>
                <Input type="number" value={baseHeight} onChange={(e) => setBaseHeight(Number(e.target.value))} className="h-8 bg-black/20 text-xs" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Offset</label>
                <Input type="number" value={offsetCut} onChange={(e) => setOffsetCut(Number(e.target.value))} className="h-8 bg-black/20 text-xs" />
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-white/6 bg-black/20 p-3">
              <h4 className="text-xs font-medium text-emerald-400">Flange Defaults (Comma-separated)</h4>
              <div className="grid gap-2 mt-2">
                <div className="grid grid-cols-3 items-center gap-2">
                  <span className="text-xs text-muted-foreground">1 Flange</span>
                  <Input value={flange1} onChange={(e) => setFlange1(e.target.value)} className="col-span-2 h-7 bg-black/40 text-xs font-mono" placeholder="20" />
                </div>
                <div className="grid grid-cols-3 items-center gap-2">
                  <span className="text-xs text-muted-foreground">2 Flanges</span>
                  <Input value={flange2} onChange={(e) => setFlange2(e.target.value)} className="col-span-2 h-7 bg-black/40 text-xs font-mono" placeholder="25, 20" />
                </div>
                <div className="grid grid-cols-3 items-center gap-2">
                  <span className="text-xs text-muted-foreground">3 Flanges</span>
                  <Input value={flange3} onChange={(e) => setFlange3(e.target.value)} className="col-span-2 h-7 bg-black/40 text-xs font-mono" placeholder="60, 40, 20" />
                </div>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-white/6 bg-black/20 p-3">
              <h4 className="text-xs font-medium text-fuchsia-400">Frez Defaults (Comma-separated)</h4>
              <div className="grid gap-2 mt-2">
                <div className="grid grid-cols-3 items-center gap-2">
                  <span className="text-xs text-muted-foreground">1 Frez</span>
                  <Input value={frez1} onChange={(e) => setFrez1(e.target.value)} className="col-span-2 h-7 bg-black/40 text-xs font-mono" placeholder="24" />
                </div>
                <div className="grid grid-cols-3 items-center gap-2">
                  <span className="text-xs text-muted-foreground">2 Frez</span>
                  <Input value={frez2} onChange={(e) => setFrez2(e.target.value)} className="col-span-2 h-7 bg-black/40 text-xs font-mono" placeholder="24, 24" />
                </div>
                <div className="grid grid-cols-3 items-center gap-2">
                  <span className="text-xs text-muted-foreground">3 Frez</span>
                  <Input value={frez3} onChange={(e) => setFrez3(e.target.value)} className="col-span-2 h-7 bg-black/40 text-xs font-mono" placeholder="24, 24, 24" />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button onClick={() => void handleSaveDefaults()} disabled={isSaving || !selectedProjectId} size="sm" className="h-8 text-xs">
                {isSaving ? "Saving..." : "Save Project Defaults"}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="export" className="mt-4 space-y-4">
            <div className="flex flex-col gap-3">
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-white/6 bg-black/20 p-3 transition-colors hover:bg-white/[0.03]">
                <div className="space-y-0.5">
                  <span className="text-sm font-medium text-foreground">Rubberband view</span>
                  <p className="text-[10px] text-muted-foreground">Lock view to center during pan/zoom</p>
                </div>
                <Switch
                  checked={model.rubberband}
                  onCheckedChange={onSetRubberband}
                />
              </label>

              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-white/6 bg-black/20 p-3 transition-colors hover:bg-white/[0.03]">
                <span className="text-sm font-medium text-foreground">Include sheet name</span>
                <Checkbox
                  checked={model.includeName}
                  onCheckedChange={(checked) => onSetIncludeName(checked === true)}
                  className="h-4 w-4 border-white/20 data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500"
                />
              </label>

              <div className="space-y-2 rounded-lg border border-white/6 bg-black/20 p-3">
                <label className="flex cursor-pointer items-center justify-between gap-3">
                  <span className="text-sm font-medium text-foreground">Include directional arrow</span>
                  <Checkbox
                    checked={model.includeArrow}
                    onCheckedChange={(checked) => onSetIncludeArrow(checked === true)}
                    className="h-4 w-4 border-white/20 data-[state=checked]:border-blue-500 data-[state=checked]:bg-blue-500"
                  />
                </label>

                {model.includeArrow && (
                  <div className="mt-3 flex gap-2">
                    {allSideKeys.map((dir) => (
                      <Button
                        key={dir}
                        variant={model.arrowDirection === dir ? "default" : "secondary"}
                        size="sm"
                        className={`flex-1 capitalize ${model.arrowDirection === dir ? "bg-blue-600 text-white hover:bg-blue-500" : ""}`}
                        onClick={() => onSetArrowDirection(dir)}
                      >
                        {dir}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>

  );
}
