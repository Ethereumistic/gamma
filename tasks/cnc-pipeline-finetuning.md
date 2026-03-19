# CNC Pipeline — Finetuning Plan

## Overview

Six focused tracks. Each is independent enough to be executed in order without regressions. Read each section fully before touching code — several tracks share types or context that must stay in sync.

---

## Track 1: Schema Cleanup — `nc_programs` Table

### Remove unused fields

In `convex/schema.ts`, remove the following fields from the `nc_programs` table definition:

- `contourCount` — not useful at rest, already shown in the live job metadata
- `exportName` — redundant; the `.nc` filename is always `name + ".nc"`, reconstruct it wherever needed in the app layer

### Remove redundant timestamp

Convex provides `_creationTime` automatically. Remove the manually-managed `createdAt` field from the schema. Keep only:

```
_creationTime  (automatic — use this as "createdAt" in the app layer)
createdBy
updatedAt
updatedBy
```

In any component or query that reads `createdAt`, replace it with `_creationTime`. In `convex/nc_programs.ts`, remove all `createdAt: Date.now()` assignments from insert payloads.

### Updated table shape (after cleanup)

```typescript
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
})
  .index("by_project", ["projectId"])
  .index("by_organization", ["organizationId"])
  .index("by_project_updated", ["projectId", "updatedAt"])
```

---

## Track 2: Replace Browser Alert with Sonner Toast

The `saveNcProgram` flow currently triggers a `window.alert()`. Replace every `alert(...)` call in the CNC pipeline save flow with Sonner toasts.

**Pattern to use** (already available in the project):

```typescript
import { toast } from "sonner";

// success
toast.success("NC program saved", { description: ncProgram.name + ".nc" });

// error
toast.error("Failed to save NC program", { description: error.message });
```

Search for any `alert(` calls inside `CNCPipelinePage.tsx`, `useGenerate.ts`, and any save-related helpers, and replace them all. Do not add a Sonner provider — it is already wrapped.

---

## Track 3: Routing — Add `/cnc-pipeline` Route File

### Problem

There is no `cnc-pipeline.tsx` route file in the `/routes` (or equivalent Vite/TanStack Router routes folder). The page component lives at `src/features/cnc-pipeline/CNCPipelinePage.tsx` but is likely referenced directly or via a catch-all. We need proper route files to support:

- `/cnc-pipeline` — index/dashboard page (new)
- `/cnc-pipeline/new` — active generation session (existing `CNCPipelinePage.tsx`)
- `/cnc-pipeline/:programId` — saved NC program viewer (new)

### What to create / move

**Step 1 — Rename / repurpose the existing page**

The existing `CNCPipelinePage.tsx` (drop zone + generation + playback) becomes the **`/cnc-pipeline/new`** page. Do not change its internal logic. Just ensure it is mounted at `/cnc-pipeline/new`.

**Step 2 — Create the route files**

Follow whatever router convention the project uses (check how `sheet-metal.tsx` is registered — most likely TanStack Router or React Router v6 with file-based routes).

Create these three route files (or register them programmatically, matching the project pattern):

```
routes/cnc-pipeline/index.tsx          → CNCPipelineDashboardPage
routes/cnc-pipeline/new.tsx            → re-exports / wraps existing CNCPipelinePage
routes/cnc-pipeline/$programId.tsx     → CNCProgramViewerPage (new, see Track 4)
```

**Step 3 — Update navigation**

In `app-sidebar.tsx`, the existing nav item already points to `/cnc-pipeline`. No URL change needed — the index route handles the dashboard.

---

## Track 4: `CNCPipelineDashboardPage` — Index Route (`/cnc-pipeline`)

This is the landing page, mirrors the `/sheet-metal` concept where you see saved items before entering a session.

### Layout

Two-column layout (or stacked on smaller screens):

**Left / Top — Upload card**

A card containing the `DXFDropZone` (full size, prominent). When a file is dropped here, navigate to `/cnc-pipeline/new` and pass the file via a shared context or `sessionStorage` so `CNCPipelinePage` picks it up immediately and starts auto-generation.

Suggested mechanism: create a tiny `useCNCUploadTransfer` context (or add to existing CNC context) that holds a `pendingFile: File | null` state. Dashboard sets it, then navigates. The `/new` page reads and clears it on mount.

