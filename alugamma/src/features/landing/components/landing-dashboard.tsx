import { useState } from "react";
import { useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { MailPlus } from "lucide-react";
import { motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useWorkspace } from "@/features/workspace/context";
import { EmojiPicker } from "./emoji-picker";
import { FeedbackBanner } from "./feedback-banner";
import { ProjectListItem } from "./project-list-item";
import { NotificationsDropdown } from "./notifications-dropdown";
import { useDashboardActions } from "../hooks/use-dashboard-actions";

// ─── Types ──────────────────────────────────────────────────────────────────────

interface ProjectAccessOverview {
  project: { id: Id<"projects">; name: string; description: string };
  members: Array<{ id: Id<"projectMembers">; userId: Id<"users">; name: string; email: string; role: string }>;
  invites: Array<{ id: Id<"projectInvites">; email: string; role: string; createdAt: number; expiresAt: number }>;
  canManage: boolean;
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function LandingDashboard() {
  const navigate = useNavigate();
  const {
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

  const {
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
  } = useDashboardActions();

  const accessOverview = (useQuery(
    api.workspaces.projectAccessOverview,
    selectedProjectId ? { projectId: selectedProjectId } : "skip",
  ) as ProjectAccessOverview | undefined) ?? null;

  const sortedProjects = [...projects].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
  const canInvite = selectedProject && (!accessOverview || accessOverview.canManage);

  function handleProjectSelect(projectId: string) {
    setSelectedProjectId(projectId as Id<"projects">);
    navigate(`/project/${projectId}`);
  }

  return (
    <div className="relative min-h-full overflow-y-auto overflow-x-hidden bg-background">
      {/* Top Bar */}
      <header className="flex h-16 w-full items-center justify-between px-6">
        <SidebarTrigger className="text-muted-foreground hover:text-white" />
        <div className="flex items-center gap-3">
          <NotificationsDropdown
            pendingInvites={pendingInvites}
            pendingOrgInvites={pendingOrgInvites}
            busyAction={busyAction}
            onAcceptInvite={handleAcceptInvite}
            onDeclineInvite={handleDeclineInvite}
            onAcceptOrgInvite={handleAcceptOrgInvite}
            onDeclineOrgInvite={handleDeclineOrgInvite}
          />
        </div>
      </header>

      {/* Background Effects */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/4 top-0 h-[500px] w-[500px] rounded-full bg-neon-green/5 blur-[120px]" />
        <div className="absolute right-1/4 bottom-0 h-[500px] w-[500px] rounded-full bg-neon-magenta/5 blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-[1240px] flex-col gap-14 px-6 py-6 lg:px-12">
        {/* Header */}
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

        {/* Management Grid */}
        <div className="grid gap-8 lg:grid-cols-3">
          {/* Latest Projects */}
          <LatestProjectsCard
            projects={sortedProjects}
            totalProjects={projects.length}
            onProjectSelect={handleProjectSelect}
            onViewAll={() => navigate("/project")}
          />

          {/* Create Stack */}
          <CreateStackCard
            organizations={organizations}
            selectedOrganizationId={selectedOrganizationId}
            onOrganizationChange={(id) => setSelectedOrganizationId(id as Id<"organizations">)}
            projectName={projectName}
            onProjectNameChange={setProjectName}
            projectDescription={projectDescription}
            onProjectDescriptionChange={setProjectDescription}
            organizationName={organizationName}
            onOrganizationNameChange={setOrganizationName}
            organizationIcon={organizationIcon}
            onOrganizationIconChange={setOrganizationIcon}
            busyAction={busyAction}
            onCreateProject={async (e) => {
              const success = await handleCreateProject(e, { name: projectName, description: projectDescription });
              if (success) { setProjectName(""); setProjectDescription(""); }
            }}
            onCreateOrganization={async (e) => {
              const success = await handleCreateOrganization(e, { name: organizationName, icon: organizationIcon });
              if (success) { setOrganizationName(""); setOrganizationIcon(""); }
            }}
          />

          {/* Send Invite */}
          <div className="space-y-6">
            <SendInviteCard
              selectedProject={selectedProject}
              inviteEmail={inviteEmail}
              onInviteEmailChange={setInviteEmail}
              inviteRole={inviteRole}
              onInviteRoleChange={setInviteRole}
              canInvite={!!canInvite}
              accessOverview={accessOverview}
              busyAction={busyAction}
              onInvite={async (e) => {
                const success = await handleInvite(e, { email: inviteEmail, role: inviteRole });
                if (success) { setInviteEmail(""); }
              }}
            />

            <FeedbackBanner error={error} feedback={feedback} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard Sub-components ──────────────────────────────────────────────────

import type { ProjectSummary } from "@/features/workspace/context";

interface LatestProjectsCardProps {
  projects: ProjectSummary[];
  totalProjects: number;
  onProjectSelect: (projectId: string) => void;
  onViewAll: () => void;
}

function LatestProjectsCard({ projects, totalProjects, onProjectSelect, onViewAll }: LatestProjectsCardProps) {
  return (
    <div className="space-y-6">
      <Card className="border-white/10 bg-white/[0.02] backdrop-blur-sm overflow-hidden rounded-md shadow-2xl">
        <CardHeader className="h-14 flex flex-row items-center justify-center bg-white/[0.02] border-b border-white/5 p-0">
          <CardTitle className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
            LATEST PROJECTS
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6 px-4">
          <div className="space-y-3">
            {projects.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">No active projects</p>
              </div>
            ) : (
              projects.map((project) => (
                <ProjectListItem key={project.id} project={project} onSelect={onProjectSelect} />
              ))
            )}
          </div>

          {totalProjects > 3 && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-6 w-full text-[9px] font-bold uppercase tracking-widest text-slate-500 hover:text-primary hover:bg-primary/5"
              onClick={onViewAll}
            >
              View All Projects
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface CreateStackCardProps {
  organizations: Array<{ id: string; name: string; icon?: string }>;
  selectedOrganizationId: string | null;
  onOrganizationChange: (id: string) => void;
  projectName: string;
  onProjectNameChange: (value: string) => void;
  projectDescription: string;
  onProjectDescriptionChange: (value: string) => void;
  organizationName: string;
  onOrganizationNameChange: (value: string) => void;
  organizationIcon: string;
  onOrganizationIconChange: (value: string) => void;
  busyAction: string | null;
  onCreateProject: (e: React.FormEvent<HTMLFormElement>) => void;
  onCreateOrganization: (e: React.FormEvent<HTMLFormElement>) => void;
}

function CreateStackCard({
  organizations,
  selectedOrganizationId,
  onOrganizationChange,
  projectName,
  onProjectNameChange,
  projectDescription,
  onProjectDescriptionChange,
  organizationName,
  onOrganizationNameChange,
  organizationIcon,
  onOrganizationIconChange,
  busyAction,
  onCreateProject,
  onCreateOrganization,
}: CreateStackCardProps) {
  return (
    <div className="space-y-6">
      <Tabs defaultValue="project" className="w-full">
        <Card className="border-white/10 bg-white/[0.02] backdrop-blur-sm overflow-hidden rounded-md shadow-2xl">
          <CardHeader className="h-14 p-1 border-b border-white/5 bg-white/[0.01]">
            <TabsList className="grid w-full grid-cols-8 h-full bg-transparent border-0 rounded-sm p-0">
              <TabsTrigger
                value="project"
                className="col-span-3 col-start-2 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:border data-[state=active]:border-primary/20 transition-all font-bold uppercase tracking-widest text-[9px]"
              >
                CREATE PROJECT
              </TabsTrigger>
              <TabsTrigger
                value="org"
                className="col-span-3 col-start-5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:border data-[state=active]:border-primary/20 transition-all font-bold uppercase tracking-widest text-[9px]"
              >
                CREATE ORG
              </TabsTrigger>
            </TabsList>
          </CardHeader>

          <CardContent className="pt-6">
            <TabsContent value="project" className="mt-0 animate-in fade-in slide-in-from-top-4 duration-500">
              <form className="space-y-4" onSubmit={onCreateProject}>
                <div className="space-y-2">
                  <Select
                    value={selectedOrganizationId ?? undefined}
                    onValueChange={(value) => onOrganizationChange(value as Id<"organizations">)}
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
                    name="projectName"
                    value={projectName}
                    onChange={(e) => onProjectNameChange(e.target.value)}
                    placeholder="Project Name (e.g. Tower 7)"
                    className="h-12 border-white/10 bg-black/40 text-sm font-medium"
                  />
                </div>
                <div className="space-y-2">
                  <Input
                    name="projectDescription"
                    value={projectDescription}
                    onChange={(e) => onProjectDescriptionChange(e.target.value)}
                    placeholder="Description (optional)"
                    className="h-12 border-white/10 bg-black/40 text-sm font-medium"
                  />
                </div>
                <Button
                  variant="default"
                  className="w-full"
                  disabled={!!busyAction || organizations.length === 0}
                >
                  {busyAction === "project" ? "Generating Silo..." : "CREATE PROJECT"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="org" className="mt-0 animate-in fade-in slide-in-from-top-4 duration-500">
              <form className="space-y-4" onSubmit={onCreateOrganization}>
                <div className="grid grid-cols-[80px,1fr] gap-4 items-end">
                  <EmojiPicker value={organizationIcon} onChange={onOrganizationIconChange} />
                  <Input
                    name="organizationName"
                    value={organizationName}
                    onChange={(e) => onOrganizationNameChange(e.target.value)}
                    placeholder="Organization Name"
                    className="h-14 bg-black/40 border-white/10 text-sm font-medium"
                  />
                </div>
                <Button
                  variant="default"
                  className="w-full h-12"
                  disabled={!!busyAction}
                >
                  {busyAction === "organization" ? "Registering Entity..." : "CREATE ORGANIZATION"}
                </Button>
              </form>
            </TabsContent>
          </CardContent>
        </Card>
      </Tabs>
    </div>
  );
}

interface SendInviteCardProps {
  selectedProject: {
    organizationIcon?: string;
    name: string;
    role: string;
  } | null;
  inviteEmail: string;
  onInviteEmailChange: (value: string) => void;
  inviteRole: "editor" | "owner";
  onInviteRoleChange: (value: "editor" | "owner") => void;
  canInvite: boolean;
  accessOverview: {
    canManage: boolean;
  } | null;
  busyAction: string | null;
  onInvite: (e: React.FormEvent<HTMLFormElement>) => void;
}

function SendInviteCard({
  selectedProject,
  inviteEmail,
  onInviteEmailChange,
  inviteRole,
  onInviteRoleChange,
  canInvite,
  accessOverview,
  busyAction,
  onInvite,
}: SendInviteCardProps) {
  const isDisabled = !selectedProject || (accessOverview != null && !accessOverview.canManage);

  return (
    <Card className="border-white/10 bg-white/[0.02] backdrop-blur-sm overflow-hidden rounded-md shadow-2xl">
      <CardHeader className="h-14 flex flex-row items-center justify-center bg-white/[0.02] border-b border-white/5 p-0">
        <CardTitle className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
          SEND INVITE
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-6 px-6">
        {/* Active Context */}
        <div className="mb-6 rounded-xl border border-primary/10 bg-primary/5 p-4 flex gap-4 items-center">
          <div className="flex size-10 items-center justify-center rounded-lg bg-black/40 border border-white/5 text-xl transition-all">
            {selectedProject?.organizationIcon || "🏢"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Active Context</p>
            <p className="font-display text-sm font-bold text-white truncate">
              {selectedProject?.name || "No Project Selected"}
            </p>
          </div>
          {selectedProject && (
            <div className="rounded-full bg-primary/20 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-primary">
              {selectedProject.role}
            </div>
          )}
        </div>

        <form className="space-y-4" onSubmit={onInvite}>
          <div className="space-y-2">
            <Input
              type="email"
              name="inviteEmail"
              value={inviteEmail}
              onChange={(e) => onInviteEmailChange(e.target.value)}
              placeholder="Operator email (name@company.com)"
              className="h-12 border-white/10 bg-black/40 text-sm font-medium"
              disabled={isDisabled}
            />
          </div>
          <div className="space-y-2">
            <Select
              value={inviteRole}
              onValueChange={(v) => onInviteRoleChange(v as "editor" | "owner")}
              disabled={isDisabled}
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

          {!canInvite ? (
            <div className="rounded-xl bg-destructive/5 border border-destructive/20 p-3 text-center">
              <p className="text-[9px] font-bold uppercase tracking-widest text-destructive">
                Insufficient Clearance
              </p>
            </div>
          ) : (
            <Button variant="neon" className="w-full" disabled={!!busyAction}>
              <MailPlus className="size-4 mr-2 group-hover:scale-110 transition-transform" />
              {busyAction === "invite" ? "Transmitting..." : "SEND INVITE"}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
