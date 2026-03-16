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
              className="bg-white/5 border border-white/10 hover:bg-white/10 transition-colors duration-200 group h-14"
            >
              <div className="flex aspect-square size-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 border border-emerald-500/20 text-emerald-400 group-hover:scale-105 transition-transform duration-200">
                <Building2 className="size-5" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight ml-2">
                <span className="truncate font-semibold text-white tracking-tight">
                  {selectedOrganization?.name ?? "Select Organization"}
                </span>
                <span className="truncate text-[11px] text-slate-400 font-medium">
                  {selectedProject?.name ?? "Select Project"}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 text-slate-500 group-hover:text-slate-300 transition-colors" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-64 rounded-xl border-white/10 bg-[#0c1425] p-2 text-slate-200 shadow-2xl backdrop-blur-xl"
            align="start"
            sideOffset={8}
          >
            <DropdownMenuLabel className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Workspaces & Projects
            </DropdownMenuLabel>
            
            <ScrollArea className="mt-1 max-h-[280px] overflow-y-auto pr-3">
              <div className="space-y-1">
                {organizations.map((org) => {
                  const orgProjects = projects.filter(p => p.organizationId === org.id)
                  const isOrgSelected = org.id === selectedOrganizationId

                  return (
                    <div key={org.id} className="space-y-0.5 mb-2 last:mb-0">
                      <button
                        onClick={() => handleOrganizationChange(org.id)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-all duration-200",
                          isOrgSelected 
                            ? "bg-emerald-500/10 text-emerald-400" 
                            : "text-slate-300 hover:bg-white/5 hover:text-white"
                        )}
                      >
                        <div className={cn(
                          "flex size-6 items-center justify-center rounded-md border transition-colors",
                          isOrgSelected 
                            ? "border-emerald-500/20 bg-emerald-500/10" 
                            : "border-white/10 bg-white/5"
                        )}>
                          <Building2 className="size-3.5" />
                        </div>
                        <span className="text-sm font-semibold truncate flex-1">{org.name}</span>
                        {isOrgSelected && (
                          <div className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
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
                                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-all duration-200",
                                isProjectSelected 
                                  ? "bg-white/10 text-white font-medium shadow-sm" 
                                  : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                              )}
                            >
                              <Folder className={cn(
                                "size-3",
                                isProjectSelected ? "text-emerald-400" : "text-slate-500"
                              )} />
                              <span className="truncate">{project.name}</span>
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
                className="flex items-center gap-2 rounded-lg py-2 hover:bg-emerald-500/10 hover:text-emerald-400 cursor-pointer transition-colors"
              >
                <div className="flex size-6 items-center justify-center rounded-md border border-dashed border-white/20">
                  <Building2 className="size-3.5" />
                </div>
                <span className="text-xs font-medium">Manage Organizations</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => navigate("/project")}
                className="flex items-center gap-2 rounded-lg py-2 hover:bg-emerald-500/10 hover:text-emerald-400 cursor-pointer transition-colors"
              >
                <div className="flex size-6 items-center justify-center rounded-md border border-dashed border-white/20">
                  <LayoutDashboard className="size-3.5" />
                </div>
                <span className="text-xs font-medium">Manage Projects</span>
              </DropdownMenuItem>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
