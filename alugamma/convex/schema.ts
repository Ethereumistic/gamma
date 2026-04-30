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
    icon: v.optional(v.string()),
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
    ncProgramCount: v.optional(v.number()),
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
  cnc_settings: defineTable({
    organizationId: v.id("organizations"),
    toolOverrides: v.any(),   // sparse JSON: { "7": { "layers": { "CUT": { "depth": -4.4 } } } }
    updatedBy: v.id("users"),
    updatedAt: v.number(),
  }).index("by_organization", ["organizationId"]),
  nc_programs: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    name: v.string(),               // assembled filename WITHOUT extension
    algorithm: v.string(),
    scenario: v.string(),
    estimatedTimeSeconds: v.number(),
    ncCode: v.string(),
    dxfSourceName: v.string(),
    createdBy: v.id("users"),
    updatedAt: v.number(),
    updatedBy: v.id("users"),
    isStarred: v.optional(v.boolean()),
    geometryData: v.optional(
      v.object({
        segments: v.array(
          v.object({
            seq_index: v.number(),
            layer: v.string(),
            x1: v.number(),
            y1: v.number(),
            x2: v.number(),
            y2: v.number(),
          })
        ),
        bbox: v.object({
          min_x: v.number(),
          min_y: v.number(),
          max_x: v.number(),
          max_y: v.number(),
        }),
      })
    ),
    lineToSegmentMap: v.optional(v.any()),
    contoursByLayer: v.optional(v.any()),
    stockBbox: v.optional(
      v.object({
        min_x: v.number(),
        max_x: v.number(),
        min_y: v.number(),
        max_y: v.number(),
      })
    ),
  })
    .index("by_project", ["projectId"])
    .index("by_organization", ["organizationId"])
    .index("by_project_updated", ["projectId", "updatedAt"]),
});
