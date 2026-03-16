import { v, type Infer } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import {
  getOrganizationMembership,
  getProjectMembership,
  isOrganizationManager,
  normalizeEmail,
  requireOrganizationManager,
  requireProjectAccess,
  requireProjectManager,
  requireViewer,
  slugify,
} from "./helpers";
import { organizationRoleValidator, projectDefaultsValidator, projectRoleValidator } from "./validators";

async function nextOrganizationSlug(ctx: MutationCtx, name: string) {
  const base = slugify(name) || "organization";
  let slug = base;
  let suffix = 2;

  while (await ctx.db.query("organizations").withIndex("by_slug", (query) => query.eq("slug", slug)).unique()) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }

  return slug;
}

async function nextProjectSlug(ctx: MutationCtx, organizationId: Id<"organizations">, name: string) {
  const base = slugify(name) || "project";
  let slug = base;
  let suffix = 2;

  while (
    await ctx.db
      .query("projects")
      .withIndex("by_organization_slug", (query) => query.eq("organizationId", organizationId).eq("slug", slug))
      .unique()
  ) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }

  return slug;
}

export const viewerWorkspace = query({
  args: {},
  handler: async (ctx) => {
    let viewer: Awaited<ReturnType<typeof requireViewer>> | null = null;

    try {
      viewer = await requireViewer(ctx);
    } catch {
      return {
        authenticated: false,
        viewer: null,
        organizations: [],
        projects: [],
        pendingInvites: [],
      };
    }

    const now = Date.now();
    const organizationMemberships = await ctx.db
      .query("organizationMembers")
      .withIndex("by_user", (query) => query.eq("userId", viewer.userId))
      .collect();
    const projectMemberships = await ctx.db
      .query("projectMembers")
      .withIndex("by_user", (query) => query.eq("userId", viewer.userId))
      .collect();

    const organizations = await Promise.all(
      organizationMemberships.map(async (membership) => {
        const organization = await ctx.db.get(membership.organizationId);
        if (!organization) {
          return null;
        }

        const projectCount = (
          await ctx.db.query("projects").withIndex("by_organization", (query) => query.eq("organizationId", organization._id)).collect()
        ).length;
        const memberCount = (
          await ctx.db
            .query("organizationMembers")
            .withIndex("by_organization", (query) => query.eq("organizationId", organization._id))
            .collect()
        ).length;

        return {
          id: organization._id,
          name: organization.name,
          slug: organization.slug,
          role: membership.role,
          memberCount,
          projectCount,
        };
      }),
    );

    const accessibleProjects = new Map<
      string,
      {
        id: Id<"projects">;
        organizationId: Id<"organizations">;
        organizationName: string;
        name: string;
        slug: string;
        description: string;
        defaults?: Infer<typeof projectDefaultsValidator>;
        role: string;
      }
    >();

    for (const membership of projectMemberships) {
      const project = await ctx.db.get(membership.projectId);
      if (!project) {
        continue;
      }

      const organization = await ctx.db.get(project.organizationId);
      if (!organization) {
        continue;
      }

      accessibleProjects.set(project._id, {
        id: project._id,
        organizationId: project.organizationId,
        organizationName: organization.name,
        name: project.name,
        slug: project.slug,
        description: project.description ?? "",
        defaults: project.defaults,
        role: membership.role,
      });
    }

    for (const membership of organizationMemberships.filter((item) => isOrganizationManager(item.role))) {
      const projects = await ctx.db
        .query("projects")
        .withIndex("by_organization", (query) => query.eq("organizationId", membership.organizationId))
        .collect();
      const organization = await ctx.db.get(membership.organizationId);
      if (!organization) {
        continue;
      }

      for (const project of projects) {
        const existing = accessibleProjects.get(project._id);
        accessibleProjects.set(project._id, {
          id: project._id,
          organizationId: project.organizationId,
          organizationName: organization.name,
          name: project.name,
          slug: project.slug,
          description: project.description ?? "",
          defaults: project.defaults,
          role: existing?.role ?? membership.role,
        });
      }
    }

    const projects = await Promise.all(
      [...accessibleProjects.values()]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(async (project) => {
          const designs = await ctx.db
            .query("designs")
            .withIndex("by_project_updatedAt", (query) => query.eq("projectId", project.id))
            .collect();

          return {
            ...project,
            designs: [...designs]
              .sort((left, right) => right.updatedAt - left.updatedAt)
              .map((design) => ({
                id: design._id,
                name: design.name,
                exportName: design.exportName,
                updatedAt: design.updatedAt,
                createdAt: design.createdAt,
                isStarred: design.isStarred,
              })),
          };
        }),
    );

    const pendingInvites = viewer.email
      ? await ctx.db
        .query("projectInvites")
        .withIndex("by_email_status", (query) => query.eq("email", viewer.email).eq("status", "pending"))
        .collect()
      : [];

    const inviteCards = await Promise.all(
      pendingInvites
        .filter((invite) => invite.expiresAt > now)
        .map(async (invite) => {
          const project = await ctx.db.get(invite.projectId);
          const organization = await ctx.db.get(invite.organizationId);
          if (!project || !organization) {
            return null;
          }

          return {
            id: invite._id,
            organizationId: invite.organizationId,
            organizationName: organization.name,
            projectId: invite.projectId,
            projectName: project.name,
            role: invite.role,
            createdAt: invite.createdAt,
            expiresAt: invite.expiresAt,
          };
        }),
    );

    const pendingOrgInvites = viewer.email
      ? await ctx.db
        .query("organizationInvites")
        .withIndex("by_email_status", (query) => query.eq("email", viewer.email).eq("status", "pending"))
        .collect()
      : [];

    const orgInviteCards = await Promise.all(
      pendingOrgInvites
        .filter((invite) => invite.expiresAt > now)
        .map(async (invite) => {
          const organization = await ctx.db.get(invite.organizationId);
          if (!organization) {
            return null;
          }

          return {
            id: invite._id,
            organizationId: invite.organizationId,
            organizationName: organization.name,
            role: invite.role,
            createdAt: invite.createdAt,
            expiresAt: invite.expiresAt,
          };
        }),
    );

    return {
      authenticated: true,
      viewer: {
        id: viewer.userId,
        email: viewer.user.email ?? "",
        name: viewer.user.name ?? (viewer.user.email ?? "User"),
      },
      organizations: organizations.filter(Boolean).sort((left, right) => left!.name.localeCompare(right!.name)),
      projects,
      pendingInvites: inviteCards.filter(Boolean).sort((left, right) => (left?.createdAt || 0) - (right?.createdAt || 0)),
      pendingOrgInvites: orgInviteCards.filter(Boolean).sort((left, right) => (left?.createdAt || 0) - (right?.createdAt || 0)),
    };
  },
});

