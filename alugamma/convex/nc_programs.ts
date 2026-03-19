import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireProjectManager, requireProjectAccess } from "./helpers";

export const saveNcProgram = mutation({
  args: {
    projectId: v.id("projects"),
    organizationId: v.id("organizations"),
    name: v.string(),
    algorithm: v.string(),
    scenario: v.string(),
    estimatedTimeSeconds: v.number(),
    ncCode: v.string(),
    dxfSourceName: v.string(),
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
  },
  handler: async (ctx, args) => {
    const access = await requireProjectManager(ctx, args.projectId);
    
    // We want to overwrite the NC program if one from the same DXF source already exists in this project
    const existing = await ctx.db
      .query("nc_programs")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .filter(q => q.eq(q.field("dxfSourceName"), args.dxfSourceName))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        algorithm: args.algorithm,
        scenario: args.scenario,
        estimatedTimeSeconds: args.estimatedTimeSeconds,
        ncCode: args.ncCode,
        updatedBy: access.userId,
        updatedAt: now,
        geometryData: args.geometryData,
        lineToSegmentMap: args.lineToSegmentMap,
      });
      return existing._id;
    } else {
      const id = await ctx.db.insert("nc_programs", {
        organizationId: args.organizationId,
        projectId: args.projectId,
        name: args.name,
        algorithm: args.algorithm,
        scenario: args.scenario,
        estimatedTimeSeconds: args.estimatedTimeSeconds,
        ncCode: args.ncCode,
        dxfSourceName: args.dxfSourceName,
        geometryData: args.geometryData,
        lineToSegmentMap: args.lineToSegmentMap,
        createdBy: access.userId,
        updatedBy: access.userId,
        updatedAt: now,
        isStarred: false,
      });
      return id;
    }
  },
});

export const updateNcProgram = mutation({
  args: {
    projectId: v.id("projects"),
    ncProgramId: v.id("nc_programs"),
    name: v.optional(v.string()),
    algorithm: v.optional(v.string()),
    scenario: v.optional(v.string()),
    estimatedTimeSeconds: v.optional(v.number()),
    ncCode: v.optional(v.string()),
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
  },
  handler: async (ctx, args) => {
    await requireProjectManager(ctx, args.projectId);
    const existing = await ctx.db.get(args.ncProgramId);
    if (!existing) throw new Error("NC program not found");
    if (existing.projectId !== args.projectId) throw new Error("Not authorized");
    
    const patch: any = { updatedAt: Date.now() };
    if (args.name !== undefined) patch.name = args.name;
    if (args.algorithm !== undefined) patch.algorithm = args.algorithm;
    if (args.scenario !== undefined) patch.scenario = args.scenario;
    if (args.estimatedTimeSeconds !== undefined) patch.estimatedTimeSeconds = args.estimatedTimeSeconds;
    if (args.ncCode !== undefined) patch.ncCode = args.ncCode;
    if (args.geometryData !== undefined) patch.geometryData = args.geometryData;
    if (args.lineToSegmentMap !== undefined) patch.lineToSegmentMap = args.lineToSegmentMap;
    
    await ctx.db.patch(args.ncProgramId, patch);
  },
});

export const getById = query({
  args: { programId: v.id("nc_programs") },
  handler: async (ctx, args) => {
    const program = await ctx.db.get(args.programId);
    if (!program) return null;
    await requireProjectAccess(ctx, program.projectId);
    return program;
  },
});

import { requireViewer } from "./helpers";
export const listAllForViewer = query({
  args: {},
  handler: async (ctx) => {
    const access = await requireViewer(ctx);
    
    const orgMemberships = await ctx.db
      .query("organizationMembers")
      .withIndex("by_user", (q) => q.eq("userId", access.userId))
      .collect();
      
    if (orgMemberships.length === 0) return [];
    
    // Get all projects for these orgs
    const projects = [];
    for (const membership of orgMemberships) {
      const orgProjects = await ctx.db
        .query("projects")
        .withIndex("by_organization", (q) => q.eq("organizationId", membership.organizationId))
        .collect();
      projects.push(...orgProjects);
    }
    
    // Get all NC programs for these projects
    const allPrograms = [];
    for (const project of projects) {
      const programs = await ctx.db
        .query("nc_programs")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect();
      allPrograms.push(...programs);
    }
    
    return allPrograms.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const listByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    return await ctx.db
      .query("nc_programs")
      .withIndex("by_project_updated", q => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();
  },
});

export const deleteNcProgram = mutation({
  args: {
    projectId: v.id("projects"),
    ncProgramId: v.id("nc_programs"),
  },
  handler: async (ctx, args) => {
    await requireProjectManager(ctx, args.projectId);
    await ctx.db.delete(args.ncProgramId);
  },
});

export const toggleStar = mutation({
  args: {
    projectId: v.id("projects"),
    ncProgramId: v.id("nc_programs"),
  },
  handler: async (ctx, args) => {
    await requireProjectManager(ctx, args.projectId);
    const existing = await ctx.db.get(args.ncProgramId);
    if (!existing) throw new Error("NC program not found");
    await ctx.db.patch(args.ncProgramId, { isStarred: !existing.isStarred });
  },
});
