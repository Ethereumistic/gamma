import { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { useConvex } from "convex/react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { toast } from "sonner";
import { Loader2Icon, DownloadIcon, CheckIcon, Building2, LockKeyhole, FileStack, Search, LayoutDashboard } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWorkspace } from "@/features/workspace/context";

import { api } from "../../convex/_generated/api";
import { buildDxf } from "@/features/sheet-metal/dxf";
import { computeSheetMetalGeometry } from "@/features/sheet-metal/geometry";
import { Id } from "../../convex/_generated/dataModel";

function BatchExportDialog({
    project,
    onClose,
    convex,
}: {
    project: any;
    onClose: () => void;
    convex: any;
}) {
    const [designs, setDesigns] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!project) return;
        setLoading(true);
        setSearchQuery("");
        convex.query(api.designs.listByProject, { projectId: project.id })
            .then((res: any[]) => {
                setDesigns(res);
                setSelectedIds(new Set(res.map((d) => d.id)));
                setLoading(false);
            })
            .catch(() => {
                toast.error("Failed to load designs.");
                setLoading(false);
                onClose();
            });
    }, [project, convex, onClose]);

    const filteredDesigns = useMemo(() => {
        if (!searchQuery) return designs;
        return designs.filter(
            (d) =>
                d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                d.exportName.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [designs, searchQuery]);

    const handleSelectAll = () => {
        if (selectedIds.size === filteredDesigns.length && filteredDesigns.every((d) => selectedIds.has(d.id))) {
            const newSet = new Set(selectedIds);
            filteredDesigns.forEach((d) => newSet.delete(d.id));
            setSelectedIds(newSet);
        } else {
            const newSet = new Set(selectedIds);
            filteredDesigns.forEach((d) => newSet.add(d.id));
            setSelectedIds(newSet);
        }
    };

    const handleToggle = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    const allSelected = filteredDesigns.length > 0 && filteredDesigns.every((d) => selectedIds.has(d.id));

    const handleExport = async () => {
        if (!project) return;
        setExporting(true);
        toast.info(`Generating export for ${selectedIds.size} design(s)...`);

        try {
            const zip = new JSZip();
            let successCount = 0;

            for (const design of designs) {
                if (!selectedIds.has(design.id)) continue;
                try {
                    const geometry = computeSheetMetalGeometry(design.model as any);
                    const dxfString = buildDxf(geometry, design.exportName, design.model as any);
                    const filename = design.exportName.toLowerCase().endsWith(".dxf")
                        ? design.exportName
                        : `${design.exportName}.dxf`;
                    zip.file(filename, dxfString);
                    successCount++;
                } catch (e) {
                    console.error(`Failed to export ${design.name}`, e);
                }
            }

            if (successCount === 0) {
                toast.error("Failed to generate any valid DXF files.");
                setExporting(false);
                return;
            }

            const content = await zip.generateAsync({ type: "blob" });
            saveAs(content, `${project.name.replace(/\s+/g, "_")}-DXF-Batch.zip`);
            toast.success(`Successfully exported ${successCount} design${successCount > 1 ? "s" : ""}!`);
            onClose();
        } catch (error) {
            console.error("Batch export failed", error);
            toast.error("An error occurred during export.");
        } finally {
            setExporting(false);
        }
    };

    return (
        <Dialog open={!!project} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md bg-zinc-950 border-white/10 text-zinc-200">
                <DialogHeader>
                    <DialogTitle>Batch Export .DXF</DialogTitle>
                    <DialogDescription>
                        Select the designs you want to include in the export for {project?.name}.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4 py-4">
                    <Input
                        placeholder="Search designs..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="bg-black/50 border-white/10"
                    />

                    {loading ? (
                        <div className="py-8 flex flex-col items-center justify-center gap-2 text-sm text-zinc-500">
                            <Loader2Icon className="h-6 w-6 animate-spin text-zinc-400" />
                            Loading designs...
                        </div>
                    ) : (
                        <div className="rounded-md flex items-center bg-black/50 border border-white/10 flex-col max-h-[300px] overflow-hidden">
                            <div className="w-full flex items-center justify-between px-3 py-3 border-b border-white/10 bg-white/5 disabled">
                                <label className="flex items-center gap-3 text-sm font-medium leading-none cursor-pointer">
                                    <Checkbox
                                        id="select-all"
                                        checked={allSelected}
                                        onCheckedChange={handleSelectAll}
                                    />
                                    {allSelected ? "Deselect All filtered" : "Select All filtered"} ({filteredDesigns.length})
                                </label>
                            </div>
                            <ScrollArea className="flex-1 overflow-y-auto w-full">
                                <div className="p-1">
                                    {filteredDesigns.length === 0 ? (
                                        <div className="p-4 text-center text-sm text-zinc-500">No designs match your search.</div>
                                    ) : (
                                        filteredDesigns.map((design) => (
                                            <label
                                                key={design.id}
                                                className="flex items-center gap-3 px-2 py-2.5 rounded-sm hover:bg-white/5 cursor-pointer transition-colors"
                                            >
                                                <Checkbox
                                                    checked={selectedIds.has(design.id)}
                                                    onCheckedChange={() => handleToggle(design.id)}
                                                />
                                                <div className="flex flex-col flex-1 min-w-0">
                                                    <span className="text-sm font-medium truncate">{design.name}</span>
                                                    <span className="text-xs text-zinc-500 truncate">{design.exportName}.dxf</span>
                                                </div>
                                            </label>
                                        ))
                                    )}
                                </div>
                            </ScrollArea>
                        </div>
                    )}
                </div>

                <DialogFooter className="flex-row items-center sm:justify-between gap-2">
                    <div className="text-sm text-zinc-500 hidden sm:block">
                        {selectedIds.size} design(s) selected
                    </div>
                    <div className="flex gap-2 w-full sm:w-auto">
                        <Button variant="ghost" className="flex-1 sm:flex-none" onClick={onClose} disabled={exporting}>Cancel</Button>
                        <Button
                            onClick={handleExport}
                            disabled={selectedIds.size === 0 || exporting}
                            className="flex-1 sm:flex-none bg-primary text-primary-foreground"
                        >
                            {exporting ? (
                                <>
                                    <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                                    Exporting...
                                </>
                            ) : (
                                <>
                                    <DownloadIcon className="mr-2 h-4 w-4" />
                                    Export as ZIP
                                </>
                            )}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default function ProjectPage() {
    const { authenticated, isLoadingWorkspace, projects, organizations, selectedProjectId, setSelectedProjectId, setSelectedOrganizationId } = useWorkspace();
    const navigate = useNavigate();
    const convex = useConvex();
    const [exportingProject, setExportingProject] = useState<any>(null);

    // Filtering state
    const [filterOrgId, setFilterOrgId] = useState<string | null>(null);
    const [projectSearchQuery, setProjectSearchQuery] = useState("");

    const filteredProjects = useMemo(() => {
        let result = projects;

        if (filterOrgId) {
            result = result.filter(p => p.organizationId === filterOrgId);
        }

        if (projectSearchQuery) {
            const query = projectSearchQuery.toLowerCase();
            result = result.filter(p =>
                p.name.toLowerCase().includes(query) ||
                p.organizationName.toLowerCase().includes(query) ||
                (p.organizationIcon && p.organizationIcon.includes(query))
            );
        }

        return result;
    }, [projects, filterOrgId, projectSearchQuery]);

    // Portal for Navbar filters
    const [portalMounted, setPortalMounted] = useState(false);
    useEffect(() => {
        setPortalMounted(true);
    }, []);

    const navbarContent = portalMounted && document.getElementById("project-navbar-portal") ? createPortal(
        <div className="flex w-full items-center gap-6">
            <div className="relative flex items-center group">
                <Search className="absolute left-3 size-3.5 text-slate-500 group-focus-within:text-neon-green transition-colors" />
                <Input
                    value={projectSearchQuery}
                    onChange={(e) => setProjectSearchQuery(e.target.value)}
                    placeholder="Search projects..."
                    className="h-9 w-[200px] bg-black/40 border-white/5 pl-9 text-xs font-medium focus:border-neon-green/30 focus:ring-1 focus:ring-neon-green/20"
                />
            </div>

            <div className="h-4 w-[1px] bg-white/10" />

            <div className="flex-1 overflow-x-auto no-scrollbar">
                <div className="flex items-center gap-1.5 p-1">
                    <button
                        onClick={() => setFilterOrgId(null)}
                        className={`flex h-8 items-center gap-2 whitespace-nowrap rounded-lg px-4 text-[10px] font-bold uppercase tracking-widest border transition-all ${filterOrgId === null
                            ? "bg-primary/10 border-primary/30 text-primary shadow-neon-green-sm"
                            : "bg-white/5 border-transparent text-slate-500 hover:bg-white/10 hover:text-white"
                            }`}
                    >
                        <LayoutDashboard className="size-3" />
                        ALL PROJECTS
                    </button>

                    {organizations.map(org => (
                        <button
                            key={org.id}
                            onClick={() => setFilterOrgId(org.id)}
                            className={`flex h-8 items-center gap-2 whitespace-nowrap rounded-lg px-4 text-[10px] font-bold uppercase tracking-widest border transition-all ${filterOrgId === org.id
                                ? "bg-primary/10 border-primary/30 text-primary shadow-neon-green-sm"
                                : "bg-white/5 border-transparent text-slate-500 hover:bg-white/10 hover:text-white"
                                }`}
                        >
                            <span className="text-sm leading-none">{org.icon || "🏢"}</span>
                            {org.name}
                        </button>
                    ))}
                </div>
            </div>
        </div>,
        document.getElementById("project-navbar-portal")!
    ) : null;

    if (isLoadingWorkspace) {
        return (
            <div className="flex h-full items-center justify-center bg-background/50 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-4">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-neon-green border-t-transparent shadow-neon-green-sm" />
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.4em] text-neon-green ml-1">Decoding Projects...</p>
                </div>
            </div>
        );
    }

    if (!authenticated) {
        return (
            <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center p-6 text-center">
                <div className="mb-6 flex size-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-500">
                    <LockKeyhole className="size-8" />
                </div>
                <h2 className="font-display text-2xl font-black uppercase tracking-tight text-white">Authorization Required</h2>
                <p className="mt-2 text-sm text-slate-500">Sign in to access your secure project silos and design pipelines.</p>
                <Button asChild className="mt-8 h-12 w-full bg-neon-green text-black hover:bg-neon-green/90 font-bold uppercase tracking-widest transition-all">
                    <Link to="/auth">Authenticate User</Link>
                </Button>
            </div>
        );
    }

    return (
        <div className="relative min-h-full overflow-y-auto bg-background px-6 py-10 lg:px-12">
            {navbarContent}
            {/* Subtle background effects */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute left-1/2 top-0 h-[400px] w-[600px] -translate-x-1/2 rounded-full bg-neon-green/5 blur-[100px]" />
            </div>

            <div className="relative z-10 mx-auto w-full max-w-[1400px] space-y-10">
                <header className="flex flex-col justify-between gap-6 md:flex-row md:items-end border-b border-white/5 pb-8">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[9px] font-bold uppercase tracking-[0.3em] text-slate-400">
                            Central Repository
                        </div>
                        <h1 className="font-display text-4xl font-black tracking-tighter text-white lg:text-5xl">
                            Project <span className="text-glow-white">Sequences</span>
                        </h1>
                        <p className="max-w-xl text-xs leading-relaxed text-slate-400 uppercase tracking-wider opacity-60">
                            Orchestrating industrial design silos and profile matrix deployments.
                        </p>
                    </div>
                </header>

                <main>
                    {filteredProjects.length === 0 ? (
                        <div className="flex flex-col items-center justify-center rounded-[2.5rem] border border-dashed border-white/10 bg-white/[0.02] py-32 px-10 text-center">
                            <div className="mb-6 flex size-20 items-center justify-center rounded-3xl bg-white/5 text-slate-700">
                                <FileStack className="size-10" />
                            </div>
                            <h3 className="font-display text-xl font-black uppercase tracking-widest text-white">No items found</h3>
                            <p className="mt-2 max-w-sm text-sm text-slate-500 uppercase tracking-wider font-bold">Try adjusting your filters or initialize a new project.</p>
                        </div>
                    ) : (
                        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                            {filteredProjects.map((project, idx) => {
                                const isSelected = project.id === selectedProjectId;
                                return (
                                    <div key={project.id}>
                                        <button
                                            onClick={() => {
                                                setSelectedProjectId(project.id);
                                                setSelectedOrganizationId(project.organizationId);
                                            }}
                                            className={`group relative flex h-full w-full flex-col overflow-hidden rounded-[2.5rem] border p-8 text-left transition-all duration-500 ${isSelected
                                                ? "border-accent/40 bg-accent/5 shadow-neon-magenta-sm"
                                                : "border-white/5 bg-black/40 hover:bg-white/[0.03] hover:border-white/20"
                                                }`}
                                        >
                                            <div className="mb-6 flex items-start justify-between">
                                                <div className="space-y-1.5">
                                                    <h3 className={`font-display text-2xl font-black text-white transition-colors leading-tight ${isSelected ? 'text-accent' : 'group-hover:text-accent'}`}>
                                                        {project.name}
                                                    </h3>
                                                    <div className="flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">
                                                        <span className="text-sm">{project.organizationIcon || "🏢"}</span>
                                                        {project.organizationName}
                                                    </div>
                                                </div>
                                                <div className={`rounded-lg border px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest transition-colors ${isSelected ? "border-accent/40 bg-accent/20 text-accent text-glow-accent-sm" : "border-white/10 bg-black/40 text-slate-400"
                                                    }`}>
                                                    {project.role}
                                                </div>
                                            </div>

                                            <p className="mb-8 line-clamp-3 min-h-[60px] text-xs leading-relaxed text-slate-400 group-hover:text-slate-300">
                                                {project.description || "No technical specification provided. Operating under standard industrial profile protocol."}
                                            </p>

                                            <div className="mt-auto flex flex-col gap-4">
                                                {/* Stats Mini Grid */}
                                                <div className="grid grid-cols-3 gap-2">
                                                    <div className="rounded-xl border border-white/5 bg-black/40 p-2.5 text-center transition-colors group-hover:border-accent/20">
                                                        <p className="text-lg font-black text-white">{project.designs?.length ?? 0}</p>
                                                        <p className="text-[7px] font-bold uppercase tracking-widest text-slate-600">DESIGNS</p>
                                                    </div>
                                                    <div className="rounded-xl border border-white/5 bg-black/40 p-2.5 text-center transition-colors group-hover:border-accent/20">
                                                        <p className="text-lg font-black text-white">{project.ncProgramCount || 0}</p>
                                                        <p className="text-[7px] font-bold uppercase tracking-widest text-slate-600">PROGRAMS</p>
                                                    </div>
                                                    <div className="rounded-xl border border-white/5 bg-black/40 p-2.5 text-center transition-colors group-hover:border-accent/20">
                                                        <p className="text-lg font-black text-white">{project.memberCount || 1}</p>
                                                        <p className="text-[7px] font-bold uppercase tracking-widest text-slate-600">MEMBERS</p>
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-between gap-3 pt-2">
                                                    <div className="font-mono text-[9px] text-slate-700 uppercase tracking-tighter truncate opacity-60">
                                                        ID: {project.slug || project.id.substring(0, 8)}
                                                    </div>
                                                    <div className="flex gap-2">
                                                        {(project.designs?.length ?? 0) > 0 && (
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                className="h-9 w-9 p-0 border border-white/5 hover:bg-white/5"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setExportingProject(project);
                                                                }}
                                                                title="Batch Export"
                                                            >
                                                                <DownloadIcon className="size-4 text-slate-400" />
                                                            </Button>
                                                        )}
                                                        <Button
                                                            variant="neon"
                                                            size="sm"
                                                            className=""
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                navigate(`/project/${project.id}`);
                                                            }}
                                                        >
                                                            Open Project
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Industrial identification lines */}
                                            <div className="absolute left-0 top-1/2 h-12 w-[1px] -translate-y-1/2 bg-white/5" />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </main>
            </div>

            <BatchExportDialog
                project={exportingProject}
                onClose={() => setExportingProject(null)}
                convex={convex}
            />
        </div>
    );
}
