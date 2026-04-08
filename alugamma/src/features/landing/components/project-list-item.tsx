import { ChevronRight } from "lucide-react";
import type { ProjectSummary } from "@/features/workspace/context";

interface ProjectListItemProps {
  project: ProjectSummary;
  onSelect: (projectId: string) => void;
}

export function ProjectListItem({ project, onSelect }: ProjectListItemProps) {
  return (
    <button
      onClick={() => onSelect(project.id)}
      className="w-full group relative flex flex-col gap-1 rounded-2xl border border-white/5 bg-black/40 p-4 transition-all hover:border-primary/40 hover:bg-primary/5 hover:shadow-neon-green-sm"
    >
      <div className="flex items-center justify-between">
        <h4 className="font-display text-sm font-bold text-white group-hover:text-primary transition-colors truncate">
          {project.name}
        </h4>
        <ChevronRight className="size-3 text-slate-600 group-hover:text-primary transition-colors" />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs">{project.organizationIcon || "🏢"}</span>
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 truncate">
          {project.organizationName}
        </p>
      </div>
      <p className="mt-1 text-[8px] font-mono text-slate-600 uppercase tracking-tighter">
        Updated {new Date(project.updatedAt).toLocaleDateString()}
      </p>
    </button>
  );
}
