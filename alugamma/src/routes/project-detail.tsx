import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/features/workspace/context";
import { computeSheetMetalGeometry } from "@/features/sheet-metal/geometry";
import { PreviewCanvas } from "@/features/sheet-metal/preview-canvas";

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
                {/* Overlay actions */}
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

export default function ProjectDetailPage() {
    const { projectId } = useParams<{ projectId: string }>();
    const [searchParams] = useSearchParams();
    const cols = parseInt(searchParams.get("cols") || "3", 10);
    const { authenticated, isLoadingWorkspace, projects } = useWorkspace();
    const designs = useQuery(api.designs.listByProject, { projectId: projectId as Id<"projects"> });

    if (isLoadingWorkspace || designs === undefined) {
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

    const gridClasses = {
        1: "grid-cols-1",
        2: "grid-cols-1 sm:grid-cols-2",
        3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
        4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
        5: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-5",
    }[cols] || "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";

    return (
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-10 lg:px-8">
            <div className="grid gap-6">
                <Card className="border-white/10 bg-card/85">
                    <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-4">
                        <div>
                            <CardTitle>Designs in {project.name}</CardTitle>
                            {project.description && (
                                <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>
                            )}
                        </div>
                        <Button asChild size="sm">
                            <Link to={`/sheet-metal/new?project=${project.id}`}>New Design</Link>
                        </Button>
                    </CardHeader>
                    <CardContent>
                        {designs.length === 0 ? (
                            <p className="text-sm text-muted-foreground mt-4 text-center py-8 border border-dashed border-white/10 rounded-xl bg-black/10">No designs created yet.</p>
                        ) : (
                            <div className={`grid gap-4 ${gridClasses}`}>
                                {designs.map((design) => (
                                    <DesignCard key={design.id} design={design} projectId={project.id} />
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
