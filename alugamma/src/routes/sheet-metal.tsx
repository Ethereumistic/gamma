import { useEffect, useRef } from "react";
import { Link, useParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSheetMetal } from "@/features/sheet-metal/context";
import { countShapes } from "@/features/sheet-metal/geometry";
import { SheetMetalHotkeys } from "@/features/sheet-metal/hotkeys";
import { PreviewCanvas } from "@/features/sheet-metal/preview-canvas";
import { SideEditor } from "@/features/sheet-metal/side-editor";
import { useSelectedSide } from "@/features/sheet-metal/selected-side-context";
import { type CornerKey, type CornerReliefAxis, type SideKey } from "@/features/sheet-metal/types";
import { useWorkspace } from "@/features/workspace/context";
import type { Id } from "../../convex/_generated/dataModel";

const sideMeta: Record<SideKey, { label: string; accentClass: string }> = {
  top: { label: "T", accentClass: "text-sky-400" },
  right: { label: "R", accentClass: "text-amber-400" },
  bottom: { label: "B", accentClass: "text-emerald-400" },
  left: { label: "L", accentClass: "text-violet-400" },
};

const sideCornerMap: Record<SideKey, { start: CornerKey; end: CornerKey }> = {
  top: { start: "topLeft", end: "topRight" },
  right: { start: "topRight", end: "bottomRight" },
  bottom: { start: "bottomLeft", end: "bottomRight" },
  left: { start: "topLeft", end: "bottomLeft" },
};

const sideCornerAxis: Record<SideKey, CornerReliefAxis> = {
  top: "horizontal",
  right: "vertical",
  bottom: "horizontal",
  left: "vertical",
};

const sideKeysTopBottom: SideKey[] = ["top", "bottom"];
const sideKeysLeftRight: SideKey[] = ["left", "right"];
const allSideKeys: SideKey[] = ["top", "right", "bottom", "left"];

function SideEditorForSide({ side }: { side: SideKey }) {
  const {
    model,
    geometry,
    addFlange,
    addFrez,
    updateFlange,
    updateFrez,
    removeFlange,
    removeFrez,
    setFrezMode,
    setFrezNotch,
    setFlangeRelief,
  } = useSheetMetal();
  const { selectedSide, setSelectedFlangeIndex, selectedFlangeIndex } = useSelectedSide();
  const isSelected = selectedSide === side;

  const handleClearAll = () => {
    // Remove frez lines first (reverse to keep indices stable)
    for (let i = model.sides[side].frezLines.length - 1; i >= 0; i--) {
      removeFrez(side, i);
    }
    // Then remove flanges
    for (let i = model.sides[side].flanges.length - 1; i >= 0; i--) {
      removeFlange(side, i);
    }
  };

  return (
    <SideEditor
      side={side}
      label={sideMeta[side].label}
      accentClass={sideMeta[side].accentClass}
      config={model.sides[side]}
      inwardLimit={side === "left" || side === "right" ? model.baseWidth : model.baseHeight}
      outwardLimit={geometry.flangeDepths[side]}
      onAddFlange={() => addFlange(side)}
      onAddFrez={() => addFrez(side)}
      onChangeFlange={(index, value) => updateFlange(side, index, value)}
      onChangeFrez={(index, value) => updateFrez(side, index, value)}
      onRemoveFlange={(index) => removeFlange(side, index)}
      onRemoveFrez={(index) => removeFrez(side, index)}
      onFocusFlange={(index) => setSelectedFlangeIndex(index)}
      selectedFlangeIndex={isSelected ? selectedFlangeIndex : null}
      onSetFrezMode={(mode) => setFrezMode(side, mode)}
      onSetFrezNotch={(index, position, value) => setFrezNotch(side, index, position, value)}
      onSetFlangeRelief={(index, position, value) => setFlangeRelief(side, index, position, value)}
      onClearAll={handleClearAll}
      isSelected={isSelected}
    />
  );
}

