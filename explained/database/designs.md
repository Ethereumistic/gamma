# Design Storage and Data Model

This document explains the technical details of how designs are stored and managed in the AluGamma database, based on `convex/designs.ts`.

## 1. Design Table (`schema.ts`)
The `designs` table stores all sheet metal design data generated in the frontend.

- **`organizationId`** & **`projectId`**: Links the design to its parent organization and project for access control.
- **`name`**: The display name of the design in the UI.
- **`exportName`**: The default filename for DXF/PDF exports.
- **`model`**: The most complex field, containing the entire design state.
- **`isStarred`**: A flag for pinning important designs.

## 2. The Sheet Metal Model
The `model` field is a deeply nested JSON object validated by `sheetModelValidator`. It includes:
- **`baseWidth`** & **`baseHeight`**: Dimensions of the flat sheet.
- **`sides`**: Configuration for Top, Right, Bottom, and Left flanges (e.g., flange height, "frez" line locations, milling modes).
- **`cornerReliefs`**: Settings for how to handle the intersections at all four corners.
- **`offsetCut`**: Margin for the cutting tool.
- **`arrowDirection`**: Indicators for material orientation.

## 3. Data Normalization
Because the design model can evolve or contain legacy data, `designs.ts` implements several "normalization" functions before saving or loading:

- **`normalizeSheetModel(model)`**: Ensures defaults are applied for missing fields (e.g., setting `offsetCut` to 3 if missing).
- **`normalizeSideConfig(side)`**: Fixes inconsistencies in flange or "frez" line definitions.
- **`normalizeCornerReliefEntry(relief)`**: Converts simple boolean states into explicit horizontal/vertical relief configurations.

## 4. Key Design Operations
The project implements standard CRUD operations for designs, all of which are protected by `requireProjectManager(ctx, projectId)`:

- **`saveDesign`**: Handles both creation (via `ctx.db.insert`) and updates (via `ctx.db.patch`).
- **`duplicateDesign`**: Creates an exact copy of an existing design with "(Copy)" appended to the name.
- **`listByProject`**: Fetches all designs for a project, sorted by the `updatedAt` timestamp.
- **`deleteDesign`**: Permanently removes a design from the database.

## 5. Design Export Tracking
The system tracks design interaction via `lastExportedAt`. Setting this timestamp allows the UI to show the user which files have already been processed for manufacturing.