export const organizationAccessOverview = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const access = await requireOrganizationManager(ctx, args.organizationId);
    if (!access) { throw new Error("Not authorized"); }
    const memberships = await ctx.db
      .query("organizationMembers")
      .withIndex("by_organization", (query) => query.eq("organizationId", args.organizationId))
      .collect();
    const invites = await ctx.db.query("organizationInvites").withIndex("by_organization", (query) => query.eq("organizationId", args.organizationId)).collect();

    const members = await Promise.all(
      memberships.map(async (membership) => {
        const user = await ctx.db.get(membership.userId);
        return {
          id: membership._id,
          userId: membership.userId,
          name: user?.name ?? user?.email ?? "User",
          email: user?.email ?? "",
          role: membership.role,
        };
      }),
    );

    const organization = await ctx.db.get(args.organizationId);

    return {
      organization: {
        id: args.organizationId,
        name: organization?.name ?? "",
        slug: organization?.slug ?? "",
      },
      members,
      invites: invites
        .filter((invite) => invite.status === "pending" && invite.expiresAt > Date.now())
        .map((invite) => ({
          id: invite._id,
          email: invite.email,
          role: invite.role,
          createdAt: invite.createdAt,
          expiresAt: invite.expiresAt,
        })),
      canManage: isOrganizationManager(access.membership?.role),
    };
  },
});

