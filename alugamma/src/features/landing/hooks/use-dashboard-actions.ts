import { useState } from "react";
import { useMutation } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useWorkspace } from "@/features/workspace/context";

type BusyAction = string | null;

interface DashboardActions {
  busyAction: BusyAction;
  feedback: string | null;
  error: string | null;
  handleCreateOrganization: (event: React.FormEvent<HTMLFormElement>, data: { name: string; icon: string }) => Promise<boolean>;
  handleCreateProject: (event: React.FormEvent<HTMLFormElement>, data: { name: string; description: string }) => Promise<boolean>;
  handleInvite: (event: React.FormEvent<HTMLFormElement>, data: { email: string; role: "editor" | "owner" }) => Promise<boolean>;
  handleAcceptInvite: (inviteId: Id<"projectInvites">, projectId: Id<"projects">, organizationId: Id<"organizations">) => Promise<void>;
  handleDeclineInvite: (inviteId: Id<"projectInvites">) => Promise<void>;
  handleAcceptOrgInvite: (inviteId: Id<"organizationInvites">, organizationId: Id<"organizations">) => Promise<void>;
  handleDeclineOrgInvite: (inviteId: Id<"organizationInvites">) => Promise<void>;
}

export function useDashboardActions(): DashboardActions {
  const { setSelectedOrganizationId, setSelectedProjectId, selectedOrganizationId, selectedProjectId } = useWorkspace();

  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);

  const createOrganization = useMutation(api.workspaces.createOrganization);
  const createProject = useMutation(api.workspaces.createProject);
  const inviteToProject = useMutation(api.workspaces.inviteToProject);
  const acceptProjectInvite = useMutation(api.workspaces.acceptProjectInvite);
  const declineProjectInvite = useMutation(api.workspaces.declineProjectInvite);
  const acceptOrganizationInvite = useMutation(api.workspaces.acceptOrganizationInvite);
  const declineOrganizationInvite = useMutation(api.workspaces.declineOrganizationInvite);

  function clearFeedback() {
    setFeedback(null);
    setError(null);
  }

  async function handleCreateOrganization(event: React.FormEvent<HTMLFormElement>, data: { name: string; icon: string }): Promise<boolean> {
    event.preventDefault();
    setBusyAction("organization");
    clearFeedback();

    try {
      const result = await createOrganization({
        name: data.name,
        icon: data.icon.trim() || undefined,
      });
      setSelectedOrganizationId(result.organizationId);
      setFeedback("Organization created.");
      return true;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to create organization.");
      return false;
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCreateProject(event: React.FormEvent<HTMLFormElement>, data: { name: string; description: string }): Promise<boolean> {
    event.preventDefault();
    if (!selectedOrganizationId) {
      setError("Select an organization before creating a project.");
      return false;
    }

    setBusyAction("project");
    clearFeedback();

    try {
      const result = await createProject({
        organizationId: selectedOrganizationId,
        name: data.name,
        description: data.description.trim() || undefined,
      });
      setSelectedProjectId(result.projectId);
      setFeedback("Project created.");
      return true;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to create project.");
      return false;
    } finally {
      setBusyAction(null);
    }
  }

  async function handleInvite(event: React.FormEvent<HTMLFormElement>, data: { email: string; role: "editor" | "owner" }): Promise<boolean> {
    event.preventDefault();
    if (!selectedProjectId) {
      setError("Select a project before inviting users.");
      return false;
    }

    setBusyAction("invite");
    clearFeedback();

    try {
      await inviteToProject({
        projectId: selectedProjectId,
        email: data.email,
        role: data.role,
      });
      setFeedback("Project invite saved. The user can accept it after signing in with that email.");
      return true;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to save project invite.");
      return false;
    } finally {
      setBusyAction(null);
    }
  }

  async function handleAcceptInvite(inviteId: Id<"projectInvites">, projectId: Id<"projects">, organizationId: Id<"organizations">) {
    setBusyAction(inviteId);
    clearFeedback();

    try {
      await acceptProjectInvite({ inviteId });
      setSelectedProjectId(projectId);
      setSelectedOrganizationId(organizationId);
      setFeedback("Invite accepted. You now have access to the project.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to accept invite.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDeclineInvite(inviteId: Id<"projectInvites">) {
    setBusyAction(inviteId);
    clearFeedback();

    try {
      await declineProjectInvite({ inviteId });
      setFeedback("Invite declined.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to decline invite.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleAcceptOrgInvite(inviteId: Id<"organizationInvites">, organizationId: Id<"organizations">) {
    setBusyAction(inviteId);
    clearFeedback();

    try {
      await acceptOrganizationInvite({ inviteId });
      setSelectedOrganizationId(organizationId);
      setFeedback("Invite accepted. You are now a member of the organization.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to accept invite.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDeclineOrgInvite(inviteId: Id<"organizationInvites">) {
    setBusyAction(inviteId);
    clearFeedback();

    try {
      await declineOrganizationInvite({ inviteId });
      setFeedback("Invite declined.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to decline invite.");
    } finally {
      setBusyAction(null);
    }
  }

  return {
    busyAction,
    feedback,
    error,
    handleCreateOrganization,
    handleCreateProject,
    handleInvite,
    handleAcceptInvite,
    handleDeclineInvite,
    handleAcceptOrgInvite,
    handleDeclineOrgInvite,
  };
}
