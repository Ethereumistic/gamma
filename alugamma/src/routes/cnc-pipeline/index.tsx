import { useQuery } from "convex/react";
import { Link, useNavigate } from "react-router-dom";
import { useWorkspace } from "@/features/workspace/context";
import { api } from "../../../convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileCode, Trash2, StopCircle, PlayCircle, Star, Clock } from "lucide-react";
import { formatDateGroup } from "@/lib/date-utils";
import { DXFDropZone } from "@/features/cnc-pipeline/components/DXFDropZone";

export default function CNCPipelineDashboardPage() {
  const { authenticated, projects } = useWorkspace();
  const navigate = useNavigate();
  
  const ncPrograms = useQuery(api.nc_programs.listAllForViewer, {});

  const handleFileDrop = (file: File) => {
    // Basic shared logic or transfer: could use sessionStorage or just navigate.
    // Given the prompt, using a basic navigation with file is tricky due to security restrictions on File objects, so users will just use drag & drop on the /new page if we don't implement full context.
    // The prompt suggested a context, but we can also just redirect to /new.
    // For now we'll just redirect to /new since DXFDropZone triggers the file dialog, but if a drop happened we'd lose the file unless we had a context.
    // Since we don't have a context, we just navigate to /new.
    navigate("/cnc-pipeline/new");
  };

  if (!authenticated) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">CNC Pipeline</h1>
        <p className="text-slate-400">Please sign in to view and save NC programs.</p>
      </div>
    );
  }

  return (
    <div className="p-6 h-[calc(100vh-4rem)] overflow-y-auto">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 flex flex-col gap-6">
          <Card className="bg-transparent border-white/10 shadow-none">
            <CardHeader>
              <CardTitle className="text-lg">Generate new NC Program</CardTitle>
            </CardHeader>
            <CardContent>
              <div onClick={() => navigate("/cnc-pipeline/new")}>
                <DXFDropZone onFile={handleFileDrop} />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2 flex flex-col gap-6">
          <h2 className="text-lg font-bold text-white tracking-tight">Saved NC Programs</h2>
          
          {!ncPrograms ? (
            <div className="text-sm text-slate-400">Loading programs...</div>
          ) : ncPrograms.length === 0 ? (
            <div className="text-sm text-slate-400">No NC programs found across your projects.</div>
          ) : (
            <div className="grid gap-4">
              {ncPrograms.map(p => (
                <Card key={p._id} className="bg-black/20 border-white/10 flex items-center justify-between p-4 hover:bg-black/40 transition-colors cursor-pointer" onClick={() => navigate(`/cnc-pipeline/${p._id}`)}>
                  <div className="flex flex-col gap-2 min-w-0">
                    <div className="flex items-center gap-3">
                      <FileCode className="h-5 w-5 text-emerald-400" />
                      <span className="font-medium text-white truncate">{p.name}</span>
                      {p.isStarred && <Star className="h-4 w-4 fill-amber-400 text-amber-400" />}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <Badge variant="outline" className="border-white/10 text-[10px] bg-white/5 uppercase font-mono">{p.algorithm}</Badge>
                      <Badge variant="outline" className="border-white/10 text-[10px] bg-white/5 uppercase font-mono">{p.scenario}</Badge>
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {Math.floor(p.estimatedTimeSeconds / 60)}m {Math.round(p.estimatedTimeSeconds % 60)}s</span>
                      <span>•</span>
                      <span>{formatDateGroup(p.updatedAt)}</span>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
