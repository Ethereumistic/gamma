import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const SELECTED_ORG_KEY = "alugamma:selected-organization";
const SELECTED_PROJECT_KEY = "alugamma:selected-project";

export type WorkspaceViewer = {
  id: Id<"users">;
  email: string;
  name: string;
};

export type OrganizationSummary = {
  id: Id<"organizations">;
  name: string;
  slug: string;
  role: string;
  memberCount: number;
  projectCount: number;
};

export type ProjectDesignSummary = {
  id: Id<"designs">;
  name: string;
  exportName: string;
  updatedAt: number;
  createdAt: number;
  isStarred?: boolean;
};

export type ProjectSummary = {
  id: Id<"projects">;
  organizationId: Id<"organizations">;
  organizationName: string;
  name: string;
  slug: string;
  description: string;
  defaults?: {
    baseWidth: number;
    baseHeight: number;
    offsetCut: number;
    flangeDefaults: {
      count1: number[];
      count2: number[];
      count3: number[];
    };
    frezDefaults: {
      count1: number[];
      count2: number[];
      count3: number[];
    };
  };
  role: string;
  designs: ProjectDesignSummary[];
};

export type PendingInviteSummary = {
  id: Id<"projectInvites">;
  organizationId: Id<"organizations">;
  organizationName: string;
  projectId: Id<"projects">;
  projectName: string;
  role: string;
  createdAt: number;
  expiresAt: number;
};

type ViewerWorkspace = {
  authenticated: boolean;
  viewer: WorkspaceViewer | null;
  organizations: OrganizationSummary[];
  projects: ProjectSummary[];
  pendingInvites: PendingInviteSummary[];
};

type WorkspaceContextValue = {
  workspace: ViewerWorkspace | undefined;
  isLoadingWorkspace: boolean;
  authenticated: boolean;
  viewer: WorkspaceViewer | null;
  organizations: OrganizationSummary[];
  projects: ProjectSummary[];
  pendingInvites: PendingInviteSummary[];
  selectedOrganizationId: Id<"organizations"> | null;
  setSelectedOrganizationId: (organizationId: Id<"organizations"> | null) => void;
  selectedProjectId: Id<"projects"> | null;
  setSelectedProjectId: (projectId: Id<"projects"> | null) => void;
  selectedOrganization: OrganizationSummary | null;
  selectedProject: ProjectSummary | null;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function readStoredId(key: string) {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(key);
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const workspace = useQuery(api.workspaces.viewerWorkspace, {}) as ViewerWorkspace | undefined;
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<Id<"organizations"> | null>(
    () => readStoredId(SELECTED_ORG_KEY) as Id<"organizations"> | null,
  );
  const [selectedProjectId, setSelectedProjectId] = useState<Id<"projects"> | null>(
    () => readStoredId(SELECTED_PROJECT_KEY) as Id<"projects"> | null,
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (selectedOrganizationId) {
      window.localStorage.setItem(SELECTED_ORG_KEY, selectedOrganizationId);
    } else {
      window.localStorage.removeItem(SELECTED_ORG_KEY);
    }
  }, [selectedOrganizationId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (selectedProjectId) {
      window.localStorage.setItem(SELECTED_PROJECT_KEY, selectedProjectId);
    } else {
      window.localStorage.removeItem(SELECTED_PROJECT_KEY);
    }
  }, [selectedProjectId]);

  const setProjectId = (id: Id<"projects"> | null) => {
    setSelectedProjectId(id);
    if (id && workspace) {
      const project = workspace.projects.find((p) => p.id === id);
      if (project && project.organizationId !== selectedOrganizationId) {
        setSelectedOrganizationId(project.organizationId);
      }
    }
  };

  const setOrganizationId = (id: Id<"organizations"> | null) => {
    setSelectedOrganizationId(id);
    if (id && workspace) {
      // If current project doesn't belong to new org, switch to first project of new org or null
      const currentProject = workspace.projects.find((p) => p.id === selectedProjectId);
      if (!currentProject || currentProject.organizationId !== id) {
        const firstProject = workspace.projects.find((p) => p.organizationId === id);
        setSelectedProjectId(firstProject?.id ?? null);
      }
    }
  };

  // Initial sync and validation
  useEffect(() => {
    if (!workspace || !workspace.authenticated) return;

    const isProjectValid = selectedProjectId
      ? workspace.projects.some((p) => p.id === selectedProjectId)
      : false;

    const isOrgValid = selectedOrganizationId
      ? workspace.organizations.some((o) => o.id === selectedOrganizationId)
      : false;

    if (selectedProjectId && !isProjectValid) {
      setSelectedProjectId(workspace.projects[0]?.id ?? null);
    } else if (!selectedProjectId && workspace.projects.length > 0) {
      setSelectedProjectId(workspace.projects[0].id);
    }

    if (selectedOrganizationId && !isOrgValid) {
      const firstProjectOrgId = workspace.projects[0]?.organizationId;
      setSelectedOrganizationId(firstProjectOrgId ?? (workspace.organizations[0]?.id ?? null));
    } else if (!selectedOrganizationId && workspace.organizations.length > 0) {
      const currentProjectOrgId = workspace.projects.find(p => p.id === selectedProjectId)?.organizationId;
      setSelectedOrganizationId(currentProjectOrgId ?? workspace.organizations[0].id);
    }
  }, [workspace]);

  const selectedProject = workspace?.projects.find((project) => project.id === selectedProjectId) ?? null;
  const selectedOrganization =
    workspace?.organizations.find((organization) => organization.id === (selectedProject?.organizationId ?? selectedOrganizationId)) ??
    null;

  return (
    <WorkspaceContext.Provider
      value={{
        workspace,
        isLoadingWorkspace: workspace === undefined,
        authenticated: workspace?.authenticated ?? false,
        viewer: workspace?.viewer ?? null,
        organizations: workspace?.organizations ?? [],
        projects: workspace?.projects ?? [],
        pendingInvites: workspace?.pendingInvites ?? [],
        selectedOrganizationId,
        setSelectedOrganizationId: setOrganizationId,
        selectedProjectId,
        setSelectedProjectId: setProjectId,
        selectedOrganization,
        selectedProject,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);

  if (!context) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }

  return context;
}
