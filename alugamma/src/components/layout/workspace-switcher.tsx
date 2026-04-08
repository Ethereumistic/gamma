import * as React from "react"
import { Building2, ChevronsUpDown, Plus, Folder, LayoutDashboard } from "lucide-react"
import { useNavigate, useLocation } from "react-router-dom"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useWorkspace } from "@/features/workspace/context"
import { useSheetMetal } from "@/features/sheet-metal/context"
import { ScrollArea } from "@/components/ui/scroll-area"

export function WorkspaceSwitcher() {
  const navigate = useNavigate()
  const location = useLocation()
  const {
    organizations,
    projects,
    selectedOrganizationId,
    selectedProjectId,
    setSelectedOrganizationId,
    setSelectedProjectId,
    selectedOrganization,
    selectedProject
  } = useWorkspace()
  const { saveDesign } = useSheetMetal()
  const [open, setOpen] = React.useState(false)

  const pathIsSheetMetal = location.pathname.startsWith("/sheet-metal")

  async function handleOrganizationChange(orgId: string) {
    if (pathIsSheetMetal) {
      await saveDesign()
    }

    setSelectedOrganizationId(orgId as any)
    const orgProjects = projects.filter((p) => p.organizationId === orgId)
    if (orgProjects.length > 0) {
      setSelectedProjectId(orgProjects[0].id)
    } else {
      setSelectedProjectId(null)
    }

    setOpen(false)

    if (pathIsSheetMetal) {
      navigate("/sheet-metal/new")
    }
  }

  async function handleProjectChange(projectId: string) {
    if (pathIsSheetMetal) {
      await saveDesign()
    }

    const project = projects.find((p) => p.id === projectId)
    if (project) {
      setSelectedOrganizationId(project.organizationId)
      setSelectedProjectId(projectId as any)
    }

    setOpen(false)

    if (pathIsSheetMetal) {
      navigate("/sheet-metal/new")
    }
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="bg-white/[0.03] border border-white/10 hover:bg-white/[0.06] hover:border-white/20 group h-14 rounded-xl shadow-[inset_0_0_20px_rgba(255,255,255,0.02)]"
            >
              <div className="flex aspect-square size-10 items-center justify-center rounded-lg bg-gradient-to-br from-neon-green/20 to-neon-green/5 border border-neon-green/20 text-neon-green shadow-neon-green-sm text-xl">
                {selectedOrganization?.icon ? (
                  <span>{selectedOrganization.icon}</span>
                ) : (
                  <Building2 className="size-5 text-glow-green-sm" />
                )}
              </div>
              <div className="grid flex-1 text-left text-xs leading-tight ml-3">
                <span className="truncate font-bold text-white uppercase tracking-widest">
                  {selectedOrganization?.name ?? "Select Org"}
                </span>
                <span className="truncate text-[10px] text-slate-500 font-mono tracking-tighter mt-0.5">
                  {selectedProject?.name ?? "Select Project"}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-3.5 text-slate-600 group-hover:text-neon-green" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-64 rounded-xl border-white/10 bg-background p-2 text-slate-200 shadow-2xl backdrop-blur-xl"
            align="start"
            sideOffset={8}
          >
            <DropdownMenuLabel className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Workspaces & Projects
            </DropdownMenuLabel>

            <ScrollArea className="mt-2 h-[320px] pr-4">
              <div className="space-y-1">
                {organizations.map((org) => {
                  const orgProjects = projects.filter(p => p.organizationId === org.id)
                  const isOrgSelected = org.id === selectedOrganizationId

                  return (
                    <div key={org.id} className="space-y-0.5 mb-2 last:mb-0">
                      <button
                        onClick={() => handleOrganizationChange(org.id)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left group/org",
                          isOrgSelected
                            ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                            : "text-slate-400 hover:bg-white/5 hover:text-white"
                        )}
                      >
                        <div className={cn(
                          "flex size-7 items-center justify-center rounded-md border text-base",
                          isOrgSelected
                            ? "border-primary/40 bg-primary/20 shadow-neon-green-sm"
                            : "border-white/10 bg-black/40 group-hover/org:border-white/20"
                        )}>
                          {org.icon ? (
                            <span>{org.icon}</span>
                          ) : (
                            <Building2 className={cn("size-4", isOrgSelected && "text-glow-green-sm")} />
                          )}
                        </div>
                        <span className="text-xs font-bold uppercase tracking-widest truncate flex-1">{org.name}</span>
                        {isOrgSelected && (
                          <div className="size-1.5 rounded-full bg-primary shadow-neon-green mx-1 animate-pulse" />
                        )}
                      </button>

                      <div className="ml-4 pl-4 border-l border-white/5 space-y-0.5 mt-0.5">
                        {orgProjects.map((project) => {
                          const isProjectSelected = project.id === selectedProjectId
                          return (
                            <button
                              key={project.id}
                              onClick={() => handleProjectChange(project.id)}
                              className={cn(
                                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[11px] group/prj",
                                isProjectSelected
                                  ? "bg-accent/10 text-accent ring-1 ring-accent/20 font-bold"
                                  : "text-slate-500 hover:bg-white/5 hover:text-slate-300"
                              )}
                            >
                              <div className={cn(
                                "flex size-5 items-center justify-center rounded border",
                                isProjectSelected
                                  ? "border-accent/40 bg-accent/20 shadow-neon-magenta-sm"
                                  : "border-white/5 bg-black/40 group-hover/prj:border-white/10"
                              )}>
                                <Folder className={cn("size-3", isProjectSelected && "text-glow-magenta-sm")} />
                              </div>
                              <span className="truncate tracking-wide flex-1">{project.name}</span>
                              {isProjectSelected && (
                                <div className="size-1 rounded-full bg-accent shadow-neon-magenta animate-pulse" />
                              )}
                            </button>
                          )
                        })}

                        {orgProjects.length === 0 && (
                          <div className="px-2 py-1.5 text-[10px] italic text-slate-600">
                            No projects in this organization
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>

            <DropdownMenuSeparator className="my-2 bg-white/5" />

            <div className="space-y-1">
              <DropdownMenuItem
                onClick={() => navigate("/organization")}
                className="flex items-center gap-3 rounded-lg py-2.5 cursor-pointer focus:bg-primary/10 focus:text-primary"
              >
                <div className="flex size-7 items-center justify-center rounded-lg border border-dashed border-white/20 bg-black/40 shadow-inner">
                  <Building2 className="size-3.5" />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest">Manage Organizations</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => navigate("/project")}
                className="flex items-center gap-3 rounded-lg py-2.5 cursor-pointer focus:bg-primary/10 focus:text-primary"
              >
                <div className="flex size-7 items-center justify-center rounded-lg border border-dashed border-white/20 bg-black/40 shadow-inner">
                  <LayoutDashboard className="size-3.5" />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest">Manage Projects</span>
              </DropdownMenuItem>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