export const inviteToOrganization = mutation({
  args: {
    organizationId: v.id("organizations"),
    email: v.string(),
    role: organizationRoleValidator,
  },
  handler: async (ctx, args) => {
    const access = await requireOrganizationManager(ctx, args.organizationId);
    const email = normalizeEmail(args.email);

    if (!email.includes("@")) {
      throw new Error("Enter a valid email address.");
    }

    const now = Date.now();
    const existingInvite = await ctx.db
      .query("organizationInvites")
      .withIndex("by_organization_email_status", (query) =>
        query.eq("organizationId", args.organizationId).eq("email", email).eq("status", "pending"),
      )
      .unique();

    if (existingInvite) {
      await ctx.db.patch(existingInvite._id, {
        role: args.role,
        invitedBy: access.userId,
        updatedAt: now,
        expiresAt: now + 1000 * 60 * 60 * 24 * 14,
      });
      return { inviteId: existingInvite._id };
    }

    const inviteId = await ctx.db.insert("organizationInvites", {
      organizationId: args.organizationId,
      email,
      role: args.role,
      status: "pending",
      invitedBy: access.userId,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 1000 * 60 * 60 * 24 * 14,
    });

    return { inviteId };
  },
});

export const updateOrganizationMemberRole = mutation({
  args: {
    organizationId: v.id("organizations"),
    memberId: v.id("users"),
    role: organizationRoleValidator,
  },
  handler: async (ctx, args) => {
    const access = await requireOrganizationManager(ctx, args.organizationId);
    if (access.userId === args.memberId) {
      throw new Error("Cannot change your own role this way.");
    }
    const membership = await getOrganizationMembership(ctx, args.organizationId, args.memberId);
    if (!membership) {
      throw new Error("Member not found.");
    }
    await ctx.db.patch(membership._id, { role: args.role });
  },
});

export const removeOrganizationMember = mutation({
  args: {
    organizationId: v.id("organizations"),
    memberId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const access = await requireOrganizationManager(ctx, args.organizationId);
    if (access.userId === args.memberId) {
      throw new Error("Cannot remove yourself.");
    }
    const membership = await getOrganizationMembership(ctx, args.organizationId, args.memberId);
    if (!membership) {
      throw new Error("Member not found.");
    }
    // Delete project memberships for this user in this org
    const projectMemberships = await ctx.db
      .query("projectMembers")
      .withIndex("by_user", q => q.eq("userId", args.memberId))
      .collect();
    for (const pm of projectMemberships) {
      if (pm.organizationId === args.organizationId) {
        await ctx.db.delete(pm._id);
      }
    }
    await ctx.db.delete(membership._id);
  },
});

export const createOrganization = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const name = args.name.trim();

    if (name.length < 2) {
      throw new Error("Organization name must be at least 2 characters.");
    }

    const now = Date.now();
    const organizationId = await ctx.db.insert("organizations", {
      name,
      slug: await nextOrganizationSlug(ctx, name),
      createdBy: viewer.userId,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("organizationMembers", {
      organizationId,
      userId: viewer.userId,
      role: "owner",
      joinedAt: now,
    });

    return { organizationId };
  },
});

export const createProject = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const manager = await requireOrganizationManager(ctx, args.organizationId);
    const name = args.name.trim();

    if (name.length < 2) {
      throw new Error("Project name must be at least 2 characters.");
    }

    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      organizationId: args.organizationId,
      name,
      slug: await nextProjectSlug(ctx, args.organizationId, name),
      description: args.description?.trim() || undefined,
      createdBy: manager.userId,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("projectMembers", {
      organizationId: args.organizationId,
      projectId,
      userId: manager.userId,
      role: "owner",
      joinedAt: now,
    });

    return { projectId };
  },
});