export default function SheetMetalApp() {
  const { designId } = useParams<{ designId?: string }>();
  const isNewDesign = !designId || designId === "new";
  const previewCanvasRef = useRef<{ centerView: () => void }>(null);
  const {
    model,
    geometry,
    selectedDesignId,
    savedDesigns,
    addFlange,
    addFrez,
    updateFlange,
    updateFrez,
    removeFlange,
    removeFrez,
    setFrezMode,
    setFrezNotch,
    setFlangeRelief,
    setIncludeName,
    setIncludeArrow,
    setArrowDirection,
    startNewDesign,
    loadSavedDesign,
  } = useSheetMetal();
  const {
    authenticated,
    isLoadingWorkspace,
    projects,
    selectedProject,
    selectedProjectId,
    setSelectedOrganizationId,
    setSelectedProjectId,
  } = useWorkspace();

  const routedProject = designId ? projects.find((project) => project.designs.some((design) => design.id === designId)) ?? null : null;

  useEffect(() => {
    if (isNewDesign) {
      if (selectedDesignId !== null) {
        startNewDesign();
      }
      return;
    }

    const designInSaved = savedDesigns.some((design) => design.id === designId);

    if (!designInSaved) {
      return;
    }

    if (selectedDesignId === designId) {
      return;
    }

    loadSavedDesign(designId as Id<"designs">);

    if (routedProject && selectedProjectId !== routedProject.id) {
      setSelectedOrganizationId(routedProject.organizationId);
      setSelectedProjectId(routedProject.id);
    }
  }, [designId, isNewDesign, loadSavedDesign, routedProject, savedDesigns, selectedDesignId, selectedProjectId, setSelectedOrganizationId, setSelectedProjectId, startNewDesign]);

  if (isLoadingWorkspace) {
    return (
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-6 lg:px-8">
        <Card className="border-white/10 bg-card/80">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">Loading project workspace...</CardContent>
        </Card>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-10 lg:px-8">
        <Card className="border-white/10 bg-card/85">
          <CardHeader>
            <CardTitle>Sign in required</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>The editor is available, but saving DXF design data requires a signed-in Convex workspace account.</p>
            <div className="flex gap-3">
              <Button asChild>
                <Link to="/auth">Sign in</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/">Open workspace dashboard</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (designId && designId !== "new" && !savedDesigns.some((design) => design.id === designId)) {
    return (
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-10 lg:px-8">
        <Card className="border-white/10 bg-card/85">
          <CardHeader>
            <CardTitle>Design not found</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>This design ID does not exist in your accessible projects, or you no longer have access to it.</p>
            <Button asChild>
              <Link to="/">Go to workspace dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!selectedProjectId || !selectedProject) {
    return (
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-10 lg:px-8">
        <Card className="border-white/10 bg-card/85">
          <CardHeader>
            <CardTitle>Select a project</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>DXF exports are stored as reusable design data inside a project. Choose or create a project first.</p>
            <Button asChild>
              <Link to="/">Go to workspace dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="spatial-workspace flex h-[calc(100vh-4rem)] w-full flex-col overflow-hidden">
      <SheetMetalHotkeys previewCanvasRef={previewCanvasRef} />
      {/* ═══════════════════════════════════════════════════════════════
          SPATIAL GRID LAYOUT
          The preview is the center of the universe.
          Side panels are positioned around it mirroring physical sides.

              [        TOP PANEL          ]
          [LEFT]  [   LIVE PREVIEW   ]  [RIGHT]
              [       BOTTOM PANEL        ]
         ═══════════════════════════════════════════════════════════════ */}

      <div className="grid flex-1 grid-cols-[auto,1fr,auto] grid-rows-[auto,1fr,auto] gap-0 overflow-hidden p-2">

        {/* ── TOP SIDE PANEL ── */}
        <div className="col-start-2 row-start-1 px-0 pb-1.5">
          <SideEditorForSide side="top" />
        </div>

        {/* ── LEFT SIDE PANEL ── */}
        <div className="col-start-1 row-start-2 h-full pr-1.5">
          <SideEditorForSide side="left" />
        </div>

        {/* ── LIVE PREVIEW (CENTER) ── */}
        <div className="col-start-2 row-start-2 flex flex-col items-stretch overflow-hidden rounded-2xl border border-white/[0.06] bg-[#080c14]">
          {/* Mini info bar */}
          <div className="flex items-center justify-between border-b border-white/[0.04] px-4 py-1.5">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/50">
              {selectedProject.name}
            </p>
            <div className="flex gap-2">
              <Badge variant="cut" className="h-5 text-[10px]">CUT {countShapes(geometry.shapes, "CUT")}</Badge>
              <Badge variant="frez" className="h-5 text-[10px]">FREZ {countShapes(geometry.shapes, "FREZ")}</Badge>
              <span className="rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] text-muted-foreground/60">
                {geometry.totalWidth}×{geometry.totalHeight}
              </span>
            </div>
          </div>

          {/* Canvas */}
          <div className="relative flex-1 overflow-hidden p-1">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(255,255,255,0.04),transparent_60%)]" />
            <div className="relative h-full w-full">
              <PreviewCanvas ref={previewCanvasRef} geometry={geometry} />
            </div>
          </div>

          {/* Warnings */}
          {geometry.warnings.length > 0 && (
            <div className="border-t border-destructive/20 bg-destructive/[0.06] px-4 py-2 text-[11px] text-destructive-foreground/80">
              <strong className="font-semibold">⚠ </strong>
              {geometry.warnings.join(" · ")}
            </div>
          )}
        </div>

        {/* ── RIGHT SIDE PANEL ── */}
        <div className="col-start-3 row-start-2 h-full pl-1.5">
          <SideEditorForSide side="right" />
        </div>

        {/* ── BOTTOM SIDE PANEL ── */}
        <div className="col-start-2 row-start-3 px-0 pt-1.5">
          <SideEditorForSide side="bottom" />
        </div>
      </div>
    </div>
  );
}