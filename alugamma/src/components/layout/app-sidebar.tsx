import React from "react";
import { FileStack, Star } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { Sidebar, SidebarContent } from "@/components/ui/sidebar";
import { useSheetMetal } from "@/features/sheet-metal/context";
import { useWorkspace } from "@/features/workspace/context";
import { useDesignDelete } from "@/features/workspace/design-delete-context";
import { useRenameDialog } from "@/hooks/use-rename-dialog";
import { SCENARIO_LABELS } from "@/features/cnc-pipeline/constants";
import type { NcProgramSummary } from "@/features/cnc-pipeline/types";

import { SidebarHeaderSection } from "./sidebar/sidebar-header-section";
import { SidebarNavSection } from "./sidebar/sidebar-nav-section";
import { SidebarItemList } from "./sidebar/sidebar-item-list";
import { SidebarRenameDialog } from "./sidebar/sidebar-rename-dialog";
import { SidebarFooterSection } from "./sidebar/sidebar-footer-section";

export function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { selectedProject, selectedProjectId, authenticated } = useWorkspace();
  const { startNewDesign } = useSheetMetal();
  const { setDesignToDelete } = useDesignDelete();

  const pathIsSheetMetal = location.pathname.startsWith("/sheet-metal");
  const pathIsNesting = location.pathname.startsWith("/nesting");
  const pathIsCNCPipeline = location.pathname.startsWith("/cnc-pipeline");

  // --- Design mutations ---
  const duplicateDesign = useMutation(api.designs.duplicateDesign);
  const toggleStarDesign = useMutation(api.designs.toggleStarDesign);
  const renameDesign = useMutation(api.designs.renameDesign);

  // --- NC Program mutations & query ---
  const toggleStarNcProgram = useMutation(api.nc_programs.toggleStar);
  const deleteNcProgram = useMutation(api.nc_programs.deleteNcProgram);
  const updateNcProgram = useMutation(api.nc_programs.updateNcProgram);

  const ncPrograms = useQuery(
    api.nc_programs.listByProject,
    selectedProject ? { projectId: selectedProject.id } : "skip"
  ) as NcProgramSummary[] | undefined;

  // --- Rename dialogs ---
  const designRename = useRenameDialog<Id<"designs">>({
    onConfirm: (id, name) => void renameDesign({ designId: id, name }),
  });

  const ncProgramRename = useRenameDialog<Id<"nc_programs">>({
    onConfirm: async (id, name) => {
      if (selectedProjectId) {
        await updateNcProgram({ projectId: selectedProjectId, ncProgramId: id, name });
      }
    },
    guard: () => !!selectedProjectId,
  });

  // --- NC program delete state (replaces window.confirm) ---
  const [ncProgramToDelete, setNcProgramToDelete] = React.useState<{ id: Id<"nc_programs">; name: string } | null>(null);

  const showDesignsPanel = authenticated && selectedProject && pathIsSheetMetal;
  const showNcPanel = authenticated && selectedProject && pathIsCNCPipeline;

  return (
    <>
      <Sidebar className="border-r border-white/10 bg-[linear-gradient(180deg,rgba(10,10,10,0.98),rgba(6,6,6,0.99))]">
        <SidebarHeaderSection />

        <SidebarContent className="overflow-hidden">
          <SidebarNavSection />

          {showDesignsPanel && (
            <SidebarItemList
              label={<span className="text-nowrap truncate">DXFs in <span className="text-white ml-1">{selectedProject.name}</span></span>}
              searchPlaceholder="Search designs..."
              emptyMessage="No saved designs yet."
              items={selectedProject.designs}
              sortField="createdAt"
              activeItemId={location.pathname.split("/sheet-metal/")[1]}
              getItemUrl={(d) => `/sheet-metal/${d.id}`}
              getItemId={(d) => d.id}
              onAdd={() => {
                if (location.pathname === "/sheet-metal" || location.pathname === "/sheet-metal/new") {
                  startNewDesign();
                }
                navigate("/sheet-metal/new");
              }}
              addTitle="New design"
              renderIcon={(d, isActive) =>
                d.isStarred
                  ? <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                  : <FileStack className={cn("h-4 w-4 transition-colors", isActive ? "text-primary" : "opacity-70")} />
              }
              getActions={(d) => [
                { label: d.isStarred ? "Unstar" : "Star design", onClick: () => toggleStarDesign({ designId: d.id, isStarred: !d.isStarred }) },
                { label: "Rename", onClick: () => designRename.openDialog({ id: d.id, name: d.name }) },
                { label: "Duplicate", onClick: async () => { const newId = await duplicateDesign({ designId: d.id }); navigate(`/sheet-metal/${newId}`); } },
                { label: "Delete design", onClick: () => setDesignToDelete(d.id), destructive: true },
              ]}
              onDuplicate={async (d) => { const newId = await duplicateDesign({ designId: d.id }); navigate(`/sheet-metal/${newId}`); }}
              onRename={(d) => designRename.openDialog({ id: d.id, name: d.name })}
              onDelete={(d) => setDesignToDelete(d.id)}
            />
          )}

          {showNcPanel && (
            <SidebarItemList
              label={<span className="text-nowrap truncate">NCs <span className="text-white ml-1">{selectedProject.name}</span></span>}
              searchPlaceholder="Search NC programs..."
              emptyMessage="No saved NC programs."
              items={ncPrograms}
              sortField="updatedAt"
              activeItemId={location.pathname.split("/cnc-pipeline/")[1]}
              getItemUrl={(p) => `/cnc-pipeline/${p._id}`}
              getItemId={(p) => p._id}
              onAdd={() => navigate("/cnc-pipeline/new")}
              addTitle="New NC program"
              renderIcon={(p, isActive) =>
                p.isStarred
                  ? <Star className="h-4 w-4 fill-amber-400 text-amber-400 shrink-0" />
                  : <FileStack className={cn("h-4 w-4 shrink-0 transition-colors", isActive ? "text-primary " : "opacity-70")} />
              }
              getActions={(p) => [
                { label: p.algorithm },
                { label: SCENARIO_LABELS[p.scenario] || p.scenario },
                { label: p.isStarred ? "Unstar" : "Star program", onClick: () => toggleStarNcProgram({ projectId: selectedProject.id, ncProgramId: p._id }) },
                { label: "Rename", onClick: () => ncProgramRename.openDialog({ id: p._id, name: p.name }) },
                { label: "Delete program", onClick: () => setNcProgramToDelete({ id: p._id, name: p.name }), destructive: true },
              ]}
              onRename={(p) => ncProgramRename.openDialog({ id: p._id, name: p.name })}
              onDelete={(p) => setNcProgramToDelete({ id: p._id, name: p.name })}
            />
          )}
        </SidebarContent>

        <SidebarFooterSection />
      </Sidebar>

      {/* Design rename dialog */}
      <SidebarRenameDialog
        open={designRename.isOpen}
        onOpenChange={(open) => !open && designRename.closeDialog()}
        title="Rename Design"
        description="Enter a new identifier for this design profile."
        value={designRename.renameValue}
        onChange={designRename.setRenameValue}
        onConfirm={designRename.confirmRename}
        confirmLabel="Update Design"
        canConfirm={designRename.canConfirm}
        onKeyDown={designRename.handleKeyDown}
      />

      {/* NC Program rename dialog */}
      <SidebarRenameDialog
        open={ncProgramRename.isOpen}
        onOpenChange={(open) => !open && ncProgramRename.closeDialog()}
        title="Rename NC Program"
        description="Update the identifier for this CNC production sequence."
        value={ncProgramRename.renameValue}
        onChange={ncProgramRename.setRenameValue}
        onConfirm={ncProgramRename.confirmRename}
        confirmLabel="Update Program"
        canConfirm={ncProgramRename.canConfirm}
        onKeyDown={ncProgramRename.handleKeyDown}
      />

      {/* NC Program delete confirmation dialog (replaces window.confirm) */}
      <SidebarRenameDialog
        open={ncProgramToDelete !== null}
        onOpenChange={(open) => !open && setNcProgramToDelete(null)}
        title="Delete NC Program"
        description={`Are you sure you want to delete "${ncProgramToDelete?.name ?? ""}"? This action cannot be undone.`}
        value=""
        onChange={() => { }}
        onConfirm={async () => {
          if (ncProgramToDelete && selectedProject) {
            await deleteNcProgram({ projectId: selectedProject.id, ncProgramId: ncProgramToDelete.id });
            setNcProgramToDelete(null);
          }
        }}
        confirmLabel="Delete Program"
        canConfirm={true}
      />
    </>
  );
}
