import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrganizationManager, requireViewer } from "./helpers";

export const getByOrganization = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireViewer(ctx);
    return await ctx.db
      .query("cnc_settings")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .unique();
  },
});

export const upsert = mutation({
  args: {
    organizationId: v.id("organizations"),
    toolOverrides: v.any(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireOrganizationManager(ctx, args.organizationId);

    const existing = await ctx.db
      .query("cnc_settings")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .unique();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        toolOverrides: args.toolOverrides,
        updatedBy: userId,
        updatedAt: now,
      });
      return existing._id;
    } else {
      return await ctx.db.insert("cnc_settings", {
        organizationId: args.organizationId,
        toolOverrides: args.toolOverrides,
        updatedBy: userId,
        updatedAt: now,
      });
    }
  },
});

export const resetToDefaults = mutation({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireOrganizationManager(ctx, args.organizationId);

    const existing = await ctx.db
      .query("cnc_settings")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});
