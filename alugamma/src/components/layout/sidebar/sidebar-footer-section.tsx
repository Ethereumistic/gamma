import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuthActions } from "@convex-dev/auth/react";
import { ChevronDown, FileStack, LayoutDashboard, LogOut, UserRound, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/features/workspace/context";
import { useSettings } from "@/features/settings/context";

export function SidebarFooterSection() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuthActions();
  const { viewer, authenticated, selectedProject } = useWorkspace();
  const { openSettings } = useSettings();

  if (!authenticated || !viewer) {
    return (
      <SidebarFooter className="border-t border-white/6 bg-black/40 px-3 py-4">
        <Button asChild className="w-full bg-primary text-black font-bold hover:bg-primary/90 border-none">
          <Link to="/auth">Sign In</Link>
        </Button>
      </SidebarFooter>
    );
  }

  return (
    <SidebarFooter className="border-t border-white/6 bg-black/40 px-3 py-4">
      <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-1.5 hover:bg-white/[0.04] transition-all group/footer">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex flex-1 items-center gap-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-primary/30 min-w-0">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary shadow-neon-green-sm shadow-inner group-hover/footer:border-primary/40 transition-colors">
                <UserRound className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-[10px] font-bold uppercase tracking-wide text-white">
                  {viewer.email}
                </p>
                <p className="truncate text-[9px] font-mono text-slate-500">
                  {selectedProject?.name ?? 'No Project'}
                </p>
              </div>
              <ChevronDown className="h-3 w-3 text-slate-500 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
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
          className="h-8 w-8 shrink-0 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          onClick={() => openSettings("hotkeys")}
          title="Settings"
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </div>
    </SidebarFooter>
  );
}
