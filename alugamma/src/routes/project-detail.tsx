import { useMemo, useState, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { toast } from "sonner";
import JSZip from "jszip";
import { saveAs } from "file-saver";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useWorkspace } from "@/features/workspace/context";
import { computeSheetMetalGeometry } from "@/features/sheet-metal/geometry";
import { PreviewCanvas } from "@/features/sheet-metal/preview-canvas";

import {
  FileCode,
  Star,
  Clock,
  Pencil,
  Trash2,
  Download,
  CheckSquare,
  X,
} from "lucide-react";

// ─── Design Card (unchanged) ────────────────────────────────────────────────

function DesignCard({ design, projectId }: { design: any; projectId: string }) {
  const geometry = useMemo(() => {
    try {
      return computeSheetMetalGeometry(design.model as any);
    } catch (error) {
      console.error(error);
      return null;
    }
  }, [design.model]);

  return (
    <Card className="flex flex-col border-white/5 bg-black/20 overflow-hidden transition-colors hover:bg-white/[0.02]">
      <div className="relative h-48 sm:h-56 bg-gradient-to-br from-black/60 to-black p-2 border-b border-white/5">
        {geometry && geometry.totalWidth > 0 && geometry.totalHeight > 0 && geometry.shapes.length > 0 ? (
          <div className="absolute inset-0 pt-4 pb-2 px-2 pointer-events-none">
            <PreviewCanvas geometry={geometry} />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            No valid geometry
          </div>
        )}
        <div className="absolute top-2 right-2 flex gap-1 z-10 pointer-events-auto opacity-0 transition-opacity group-hover:opacity-100 lg:opacity-100">
          <Button asChild variant="secondary" size="icon" className="h-7 w-7 bg-black/40 hover:bg-black/80 backdrop-blur-md">
            <Link to={`/project/${projectId}/${design.id}`}>
              <svg className="h-3.5 w-3.5 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            </Link>
          </Button>
          <Button asChild variant="secondary" size="icon" className="h-7 w-7 bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-400 backdrop-blur-md border border-emerald-500/20">
            <Link to={`/sheet-metal/${design.id}`}>
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
            </Link>
          </Button>
        </div>
        {design.isStarred && (
          <div className="absolute top-2 left-2 z-10">
            <Badge variant="secondary" className="px-1 py-0 h-4 text-[10px] bg-yellow-500/20 text-yellow-500 border-yellow-500/30">★</Badge>
          </div>
        )}
      </div>

      <CardContent className="flex flex-col gap-2 p-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium truncate text-sm" title={design.name}>{design.name}</h3>
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{new Date(design.updatedAt).toLocaleDateString()}</span>
          <span>{design.updatedByName}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── NC Program Row ─────────────────────────────────────────────────────────

function formatTime(sec: number) {
  if (sec >= 60) return `${(sec / 60).toFixed(1)}m`;
  return `${Math.round(sec)}s`;
}

function sequenceLabel(program: any): string | null {
  if (!program.customSequence || !Array.isArray(program.customSequence) || program.customSequence.length === 0) return null;
  return program.customSequence.map(([layer]: [string]) => layer).join(" → ");
}

function NcProgramRow({
  program,
  projectId,
  onRename,
  onDelete,
  onToggleStar,
  selectable,
  selected,
  onToggleSelect,
}: {
  program: any;
  projectId: string;
  onRename: (id: Id<"nc_programs">, name: string) => void;
  onDelete: (id: Id<"nc_programs">) => void;
  onToggleStar: (id: Id<"nc_programs">) => void;
  selectable: boolean;
  selected: boolean;
  onToggleSelect: (id: Id<"nc_programs">) => void;
}) {
  const navigate = useNavigate();
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(program.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const seq = sequenceLabel(program);

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== program.name) {
      onRename(program._id, trimmed);
    }
    setIsRenaming(false);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleRenameSubmit();
    if (e.key === "Escape") {
      setRenameValue(program.name);
      setIsRenaming(false);
    }
  };

  return (
    <div
      className={`group flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
        selected
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-white/5 bg-black/20 hover:bg-white/[0.02] hover:border-white/10"
      }`}
    >
      {/* Selection checkbox */}
      {selectable && (
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelect(program._id)}
          className={`shrink-0 ${selected ? "border-emerald-500 data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500" : ""}`}
        />
      )}

      {/* Star */}
      <button
        onClick={() => onToggleStar(program._id)}
        className="shrink-0 transition-colors"
        title={program.isStarred ? "Unstar" : "Star"}
      >
        <Star
          className={`h-4 w-4 ${
            program.isStarred
              ? "fill-amber-400 text-amber-400"
              : "text-slate-600 hover:text-amber-400"
          }`}
        />
      </button>

      {/* Icon + Name */}
      <FileCode className="h-4 w-4 text-emerald-400 shrink-0" />

      <div className="flex-1 min-w-0 flex items-center gap-3">
        {isRenaming ? (
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={handleRenameKeyDown}
            autoFocus
            className="h-7 text-sm bg-black/40 border-white/10 w-[200px]"
          />
        ) : (
          <span
            className="text-sm font-medium truncate cursor-pointer hover:text-emerald-400 transition-colors"
            onClick={() => navigate(`/cnc-pipeline/${program._id}`)}
            title="Open program"
          >
            {program.name}
          </span>
        )}
      </div>

      {/* Metadata badges */}
      <div className="flex items-center gap-2 shrink-0">
        <Badge variant="outline" className="border-white/10 text-[10px] bg-white/5 uppercase font-mono">
          {program.algorithm}
        </Badge>
        <Badge variant="outline" className="border-white/10 text-[10px] bg-white/5 uppercase font-mono">
          {program.scenario}
        </Badge>
      </div>

      {/* Sequence (if custom) */}
      {seq && (
        <span className="text-[10px] text-slate-500 font-mono truncate max-w-[180px] shrink-0" title={seq}>
          {seq}
        </span>
      )}

      {/* Estimated time */}
      <span className="text-[10px] text-slate-500 flex items-center gap-1 shrink-0 whitespace-nowrap">
        <Clock className="h-3 w-3" />
        {formatTime(program.estimatedTimeSeconds)}
      </span>

      {/* Date */}
      <span className="text-[10px] text-slate-600 shrink-0 whitespace-nowrap">
        {new Date(program.updatedAt).toLocaleDateString()}
      </span>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-slate-500 hover:text-white"
          onClick={() => setIsRenaming(true)}
          title="Rename"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>

        {confirmDelete ? (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[10px] text-red-400 hover:bg-red-500/10"
              onClick={() => {
                onDelete(program._id);
                setConfirmDelete(false);
              }}
            >
              Confirm
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[10px] text-slate-400"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-slate-500 hover:text-red-400"
            onClick={() => setConfirmDelete(true)}
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Selection Toolbar ────────────────────────────────────────────────────────

function SelectionToolbar({
  selectedCount,
  totalCount,
  allSelected,
  onToggleSelectAll,
  onDownloadZip,
  onDeleteSelected,
  onClearSelection,
  isDownloading,
  isDeleting,
}: {
  selectedCount: number;
  totalCount: number;
  allSelected: boolean;
  onToggleSelectAll: () => void;
  onDownloadZip: () => void;
  onDeleteSelected: () => void;
  onClearSelection: () => void;
  isDownloading: boolean;
  isDeleting: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 mb-2">
      <Checkbox
        checked={allSelected}
        onCheckedChange={onToggleSelectAll}
        className="border-emerald-500 data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500"
      />
      <span className="text-xs text-emerald-400 font-medium whitespace-nowrap">
        {selectedCount} selected
      </span>
      <div className="h-4 w-px bg-emerald-500/20" />
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2.5 text-[11px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
        onClick={onDownloadZip}
        disabled={isDownloading}
      >
        <Download className="h-3.5 w-3.5 mr-1.5" />
        {isDownloading ? "Zipping..." : "Download ZIP"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2.5 text-[11px] text-red-400 hover:text-red-300 hover:bg-red-500/10"
        onClick={onDeleteSelected}
        disabled={isDeleting}
      >
        <Trash2 className="h-3.5 w-3.5 mr-1.5" />
        {isDeleting ? "Deleting..." : "Delete Selected"}
      </Button>
      <div className="flex-1" />
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-slate-500 hover:text-white"
        onClick={onClearSelection}
        title="Clear selection"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ─── Project Detail Page ────────────────────────────────────────────────────

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { authenticated, isLoadingWorkspace, projects } = useWorkspace();
  const navigate = useNavigate();

  const designs = useQuery(api.designs.listByProject, {
    projectId: projectId as Id<"projects">,
  });
  const ncPrograms = useQuery(api.nc_programs.listByProject, {
    projectId: projectId as Id<"projects">,
  });

  const updateNcProgram = useMutation(api.nc_programs.updateNcProgram);
  const deleteNcProgramMutation = useMutation(api.nc_programs.deleteNcProgram);
  const batchDeleteNcProgramsMutation = useMutation(api.nc_programs.batchDeleteNcPrograms);
  const toggleStarMutation = useMutation(api.nc_programs.toggleStar);

  // ── Selection state ───────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<Id<"nc_programs">>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);

  const toggleSelect = useCallback((id: Id<"nc_programs">) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      if (next.size === 0) {
        setSelectionMode(false);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectionMode(false);
    setConfirmBatchDelete(false);
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (!ncPrograms) return;
    if (selectedIds.size === ncPrograms.length) {
      // Deselect all
      clearSelection();
    } else {
      // Select all
      setSelectedIds(new Set(ncPrograms.map((p: any) => p._id)));
    }
  }, [ncPrograms, selectedIds.size, clearSelection]);

  const enterSelectionMode = useCallback(() => {
    setSelectionMode(true);
  }, []);

  // ── Batch download as ZIP ────────────────────────────────────────────────
  const handleDownloadZip = useCallback(async () => {
    if (!ncPrograms || selectedIds.size === 0) return;

    setIsDownloading(true);
    try {
      const zip = new JSZip();
      const selectedPrograms = ncPrograms.filter((p: any) => selectedIds.has(p._id));

      for (const program of selectedPrograms) {
        const filename = `${program.name}.nc`;
        zip.file(filename, program.ncCode);
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const project = projects.find((p) => p.id === projectId);
      const zipName = project
        ? `${project.name.replace(/\s+/g, "_")}-NC-Programs.zip`
        : `nc-programs-${new Date().toISOString().slice(0, 10)}.zip`;

      saveAs(blob, zipName);
      toast.success(`Downloaded ${selectedPrograms.length} NC program${selectedPrograms.length > 1 ? "s" : ""} as ZIP`);
    } catch (e: any) {
      toast.error("Download failed", { description: e.message });
    } finally {
      setIsDownloading(false);
    }
  }, [ncPrograms, selectedIds, projectId, projects]);

  // ── Batch delete ─────────────────────────────────────────────────────────
  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;

    setIsDeleting(true);
    try {
      const idsArray = Array.from(selectedIds);
      const deletedCount = await batchDeleteNcProgramsMutation({
        projectId: projectId as Id<"projects">,
        ncProgramIds: idsArray,
      });
      toast.success(`Deleted ${deletedCount} program${deletedCount > 1 ? "s" : ""}`);
      clearSelection();
    } catch (e: any) {
      toast.error("Delete failed", { description: e.message });
    } finally {
      setIsDeleting(false);
      setConfirmBatchDelete(false);
    }
  }, [selectedIds, batchDeleteNcProgramsMutation, projectId, clearSelection]);

  // ── Single-item handlers ──────────────────────────────────────────────────
  const handleRename = async (programId: Id<"nc_programs">, name: string) => {
    try {
      await updateNcProgram({
        projectId: projectId as Id<"projects">,
        ncProgramId: programId,
        name,
      });
      toast.success("Renamed");
    } catch (e: any) {
      toast.error("Rename failed", { description: e.message });
    }
  };

  const handleDelete = async (ncProgramId: Id<"nc_programs">) => {
    try {
      await deleteNcProgramMutation({
        projectId: projectId as Id<"projects">,
        ncProgramId,
      });
      toast.success("Deleted");
      // Also remove from selection if present
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(ncProgramId);
        if (next.size === 0) setSelectionMode(false);
        return next;
      });
    } catch (e: any) {
      toast.error("Delete failed", { description: e.message });
    }
  };

  const handleToggleStar = async (programId: Id<"nc_programs">) => {
    try {
      await toggleStarMutation({
        projectId: projectId as Id<"projects">,
        ncProgramId: programId,
      });
    } catch (e: any) {
      toast.error("Star toggle failed", { description: e.message });
    }
  };

  const isLoading =
    isLoadingWorkspace || designs === undefined || ncPrograms === undefined;

  if (isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-10 lg:px-8">
        <Card className="border-white/10 bg-card/85">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Loading...
          </CardContent>
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
            <p>You need to be signed in to view this project.</p>
            <Button asChild>
              <Link to="/auth">Sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const project = projects.find((p) => p.id === projectId);

  if (!project) {
    return (
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-10 lg:px-8">
        <Card className="border-white/10 bg-card/85">
          <CardHeader>
            <CardTitle>Project not found</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            You do not have access to this project or it does not exist.
          </CardContent>
          <CardContent>
            <Button asChild>
              <Link to="/project">Back to Projects</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const allSelected = ncPrograms.length > 0 && selectedIds.size === ncPrograms.length;

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-10 lg:px-8">
      <Card className="border-white/10 bg-card/85">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-2">
          <div>
            <CardTitle>{project.name}</CardTitle>
            {project.description && (
              <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>
            )}
          </div>
          <Button
            asChild
            size="sm"
            variant="outline"
            onClick={() => navigate("/cnc-pipeline")}
            title="Go to CNC Batch Pipeline to generate new NC programs"
          >
            <Link to="/cnc-pipeline">+ New NC Program</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="designs">
            <TabsList className="mb-4">
              <TabsTrigger value="designs">
                Designs {designs.length > 0 && <span className="ml-1.5 text-[10px] font-mono text-slate-500">({designs.length})</span>}
              </TabsTrigger>
              <TabsTrigger value="nc-programs">
                NC Programs {ncPrograms.length > 0 && <span className="ml-1.5 text-[10px] font-mono text-slate-500">({ncPrograms.length})</span>}
              </TabsTrigger>
            </TabsList>

            {/* ── Designs Tab ── */}
            <TabsContent value="designs">
              {designs.length === 0 ? (
                <p className="text-sm text-muted-foreground mt-4 text-center py-8 border border-dashed border-white/10 rounded-xl bg-black/10">
                  No designs created yet.
                </p>
              ) : (
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                  {designs.map((design: any) => (
                    <DesignCard key={design.id} design={design} projectId={project.id} />
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ── NC Programs Tab ── */}
            <TabsContent value="nc-programs">
              {ncPrograms.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <FileCode className="h-10 w-10 text-slate-700 mb-4" />
                  <p className="text-sm text-slate-500">No NC programs saved in this project yet.</p>
                  <p className="text-xs text-slate-600 mt-1">
                    Use the{" "}
                    <Link to="/cnc-pipeline" className="text-emerald-400 hover:underline">
                      CNC Batch Pipeline
                    </Link>{" "}
                    to generate and save programs.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {/* ── Selection toolbar ── */}
                  {selectionMode && selectedIds.size > 0 && (
                    <SelectionToolbar
                      selectedCount={selectedIds.size}
                      totalCount={ncPrograms.length}
                      allSelected={allSelected}
                      onToggleSelectAll={toggleSelectAll}
                      onDownloadZip={handleDownloadZip}
                      onDeleteSelected={() => {
                        if (confirmBatchDelete) {
                          handleDeleteSelected();
                        } else {
                          setConfirmBatchDelete(true);
                        }
                      }}
                      onClearSelection={clearSelection}
                      isDownloading={isDownloading}
                      isDeleting={isDeleting}
                    />
                  )}

                  {/* Confirm batch delete bar */}
                  {selectionMode && selectedIds.size > 0 && confirmBatchDelete && (
                    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-red-500/30 bg-red-500/5 mb-1">
                      <span className="text-xs text-red-400 font-medium">
                        Delete {selectedIds.size} program{selectedIds.size > 1 ? "s" : ""}? This cannot be undone.
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2.5 text-[11px] text-red-400 hover:bg-red-500/10"
                        onClick={handleDeleteSelected}
                        disabled={isDeleting}
                      >
                        Yes, delete
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2.5 text-[11px] text-slate-400"
                        onClick={() => setConfirmBatchDelete(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}

                  {/* Select all / enter selection mode row */}
                  {ncPrograms.length > 0 && !selectionMode && (
                    <div className="flex items-center gap-2 mb-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2.5 text-[11px] text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10"
                        onClick={enterSelectionMode}
                      >
                        <CheckSquare className="h-3.5 w-3.5 mr-1.5" />
                        Select
                      </Button>
                    </div>
                  )}

                  {/* Program rows */}
                  {ncPrograms.map((program: any) => (
                    <NcProgramRow
                      key={program._id}
                      program={program}
                      projectId={project.id}
                      onRename={handleRename}
                      onDelete={handleDelete}
                      onToggleStar={handleToggleStar}
                      selectable={selectionMode}
                      selected={selectedIds.has(program._id)}
                      onToggleSelect={toggleSelect}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}