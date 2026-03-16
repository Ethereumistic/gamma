import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireProjectAccess, requireProjectManager } from "./helpers";
import { sheetModelValidator } from "./validators";

function normalizeCornerReliefEntry(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if ("horizontal" in record || "vertical" in record) {
      return {
        horizontal: record.horizontal === true,
        vertical: record.vertical === true,
      };
    }
  }

  if (value === "horizontal" || value === true) {
    return { horizontal: true, vertical: false };
  }

  if (value === "vertical") {
    return { horizontal: false, vertical: true };
  }

  return { horizontal: false, vertical: false };
}

function normalizeMeasurementEntry(value: unknown, fallbackAmount: number) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return {
      id: typeof record.id === "string" ? record.id : "legacy",
      amount: typeof record.amount === "number" ? record.amount : fallbackAmount,
    };
  }

  return {
    id: "legacy",
    amount: fallbackAmount,
  };
}

function normalizeFlangeMeasurementEntry(value: unknown) {
  const measurement = normalizeMeasurementEntry(value, 20);

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const reliefs = record.reliefs;

    if (reliefs && typeof reliefs === "object" && !Array.isArray(reliefs)) {
      const reliefRecord = reliefs as Record<string, unknown>;
      return {
        ...measurement,
        reliefs: {
          start: reliefRecord.start === true,
          end: reliefRecord.end === true,
        },
      };
    }
  }

  return {
    ...measurement,
    reliefs: {
      start: false,
      end: false,
    },
  };
}

function normalizeFrezMeasurementEntry(value: unknown) {
  const measurement = normalizeMeasurementEntry(value, 24);

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const notches = record.notches;

    if (notches && typeof notches === "object" && !Array.isArray(notches)) {
      const notchRecord = notches as Record<string, unknown>;
      return {
        ...measurement,
        notches: {
          start: notchRecord.start === true,
          end: notchRecord.end === true,
        },
      };
    }
  }

  return {
    ...measurement,
    notches: {
      start: true,
      end: true,
    },
  };
}

function normalizeSideConfig(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return {
      flanges: Array.isArray(record.flanges) ? record.flanges.map((item) => normalizeFlangeMeasurementEntry(item)) : [],
      frezLines: Array.isArray(record.frezLines) ? record.frezLines.map((item) => normalizeFrezMeasurementEntry(item)) : [],
      frezMode: record.frezMode === "outer" ? "outer" : "inner",
    };
  }

  return {
    flanges: [],
    frezLines: [],
    frezMode: "inner",
  };
}

function normalizeSheetModel(model: any) {
  return {
    ...model,
    offsetCut: typeof model.offsetCut === "number" ? model.offsetCut : 3,
    includeName: typeof model.includeName === "boolean" ? model.includeName : true,
    includeArrow: typeof model.includeArrow === "boolean" ? model.includeArrow : true,
    arrowDirection: ["top", "right", "bottom", "left"].includes(model.arrowDirection) ? model.arrowDirection : "top",
    sides: {
      top: normalizeSideConfig(model.sides?.top),
      right: normalizeSideConfig(model.sides?.right),
      bottom: normalizeSideConfig(model.sides?.bottom),
      left: normalizeSideConfig(model.sides?.left),
    },
    cornerReliefs: {
      topLeft: normalizeCornerReliefEntry(model.cornerReliefs?.topLeft),
      topRight: normalizeCornerReliefEntry(model.cornerReliefs?.topRight),
      bottomRight: normalizeCornerReliefEntry(model.cornerReliefs?.bottomRight),
      bottomLeft: normalizeCornerReliefEntry(model.cornerReliefs?.bottomLeft),
    },
    rubberband: typeof model.rubberband === "boolean" ? model.rubberband : true,
  };
}

export const listByProject = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);

    const designs = await ctx.db
      .query("designs")
      .withIndex("by_project_updatedAt", (query) => query.eq("projectId", args.projectId))
      .collect();

    return Promise.all(
      [...designs]
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map(async (design) => {
          const updatedBy = await ctx.db.get(design.updatedBy);
          return {
            id: design._id,
            name: design.name,
            exportName: design.exportName,
            model: normalizeSheetModel(design.model),
            createdAt: design.createdAt,
            updatedAt: design.updatedAt,
            lastExportedAt: design.lastExportedAt ?? null,
            isStarred: design.isStarred ?? false,
            updatedByName: updatedBy?.name ?? updatedBy?.email ?? "User",
          };
        }),
    );
  },
});

