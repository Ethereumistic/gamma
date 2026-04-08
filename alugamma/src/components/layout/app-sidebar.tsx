import { ChevronDown, FileStack, LayoutDashboard, LogOut, Plus, ScissorsLineDashed, UserRound, Search, Filter, MoreHorizontal, Star, Copy, Settings } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSheetMetal } from "@/features/sheet-metal/context";
import { useWorkspace, type ProjectDesignSummary } from "@/features/workspace/context";
import { useDesignDelete } from "@/features/workspace/design-delete-context";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { useSettings } from "@/features/settings/context";

const systemItems = [
  {
    title: "Workspace",
    url: "/",
    icon: LayoutDashboard,
  },
  {
    title: "Organizations",
    url: "/organization",
    icon: UserRound,
  },
  {
    title: "Projects",
    url: "/project",
    icon: FileStack,
  },
];

const toolItems = [
  {
    title: "Sheet Metal",
    url: "/sheet-metal",
    icon: ScissorsLineDashed,
  },
  {
    title: "CNC Pipeline",
    url: "/cnc-pipeline",
    icon: LayoutDashboard,
  },
];

import { LogoShort, LogoMark } from "@/components/logo";
import { formatDateGroup } from "@/lib/date-utils";

export function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuthActions();
  const { viewer, authenticated, organizations, projects, selectedOrganizationId, selectedProjectId, setSelectedOrganizationId, setSelectedProjectId, selectedOrganization, selectedProject } = useWorkspace();
  const { startNewDesign, saveDesign } = useSheetMetal();
  const { openSettings } = useSettings();
  const { designToDelete, setDesignToDelete } = useDesignDelete();

  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "a-z" | "z-a">("newest");

  const [designToRename, setDesignToRename] = useState<{ id: Id<"designs">, name: string } | null>(null);

  const duplicateDesign = useMutation(api.designs.duplicateDesign);
  const toggleStarDesign = useMutation(api.designs.toggleStarDesign);
  const renameDesign = useMutation(api.designs.renameDesign);

  const pathIsSheetMetal = location.pathname.startsWith("/sheet-metal");
  const pathIsCNCPipeline = location.pathname.startsWith("/cnc-pipeline");

  const toggleStarNcProgram = useMutation(api.nc_programs.toggleStar);
  const deleteNcProgram = useMutation(api.nc_programs.deleteNcProgram);
  const updateNcProgram = useMutation(api.nc_programs.updateNcProgram);

  const [ncSearchQuery, setNcSearchQuery] = useState("");
  const [ncSortOrder, setNcSortOrder] = useState<"newest" | "oldest" | "a-z" | "z-a">("newest");
  const [ncProgramToRename, setNcProgramToRename] = useState<{ id: Id<"nc_programs">, name: string } | null>(null);

  const groupedDesigns = useMemo(() => {
    if (!selectedProject) return new Map<string, ProjectDesignSummary[]>();

    let filtered = selectedProject.designs.filter(d =>
      !searchQuery || d.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    filtered.sort((a, b) => {
      // Always put starred first
      if (a.isStarred && !b.isStarred) return -1;
      if (!a.isStarred && b.isStarred) return 1;

      if (sortOrder === "newest") return b.createdAt - a.createdAt;
      if (sortOrder === "oldest") return a.createdAt - b.createdAt;
      if (sortOrder === "a-z") return a.name.localeCompare(b.name);
      if (sortOrder === "z-a") return b.name.localeCompare(a.name);
      return 0;
    });

    const groups = new Map<string, typeof filtered>();
    filtered.forEach(d => {
      const group = formatDateGroup(d.createdAt);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(d);
    });

    return groups;
  }, [selectedProject, searchQuery, sortOrder]);

  // We should fetch NC programs if on CNC pipeline
  const ncProgramsUnfiltered = useQuery(
    api.nc_programs.listByProject,
    selectedProject ? { projectId: selectedProject.id } : "skip"
  );

  const groupedNcPrograms = useMemo(() => {
    if (!ncProgramsUnfiltered) return new Map<string, any[]>();

    let filtered = ncProgramsUnfiltered.filter((p: any) =>
      !ncSearchQuery || p.name.toLowerCase().includes(ncSearchQuery.toLowerCase())
    );

    filtered.sort((a: any, b: any) => {
      if (a.isStarred && !b.isStarred) return -1;
      if (!a.isStarred && b.isStarred) return 1;

      if (ncSortOrder === "newest") return b.updatedAt - a.updatedAt;
      if (ncSortOrder === "oldest") return a.updatedAt - b.updatedAt;
      if (ncSortOrder === "a-z") return a.name.localeCompare(b.name);
      if (ncSortOrder === "z-a") return b.name.localeCompare(a.name);
      return 0;
    });

    const groups = new Map<string, any[]>();
    filtered.forEach((p: any) => {
      const group = formatDateGroup(p.updatedAt);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(p);
    });

    return groups;
  }, [ncProgramsUnfiltered, ncSearchQuery, ncSortOrder]);

  return (
    <>
      <Sidebar className="border-r border-white/10 bg-[linear-gradient(180deg,rgba(10,10,10,0.98),rgba(6,6,6,0.99))]">
        <SidebarHeader className="border-b border-white/5 px-4 py-4">
          <Link to="/" className="flex items-center gap-1.5 px-1 py-1 group">
            <span className="font-display text-3xl font-black tracking-tighter">
              <span className="text-neon-green text-glow-green drop-shadow-[0_0_8px_rgba(57,255,20,0.5)]">Ω</span>
              <span className="text-neon-magenta text-glow-magenta drop-shadow-[0_0_8px_rgba(255,0,255,0.4)] ml-[-1px]">Forge</span>
            </span>
          </Link>

          {authenticated && (
            <div className="mt-4">
              <WorkspaceSwitcher />
            </div>
          )}
        </SidebarHeader>

        <SidebarContent className="overflow-hidden">
          <SidebarGroup className="pb-0">
            <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500 mb-2">
              System
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {systemItems.map((item) => {
                  const isActive = location.pathname === item.url;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        className={cn(
                          "h-10 px-3 rounded-xl border",
                          isActive
                            ? "bg-primary/10 border-primary/30 text-primary shadow-neon-green-sm"
                            : "text-slate-400 border-transparent hover:bg-white/5 hover:text-white"
                        )}
                      >
                        <Link to={item.url} className="flex items-center gap-3">
                          <div className={cn(
                            "flex h-6 w-6 items-center justify-center rounded-md",
                            isActive ? "bg-primary/20 text-primary shadow-neon-green-sm" : "bg-black/40 text-slate-500"
                          )}>
                            <item.icon className="h-3.5 w-3.5" />
                          </div>
                          <span className="font-bold text-[10px] uppercase tracking-widest">{item.title}</span>
                          {isActive && (
                            <div className="ml-auto h-1.5 w-1.5 rounded-full bg-primary shadow-neon-green animate-pulse" />
                          )}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500 mb-3 mt-2">
              Internal Tools
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <div className="grid grid-cols-2 gap-2.5 px-2">
                {toolItems.map((item) => {
                  const isActive = item.url === "/sheet-metal" ? pathIsSheetMetal : location.pathname.startsWith(item.url);
                  return (
                    <Link
                      key={item.title}
                      to={item.url}
                      className={cn(
                        "flex flex-col items-center justify-center gap-3 py-5 rounded-xl border group",
                        isActive
                          ? "bg-primary/10 border-primary/30 text-primary shadow-neon-green-sm"
                          : "bg-white/[0.03] border-white/5 text-slate-400 hover:bg-white/10 hover:border-white/20 hover:text-white"
                      )}
                    >
                      <div className={cn(
                        "p-2 rounded-lg",
                        isActive ? "bg-primary/20" : "bg-black/40 group-hover:scale-110"
                      )}>
                        <item.icon className="h-5 w-5" />
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-center">
                        {item.title.split(' ').map((tile, i) => <span key={i} className="block last:text-[9px] last:opacity-70">{tile}</span>)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </SidebarGroupContent>
          </SidebarGroup>

          {authenticated && selectedProject && pathIsSheetMetal && (
            <SidebarGroup className="min-h-0 flex-1 overflow-hidden flex flex-col pt-0">
              <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary/80 pt-6 pb-3 px-4 flex items-center gap-2">
                <div className="h-1 w-1 rounded-full bg-primary" />
                Designs in <span className="text-white ml-1">{selectedProject.name}</span>
              </SidebarGroupLabel>

              <div className="px-3 pb-3 pt-1 flex flex-col gap-2 shrink-0">
                <div className="flex items-center gap-2">
                  <Button
                    variant="neon"
                    size="icon"
                    onClick={() => {
                      if (location.pathname === "/sheet-metal" || location.pathname === "/sheet-metal/new") {
                        startNewDesign();
                      }
                      navigate("/sheet-metal/new");
                    }}
                    className="shrink-0 h-8 w-8"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    <Input
                      placeholder="Search designs..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-8 pl-8 bg-black/20 border-white/10 text-xs focus-visible:ring-1 focus-visible:ring-primary/50"
                    />
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon" className="shrink-0 h-8 w-8 bg-transparent border-white/10 hover:bg-white/5">
                        <Filter className="h-3.5 w-3.5 text-slate-400" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40 border-white/10 bg-[#090d16] text-slate-200">
                      <DropdownMenuItem onClick={() => setSortOrder("newest")} className="hover:bg-white/10">Newest first</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setSortOrder("oldest")} className="hover:bg-white/10">Oldest first</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setSortOrder("a-z")} className="hover:bg-white/10">A-Z</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setSortOrder("z-a")} className="hover:bg-white/10">Z-A</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <SidebarGroupContent className="min-h-0 flex-1">
                <ScrollArea className="h-full pr-3 pl-3">
                  <SidebarMenuSub className="space-y-4 pr-1 pl-0 mx-0 border-none">
                    {selectedProject.designs.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-white/8 px-3 py-4 text-center text-xs text-slate-500 mx-2">
                        No saved designs yet.
                      </div>
                    ) : groupedDesigns.size === 0 ? (
                      <div className="text-center text-xs text-slate-500 mx-2 py-4">
                        No designs match "{searchQuery}"
                      </div>
                    ) : (
                      Array.from(groupedDesigns.entries()).map(([group, designs]) => (
                        <div key={group}>
                          <div className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500/80">
                            {group}
                          </div>
                          <ul className="space-y-0.5">
                            {designs.map((design) => (
                              <SidebarMenuSubItem key={design.id} className="group/item relative">
                                <SidebarMenuSubButton
                                  asChild
                                  isActive={location.pathname === `/sheet-metal/${design.id}`}
                                  className={cn(
                                    "pr-8 h-8 outline-none w-full",
                                    location.pathname === `/sheet-metal/${design.id}`
                                      ? "bg-primary/10 text-primary border-r-2 border-primary"
                                      : "text-slate-400 hover:text-white"
                                  )}
                                >
                                  <Link to={`/sheet-metal/${design.id}`}>
                                    {design.isStarred ? (
                                      <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                                    ) : (
                                      <FileStack className="h-4 w-4 opacity-70" />
                                    )}
                                    <span className="truncate">{design.name}</span>
                                  </Link>
                                </SidebarMenuSubButton>

                                <div className="absolute right-0.5 top-1/2 -translate-y-1/2 flex items-center opacity-0 group-hover/item:opacity-100 focus-within:opacity-100">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 hover:bg-white/10 text-slate-400 hover:text-white"
                                    onClick={async (e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      const newId = await duplicateDesign({ designId: design.id });
                                      navigate(`/sheet-metal/${newId}`);
                                    }}
                                    title="Duplicate design"
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                  </Button>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 hover:bg-white/10 aria-expanded:bg-white/10 text-slate-400 hover:text-white"
                                      >
                                        <MoreHorizontal className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-48 border-white/10 bg-[#090d16] text-slate-200">
                                      <DropdownMenuItem onClick={() => toggleStarDesign({ designId: design.id, isStarred: !design.isStarred })} className="hover:bg-white/10">
                                        {design.isStarred ? "Unstar" : "Star design"}
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => setDesignToRename({ id: design.id, name: design.name })} className="hover:bg-white/10">
                                        Rename
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={async () => {
                                          const newId = await duplicateDesign({ designId: design.id });
                                          navigate(`/sheet-metal/${newId}`);
                                        }}
                                        className="hover:bg-white/10"
                                      >
                                        Duplicate
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator className="bg-white/5" />
                                      <DropdownMenuItem
                                        className="text-red-400 focus:text-red-300 focus:bg-red-400/10 hover:text-red-300 hover:bg-red-400/10"
                                        onClick={() => setDesignToDelete(design.id)}
                                      >
                                        Delete design
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </SidebarMenuSubItem>
                            ))}
                          </ul>
                        </div>
                      ))
                    )}
                  </SidebarMenuSub>
                </ScrollArea>
              </SidebarGroupContent>
            </SidebarGroup>
          )}

          {authenticated && selectedProject && pathIsCNCPipeline && (
            <SidebarGroup className="min-h-0 flex-1 overflow-hidden flex flex-col pt-0">
              <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary/80 pt-6 pb-3 px-4 flex items-center gap-2">
                <div className="h-1 w-1 rounded-full bg-primary" />
                NC Programs in <span className="text-white ml-1">{selectedProject.name}</span>
              </SidebarGroupLabel>

              <div className="px-3 pb-3 pt-1 flex flex-col gap-2 shrink-0">
                <div className="flex items-center gap-2">
                  <Button
                    variant="neon"
                    size="icon"
                    onClick={() => navigate("/cnc-pipeline/new")}
                    className="shrink-0 h-8 w-8 shadow-neon-green-sm"
                    title="New NC program"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    <Input
                      placeholder="Search NC programs..."
                      value={ncSearchQuery}
                      onChange={(e) => setNcSearchQuery(e.target.value)}
                      className="h-8 pl-8 bg-black/20 border-white/10 text-xs focus-visible:ring-1 focus-visible:ring-primary/50"
                    />
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon" className="shrink-0 h-8 w-8 bg-transparent border-white/10 hover:bg-white/5">
                        <Filter className="h-3.5 w-3.5 text-slate-400" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40 border-white/10 bg-[#090d16] text-slate-200">
                      <DropdownMenuItem onClick={() => setNcSortOrder("newest")} className="hover:bg-white/10">Newest first</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setNcSortOrder("oldest")} className="hover:bg-white/10">Oldest first</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setNcSortOrder("a-z")} className="hover:bg-white/10">A-Z</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setNcSortOrder("z-a")} className="hover:bg-white/10">Z-A</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <SidebarGroupContent className="min-h-0 flex-1">
                <ScrollArea className="h-full pr-3 pl-3">
                  <SidebarMenuSub className="space-y-4 pr-1 pl-0 mx-0 border-none">
                    {(!ncProgramsUnfiltered || ncProgramsUnfiltered.length === 0) ? (
                      <div className="rounded-lg border border-dashed border-white/8 px-3 py-4 text-center text-xs text-slate-500 mx-2">
                        No saved NC programs.
                      </div>
                    ) : groupedNcPrograms.size === 0 ? (
                      <div className="text-center text-xs text-slate-500 mx-2 py-4">
                        No NC programs match "{ncSearchQuery}"
                      </div>
                    ) : (
                      Array.from(groupedNcPrograms.entries()).map(([group, programs]) => (
                        <div key={group}>
                          <div className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500/80">
                            {group}
                          </div>
                          <ul className="space-y-0.5">
                            {programs.map((program: any) => (
                              <SidebarMenuSubItem key={program._id} className="group/item relative">
                                <SidebarMenuSubButton
                                  asChild
                                  isActive={location.pathname === `/cnc-pipeline/${program._id}`}
                                  className={cn(
                                    "pr-8 h-8 outline-none w-full flex items-center gap-2",
                                    location.pathname === `/cnc-pipeline/${program._id}`
                                      ? "bg-primary/10 text-primary border-r-2 border-primary"
                                      : "text-slate-400 hover:text-white"
                                  )}
                                >
                                  <Link to={`/cnc-pipeline/${program._id}`}>
                                    {program.isStarred ? (
                                      <Star className="h-4 w-4 fill-amber-400 text-amber-400 shrink-0" />
                                    ) : (
                                      <FileStack className="h-4 w-4 opacity-70 shrink-0" />
                                    )}
                                    <span className="truncate flex-1">{program.name}</span>
                                    <div className="flex gap-1 shrink-0 ml-2">
                                      <span className="text-[9px] border border-white/10 rounded px-1 bg-white/5 opacity-60 uppercase font-mono">{program.algorithm}</span>
                                      <span className="text-[9px] border border-white/10 rounded px-1 bg-white/5 opacity-60 uppercase font-mono">
                                        {{ most_common: "F-C", common: "H-F-C", rare: "F-F135-C", very_rare: "H-F-F135-C", cut_only: "C" }[program.scenario as string] || program.scenario}
                                      </span>
                                    </div>
                                  </Link>
                                </SidebarMenuSubButton>

                                <div className="absolute right-0.5 top-1/2 -translate-y-1/2 flex items-center opacity-0 group-hover/item:opacity-100 focus-within:opacity-100">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 hover:bg-white/10 aria-expanded:bg-white/10 text-slate-400 hover:text-white"
                                      >
                                        <MoreHorizontal className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-48 border-white/10 bg-[#090d16] text-slate-200">
                                      <DropdownMenuItem onClick={() => toggleStarNcProgram({ projectId: selectedProject.id, ncProgramId: program._id })} className="hover:bg-white/10">
                                        {program.isStarred ? "Unstar" : "Star program"}
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => setNcProgramToRename({ id: program._id, name: program.name })} className="hover:bg-white/10">
                                        Rename
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator className="bg-white/5" />
                                      <DropdownMenuItem
                                        className="text-red-400 focus:text-red-300 focus:bg-red-400/10 hover:text-red-300 hover:bg-red-400/10"
                                        onClick={() => {
                                          if (confirm(`Delete NC Program ${program.name}?`)) {
                                            deleteNcProgram({ projectId: selectedProject.id, ncProgramId: program._id });
                                          }
                                        }}
                                      >
                                        Delete program
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </SidebarMenuSubItem>
                            ))}
                          </ul>
                        </div>
                      ))
                    )}
                  </SidebarMenuSub>
                </ScrollArea>
              </SidebarGroupContent>
            </SidebarGroup>
          )}

        </SidebarContent>

        <SidebarFooter className="border-t border-white/6 bg-black/40 px-3 py-4">
          {authenticated && viewer ? (
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex flex-1 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-2 text-left hover:bg-white/5 hover:border-white/20 outline-none focus-visible:ring-1 focus-visible:ring-primary/30">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary shadow-neon-green-sm shadow-inner">
                      <UserRound className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-xs font-bold uppercase tracking-widest text-white">
                        {viewer.name || viewer.email?.split('@')[0]}
                      </p>
                      <p className="truncate text-[9px] font-mono text-slate-500 group-hover:text-slate-400">
                        {selectedProject?.name ?? 'No Project'}
                      </p>
                    </div>
                    <ChevronDown className="h-3 w-3 text-slate-500" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="right"
                  align="end"
                  className="w-56 overflow-hidden rounded-xl border-white/10 bg-background p-1 shadow-2xl backdrop-blur-xl"
                  sideOffset={12}
                >
                  <DropdownMenuLabel className="px-2 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                    Operations
                  </DropdownMenuLabel>
                  <DropdownMenuItem 
                    onClick={() => navigate("/")} 
                    className={cn(
                      "gap-2 rounded-lg py-2 cursor-pointer transition-colors focus:bg-primary/10 focus:text-primary",
                      location.pathname === "/" && "bg-primary/10 text-primary font-bold"
                    )}
                  >
                    <LayoutDashboard className="h-4 w-4" />
                    <span className="text-xs font-medium">Workspace</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={() => navigate("/organization")} 
                    className={cn(
                      "gap-2 rounded-lg py-2 cursor-pointer transition-colors focus:bg-primary/10 focus:text-primary",
                      location.pathname === "/organization" && "bg-primary/10 text-primary font-bold"
                    )}
                  >
                    <UserRound className="h-4 w-4" />
                    <span className="text-xs font-medium">Organization</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={() => navigate("/project")} 
                    className={cn(
                      "gap-2 rounded-lg py-2 cursor-pointer transition-colors focus:bg-primary/10 focus:text-primary",
                      location.pathname === "/project" && "bg-primary/10 text-primary font-bold"
                    )}
                  >
                    <FileStack className="h-4 w-4" />
                    <span className="text-xs font-medium">Project</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-white/5" />
                  <DropdownMenuItem
                    onClick={() => void signOut()}
                    className="gap-2 rounded-lg py-2 cursor-pointer focus:bg-destructive/10 focus:text-destructive text-red-400"
                  >
                    <LogOut className="h-4 w-4" />
                    <span className="text-xs font-medium">Sign Out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-xl bg-white/[0.02] border border-white/10 text-slate-400 hover:text-white hover:bg-white/5"
                onClick={() => openSettings("hotkeys")}
                title="Settings"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button asChild className="w-full bg-primary text-black font-bold hover:bg-primary/90 border-none">
              <Link to="/auth">Sign In</Link>
            </Button>
          )}
        </SidebarFooter>
      </Sidebar>

      <AlertDialog open={!!designToRename} onOpenChange={(open) => !open && setDesignToRename(null)}>
        <AlertDialogContent className="border-white/10 bg-[#090d16] text-white sm:max-w-[425px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl font-bold uppercase tracking-tight text-white">Rename Design</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 font-body text-sm">
              Enter a new identifier for this design profile.
            </AlertDialogDescription>
            <div className="py-4">
              <Input
                autoFocus
                value={designToRename?.name || ""}
                onChange={e => setDesignToRename(prev => prev ? { ...prev, name: e.target.value } : null)}
                className="bg-black/40 border-white/10 text-white focus-visible:ring-primary/50"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && designToRename && designToRename.name.trim().length >= 2) {
                    e.preventDefault();
                    renameDesign({ designId: designToRename.id, name: designToRename.name });
                    setDesignToRename(null);
                  }
                }}
              />
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="rounded-xl border-white/10 bg-transparent text-slate-400 hover:bg-white/5 hover:text-white transition-all">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-primary text-black font-bold uppercase tracking-widest hover:bg-primary/90 border-none shadow-neon-green-sm"
              disabled={!designToRename || designToRename.name.trim().length < 2}
              onClick={async () => {
                if (designToRename && designToRename.name.trim().length >= 2) {
                  await renameDesign({ designId: designToRename.id, name: designToRename.name });
                  setDesignToRename(null);
                }
              }}
            >
              Update Design
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!ncProgramToRename} onOpenChange={(open) => !open && setNcProgramToRename(null)}>
        <AlertDialogContent className="border-white/10 bg-[#090d16] text-white sm:max-w-[425px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl font-bold uppercase tracking-tight text-white">Rename NC Program</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 font-body text-sm">
              Update the identifier for this CNC production sequence.
            </AlertDialogDescription>
            <div className="py-4">
              <Input
                autoFocus
                value={ncProgramToRename?.name || ""}
                onChange={e => setNcProgramToRename(prev => prev ? { ...prev, name: e.target.value } : null)}
                className="bg-black/40 border-white/10 text-white focus-visible:ring-primary/50"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && ncProgramToRename && ncProgramToRename.name.trim().length >= 2) {
                    e.preventDefault();
                    if (selectedProjectId) {
                      updateNcProgram({ projectId: selectedProjectId, ncProgramId: ncProgramToRename.id, name: ncProgramToRename.name });
                    }
                    setNcProgramToRename(null);
                  }
                }}
              />
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="rounded-xl border-white/10 bg-transparent text-slate-400 hover:bg-white/5 hover:text-white transition-all">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-primary text-black font-bold uppercase tracking-widest hover:bg-primary/90 border-none shadow-neon-green-sm"
              disabled={!ncProgramToRename || ncProgramToRename.name.trim().length < 2 || !selectedProjectId}
              onClick={async () => {
                if (ncProgramToRename && ncProgramToRename.name.trim().length >= 2 && selectedProjectId) {
                  await updateNcProgram({ projectId: selectedProjectId, ncProgramId: ncProgramToRename.id, name: ncProgramToRename.name });
                  setNcProgramToRename(null);
                }
              }}
            >
              Update Program
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
