import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { computeSheetMetalGeometry, countShapes } from "@/features/sheet-metal/geometry";
import { PreviewCanvas } from "@/features/sheet-metal/preview-canvas";
import { useWorkspace } from "@/features/workspace/context";

export default function DesignDetailPage() {
    const { projectId, designId } = useParams<{ projectId: string; designId: string }>();
    const { authenticated, isLoadingWorkspace } = useWorkspace();

    const design = useQuery(api.designs.getDesign, designId ? { designId: designId as Id<"designs"> } : "skip");

    const geometry = useMemo(() => {
        if (!design?.model) return null;
        return computeSheetMetalGeometry(design.model);
    }, [design?.model]);

    if (isLoadingWorkspace || design === undefined) {
        return (
            <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-10 lg:px-8">
                <Card className="border-white/10 bg-card/85">
                    <CardContent className="py-10 text-center text-sm text-muted-foreground">Loading preview...</CardContent>
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
                        <p>You need to be signed in to view this design.</p>
                        <Button asChild>
                            <Link to="/auth">Sign in</Link>
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (design === null) {
        return (
            <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-10 lg:px-8">
                <Card className="border-white/10 bg-card/85">
                    <CardHeader>
                        <CardTitle>Design not found</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                        You do not have access to this design or it does not exist.
                    </CardContent>
                    <CardContent>
                        <Button asChild>
                            <Link to={`/project/${projectId}`}>Back to Project</Link>
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (!geometry) {
        return null;
    }

    return (
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 py-10 lg:px-8">
            <div className="flex items-center gap-4">
                <Button asChild variant="outline" size="sm" className="hidden sm:flex">
                    <Link to={`/project/${projectId}`}>← Back to Project</Link>
                </Button>
                <h1 className="text-3xl font-bold tracking-tight">{design.name}</h1>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1fr,320px]">
                <Card className="overflow-hidden border-white/10 bg-card/80 shadow-2xl backdrop-blur-xl">
                    <CardHeader className="flex flex-col gap-4 border-b border-white/6 bg-white/[0.02] px-5 pb-4 pt-5 md:flex-row md:items-end md:justify-between">
                        <div>
                            <CardTitle>Visualization Preview</CardTitle>
                            <p className="mt-1 text-sm text-muted-foreground">Production geometry view only</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Badge variant="outline">CUT ({countShapes(geometry.shapes, "CUT")})</Badge>
                            <Badge variant="secondary">FREZ ({countShapes(geometry.shapes, "FREZ")})</Badge>
                            <Badge variant="outline">{geometry.totalWidth} x {geometry.totalHeight} mm</Badge>
                        </div>
                    </CardHeader>
                    <CardContent className="p-4">
                        <div className="panel-grid relative overflow-hidden rounded-[1.25rem] border border-white/8 bg-[#090d16] p-2">
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_34%)]" />
                            <div className="relative h-[600px] w-full">
                                <PreviewCanvas geometry={geometry} />
                            </div>
                        </div>

                        {geometry.warnings.length > 0 && (
                            <div className="relative mt-4 overflow-hidden rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
                                <strong className="mb-1 block font-semibold">Geometry warnings</strong>
                                <ul className="list-inside list-disc opacity-90">
                                    {geometry.warnings.map((warning, index) => (
                                        <li key={index}>{warning}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <div className="flex flex-col gap-6">
                    <Card className="border-white/10 bg-card/85">
                        <CardHeader>
                            <CardTitle>Design Details</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4 text-sm text-muted-foreground">
                            <div className="flex justify-between border-b border-white/5 pb-2">
                                <span>Created by</span>
                                <span className="font-medium text-foreground">{design.updatedByName}</span>
                            </div>
                            <div className="flex justify-between border-b border-white/5 pb-2">
                                <span>Last Updated</span>
                                <span className="font-medium text-foreground">{new Date(design.updatedAt).toLocaleDateString()}</span>
                            </div>
                            <div className="flex justify-between border-b border-white/5 pb-2">
                                <span>Base Size</span>
                                <span className="font-medium text-foreground">{design.model.baseWidth} x {design.model.baseHeight} mm</span>
                            </div>
                            <div className="pt-4">
                                <Button asChild className="w-full">
                                    <Link to={`/sheet-metal/${design.id}`}>Open in Editor</Link>
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