export const getDesign = query({
  args: {
    designId: v.id("designs"),
  },
  handler: async (ctx, args) => {
    const design = await ctx.db.get(args.designId);
    if (!design) {
      return null;
    }

    await requireProjectAccess(ctx, design.projectId);

    const updatedBy = await ctx.db.get(design.updatedBy);
    return {
      id: design._id,
      name: design.name,
      exportName: design.exportName,
      model: normalizeSheetModel(design.model),
      createdAt: design.createdAt,
      updatedAt: design.updatedAt,
      lastExportedAt: design.lastExportedAt ?? null,
      isStarred: design.isStarred ?? false,
      updatedByName: updatedBy?.name ?? updatedBy?.email ?? "User",
      projectId: design.projectId,
      organizationId: design.organizationId,
    };
  },
});

export const saveDesign = mutation({
  args: {
    designId: v.optional(v.id("designs")),
    projectId: v.id("projects"),
    name: v.string(),
    exportName: v.string(),
    model: sheetModelValidator,
    markExported: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const access = await requireProjectManager(ctx, args.projectId);
    const now = Date.now();
    const name = args.name.trim();
    const exportName = args.exportName.trim() || name;
    const normalizedModel = normalizeSheetModel(args.model);
    const lastExportedAt = args.markExported ? now : undefined;

    if (name.length < 2) {
      throw new Error("Design name must be at least 2 characters.");
    }

    if (exportName.length < 2) {
      throw new Error("Export name must be at least 2 characters.");
    }

    if (args.designId) {
      const existing = await ctx.db.get(args.designId);
      if (!existing) {
        throw new Error("Saved design not found.");
      }
      if (existing.projectId !== args.projectId) {
        throw new Error("Saved design belongs to another project.");
      }

      await ctx.db.patch(args.designId, {
        name,
        exportName,
        model: normalizedModel,
        updatedBy: access.userId,
        updatedAt: now,
        ...(lastExportedAt ? { lastExportedAt } : {}),
      });

      return { designId: args.designId };
    }

    const designId = await ctx.db.insert("designs", {
      organizationId: access.project.organizationId,
      projectId: args.projectId,
      name,
      exportName,
      model: normalizedModel,
      createdBy: access.userId,
      updatedBy: access.userId,
      createdAt: now,
      updatedAt: now,
      ...(lastExportedAt ? { lastExportedAt } : {}),
    });

    return { designId };
  },
});

export const deleteDesign = mutation({
  args: {
    designId: v.id("designs"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.designId);
    if (!existing) throw new Error("Saved design not found.");
    await requireProjectManager(ctx, existing.projectId);
    await ctx.db.delete(args.designId);
  },
});

export const renameDesign = mutation({
  args: {
    designId: v.id("designs"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.designId);
    if (!existing) throw new Error("Saved design not found.");
    const access = await requireProjectManager(ctx, existing.projectId);

    const name = args.name.trim();
    if (name.length < 2) throw new Error("Design name must be at least 2 characters.");

    await ctx.db.patch(args.designId, {
      name,
      updatedBy: access.userId,
      updatedAt: Date.now(),
    });
  },
});

export const duplicateDesign = mutation({
  args: {
    designId: v.id("designs"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.designId);
    if (!existing) throw new Error("Saved design not found.");
    const access = await requireProjectManager(ctx, existing.projectId);

    const now = Date.now();
    const newDesignId = await ctx.db.insert("designs", {
      organizationId: access.project.organizationId,
      projectId: existing.projectId,
      name: `${existing.name} (Copy)`,
      exportName: existing.exportName,
      model: existing.model,
      createdBy: access.userId,
      updatedBy: access.userId,
      createdAt: now,
      updatedAt: now,
      isStarred: existing.isStarred,
    });

    return newDesignId;
  },
});

export const toggleStarDesign = mutation({
  args: {
    designId: v.id("designs"),
    isStarred: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.designId);
    if (!existing) throw new Error("Saved design not found.");
    await requireProjectManager(ctx, existing.projectId);

    await ctx.db.patch(args.designId, {
      isStarred: args.isStarred,
    });
  },
});
