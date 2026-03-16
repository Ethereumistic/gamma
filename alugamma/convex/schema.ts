import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
  inviteStatusValidator,
  organizationRoleValidator,
  projectDefaultsValidator,
  projectRoleValidator,
  sheetModelValidator,
} from "./validators";

export default defineSchema({
  ...authTables,
  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_slug", ["slug"]),
  organizationMembers: defineTable({
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    role: organizationRoleValidator,
    joinedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_user", ["userId"])
    .index("by_organization_user", ["organizationId", "userId"]),
  projects: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    defaults: v.optional(projectDefaultsValidator),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_slug", ["organizationId", "slug"]),
  projectMembers: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    userId: v.id("users"),
    role: projectRoleValidator,
    joinedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_user", ["userId"])
    .index("by_project_user", ["projectId", "userId"]),
  projectInvites: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    email: v.string(),
    role: projectRoleValidator,
    status: inviteStatusValidator,
    invitedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
  })
    .index("by_email_status", ["email", "status"])
    .index("by_project_email_status", ["projectId", "email", "status"])
    .index("by_project", ["projectId"]),
  organizationInvites: defineTable({
    organizationId: v.id("organizations"),
    email: v.string(),
    role: organizationRoleValidator,
    status: inviteStatusValidator,
    invitedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
  })
    .index("by_email_status", ["email", "status"])
    .index("by_organization_email_status", ["organizationId", "email", "status"])
    .index("by_organization", ["organizationId"]),
  designs: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    name: v.string(),
    exportName: v.string(),
    model: sheetModelValidator,
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastExportedAt: v.optional(v.number()),
    isStarred: v.optional(v.boolean()),
  })
    .index("by_project", ["projectId"])
    .index("by_project_updatedAt", ["projectId", "updatedAt"]),
});
