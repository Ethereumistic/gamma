import React, { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Building2, FolderKanban, LockKeyhole, MailPlus, Users2, ScissorsLineDashed, Cpu, ArrowRight, CheckCircle2, ChevronRight } from "lucide-react";
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

export default function LandingPage() {
  const navigate = useNavigate();
  const {
    authenticated,
    isLoadingWorkspace,
    viewer,
    organizations,
    projects,
    pendingInvites,
    selectedOrganizationId,
    setSelectedOrganizationId,
    selectedProjectId,
    setSelectedProjectId,
    selectedProject,
  } = useWorkspace();
  const [organizationName, setOrganizationName] = useState("");
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
      const result = await createOrganization({ name: organizationName });
      setSelectedOrganizationId(result.organizationId);
      setOrganizationName("");
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

  // ── AUTHENTICATED: Dashboard ──
  return (
    <div className="flex h-full flex-col px-4 py-8 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6">
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr),420px]">
          <Card className="overflow-hidden border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(57,255,20,0.06),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] shadow-2xl">
            <CardContent className="flex h-full flex-col justify-between gap-8 p-8 lg:p-10">
              <div className="space-y-5">
                <div className="inline-flex items-center gap-2 rounded-full border border-neon-green/20 bg-neon-green/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.28em] text-neon-green text-glow-green-sm">
                  Workspace Control Center
                </div>
                <div>
                  <p className="text-sm uppercase tracking-[0.28em] text-slate-400">Signed in as</p>
                  <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-white lg:text-5xl">
                    {viewer?.name || viewer?.email || "Workspace user"}
                  </h1>
                  <p className="mt-3 max-w-2xl text-base leading-7 text-slate-300">
                    Create organizations, manage project access, and open the sheet-metal editor against a selected project.
                    Every DXF export is stored as reusable model data inside that project.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <StatCard title="Organizations" value={organizations.length.toString()} subtitle="Memberships you can access" />
                <StatCard title="Projects" value={projects.length.toString()} subtitle="Available editors and exports" />
                <StatCard title="Pending invites" value={pendingInvites.length.toString()} subtitle="Accept from the web app" />
              </div>

              <div className="flex flex-wrap gap-3">
                <Button onClick={() => navigate("/sheet-metal")}>Open sheet-metal editor</Button>
                <Button variant="outline" onClick={() => selectedProjectId && navigate("/sheet-metal")} disabled={!selectedProjectId}>
                  Open selected project
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-6">
            <Card className="border-white/10 bg-card/85">
              <CardHeader>
                <CardTitle>Create organization</CardTitle>
                <CardDescription>Each organization can contain multiple projects and member roles.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={handleCreateOrganization}>
                  <Input
                    value={organizationName}
                    onChange={(event) => setOrganizationName(event.target.value)}
                    placeholder="e.g. Facade Engineering"
                  />
                  <Button className="w-full" disabled={busyAction === "organization"}>
                    {busyAction === "organization" ? "Creating..." : "Create organization"}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-card/85">
              <CardHeader>
                <CardTitle>Create project</CardTitle>
                <CardDescription>Select the owning organization first.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={handleCreateProject}>
                  <Select
                    value={selectedOrganizationId ?? undefined}
                    onValueChange={(value) => setSelectedOrganizationId(value as Id<"organizations">)}
                  >
                    <SelectTrigger className="bg-black/20">
                      <SelectValue placeholder="Choose organization" />
                    </SelectTrigger>
                    <SelectContent>
                      {organizations.map((organization) => (
                        <SelectItem key={organization.id} value={organization.id}>
                          {organization.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="e.g. Tower A fronts" />
                  <Input
                    value={projectDescription}
                    onChange={(event) => setProjectDescription(event.target.value)}
                    placeholder="Short project description"
                  />
                  <Button className="w-full" disabled={busyAction === "project" || organizations.length === 0}>
                    {busyAction === "project" ? "Creating..." : "Create project"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </section>

        {(feedback || error) && (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${error
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-neon-green/30 bg-neon-green/10 text-neon-green"
              }`}
          >
            {error ?? feedback}
          </div>
        )}

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr),420px]">
          <Card className="border-white/10 bg-card/80">
            <CardHeader className="flex flex-row items-end justify-between gap-4 border-b border-white/6">
              <div>
                <CardTitle>Projects</CardTitle>
                <CardDescription>Select a project to edit designs or manage access.</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => selectedProjectId && navigate("/sheet-metal")} disabled={!selectedProjectId}>
                Open in editor
              </Button>
            </CardHeader>
            <CardContent className="grid gap-4 pt-6 md:grid-cols-2">
              {projects.length === 0 && (
                <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 p-6 text-sm text-muted-foreground md:col-span-2">
                  No projects yet. Create an organization and then your first project to start saving DXF design data.
                </div>
              )}
              {projects.map((project) => {
                const isSelected = project.id === selectedProjectId;
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => {
                      setSelectedProjectId(project.id);
                      setSelectedOrganizationId(project.organizationId);
                    }}
                    className={`rounded-[1.5rem] border p-5 text-left transition-colors ${isSelected
                      ? "border-neon-green/40 bg-neon-green/5 shadow-neon-green-sm"
                      : "border-white/8 bg-black/10 hover:bg-white/[0.03]"
                      }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="font-display text-xl font-semibold text-white">{project.name}</h3>
                        <p className="mt-1 text-xs uppercase tracking-[0.26em] text-slate-400">{project.organizationName}</p>
                      </div>
                      <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-slate-300">
                        {project.role}
                      </span>
                    </div>
                    <p className="mt-4 min-h-12 text-sm leading-6 text-muted-foreground">
                      {project.description || "No description provided."}
                    </p>
                    <div className="mt-5 text-xs uppercase tracking-[0.24em] text-slate-500">{project.slug}</div>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-6">
            <Card className="border-white/10 bg-card/85">
              <CardHeader>
                <CardTitle>Pending invites</CardTitle>
                <CardDescription>Invites appear when the signed-in email matches the invited address.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {pendingInvites.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 px-4 py-5 text-sm text-muted-foreground">
                    No pending invites for {viewer?.email}.
                  </div>
                ) : (
                  pendingInvites.map((invite) => (
                    <div key={invite.id} className="rounded-2xl border border-white/8 bg-black/10 p-4">
                      <p className="font-medium text-white">{invite.projectName}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{invite.organizationName}</p>
                      <p className="mt-3 text-xs uppercase tracking-[0.24em] text-slate-400">{invite.role}</p>
                      <Button
                        className="mt-4 w-full"
                        size="sm"
                        disabled={busyAction === invite.id}
                        onClick={() => void handleAcceptInvite(invite.id, invite.projectId, invite.organizationId)}
                      >
                        {busyAction === invite.id ? "Accepting..." : "Accept invite"}
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-card/85">
              <CardHeader>
                <CardTitle>Organizations</CardTitle>
                <CardDescription>Select where new projects should be created.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {organizations.map((organization) => {
                  const isSelected = organization.id === selectedOrganizationId;
                  return (
                    <button
                      key={organization.id}
                      type="button"
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${isSelected ? "border-neon-green/40 bg-neon-green/5" : "border-white/8 bg-black/10 hover:bg-white/[0.03]"
                        }`}
                      onClick={() => setSelectedOrganizationId(organization.id)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-white">{organization.name}</p>
                          <p className="text-xs uppercase tracking-[0.24em] text-slate-400">{organization.role}</p>
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          <div>{organization.projectCount} projects</div>
                          <div>{organization.memberCount} members</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </section>

        {selectedProject && accessOverview && (
          <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr),420px]">
            <Card className="border-white/10 bg-card/80">
              <CardHeader className="border-b border-white/6">
                <CardTitle>{selectedProject.name}</CardTitle>
                <CardDescription>{selectedProject.description || "Project access and active memberships."}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 pt-6 md:grid-cols-2">
                <div className="rounded-[1.5rem] border border-white/8 bg-black/10 p-5">
                  <h3 className="font-display text-lg font-semibold text-white">Members</h3>
                  <div className="mt-4 space-y-3">
                    {accessOverview.members.map((member) => (
                      <div key={member.id} className="rounded-xl border border-white/8 bg-black/20 px-4 py-3">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="font-medium text-white">{member.name}</p>
                            <p className="text-sm text-muted-foreground">{member.email || "No email on profile"}</p>
                          </div>
                          <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-slate-300">
                            {member.role}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[1.5rem] border border-white/8 bg-black/10 p-5">
                  <h3 className="font-display text-lg font-semibold text-white">Pending project invites</h3>
                  <div className="mt-4 space-y-3">
                    {accessOverview.invites.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-sm text-muted-foreground">
                        No pending invites for this project.
                      </div>
                    ) : (
                      accessOverview.invites.map((invite) => (
                        <div key={invite.id} className="rounded-xl border border-white/8 bg-black/20 px-4 py-3">
                          <p className="font-medium text-white">{invite.email}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.24em] text-slate-400">{invite.role}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-card/85">
              <CardHeader>
                <CardTitle>Invite user</CardTitle>
                <CardDescription>
                  {accessOverview.canManage
                    ? "Create an email-based project invite."
                    : "You can view this project, but only managers can invite users."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={handleInvite}>
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="name@company.com"
                    disabled={!accessOverview.canManage}
                  />
                  <Select
                    value={inviteRole}
                    onValueChange={(value) => setInviteRole(value as "editor" | "owner")}
                    disabled={!accessOverview.canManage}
                  >
                    <SelectTrigger className="bg-black/20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="editor">Editor</SelectItem>
                      <SelectItem value="owner">Owner</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button className="w-full" disabled={!accessOverview.canManage || busyAction === "invite"}>
                    <MailPlus className="h-4 w-4" />
                    {busyAction === "invite" ? "Saving invite..." : "Invite to project"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </section>
        )}
      </div>
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

          <Card className="relative overflow-hidden border-white/10 bg-card/40 shadow-2xl backdrop-blur-xl transition-all hover:border-neon-green/30 hover:shadow-neon-green/5">
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
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="signIn">Sign In</TabsTrigger>
                    <TabsTrigger value="signUp">Sign Up</TabsTrigger>
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
