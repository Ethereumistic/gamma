import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { useConvex } from "convex/react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { toast } from "sonner";
import { Loader2Icon, DownloadIcon, CheckIcon } from "lucide-react";

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
    const { authenticated, isLoadingWorkspace, projects } = useWorkspace();
    const convex = useConvex();
    const [exportingProject, setExportingProject] = useState<any>(null);

    if (isLoadingWorkspace) {
        return (
            <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-10 lg:px-8">
                <Card className="border-white/10 bg-card/85">
                    <CardContent className="py-10 text-center text-sm text-muted-foreground">Loading...</CardContent>
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
                        <p>You need to be signed in to view your projects.</p>
                        <Button asChild>
                            <Link to="/auth">Sign in</Link>
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-10 lg:px-8">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
            </div>

            {projects.length === 0 ? (
                <Card className="border-white/10 bg-card/85">
                    <CardHeader>
                        <CardTitle>No projects found</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                        You are not a member of any projects yet.
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {projects.map((project) => (
                        <Card key={project.id} className="flex flex-col border-white/10 bg-card/85 transition-colors hover:bg-card/95">
                            <CardHeader className="pb-4">
                                <CardTitle className="flex items-center justify-between gap-4">
                                    <span className="truncate">{project.name}</span>
                                    <span className="flex-shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                        {project.role}
                                    </span>
                                </CardTitle>
                                <div className="text-xs text-muted-foreground">
                                    Org: {project.organizationName}
                                </div>
                            </CardHeader>
                            <CardContent className="flex flex-1 flex-col gap-4">
                                <div className="flex items-center justify-between text-sm text-muted-foreground">
                                    <span>{project.designs?.length ?? 0} design{(project.designs?.length ?? 0) !== 1 && "s"}</span>
                                </div>

                                {(project.designs?.length ?? 0) > 0 && (
                                    <Accordion type="single" collapsible className="w-full">
                                        <AccordionItem value="designs" className="border-white/10 border-b-0">
                                            <AccordionTrigger className="py-2 text-sm hover:no-underline">
                                                View Designs
                                            </AccordionTrigger>
                                            <AccordionContent>
                                                <div className="flex flex-col gap-2 pt-2">
                                                    {project.designs.map(design => (
                                                        <div key={design.id} className="flex items-center gap-2 rounded-md bg-white/5 px-3 py-2 text-sm">
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="truncate font-medium">{design.name}</span>
                                                                    {design.isStarred && <Badge variant="secondary" className="px-1 py-0 h-4 text-[10px]">★</Badge>}
                                                                </div>
                                                            </div>
                                                            <div className="flex gap-1 shrink-0">
                                                                <Button asChild variant="ghost" size="sm" className="h-6 px-2 text-xs">
                                                                    <Link to={`/project/${project.id}/${design.id}`}>Preview</Link>
                                                                </Button>
                                                                <Button asChild variant="secondary" size="sm" className="h-6 px-2 text-xs">
                                                                    <Link to={`/sheet-metal/${design.id}`}>Edit</Link>
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </AccordionContent>
                                        </AccordionItem>
                                    </Accordion>
                                )}

                                <div className="mt-auto pt-4 flex gap-2">
                                    <Button asChild variant="secondary" className="w-full">
                                        <Link to={`/project/${project.id}`}>View Project Details</Link>
                                    </Button>
                                    {(project.designs?.length ?? 0) > 0 && (
                                        <Button
                                            variant="outline"
                                            className="w-full"
                                            onClick={() => setExportingProject(project)}
                                        >
                                            <DownloadIcon className="mr-2 h-4 w-4" />
                                            Batch Export .DXF
                                        </Button>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            <BatchExportDialog
                project={exportingProject}
                onClose={() => setExportingProject(null)}
                convex={convex}
            />
        </div>
    );
}
