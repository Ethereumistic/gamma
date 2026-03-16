import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Building2, FolderKanban, LockKeyhole, MailPlus, Users2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useWorkspace } from "@/features/workspace/context";

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

  if (!authenticated) {
    return (
      <div className="flex h-full flex-col px-4 py-12 lg:px-8">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-16">
          <section className="mt-12 flex flex-col items-center justify-center gap-6 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary shadow-[0_0_15px_rgba(20,180,100,0.1)]">
              <LockKeyhole className="h-4 w-4" />
              Convex-backed DXF workspace
            </div>
            <h1 className="font-display max-w-4xl text-5xl font-semibold tracking-tight text-white lg:text-7xl">
              Save design data, not just the exported DXF.
            </h1>
            <p className="max-w-[760px] text-lg leading-relaxed text-muted-foreground">
              Organizations own projects, projects own saved sheet configurations, and every export can be reopened and
              re-generated later with the same flanges, FREZ lines, and corner relief settings.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
              <Button asChild size="lg" className="h-12 px-8 text-base shadow-lg shadow-primary/20">
                <Link to="/auth">Sign in or create account</Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="h-12 border-white/10 px-8 text-base hover:bg-white/5">
                <Link to="/sheet-metal">Open editor preview</Link>
              </Button>
            </div>
          </section>

          <section className="grid gap-6 md:grid-cols-3">
            <FeatureCard
              icon={<Building2 className="h-6 w-6 text-sky-400" />}
              title="Organizations"
              description="Separate customer teams, departments, or production groups with clear ownership."
            />
            <FeatureCard
              icon={<FolderKanban className="h-6 w-6 text-emerald-400" />}
              title="Project-based designs"
              description="Group saved DXF input data per project and re-open any design for editing or export."
            />
            <FeatureCard
              icon={<Users2 className="h-6 w-6 text-amber-400" />}
              title="Email invites"
              description="Invite teammates to a project by email, then let them accept access from the web app."
            />
          </section>
        </div>
      </div>
    );
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

  return (
    <div className="flex h-full flex-col px-4 py-8 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6">
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr),420px]">
          <Card className="overflow-hidden border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(58,196,143,0.15),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))] shadow-2xl">
            <CardContent className="flex h-full flex-col justify-between gap-8 p-8 lg:p-10">
              <div className="space-y-5">
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.28em] text-emerald-100">
                  Workspace Control Center
                </div>
                <div>
                  <p className="text-sm uppercase tracking-[0.28em] text-slate-300">Signed in as</p>
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
            className={`rounded-2xl border px-4 py-3 text-sm ${
              error
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
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
                    className={`rounded-[1.5rem] border p-5 text-left transition-colors ${
                      isSelected
                        ? "border-primary/40 bg-primary/10 shadow-[0_0_30px_rgba(20,180,100,0.08)]"
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
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                        isSelected ? "border-primary/40 bg-primary/10" : "border-white/8 bg-black/10 hover:bg-white/[0.03]"
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

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-white/5 bg-card/40 p-8 shadow-panel backdrop-blur transition-colors hover:bg-card/60">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/5 bg-black/20 shadow-inner">
        {icon}
      </div>
      <h3 className="font-display text-xl font-semibold text-white">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
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