**Right / Bottom — Saved NC Programs**

Display saved NC programs grouped by project, across all organizations the user belongs to — same pattern as how `viewerWorkspace` already returns the full org/project tree.

Query: `api.nc_programs.listAllForViewer` — a new Convex query that, like `viewerWorkspace`, fetches all NC programs accessible to the current user across all their projects/orgs, sorted by `updatedAt` descending. Protect it with `requireViewer`.

Each program card / list row should show:
- `name` (the assembled NC filename without extension)
- `algorithm` badge
- `scenario` short code badge
- estimated time (formatted as `MM:SS`)
- `_creationTime` formatted (same `formatDateGroup` utility already in `app-sidebar.tsx`)
- Star toggle
- Link to `/cnc-pipeline/:programId`
- Delete action

Group programs visually by organization → project, similar to how designs are grouped in the workspace dashboard.

---

## Track 5: `CNCProgramViewerPage` — Saved Program Route (`/cnc-pipeline/:programId`)

When the user clicks a saved NC program, navigate to `/cnc-pipeline/:programId`.

### Behavior

- Fetch the `nc_programs` record by ID from Convex: `api.nc_programs.getById`.
- Reconstruct the playback-ready state: the `ncCode` string is already stored. Pipe it directly into `NCPreview` and `PlaybackControls` as if the user just generated it.
- **Geometry viewer**: the raw geometry segments are NOT stored (only the NC code is). Two options — pick one and note it in the implementation:
  - **Option A (recommended)**: Show only `NCPreview` + `PlaybackControls`. Hide `GeometryViewer`. The NC code viewer with line highlighting and seek is still fully functional without geometry.
  - **Option B**: Re-run `POST /api/generate` on load using the stored `dxfSourceName` and `algorithm` to regenerate geometry. Only viable if the original DXF is also stored somewhere. Given we do NOT store the DXF, **Option A is the correct choice**.
- Show a header with the program name, algorithm badge, scenario badge, estimated time, and a **Download `.nc`** button (constructs a `Blob` from `ncCode` and triggers download as `name + ".nc"`).
- Show a **Re-generate** button that navigates to `/cnc-pipeline/new` and pre-fills the algorithm setting from the saved program's `algorithm` field (store it in the transfer context).

---

## Track 6: Sidebar — Context-Aware Panel (Designs vs NC Programs)

### Goal

When on `/sheet-metal/*`, the sidebar shows the **Designs** panel (existing behavior, no change).  
When on `/cnc-pipeline/*`, the sidebar shows an **NC Programs** panel (new).  
On all other routes, neither panel is shown (existing behavior).

### Changes in `app-sidebar.tsx`

**Step 1 — Add route detection**

```typescript
const pathIsSheetMetal = location.pathname.startsWith("/sheet-metal");
const pathIsCNCPipeline = location.pathname.startsWith("/cnc-pipeline");  // ADD THIS
```

**Step 2 — Add NC programs data**

Add a new query (or extend existing workspace context) to fetch NC programs for the selected project. Suggested: add `ncPrograms: NcProgramSummary[]` to the `selectedProject` object returned by the workspace context, fetching from `api.nc_programs.listByProject`. Each `NcProgramSummary` should include: `id`, `name`, `algorithm`, `scenario`, `estimatedTimeSeconds`, `isStarred`, `_creationTime`.

Alternatively, query directly inside `AppSidebar` with `useQuery(api.nc_programs.listByProject, { projectId: selectedProjectId })` — simpler, keeps the workspace context clean.

**Step 3 — Add NC programs mutation hooks**

Mirror what exists for designs:

```typescript
const toggleStarNcProgram = useMutation(api.nc_programs.toggleStar);
const deleteNcProgram = useMutation(api.nc_programs.deleteNcProgram);
const renameNcProgram = useMutation(api.nc_programs.renameNcProgram);  // add this mutation if not yet present
```

**Step 4 — Add NC programs state**

```typescript
const [ncSearchQuery, setNcSearchQuery] = useState("");
const [ncSortOrder, setNcSortOrder] = useState<"newest" | "oldest" | "a-z" | "z-a">("newest");
const [ncProgramToRename, setNcProgramToRename] = useState<{ id: Id<"nc_programs">, name: string } | null>(null);
```

