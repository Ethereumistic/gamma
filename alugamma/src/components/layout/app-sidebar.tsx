import { ChevronDown, FileStack, LayoutDashboard, LogOut, Plus, ScissorsLineDashed, UserRound, Search, Filter, MoreHorizontal, Star, Copy, Settings } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

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

const navItems = [
  {
    title: "Workspace",
    url: "/",
    icon: LayoutDashboard,
  },
  {
    title: "Organizations",
    url: "/organization",
    icon: LayoutDashboard, // Will replace with Building / Users later if needed
  },
  {
    title: "Projects",
    url: "/project",
    icon: FileStack,
  },
  {
    title: "Sheet Metal",
    url: "/sheet-metal",
    icon: ScissorsLineDashed,
  },
];

function isSameDay(d1: Date, d2: Date) {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

function formatDateGroup(timestamp: number) {
  const date = new Date(timestamp);
  const today = new Date();

  if (isSameDay(date, today)) return "Today";

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(date, yesterday)) return "Yesterday";

  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' }).format(date);
}

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

  return (
    <>
      <Sidebar className="border-r border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.96),rgba(9,13,22,0.98))]">
        <SidebarHeader className="border-b border-white/5 px-4 py-4">
          <Link to="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-primary shadow-[0_0_18px_rgba(20,180,100,0.14)]">
              <ScissorsLineDashed className="h-5 w-5" />
            </div>
            <div>
              <span className="font-display text-lg font-semibold tracking-tight text-white">AluGamma</span>
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">DXF Workspace</p>
            </div>
          </Link>

          {authenticated && (
            <div className="mt-4">
              <WorkspaceSwitcher />
            </div>
          )}
        </SidebarHeader>

        <SidebarContent className="overflow-hidden">
          <SidebarGroup>
            <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Internal Tools
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => {
                  const isActive = item.url === "/sheet-metal" ? pathIsSheetMetal : location.pathname === item.url;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        className={
                          isActive
                            ? "bg-primary/15 text-primary"
                            : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                        }
                      >
                        <Link to={item.url}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {authenticated && selectedProject && (
            <SidebarGroup className="min-h-0 flex-1 overflow-hidden flex flex-col pt-0">
              <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground pt-4 pb-2">
                Designs in {selectedProject.name}
              </SidebarGroupLabel>

              <div className="px-3 pb-3 pt-1 flex flex-col gap-2 shrink-0">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      if (location.pathname === "/sheet-metal" || location.pathname === "/sheet-metal/new") {
                        startNewDesign();
                      }
                      navigate("/sheet-metal/new");
                    }}
                    className="shrink-0 h-8 w-8 bg-transparent border-white/10 hover:bg-white/5"
                  >
                    <Plus className="h-4 w-4 text-slate-300" />
                  </Button>
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    <Input
                      placeholder="Search designs..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-8 pl-8 bg-black/20 border-white/10 text-xs focus-visible:ring-1 focus-visible:ring-emerald-500/50"
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
                                  className="text-slate-300 hover:text-white pr-8 h-8 focus-visible:ring-1 focus-visible:ring-emerald-500/50 outline-none w-full"
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

                                <div className="absolute right-0.5 top-1/2 -translate-y-1/2 flex items-center opacity-0 group-hover/item:opacity-100 focus-within:opacity-100 transition-opacity">
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
        </SidebarContent>

        <SidebarFooter className="border-t border-white/6 bg-black/20 px-4 py-4">
          {authenticated && viewer ? (
            <div className="space-y-3">
              <div className="flex items-center gap-1">
                <div className="flex-1 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/20 text-slate-300">
                      <UserRound className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{viewer.name || viewer.email}</p>
                      {/* <p className="truncate text-xs text-slate-500">{viewer.email}</p> */}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-white"
                      onClick={() => openSettings("hotkeys")}
                      title="Settings"
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                  </div>

                </div>

              </div>
              <Button
                variant="outline"
                className="w-full justify-start border-white/10 bg-black/20 text-slate-300 hover:bg-white/5 hover:text-white"
                onClick={() => void signOut()}
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </Button>
            </div>
          ) : (
            <Button asChild className="w-full justify-start">
              <Link to="/auth">Sign in</Link>
            </Button>
          )}
        </SidebarFooter>
      </Sidebar>

      <AlertDialog open={!!designToRename} onOpenChange={(open) => !open && setDesignToRename(null)}>
        <AlertDialogContent className="border-white/10 bg-[#090d16] text-white sm:max-w-[425px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Rename design</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Enter a new name for the design.
            </AlertDialogDescription>
            <div className="py-2">
              <Input
                autoFocus
                value={designToRename?.name || ""}
                onChange={e => setDesignToRename(prev => prev ? { ...prev, name: e.target.value } : null)}
                className="bg-black/20 border-white/10 text-white focus-visible:ring-emerald-500/50"
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
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-transparent text-white hover:bg-white/5">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-500 text-white hover:bg-emerald-600 border-none disabled:opacity-50"
              disabled={!designToRename || designToRename.name.trim().length < 2}
              onClick={async () => {
                if (designToRename && designToRename.name.trim().length >= 2) {
                  await renameDesign({ designId: designToRename.id, name: designToRename.name });
                  setDesignToRename(null);
                }
              }}
            >
              Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
