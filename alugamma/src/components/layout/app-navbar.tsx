import { useLocation, useNavigate, Link, useSearchParams, matchPath } from "react-router-dom";
import { Bell, Building2, FolderKanban, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { useSheetMetal } from "@/features/sheet-metal/context";
import { ExportSettingsDialog } from "@/features/sheet-metal/export-settings-dialog";
import { presetLibrary } from "@/features/sheet-metal/presets";
import { useWorkspace } from "@/features/workspace/context";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

function NavNumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      <div className="relative">
        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value === 0 ? "" : value.toString()}
          onChange={(event) => {
            const raw = event.target.value.replace(/[^0-9]/g, "");
            onChange(raw === "" ? 0 : Number(raw));
          }}
          className="h-8 w-[80px] bg-black/20 px-2 pr-6 font-mono text-xs transition-colors focus-visible:ring-1 focus-visible:ring-emerald-500"
        />
        <span className="absolute right-2 top-1.5 text-[10px] font-medium text-muted-foreground">mm</span>
      </div>
    </div>
  );
}

export function AppNavbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const isSheetMetal = location.pathname.startsWith("/sheet-metal");
  const isCncPipeline = location.pathname.startsWith("/cnc-pipeline");
  const isHome = location.pathname === "/";
  const isOrganizations = location.pathname === "/organization";
  const isProjects = location.pathname === "/project";
  const projectDetailMatch = matchPath("/project/:projectId", location.pathname);

  const {
    model,
    designName,
    setDesignName,
    setBaseValue,
    setIncludeName,
    setIncludeArrow,
    setArrowDirection,
    setInvert,
    setRubberband,
    loadPreset,
    exportDxf,
    saveDesign,
    isSaving,
  } = useSheetMetal();
  const { viewer, selectedProject, selectedOrganization, selectedOrganizationId, selectedProjectId, pendingInvites, setSelectedProjectId, setSelectedOrganizationId } = useWorkspace();
  
  const acceptProjectInvite = useMutation(api.workspaces.acceptProjectInvite);

  async function handleSave() {
    const designId = await saveDesign();
    if (designId) {
      navigate(`/sheet-metal/${designId}`, { replace: true });
    }
  }

  async function handleExport() {
    const designId = await exportDxf();
    if (designId) {
      navigate(`/sheet-metal/${designId}`, { replace: true });
    }
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center gap-4 border-b border-white/5 bg-card/60 px-6 backdrop-blur">
      <SidebarTrigger className="text-muted-foreground hover:text-white" />

      {isHome && (
        <div className="flex flex-1 items-center gap-4 text-sm">
           <div className="flex items-center gap-2 font-display text-xs font-black uppercase tracking-[0.2em] text-white">
             Hello <span className="text-neon-green">{viewer?.name || "User"}</span>
           </div>
        </div>
      )}

      {isOrganizations && (
        <div className="flex flex-1 items-center gap-4">
          <h1 className="text-sm font-semibold text-foreground uppercase tracking-widest">Industry Directory</h1>
        </div>
      )}

      {isProjects && (
        <div id="project-navbar-portal" className="flex flex-1 items-center gap-4 overflow-x-auto min-w-0 no-scrollbar" />
      )}

      {/* Target for CNCPipelinePage Portal Actions */}
      {isCncPipeline && (
        <div id="cnc-navbar-portal" className="flex flex-1 items-center justify-between gap-4 overflow-x-auto" />
      )}

      {projectDetailMatch && (
        <div className="flex flex-1 items-center justify-between gap-4">
          <div className="flex items-center gap-4 mt-0.5">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink href="/">Home</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink href="/organization">Organization</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Project Details</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Columns</span>
            <Select
              value={searchParams.get("cols") || "3"}
              onValueChange={(val) => {
                setSearchParams((prev) => {
                  prev.set("cols", val);
                  return prev;
                });
              }}
            >
              <SelectTrigger className="h-8 w-[80px] bg-black/20 text-xs">
                <SelectValue placeholder="Cols" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">x1</SelectItem>
                <SelectItem value="2">x2</SelectItem>
                <SelectItem value="3">x3</SelectItem>
                <SelectItem value="4">x4</SelectItem>
                <SelectItem value="5">x5</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {isSheetMetal && (
        <div className="flex flex-1 items-center gap-4 overflow-x-auto">
          <div className="min-w-[240px] max-w-[340px] flex-1 items-center gap-2 md:flex">
            <span className="hidden text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:block">Design</span>
            <Input
              value={designName}
              onChange={(event) => setDesignName(event.target.value)}
              onKeyDown={(e) => {
                if (!e.ctrlKey && !e.metaKey && !e.altKey) {
                  e.stopPropagation();
                }
              }}
              placeholder="e.g. facade-panel-01"
              className="h-8 border-white/10 bg-black/20 text-xs"
            />
          </div>

          <div className="hidden items-center gap-2 lg:flex">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Preset</span>
            <Select
              onValueChange={(value) => {
                loadPreset(Number(value));
                navigate("/sheet-metal");
              }}
            >
              <SelectTrigger className="h-8 w-[170px] border-white/10 bg-black/20 text-xs hover:bg-white/5 focus:ring-1 focus:ring-emerald-500">
                <SelectValue placeholder="Select preset..." />
              </SelectTrigger>
              <SelectContent>
                {presetLibrary.map((preset, index) => (
                  <SelectItem key={preset.name} value={index.toString()}>
                    {preset.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="hidden h-4 w-px bg-white/10 lg:block" />

          <div className="hidden items-center gap-4 xl:flex">
            <NavNumberField label="W" value={model.baseWidth} onChange={(value) => setBaseValue("baseWidth", value)} />
            <span className="mb-0.5 font-bold text-muted-foreground/30">×</span>
            <NavNumberField label="H" value={model.baseHeight} onChange={(value) => setBaseValue("baseHeight", value)} />
          </div>

          <div className="hidden h-4 w-px bg-white/10 xl:block" />

          <div className="hidden items-center gap-4 2xl:flex">
            <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-white">
              <Checkbox
                checked={model.invertX}
                onCheckedChange={(checked) => setInvert("invertX", !!checked)}
                className="h-3.5 w-3.5 border-white/20 data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500"
              />
              Invert X
            </label>
            <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-white">
              <Checkbox
                checked={model.invertY}
                onCheckedChange={(checked) => setInvert("invertY", !!checked)}
                className="h-3.5 w-3.5 border-white/20 data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500"
              />
              Invert Y
            </label>
          </div>

          <div className="h-4 w-px bg-white/10" />

          <div className="flex items-center gap-2 text-glow-none">
            <ExportSettingsDialog
              model={model}
              onSetIncludeName={setIncludeName}
              onSetIncludeArrow={setIncludeArrow}
              onSetArrowDirection={setArrowDirection}
              onSetRubberband={setRubberband}
            />
            <Button size="sm" variant="outline" className="h-8 px-4 text-xs" onClick={() => void handleSave()} disabled={!selectedProject || isSaving}>
              Save
            </Button>
            <Button
              size="sm"
              className="h-8 px-4 text-xs shadow-[0_0_15px_rgba(20,180,100,0.15)]"
              onClick={() => void handleExport()}
              disabled={!selectedProject || isSaving}
            >
              {isSaving ? "Saving..." : "Save + Export DXF"}
            </Button>
          </div>
        </div>
      )}

      <div className="ml-auto flex items-center gap-3">
        {/* Notification Bell */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative h-10 w-10 border border-white/5 bg-black/20 text-slate-400 hover:text-white">
              <Bell className="size-5" />
              {pendingInvites.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-neon-magenta text-[8px] font-bold text-white shadow-neon-magenta-sm ring-2 ring-background">
                  {pendingInvites.length}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80 border border-white/10 bg-zinc-950 p-2 shadow-2xl backdrop-blur-xl">
            <DropdownMenuLabel className="flex items-center justify-between px-3 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
              Inbound Deployments
              <span className="rounded-md bg-neon-magenta/10 px-1.5 py-0.5 text-neon-magenta text-[8px]">Live Status</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-white/5" />
            <div className="max-h-80 overflow-y-auto pt-2">
              {pendingInvites.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-xs font-medium text-slate-600 uppercase tracking-widest">No pending authorizations</p>
                </div>
              ) : (
                <div className="space-y-2">
                   {pendingInvites.map((invite) => (
                      <div key={invite.id} className="group relative flex flex-col gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-4 transition-colors hover:border-neon-magenta/30">
                        <div className="flex items-start justify-between">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-bold text-white">{invite.projectName}</p>
                            <p className="truncate text-[9px] uppercase tracking-wider text-slate-500">{invite.organizationName}</p>
                          </div>
                          <div className="rounded-lg border border-neon-magenta/20 bg-neon-magenta/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-neon-magenta">
                            {invite.role}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          className="h-8 w-full bg-neon-magenta text-[9px] font-bold uppercase tracking-widest text-white hover:bg-neon-magenta/90"
                          onClick={async () => {
                            await acceptProjectInvite({ inviteId: invite.id });
                            setSelectedProjectId(invite.projectId);
                            setSelectedOrganizationId(invite.organizationId);
                            navigate("/project");
                          }}
                        >
                          Accept Authorization
                        </Button>
                      </div>
                   ))}
                </div>
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}