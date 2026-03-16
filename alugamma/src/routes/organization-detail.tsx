import { Link, useParams } from "react-router-dom";
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { toast } from "sonner";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWorkspace } from "@/features/workspace/context";

export default function OrganizationDetailPage() {
    const { orgId } = useParams<{ orgId: string }>();
    const { authenticated, isLoadingWorkspace, organizations, projects } = useWorkspace();

    // Org member management features
    const overview = useQuery(api.workspaces.organizationAccessOverview, { organizationId: orgId as Id<"organizations"> });
    const updateRole = useMutation(api.workspaces.updateOrganizationMemberRole);
    const removeMember = useMutation(api.workspaces.removeOrganizationMember);
    const inviteUser = useMutation(api.workspaces.inviteToOrganization);

    const [inviteEmail, setInviteEmail] = useState("");
    const [inviteRole, setInviteRole] = useState<"owner" | "admin" | "member">("member");
    const [isInviting, setIsInviting] = useState(false);

    if (isLoadingWorkspace || overview === undefined) {
        return (
            <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-10 lg:px-8">
                <Card className="border-white/10 bg-card/85">
                    <CardContent className="py-10 text-center text-sm text-muted-foreground">Loading...</CardContent>
                </Card>
            </div>
        );
    }

    if (!authenticated) {
        return (
            <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-10 lg:px-8">
                <Card className="border-white/10 bg-card/85">
                    <CardHeader>
                        <CardTitle>Sign in required</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4 text-sm text-muted-foreground">
                        <p>You need to be signed in to view this organization.</p>
                        <Button asChild>
                            <Link to="/auth">Sign in</Link>
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    const organization = organizations.find((o) => o.id === orgId);
    const orgProjects = projects.filter((p) => p.organizationId === orgId);

    if (!organization) {
        return (
            <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-10 lg:px-8">
                <Card className="border-white/10 bg-card/85">
                    <CardHeader>
                        <CardTitle>Organization not found</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                        You do not have access to this organization or it does not exist.
                    </CardContent>
                    <CardContent>
                        <Button asChild>
                            <Link to="/organization">Back to Organizations</Link>
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    const { members, invites, canManage } = overview || { members: [], invites: [], canManage: false };

    async function handleInvite() {
        if (!inviteEmail) return;
        setIsInviting(true);
        try {
            await inviteUser({ organizationId: orgId as Id<"organizations">, email: inviteEmail, role: inviteRole });
            toast.success("Invite sent successfully.");
            setInviteEmail("");
        } catch (error: any) {
            toast.error(error.message);
        } finally {
            setIsInviting(false);
        }
    }

    async function handleUpdateRole(memberId: Id<"users">, newRole: string) {
        try {
            await updateRole({ organizationId: orgId as Id<"organizations">, memberId, role: newRole as "owner" | "admin" | "member" });
            toast.success("Role updated.");
        } catch (error: any) {
            toast.error(error.message);
        }
    }

    async function handleRemoveMember(memberId: Id<"users">) {
        if (!confirm("Are you sure you want to remove this member?")) return;
        try {
            await removeMember({ organizationId: orgId as Id<"organizations">, memberId });
            toast.success("Member removed.");
        } catch (error: any) {
            toast.error(error.message);
        }
    }

    return (
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-10 lg:px-8">
            <div className="flex items-center gap-4">
                <Button asChild variant="outline" size="sm" className="hidden sm:flex">
                    <Link to="/organization">← Back</Link>
                </Button>
                <h1 className="text-3xl font-bold tracking-tight">{organization.name}</h1>
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-sm font-medium text-primary">
                    {organization.role}
                </span>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <div className="flex flex-col gap-6 lg:col-span-2">
                    <Card className="border-white/10 bg-card/85">
                        <CardHeader>
                            <CardTitle>Projects in {organization.name}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {orgProjects.length === 0 ? (
                                <p className="text-sm text-muted-foreground">There are no projects in this organization.</p>
                            ) : (
                                <ul className="space-y-4">
                                    {orgProjects.map((project) => (
                                        <li key={project.id} className="cursor-pointer rounded-lg border border-white/5 bg-black/20 p-4 transition-colors hover:bg-white/[0.02]">
                                            <div className="flex items-center justify-between">
                                                <h3 className="font-semibold">{project.name}</h3>
                                                <span className="text-xs font-medium text-muted-foreground">{project.role}</span>
                                            </div>
                                            {project.description && (
                                                <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{project.description}</p>
                                            )}
                                            <div className="mt-4">
                                                <Button asChild variant="secondary" size="sm">
                                                    <Link to={`/project/${project.id}`}>Open Project</Link>
                                                </Button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="border-white/10 bg-card/85">
                        <CardHeader>
                            <CardTitle>Members</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ul className="space-y-4">
                                {members.map((member) => (
                                    <li key={member.id} className="flex flex-col gap-2 rounded-lg border border-white/5 bg-black/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <div className="font-medium">{member.name}</div>
                                            <div className="text-xs text-muted-foreground">{member.email}</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {canManage ? (
                                                <Select value={member.role} onValueChange={(val) => handleUpdateRole(member.userId, val)}>
                                                    <SelectTrigger className="h-8 w-[100px] bg-black/20 text-xs">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="owner">Owner</SelectItem>
                                                        <SelectItem value="admin">Admin</SelectItem>
                                                        <SelectItem value="member">Member</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            ) : (
                                                <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs">{member.role}</span>
                                            )}

                                            {canManage && (
                                                <Button variant="destructive" size="sm" onClick={() => handleRemoveMember(member.userId)} className="h-8 px-2 text-xs">
                                                    Kick
                                                </Button>
                                            )}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </CardContent>
                    </Card>

                    {invites.length > 0 && (
                        <Card className="border-white/10 bg-card/85">
                            <CardHeader>
                                <CardTitle>Pending Invites</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ul className="space-y-2">
                                    {invites.map((invite) => (
                                        <li key={invite.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-black/20 p-3 text-sm">
                                            <span>{invite.email}</span>
                                            <span className="text-xs text-muted-foreground">{invite.role}</span>
                                        </li>
                                    ))}
                                </ul>
                            </CardContent>
                        </Card>
                    )}
                </div>

                <div className="flex flex-col gap-6">
                    <Card className="border-white/10 bg-card/85">
                        <CardHeader>
                            <CardTitle>Organization Details</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4 text-sm text-muted-foreground">
                            <div className="flex justify-between border-b border-white/5 pb-2">
                                <span>Name</span>
                                <span className="font-medium text-foreground">{organization.name}</span>
                            </div>
                            <div className="flex justify-between border-b border-white/5 pb-2">
                                <span>Slug</span>
                                <span className="font-medium text-foreground">{organization.slug}</span>
                            </div>
                            <div className="flex justify-between border-b border-white/5 pb-2">
                                <span>Members</span>
                                <span className="font-medium text-foreground">{organization.memberCount}</span>
                            </div>
                            <div className="flex justify-between border-b border-white/5 pb-2">
                                <span>Projects</span>
                                <span className="font-medium text-foreground">{organization.projectCount}</span>
                            </div>
                        </CardContent>
                    </Card>

                    {canManage && (
                        <Card className="border-emerald-500/20 bg-card/85 shadow-[0_0_15px_rgba(20,180,100,0.05)]">
                            <CardHeader>
                                <CardTitle>Invite Member</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-muted-foreground">Email Address</label>
                                    <Input
                                        type="email"
                                        placeholder="colleague@example.com"
                                        value={inviteEmail}
                                        onChange={(e) => setInviteEmail(e.target.value)}
                                        className="h-9 bg-black/20 border-white/10 text-sm focus-visible:ring-emerald-500/50"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-muted-foreground">Role</label>
                                    <Select value={inviteRole} onValueChange={(val: any) => setInviteRole(val)}>
                                        <SelectTrigger className="h-9 w-full bg-black/20 text-sm">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="owner">Owner</SelectItem>
                                            <SelectItem value="admin">Admin</SelectItem>
                                            <SelectItem value="member">Member</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <Button
                                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white"
                                    onClick={handleInvite}
                                    disabled={!inviteEmail || isInviting}
                                >
                                    {isInviting ? "Inviting..." : "Send Invite"}
                                </Button>
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );
}