**Step 5 — Replace the conditional panel block**

The existing sidebar has this structure (simplified):

```tsx
{authenticated && selectedProject && (
  <SidebarGroup>  {/* Designs panel */}
    ...
  </SidebarGroup>
)}
```

Replace it with a conditional switch:

```tsx
{authenticated && selectedProject && pathIsSheetMetal && (
  <SidebarGroup>
    {/* EXISTING Designs panel — no changes inside */}
  </SidebarGroup>
)}

{authenticated && selectedProject && pathIsCNCPipeline && (
  <SidebarGroup className="min-h-0 flex-1 overflow-hidden flex flex-col pt-0">
    <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground pt-4 pb-2">
      NC Programs in {selectedProject.name}
    </SidebarGroupLabel>

    {/* Search + Sort + New button toolbar — same structure as Designs */}
    <div className="px-3 pb-3 pt-1 flex flex-col gap-2 shrink-0">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={() => navigate("/cnc-pipeline/new")}
          className="shrink-0 h-8 w-8 bg-transparent border-white/10 hover:bg-white/5"
          title="New NC program"
        >
          <Plus className="h-4 w-4 text-slate-300" />
        </Button>
        {/* Search input — same as Designs, bound to ncSearchQuery */}
        {/* Filter dropdown — same as Designs, bound to ncSortOrder */}
      </div>
    </div>

    <SidebarGroupContent className="min-h-0 flex-1">
      <ScrollArea className="h-full pr-3 pl-3">
        {/* List NC programs, grouped by date using same formatDateGroup utility */}
        {/* Each item: link to /cnc-pipeline/:programId */}
        {/* Hover actions: star toggle, rename, delete — same pattern as design items */}
        {/* Icon: use Terminal or FileCode from lucide-react instead of FileStack */}
      </ScrollArea>
    </SidebarGroupContent>
  </SidebarGroup>
)}
```

**Step 6 — Add rename AlertDialog for NC programs**

Copy the existing `designToRename` AlertDialog block and create an identical one for `ncProgramToRename`, wired to `renameNcProgram` mutation. Place it adjacent to the existing one at the bottom of the component, outside `<Sidebar>`.

**Step 7 — Add `NcProgramDeleteContext` (optional but clean)**

If a `useDesignDelete` context exists for designs (it does — `design-delete-context`), create a matching `nc-program-delete-context` following the exact same pattern, so delete confirmations for NC programs are handled consistently.

---

## Implementation Order

1. **Track 1** — Schema cleanup (smallest, no UI, do first so all subsequent tracks build on clean types)
2. **Track 2** — Sonner toast (one-liner replacements, zero risk)
3. **Track 3** — Route files (structural foundation for Tracks 4 and 5)
4. **Track 4** — Dashboard index page
5. **Track 5** — Saved program viewer page
6. **Track 6** — Sidebar context-aware panel (do last — depends on queries added in Track 4)

---

## Cross-Cutting Notes

- **`renameNcProgram` mutation**: Add it to `convex/nc_programs.ts` if not already present. It only needs `ncProgramId` + `name` params, protected by `requireProjectManager`.
- **`listAllForViewer` query**: New query in `convex/nc_programs.ts`. It should mirror the `viewerWorkspace` pattern — fetch all org memberships, then all projects, then all NC programs for those projects. Protect with `requireViewer`. This powers the dashboard cross-org listing in Track 4.
- **`getById` query**: Simple `ctx.db.get(id)` with a `requireProjectAccess` guard. Needed for Track 5.
- **`NcProgramSummary` type**: Define it in a shared `types.ts` alongside `ProjectDesignSummary`. Fields: `id`, `name`, `algorithm`, `scenario`, `estimatedTimeSeconds`, `isStarred`, `_creationTime`. Used by both the sidebar and the dashboard page.
- **Do not break the Designs panel**: The `pathIsSheetMetal` guard wrapping it ensures it remains completely untouched when on CNC routes.
- **`formatDateGroup` utility**: Already exists in `app-sidebar.tsx`. Extract it to a shared `src/lib/date-utils.ts` so both the sidebar and the dashboard page can import it without circular deps.