export const inviteToProject = mutation({
  args: {
    projectId: v.id("projects"),
    email: v.string(),
    role: projectRoleValidator,
  },
  handler: async (ctx, args) => {
    const access = await requireProjectManager(ctx, args.projectId);
    const email = normalizeEmail(args.email);

    if (!email.includes("@")) {
      throw new Error("Enter a valid email address.");
    }

    const now = Date.now();
    const existingInvite = await ctx.db
      .query("projectInvites")
      .withIndex("by_project_email_status", (query) =>
        query.eq("projectId", args.projectId).eq("email", email).eq("status", "pending"),
      )
      .unique();

    if (existingInvite) {
      await ctx.db.patch(existingInvite._id, {
        role: args.role,
        invitedBy: access.userId,
        updatedAt: now,
        expiresAt: now + 1000 * 60 * 60 * 24 * 14,
      });
      return { inviteId: existingInvite._id };
    }

    const inviteId = await ctx.db.insert("projectInvites", {
      organizationId: access.project.organizationId,
      projectId: args.projectId,
      email,
      role: args.role,
      status: "pending",
      invitedBy: access.userId,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 1000 * 60 * 60 * 24 * 14,
    });

    return { inviteId };
  },
});

export const acceptProjectInvite = mutation({
  args: {
    inviteId: v.id("projectInvites"),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const invite = await ctx.db.get(args.inviteId);

    if (!invite) {
      throw new Error("Invite not found.");
    }

    if (invite.status !== "pending") {
      throw new Error("This invite is no longer active.");
    }

    if (invite.expiresAt <= Date.now()) {
      await ctx.db.patch(invite._id, { status: "expired", updatedAt: Date.now() });
      throw new Error("This invite has expired.");
    }

    if (!viewer.email || invite.email !== viewer.email) {
      throw new Error("This invite belongs to a different email address.");
    }

    const now = Date.now();
    const orgMembership = await getOrganizationMembership(ctx, invite.organizationId, viewer.userId);
    if (!orgMembership) {
      await ctx.db.insert("organizationMembers", {
        organizationId: invite.organizationId,
        userId: viewer.userId,
        role: "member",
        joinedAt: now,
      });
    }

    const projectMembership = await getProjectMembership(ctx, invite.projectId, viewer.userId);
    if (!projectMembership) {
      await ctx.db.insert("projectMembers", {
        organizationId: invite.organizationId,
        projectId: invite.projectId,
        userId: viewer.userId,
        role: invite.role,
        joinedAt: now,
      });
    }

    await ctx.db.patch(invite._id, {
      status: "accepted",
      acceptedAt: now,
      updatedAt: now,
    });

    return { success: true };
  },
});

export const projectAccessOverview = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const access = await requireProjectAccess(ctx, args.projectId);
    const memberships = await ctx.db
      .query("projectMembers")
      .withIndex("by_project", (query) => query.eq("projectId", args.projectId))
      .collect();
    const invites = await ctx.db.query("projectInvites").withIndex("by_project", (query) => query.eq("projectId", args.projectId)).collect();

    const members = await Promise.all(
      memberships.map(async (membership) => {
        const user = await ctx.db.get(membership.userId);
        return {
          id: membership._id,
          userId: membership.userId,
          name: user?.name ?? user?.email ?? "User",
          email: user?.email ?? "",
          role: membership.role,
        };
      }),
    );

    return {
      project: {
        id: access.project._id,
        name: access.project.name,
        description: access.project.description ?? "",
        defaults: access.project.defaults,
      },
      members,
      invites: invites
        .filter((invite) => invite.status === "pending" && invite.expiresAt > Date.now())
        .map((invite) => ({
          id: invite._id,
          email: invite.email,
          role: invite.role,
          createdAt: invite.createdAt,
          expiresAt: invite.expiresAt,
        })),
      canManage:
        isOrganizationManager(access.organizationMembership?.role) ||
        access.projectMembership?.role === "owner" ||
        access.projectMembership?.role === "editor",
    };
  },
});

export const updateProjectDefaults = mutation({
  args: {
    projectId: v.id("projects"),
    defaults: projectDefaultsValidator,
  },
  handler: async (ctx, args) => {
    const access = await requireProjectManager(ctx, args.projectId);
    await ctx.db.patch(args.projectId, { defaults: args.defaults });
  },
});
