import { getAuthUserId } from "@convex-dev/auth/server";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type RequestCtx = QueryCtx | MutationCtx;

type ViewerRecord = Doc<"users">;
type OrganizationMembershipRecord = Doc<"organizationMembers">;
type ProjectMembershipRecord = Doc<"projectMembers">;
type ProjectRecord = Doc<"projects">;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function isOrganizationManager(role: string | undefined) {
  return role === "owner" || role === "admin";
}

export function isProjectManager(role: string | undefined) {
  return role === "owner" || role === "editor";
}

export async function requireViewer(ctx: RequestCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("You must be signed in.");
  }

  const user = (await ctx.db.get(userId)) as ViewerRecord | null;
  if (!user) {
    throw new Error("Authenticated user record not found.");
  }

  return {
    userId,
    user,
    email: typeof user.email === "string" ? normalizeEmail(user.email) : "",
  };
}

export async function getOrganizationMembership(
  ctx: RequestCtx,
  organizationId: Id<"organizations">,
  userId: Id<"users">,
) {
  return (await ctx.db
    .query("organizationMembers")
    .withIndex("by_organization_user", (query) => query.eq("organizationId", organizationId).eq("userId", userId))
    .unique()) as OrganizationMembershipRecord | null;
}

export async function getProjectMembership(ctx: RequestCtx, projectId: Id<"projects">, userId: Id<"users">) {
  return (await ctx.db
    .query("projectMembers")
    .withIndex("by_project_user", (query) => query.eq("projectId", projectId).eq("userId", userId))
    .unique()) as ProjectMembershipRecord | null;
}

export async function requireOrganizationManager(ctx: RequestCtx, organizationId: Id<"organizations">) {
  const viewer = await requireViewer(ctx);
  const membership = await getOrganizationMembership(ctx, organizationId, viewer.userId);

  if (!membership || !isOrganizationManager(membership.role)) {
    throw new Error("You do not have permission to manage this organization.");
  }

  return { ...viewer, membership };
}

export async function requireProjectAccess(ctx: RequestCtx, projectId: Id<"projects">) {
  const viewer = await requireViewer(ctx);
  const project = (await ctx.db.get(projectId)) as ProjectRecord | null;

  if (!project) {
    throw new Error("Project not found.");
  }

  const organizationMembership = await getOrganizationMembership(ctx, project.organizationId, viewer.userId);
  const projectMembership = await getProjectMembership(ctx, projectId, viewer.userId);

  if (!projectMembership && !isOrganizationManager(organizationMembership?.role)) {
    throw new Error("You do not have access to this project.");
  }

  return {
    ...viewer,
    project,
    organizationMembership,
    projectMembership,
  };
}

export async function requireProjectManager(ctx: RequestCtx, projectId: Id<"projects">) {
  const access = await requireProjectAccess(ctx, projectId);

  if (!isOrganizationManager(access.organizationMembership?.role) && !isProjectManager(access.projectMembership?.role)) {
    throw new Error("You do not have permission to manage this project.");
  }

  return access;
}
