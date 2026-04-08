import React, { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Building2, FolderKanban, LockKeyhole, MailPlus, Users2, ScissorsLineDashed, Cpu, ArrowRight, CheckCircle2, ChevronRight, Plus, Bell, X, User } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { motion, AnimatePresence } from "motion/react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useWorkspace } from "@/features/workspace/context";
import { Logo, LogoMark } from "@/components/logo";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export default function LandingPage() {
  const navigate = useNavigate();
  const {
    authenticated,
    isLoadingWorkspace,
    viewer,
    organizations,
    projects,
    pendingInvites,
    pendingOrgInvites,
    selectedOrganizationId,
    setSelectedOrganizationId,
    selectedProjectId,
    setSelectedProjectId,
    selectedProject,
  } = useWorkspace();
  const [organizationName, setOrganizationName] = useState("");
  const [organizationIcon, setOrganizationIcon] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "owner">("editor");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const createOrganization = useMutation(api.workspaces.createOrganization);
  const createProject = useMutation(api.workspaces.createProject);
  const inviteToProject = useMutation(api.workspaces.inviteToProject);
  const acceptProjectInvite = useMutation(api.workspaces.acceptProjectInvite);
  const declineProjectInvite = useMutation(api.workspaces.declineProjectInvite);
  const acceptOrganizationInvite = useMutation(api.workspaces.acceptOrganizationInvite);
  const declineOrganizationInvite = useMutation(api.workspaces.declineOrganizationInvite);
  const accessOverview =
    (useQuery(api.workspaces.projectAccessOverview, selectedProjectId ? { projectId: selectedProjectId } : "skip") as
      | {
        project: { id: Id<"projects">; name: string; description: string };
        members: Array<{ id: Id<"projectMembers">; userId: Id<"users">; name: string; email: string; role: string }>;
        invites: Array<{ id: Id<"projectInvites">; email: string; role: string; createdAt: number; expiresAt: number }>;
        canManage: boolean;
      }
      | undefined) ?? null;

  if (isLoadingWorkspace) {
    return (
      <div className="flex h-full items-center justify-center px-4 py-12 lg:px-8">
        <Card className="w-full max-w-2xl border-white/10 bg-card/80">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">Loading workspace...</CardContent>
        </Card>
      </div>
    );
  }

  // ── UNAUTHENTICATED: 2-column hero + login form ──
  if (!authenticated) {
    return <LandingHero />;
  }

  async function handleCreateOrganization(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyAction("organization");
    setFeedback(null);
    setError(null);

    try {
      const result = await createOrganization({
        name: organizationName,
        icon: organizationIcon.trim() || undefined
      });
      setSelectedOrganizationId(result.organizationId);
      setOrganizationName("");
      setOrganizationIcon("");
      setFeedback("Organization created.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to create organization.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCreateProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrganizationId) {
      setError("Select an organization before creating a project.");
      return;
    }

    setBusyAction("project");
    setFeedback(null);
    setError(null);

    try {
      const result = await createProject({
        organizationId: selectedOrganizationId,
        name: projectName,
        description: projectDescription.trim() || undefined,
      });
      setSelectedProjectId(result.projectId);
      setProjectName("");
      setProjectDescription("");
      setFeedback("Project created.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to create project.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProjectId) {
      setError("Select a project before inviting users.");
      return;
    }

    setBusyAction("invite");
    setFeedback(null);
    setError(null);

    try {
      await inviteToProject({
        projectId: selectedProjectId,
        email: inviteEmail,
        role: inviteRole,
      });
      setInviteEmail("");
      setFeedback("Project invite saved. The user can accept it after signing in with that email.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to save project invite.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleAcceptInvite(inviteId: Id<"projectInvites">, projectId: Id<"projects">, organizationId: Id<"organizations">) {
    setBusyAction(inviteId);
    setFeedback(null);
    setError(null);

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
    setFeedback(null);
    setError(null);

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
    setFeedback(null);
    setError(null);

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
    setFeedback(null);
    setError(null);

    try {
      await declineOrganizationInvite({ inviteId });
      setFeedback("Invite declined.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to decline invite.");
    } finally {
      setBusyAction(null);
    }
  }

  // ── AUTHENTICATED: Dashboard ──
  return (
    <div className="relative min-h-full overflow-y-auto overflow-x-hidden bg-background">
      {/* Precision Top Bar (AppNavbar clone position) */}
      <header className="flex h-16 w-full items-center justify-between px-6">
        <SidebarTrigger className="text-muted-foreground hover:text-white" />
        <div className="flex items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative h-10 w-10 border border-white/5 bg-black/20 text-slate-400 hover:text-white rounded-md transition-all"
              >
                <Bell className="size-5" />
                {(pendingInvites.length + pendingOrgInvites.length) > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-neon-magenta text-[8px] font-bold text-white shadow-neon-magenta-sm ring-2 ring-background animate-pulse">
                    {(pendingInvites.length + pendingOrgInvites.length)}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[380px] border border-white/10 bg-zinc-950 p-3 shadow-2xl backdrop-blur-xl rounded-md">
              <DropdownMenuLabel className="flex items-center justify-between px-3 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                NOTIFICATIONS
                <span className="rounded-md bg-neon-magenta/10 px-1.5 py-0.5 text-neon-magenta text-[8px]">ACTIVE DEPLOYMENTS</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-white/5" />
              <div className="max-h-[500px] overflow-y-auto space-y-3 pt-3">
                {(pendingInvites.length === 0 && pendingOrgInvites.length === 0) ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest italic">No pending system protocols</p>
                  </div>
                ) : (
                  <div className="space-y-3 p-1">
                    {pendingInvites.map((invite) => (
                      <div
                        key={invite.id}
                        className="flex flex-col gap-4 rounded-xl border border-white/5 bg-white/[0.02] p-4 transition-all hover:border-neon-magenta/40"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex size-9 items-center justify-center rounded-lg bg-white/5 border border-white/10 text-lg">
                              {invite.organizationIcon || "🏢"}
                            </div>
                            <div className="min-w-0">
                              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">ORGANIZATION</p>
                              <h4 className="font-display text-xs font-black text-white truncate">{invite.organizationName}</h4>
                            </div>
                          </div>
                          <div className="rounded-md border border-neon-magenta/20 bg-neon-magenta/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-neon-magenta">
                            {invite.role}
                          </div>
                        </div>

                        <div className="space-y-1 py-2 border-y border-white/5">
                          <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-widest">
                            <span className="text-slate-500">PROJECT</span>
                            <span className="text-white">{invite.projectName}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 rounded-lg bg-white/[0.03] p-2 border border-white/5">
                          <div className="flex size-6 items-center justify-center rounded-full bg-neon-magenta/10 text-neon-magenta">
                            <User className="size-3" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[8px] font-bold text-white truncate">{invite.invitedBy?.name || "Oracle"}</p>
                            <p className="text-[7px] font-medium text-slate-500 truncate">{invite.invitedBy?.email}</p>
                          </div>
                        </div>

                        <div className="flex gap-2 mt-1">
                          <Button
                            variant="default"
                            className="flex-1 h-8 text-[8px] font-bold uppercase tracking-[0.2em]"
                            onClick={() => handleAcceptInvite(invite.id, invite.projectId, invite.organizationId)}
                            disabled={!!busyAction}
                          >
                            ACCEPT
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 "
                            onClick={() => handleDeclineInvite(invite.id)}
                            disabled={!!busyAction}
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      </div>
                    ))}

                    {pendingOrgInvites.map((invite) => (
                      <div
                        key={invite.id}
                        className="flex flex-col gap-4 rounded-xl border border-white/5 bg-white/[0.02] p-4 transition-all hover:border-cyan-500/40"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex size-9 items-center justify-center rounded-lg bg-white/5 border border-white/10 text-lg">
                              🏢
                            </div>
                            <div className="min-w-0">
                              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">ORGANIZATION</p>
                              <h4 className="font-display text-xs font-black text-white truncate">{invite.organizationName}</h4>
                            </div>
                          </div>
                          <div className="rounded-md border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-cyan-500">
                            {invite.role}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 rounded-lg bg-white/[0.03] p-2 border border-white/5">
                          <div className="flex size-6 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-500">
                            <User className="size-3" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[8px] font-bold text-white truncate">{invite.invitedBy?.name || "Oracle"}</p>
                            <p className="text-[7px] font-medium text-slate-500 truncate">{invite.invitedBy?.email}</p>
                          </div>
                        </div>

                        <div className="flex gap-2 mt-1">
                          <Button
                            variant="default"
                            className="flex-1 h-8 text-[8px] font-bold uppercase tracking-[0.2em] bg-cyan-600 hover:bg-cyan-500"
                            onClick={() => handleAcceptOrgInvite(invite.id, invite.organizationId)}
                            disabled={!!busyAction}
                          >
                            JOIN
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 "
                            onClick={() => handleDeclineOrgInvite(invite.id)}
                            disabled={!!busyAction}
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Subtle Background Effects */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/4 top-0 h-[500px] w-[500px] rounded-full bg-neon-green/5 blur-[120px]" />
        <div className="absolute right-1/4 bottom-0 h-[500px] w-[500px] rounded-full bg-neon-magenta/5 blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-[1240px] flex-col gap-14 px-6 py-6 lg:px-12">
        {/* --- TOP HEADER --- */}
        <header className="flex flex-col items-center justify-center py-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="text-center"
          >
            <h1 className="font-display text-5xl font-black tracking-tighter text-white lg:text-7xl">
              Hello, <span className="text-glow-green">{viewer?.name.split(" ")[0] || "\u03A9"}</span>
              <span className="ml-4 text-glow-magenta">{viewer?.name.split(" ")[1] || "Forger"}</span>
            </h1>
          </motion.div>
        </header>



        {/* --- MANAGEMENT GRIDS --- */}
        <div className="grid gap-8 lg:grid-cols-3">

          {/* Recent Activity */}
          <div className="space-y-6">
            <Card className="border-white/10 bg-white/[0.02] backdrop-blur-sm overflow-hidden rounded-md shadow-2xl">
              <CardHeader className="h-14 flex flex-row items-center justify-center bg-white/[0.02] border-b border-white/5 p-0">
                <CardTitle className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">LATEST PROJECTS</CardTitle>
              </CardHeader>
              <CardContent className="pt-6 px-4">
                <div className="space-y-3">
                  {projects.length === 0 ? (
                    <div className="py-8 text-center">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">No active projects</p>
                    </div>
                  ) : (
                    [...projects]
                      .sort((a, b) => b.updatedAt - a.updatedAt)
                      .slice(0, 3)
                      .map((project) => (
                        <button
                          key={project.id}
                          onClick={() => {
                            setSelectedProjectId(project.id);
                            navigate(`/project/${project.id}`);
                          }}
                          className="w-full group relative flex flex-col gap-1 rounded-2xl border border-white/5 bg-black/40 p-4 transition-all hover:border-primary/40 hover:bg-primary/5 hover:shadow-neon-green-sm"
                        >
                          <div className="flex items-center justify-between">
                            <h4 className="font-display text-sm font-bold text-white group-hover:text-primary transition-colors truncate">
                              {project.name}
                            </h4>
                            <ChevronRight className="size-3 text-slate-600 group-hover:text-primary transition-colors" />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs">{project.organizationIcon || "🏢"}</span>
                            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 truncate">
                              {project.organizationName}
                            </p>
                          </div>
                          <p className="mt-1 text-[8px] font-mono text-slate-600 uppercase tracking-tighter">
                            Updated {new Date(project.updatedAt).toLocaleDateString()}
                          </p>
                        </button>
                      ))
                  )}
                </div>

                {projects.length > 3 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-6 w-full text-[9px] font-bold uppercase tracking-widest text-slate-500 hover:text-primary hover:bg-primary/5"
                    onClick={() => {
                      navigate(`/project`);
                    }}
                  >
                    View All Projects
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Create Stack */}
          <div className="space-y-6">
            <Tabs defaultValue="project" className="w-full">
              <Card className="border-white/10 bg-white/[0.02] backdrop-blur-sm overflow-hidden rounded-md shadow-2xl">
                <CardHeader className="h-14 p-1 border-b border-white/5 bg-white/[0.01]">
                  <TabsList className="grid w-full grid-cols-8 h-full bg-transparent border-0 rounded-sm p-0">
                    <TabsTrigger
                      value="project"
                      className=" col-span-3 col-start-2 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:border data-[state=active]:border-primary/20 transition-all font-bold uppercase tracking-widest text-[9px]"
                    >
                      CREATE PROJECT
                    </TabsTrigger>
                    <TabsTrigger
                      value="org"
                      className=" col-span-3 col-start-5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:border data-[state=active]:border-primary/20 transition-all font-bold uppercase tracking-widest text-[9px]"
                    >
                      CREATE ORG
                    </TabsTrigger>
                  </TabsList>
                </CardHeader>

                <CardContent className="pt-6">
                  <TabsContent value="project" className="mt-0 animate-in fade-in slide-in-from-top-4 duration-500">
                    <form className="space-y-4" onSubmit={handleCreateProject}>
                      <div className="space-y-2">
                        <Select
                          value={selectedOrganizationId ?? undefined}
                          onValueChange={(value) => setSelectedOrganizationId(value as Id<"organizations">)}
                        >
                          <SelectTrigger className="h-12 border-white/10 bg-black/40">
                            <SelectValue placeholder="Select Organization" />
                          </SelectTrigger>
                          <SelectContent className="border-white/10 bg-zinc-950 shadow-2xl">
                            {organizations.map((organization) => (
                              <SelectItem key={organization.id} value={organization.id}>
                                <div className="flex items-center gap-3">
                                  <span className="text-xl">{organization.icon || "🏢"}</span>
                                  <span className="font-bold uppercase tracking-wider text-xs">{organization.name}</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Input
                          value={projectName}
                          onChange={(e) => setProjectName(e.target.value)}
                          placeholder="Project Name (e.g. Tower 7)"
                          className="h-12 border-white/10 bg-black/40 text-sm font-medium"
                        />
                      </div>
                      <div className="space-y-2">
                        <Input
                          value={projectDescription}
                          onChange={(e) => setProjectDescription(e.target.value)}
                          placeholder="Description (optional)"
                          className="h-12 border-white/10 bg-black/40 text-sm font-medium"
                        />
                      </div>
                      <Button
                        variant="default"
                        className="w-full" disabled={!!busyAction || organizations.length === 0}>
                        {busyAction === "project" ? "Generating Silo..." : "CREATE PROJECT"}
                      </Button>
                    </form>
                  </TabsContent>

                  <TabsContent value="org" className="mt-0 animate-in fade-in slide-in-from-top-4 duration-500">
                    <form className="space-y-4" onSubmit={handleCreateOrganization}>
                      <div className="grid grid-cols-[80px,1fr] gap-4 items-end">
                        <EmojiPicker value={organizationIcon} onChange={setOrganizationIcon} />
                        <Input
                          value={organizationName}
                          onChange={(e) => setOrganizationName(e.target.value)}
                          placeholder="Organization Name"
                          className="h-14 bg-black/40 border-white/10 text-sm font-medium"
                        />
                      </div>
                      <Button
                        variant="default"
                        className="w-full h-12" disabled={!!busyAction}>
                        {busyAction === "organization" ? "Registering Entity..." : "CREATE ORGANIZATION"}
                      </Button>
                    </form>
                  </TabsContent>
                </CardContent>
              </Card>
            </Tabs>
          </div>

          {/* Personnel Deployment */}
          <div className="space-y-6">
            <Card className="border-white/10 bg-white/[0.02] backdrop-blur-sm overflow-hidden rounded-md shadow-2xl">
              <CardHeader className="h-14 flex flex-row items-center justify-center bg-white/[0.02] border-b border-white/5 p-0">
                <CardTitle className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">SEND INVITE</CardTitle>
              </CardHeader>
              <CardContent className="pt-6 px-6">
                <div className="mb-6 rounded-xl border border-primary/10 bg-primary/5 p-4 flex gap-4 items-center">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-black/40 border border-white/5 text-xl transition-all">
                    {selectedProject?.organizationIcon || "🏢"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Active Context</p>
                    <p className="font-display text-sm font-bold text-white truncate">{selectedProject?.name || "No Project Selected"}</p>
                  </div>
                  {selectedProject && (
                    <div className="rounded-full bg-primary/20 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-primary">
                      {selectedProject.role}
                    </div>
                  )}
                </div>

                <form className="space-y-4" onSubmit={handleInvite}>
                  <div className="space-y-2">
                    <Input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="Operator email (name@company.com)"
                      className="h-12 border-white/10 bg-black/40 text-sm font-medium"
                      disabled={!!(!selectedProject || (accessOverview && !accessOverview.canManage))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Select
                      value={inviteRole}
                      onValueChange={(v) => setInviteRole(v as any)}
                      disabled={!!(!selectedProject || (accessOverview && !accessOverview.canManage))}
                    >
                      <SelectTrigger className="h-12 border-white/10 bg-black/40">
                        <SelectValue placeholder="Select Access Level" />
                      </SelectTrigger>
                      <SelectContent className="border-white/10 bg-zinc-950 text-xs shadow-2xl">
                        <SelectItem value="editor" className="font-bold uppercase tracking-wider">Editor (Write Access)</SelectItem>
                        <SelectItem value="owner" className="font-bold uppercase tracking-wider">Owner (Full Control)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {(!selectedProject || (accessOverview && !accessOverview.canManage)) ? (
                    <div className="rounded-xl bg-destructive/5 border border-destructive/20 p-3 text-center">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-destructive">
                        Insufficient Clearance
                      </p>
                    </div>
                  ) : (
                    <Button
                      variant="neon"
                      className="w-full" disabled={!!busyAction}>
                      <MailPlus className="size-4 mr-2 group-hover:scale-110 transition-transform" />
                      {busyAction === "invite" ? "Transmitting..." : "SEND INVITE"}
                    </Button>
                  )}
                </form>
              </CardContent>
            </Card>

            {(feedback || error) && (
              <div
                className={`rounded-2xl border p-4 text-[10px] font-bold uppercase tracking-[0.2em] text-center ${error
                  ? "border-destructive/30 bg-destructive/5 text-destructive"
                  : "border-neon-green/30 bg-neon-green/5 text-neon-green shadow-neon-green-sm"
                  }`}
              >
                {error ?? feedback}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Internal Sub-components ────────────────────────────────────────────────────────────



function EmojiPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const commonEmojis = ["🏢", "🏪", "🏫", "🏭", "🏠", "🏡", "🏥", "🏦", "🏗️", "📐", "🔨", "🛠️", "🔧", "⚙️", "🔦", "💎"];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-14 w-full text-2xl bg-black/40 border-white/10 hover:bg-white/5 hover:border-white/20 transition-all">
          {value || "🏢"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[340px] border-white/10 bg-zinc-950 text-white rounded-md">
        <DialogHeader>
          <DialogTitle className="text-xs font-bold uppercase tracking-[0.3em] text-slate-500 text-center">Select Identity Icon</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-4 gap-3 pt-4">
          {commonEmojis.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onChange(emoji);
                setOpen(false);
              }}
              className="flex items-center justify-center h-14 rounded-md bg-white/5 hover:bg-white/10 text-2xl border border-white/5 hover:border-white/10 transition-all font-emoji"
            >
              {emoji}
            </button>
          ))}
        </div>
        <div className="pt-6 space-y-3">
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value.slice(0, 3))}
            placeholder="Custom Label (ABC)"
            className="h-12 bg-black/40 border-white/10 text-center text-sm font-bold uppercase tracking-widest"
            maxLength={3}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setOpen(false);
              }
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}



function ProjectActionCard({ project, isSelected, onClick, onAction, delay }: { project: any; isSelected: boolean; onClick: () => void; onAction: () => void; delay: number }) {
  return (
    <button
      onClick={onClick}
      className={`group relative flex flex-col overflow-hidden rounded-[2rem] border p-6 text-left transition-all duration-300 ${isSelected
        ? "border-primary/40 bg-primary/5 shadow-neon-green-sm"
        : "border-white/8 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/20"
        }`}
    >
      <div className="mb-4 flex items-start justify-between">
        <div className="space-y-1">
          <h3 className="font-display text-xl font-black text-white group-hover:text-primary transition-colors">
            {project.name}
          </h3>
          <p className="inline-flex items-center gap-2 font-mono text-[9px] uppercase tracking-widest text-slate-500">
            <Building2 className="size-3" />
            {project.organizationName}
          </p>
        </div>
        <div className={`rounded-lg border px-2 py-1 text-[8px] font-bold uppercase tracking-widest transition-colors ${isSelected ? "border-primary/40 bg-primary/20 text-primary" : "border-white/10 bg-black/40 text-slate-400"
          }`}>
          {project.role}
        </div>
      </div>

      <p className="mb-6 line-clamp-2 min-h-[40px] text-xs leading-relaxed text-slate-400 group-hover:text-slate-300">
        {project.description || "No project description provided. Industrial default sequence active."}
      </p>

      <div className="mt-auto flex items-center justify-between">
        <div className="font-mono text-[9px] text-slate-600 uppercase tracking-tighter">
          {project.slug}
        </div>
        {isSelected && (
          <Button
            variant="neon"
            size="sm"
            className="h-8 px-4 text-[10px] uppercase tracking-widest"
            onClick={(e) => {
              e.stopPropagation();
              onAction();
            }}
          >
            Enter Workspace
          </Button>
        )}
      </div>

      {isSelected && (
        <div
          className="absolute -inset-[1px] -z-10 rounded-[2rem] bg-primary/5 blur-sm"
        />
      )}
    </button>
  );
}

function EmptyState({ title, description, icon }: { title: string; description: string; icon: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[2.5rem] border border-dashed border-white/10 bg-white/[0.02] py-24 px-10 text-center">
      <div className="mb-4 flex size-16 items-center justify-center rounded-2xl bg-white/5 text-slate-600">
        {icon}
      </div>
      <h3 className="font-display text-lg font-bold uppercase tracking-widest text-white">{title}</h3>
      <p className="mt-2 max-w-sm text-sm text-slate-500">{description}</p>
    </div>
  );
}

// ─── LANDING HERO (unauthenticated) ────────────────────────────────────────────

function LandingHero() {
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (isAuthenticated) {
    return null;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setError(null);

    try {
      const result = await signIn("password", {
        flow: mode,
        email,
        password,
        ...(mode === "signUp" && name.trim().length > 0 ? { name: name.trim() } : {}),
      });

      if (result.redirect) {
        window.location.href = result.redirect.toString();
        return;
      }

      setMessage(mode === "signUp" ? "Account created. Signing you in..." : "Signing you in...");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Authentication failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden bg-background px-4 py-8 lg:px-8">
      {/* Background Layer */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute inset-0 opacity-[0.15] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_100%)]">
          <div className="panel-grid h-full w-full" />
        </div>

        {/* Decorative Orbs */}
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.05, 0.08, 0.05],
          }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -left-32 top-1/4 h-[500px] w-[500px] rounded-full bg-neon-green/10 blur-[120px]"
        />
        <motion.div
          animate={{
            scale: [1.2, 1, 1.2],
            opacity: [0.04, 0.07, 0.04],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -right-32 bottom-1/4 h-[500px] w-[500px] rounded-full bg-neon-magenta/10 blur-[120px]"
        />
      </div>

      <div className="relative z-10 grid w-full max-w-[1240px] gap-12 lg:grid-cols-[1fr,440px] lg:gap-20">
        {/* LEFT COLUMN: Hero content */}
        <motion.section
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="flex flex-col justify-center space-y-12"
        >
          <div className="space-y-8">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <Logo variant="full" size="xl" className="brightness-110 drop-shadow-[0_0_15px_rgba(57,255,20,0.3)]" />
            </motion.div>

            <div className="space-y-4">
              <motion.h2
                initial={{ opacity: 0, letterSpacing: "0.2em" }}
                animate={{ opacity: 1, letterSpacing: "0.45em" }}
                transition={{ duration: 1, delay: 0.4 }}
                className="font-mono text-xs font-bold uppercase text-neon-magenta text-glow-magenta-sm lg:text-sm"
              >
                Precision Forged to &Omega;
              </motion.h2>

            </div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8 }}
              className="max-w-xl text-lg leading-relaxed text-slate-400 lg:text-xl"
            >
              The advanced fenestration ecosystem. From DXF profile engineering to
              <span className="text-white"> automated CNC manufacturing</span>—all powered
              by a high-precision geometry engine.
            </motion.p>

            {/* Feature display */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1, duration: 0.6 }}
              className="grid gap-4 sm:grid-cols-2 lg:flex lg:flex-wrap"
            >
              <FeaturePill icon={<ScissorsLineDashed />} label="DXF Editor" delay={1.1} />
              <FeaturePill icon={<Building2 />} label="Assembly Engine" delay={1.2} />
              <FeaturePill icon={<Cpu />} label="CNC Pipeline" delay={1.3} />
              <FeaturePill icon={<FolderKanban />} label="PDR Management" delay={1.4} />
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.5 }}
            className="flex items-center gap-6"
          >
            <div className="h-[1px] w-12 bg-neon-green/30" />
            <p className="font-mono text-[10px] uppercase tracking-[0.5em] text-slate-500">
              Trusted by modern envelope fabricators
            </p>
          </motion.div>
        </motion.section>

        {/* RIGHT COLUMN: Auth Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, x: 20 }}
          animate={{ opacity: 1, scale: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="relative"
        >
          {/* Decorative halo around card */}
          <div className="absolute -inset-1 rounded-[2rem] bg-gradient-to-br from-neon-green/20 via-transparent to-neon-magenta/20 blur-xl transition-opacity group-hover:opacity-100" />

          <Card className="relative overflow-hidden border-white/10 bg-card/40 shadow-2xl backdrop-blur-xl transition-all hover:border-neon-green/30 hover:shadow-neon-green/5 rounded-md">
            {/* Top scanning line effect */}
            <motion.div
              animate={{ top: ["0%", "100%", "0%"] }}
              transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
              className="absolute left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-neon-green/20 to-transparent"
            />

            <Tabs value={mode} onValueChange={(v) => setMode(v as any)} className="w-full">
              <CardHeader className="space-y-6 border-b border-white/5 bg-white/[0.02] p-8">
                <div className="flex flex-col gap-6">
                  {/* Custom Tab Switcher using Tabs component */}
                  <TabsList className="grid w-full grid-cols-2 rounded-sm h-12">
                    <TabsTrigger value="signIn" className="rounded-sm">Sign In</TabsTrigger>
                    <TabsTrigger value="signUp" className="rounded-sm">Sign Up</TabsTrigger>
                  </TabsList>

                  <div>
                    <CardTitle className="font-display text-2xl font-bold tracking-tight text-white">
                      {mode === "signIn" ? "Welcome Back" : "Initialize Account"}
                    </CardTitle>
                    <CardDescription className="mt-2 font-body text-sm text-slate-400">
                      {mode === "signIn"
                        ? "Enter your credentials to access the Forge control center."
                        : "Create your workspace and start designing at scale."}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-8">
                <form className="space-y-5" onSubmit={handleSubmit}>
                  <AnimatePresence mode="wait">
                    {mode === "signUp" && (
                      <motion.div
                        key="name"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.3 }}
                      >
                        <AuthField label="Full name">
                          <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Ahmad Saab"
                          />
                        </AuthField>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <AuthField label="Email address">
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@company.com"
                      autoComplete="email"
                    />
                  </AuthField>

                  <AuthField label="Security Key">
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete={mode === "signIn" ? "current-password" : "new-password"}
                    />
                  </AuthField>

                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs font-semibold text-destructive uppercase tracking-widest"
                    >
                      <div className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" />
                      {error}
                    </motion.div>
                  )}

                  {message && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-2 rounded-xl border border-neon-green/30 bg-neon-green/5 px-4 py-3 text-xs font-semibold text-neon-green uppercase tracking-widest"
                    >
                      <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                      {message}
                    </motion.div>
                  )}

                  <Button
                    variant="default"
                    className="h-12 w-full group"
                    disabled={submitting}
                  >
                    <span className="flex items-center justify-center gap-2">
                      {submitting ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-black border-t-transparent" />
                      ) : (
                        <>
                          {mode === "signIn" ? "Authorize" : "Initialize"}
                          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                        </>
                      )}
                    </span>
                  </Button>

                  <p className="text-center text-[10px] uppercase tracking-[0.2em] text-slate-500">
                    Secured by Convex &Omega; Engine
                  </p>
                </form>
              </CardContent>
            </Tabs>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function AuthField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 opacity-80">{label}</span>
      {children}
    </label>
  );
}

function FeaturePill({ icon, label, delay = 0 }: { icon: React.ReactNode; label: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay }}
      whileHover={{ y: -2, scale: 1.05 }}
      className="group flex cursor-default items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-5 py-3 text-sm transition-all hover:border-neon-green/40 hover:bg-neon-green/5 hover:shadow-neon-green-sm"
    >
      <span className="text-neon-green transition-transform group-hover:scale-110">
        {React.cloneElement(icon as React.ReactElement, { className: "h-5 w-5" })}
      </span>
      <span className="font-display font-medium text-slate-300 group-hover:text-white">{label}</span>
    </motion.div>
  );
}

function StatCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <div className="rounded-[1.5rem] border border-white/8 bg-black/20 p-5">
      <p className="text-xs uppercase tracking-[0.24em] text-slate-400">{title}</p>
      <p className="mt-3 font-display text-4xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}
