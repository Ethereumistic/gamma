import { Route, Routes } from "react-router-dom";

import { AppNavbar } from "@/components/layout/app-navbar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarProvider as UI_SidebarProvider } from "@/components/ui/sidebar";
import { SheetMetalProvider } from "@/features/sheet-metal/context";
import { SelectedSideProvider } from "@/features/sheet-metal/selected-side-context";
import { SettingsProvider } from "@/features/settings/context";
import { SettingsDialog } from "@/features/settings/settings-dialog";
import { DesignDeleteProvider } from "@/features/workspace/design-delete-context";
import { DesignDeleteDialog } from "@/features/workspace/design-delete-dialog";
import { WorkspaceProvider, useWorkspace } from "@/features/workspace/context";
import AuthPage from "@/routes/auth";
import LandingPage from "@/routes/landing";
import OrganizationPage from "@/routes/organization";
import OrganizationDetailPage from "@/routes/organization-detail";
import ProjectPage from "@/routes/project";
import ProjectDetailPage from "@/routes/project-detail";
import DesignDetailPage from "@/routes/design-detail";
import SheetMetalApp from "@/routes/sheet-metal";
import CNCPipelineDashboardPage from "@/routes/cnc-pipeline/index";
import CNCPipelineNewRoute from "@/routes/cnc-pipeline/new";
import CNCProgramViewerPage from "@/routes/cnc-pipeline/$programId";
import { Toaster } from "@/components/ui/sonner";

function AppLayout() {
  const { authenticated, isLoadingWorkspace } = useWorkspace();

  // While loading, show a minimal centered spinner state
  if (isLoadingWorkspace) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neon-green border-t-transparent" />
      </div>
    );
  }

  // Unauthenticated: no sidebar, no navbar - full-screen landing
  if (!authenticated) {
    return (
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/auth" element={<AuthPage />} />
            {/* Allow direct access to sheet-metal preview without auth */}
            <Route path="/sheet-metal" element={<SheetMetalApp />} />
            <Route path="/sheet-metal/:designId" element={<SheetMetalApp />} />
            {/* Catch-all: redirect to landing */}
            <Route path="*" element={<LandingPage />} />
          </Routes>
        </main>
      </div>
    );
  }

  // Authenticated: full app layout with sidebar + navbar
  return (
    <DesignDeleteProvider>
      <SettingsProvider>
        <SheetMetalProvider>
          <SelectedSideProvider>
            <div className="flex min-h-screen w-full bg-background text-foreground">
              <AppSidebar />
              <div className="flex flex-1 flex-col overflow-hidden">
                <AppNavbar />
                <main className="flex-1 overflow-y-auto">
                  <Routes>
                    <Route path="/" element={<LandingPage />} />
                    <Route path="/auth" element={<AuthPage />} />
                    <Route path="/organization" element={<OrganizationPage />} />
                    <Route path="/organization/:orgId" element={<OrganizationDetailPage />} />
                    <Route path="/project" element={<ProjectPage />} />
                    <Route path="/project/:projectId" element={<ProjectDetailPage />} />
                    <Route path="/project/:projectId/:designId" element={<DesignDetailPage />} />
                    <Route path="/sheet-metal" element={<SheetMetalApp />} />
                    <Route path="/sheet-metal/:designId" element={<SheetMetalApp />} />
                    <Route path="/cnc-pipeline" element={<CNCPipelineDashboardPage />} />
                    <Route path="/cnc-pipeline/new" element={<CNCPipelineNewRoute />} />
                    <Route path="/cnc-pipeline/:programId" element={<CNCProgramViewerPage />} />
                  </Routes>
                </main>
              </div>
            </div>
            <SettingsDialog />
            <DesignDeleteDialog />
            <Toaster theme="dark" position="bottom-left" richColors />
          </SelectedSideProvider>
        </SheetMetalProvider>
      </SettingsProvider>
    </DesignDeleteProvider>
  );
}

export default function App() {
  return (
    <UI_SidebarProvider>
      <WorkspaceProvider>
        <AppLayout />
      </WorkspaceProvider>
    </UI_SidebarProvider>
  );
}
