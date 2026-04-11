import { useLocation, matchPath } from "react-router-dom";
import { useWorkspace } from "@/features/workspace/context";
import { SheetMetalToolbar } from "./sheet-metal-toolbar";
import { NavbarBreadcrumb } from "./navbar-breadcrumb";

export function NavbarContent() {
  const location = useLocation();
  const { viewer } = useWorkspace();

  const isSheetMetal = location.pathname.startsWith("/sheet-metal");
  const isCncPipeline = location.pathname.startsWith("/cnc-pipeline");
  const isHome = location.pathname === "/";
  const isOrganizations = location.pathname === "/organization";
  const isProjects = location.pathname === "/project";
  const projectDetailMatch = matchPath("/project/:projectId", location.pathname);

  if (isHome) {
    return (
      <div className="flex flex-1 items-center gap-4 text-sm">
        <div className="flex items-center gap-2 font-display text-xs font-black uppercase tracking-[0.2em] text-white">
          Hello <span className="text-neon-green">{viewer?.name || "User"}</span>
        </div>
      </div>
    );
  }

  if (isOrganizations) {
    return (
      <div className="flex flex-1 items-center gap-4">
        <h1 className="text-sm font-semibold uppercase tracking-widest text-foreground">
          Industry Directory
        </h1>
      </div>
    );
  }

  if (isProjects && !projectDetailMatch) {
    return (
      <div
        id="project-navbar-portal"
        className="flex flex-1 items-center gap-4 overflow-x-auto min-w-0 no-scrollbar"
      />
    );
  }

  if (projectDetailMatch) {
    return <NavbarBreadcrumb />;
  }

  if (isCncPipeline) {
    return (
      <div
        id="cnc-navbar-portal"
        className="flex flex-1 items-center justify-between gap-4 overflow-x-auto"
      />
    );
  }

  if (isSheetMetal) {
    return <SheetMetalToolbar />;
  }

  return null;
}
