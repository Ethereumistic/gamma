# CNC Pipeline — Improvements & Feature Plan

## Overview

This document covers all planned improvements to the CNC Pipeline feature. The work is divided into **5 focused tracks**, ordered by dependency. Each track can be handed off independently once the previous one is stable.

---

## Track 1: Flow Redesign — Auto-Generate on Upload & Algorithm Change

### 1.1 Remove the Two-Step Upload → Generate Flow

**Current**: Drop DXF → preview appears → user clicks "Generate NC program" button.  
**Desired**: Drop DXF → preview + NC generation happen in a single step automatically.

**Changes required:**

- In `useGenerate.ts`, after the `POST /api/generate` call completes and transitions to `ready` state, **immediately trigger the NC preview fetch** (`GET /api/preview/{jobId}`), transitioning directly to `done` state.
- The `ready` state becomes an internal/transient state — the user should never see it for more than a brief loading moment.
- Remove the "Generate NC program" button from the portal entirely (it is no longer needed as a user action).
- The loading indicator should communicate both phases: "Analysing DXF…" → "Generating NC program…".

### 1.2 Algorithm Change Triggers Re-generation

**Current**: Algorithm dropdown is a pre-upload selector only.  
**Desired**: Changing the algorithm while a job exists re-runs `POST /api/generate` with the new algorithm and auto-fetches NC preview.

**Changes required:**

- In `CNCPipelinePage.tsx` (or `useGenerate.ts`), add a `useEffect` (or callback) that watches the selected algorithm value.
- When the algorithm changes AND `state` is `done` (or `ready`), automatically re-call the upload pipeline with the same DXF file (keep a ref to the last `File` object uploaded — call it `lastDxfFileRef`).
- **Reset playback to position 0** before starting re-generation (see Track 4).
- Show a loading overlay on the `GeometryViewer` + `NCPreview` during re-generation so the user knows work is in progress.
- The algorithm dropdown should be disabled (but visible) during generation to prevent double-triggers.

---

## Track 2: Upload UX — Larger Drop Zone & Replace "Generate Another"

### 2.1 Bigger Drop Zone

- In `DXFDropZone.tsx`, increase the hit area to fill the available page space when in `idle` state. Use a full-bleed centered layout. The visual cue (dashed border, icon, label) can remain the same, just scaled up significantly so it is impossible to miss.

### 2.2 Replace "Generate Another" Button with Inline Drop Area

**Current**: After a job is done, a "Generate another" button appears.  
**Desired**: Replace it with a compact but visible **drop zone / browse control** that is always present once a job exists — so the user can seamlessly drop the next DXF without any navigation.

**Changes required:**

- Remove the "Generate another" `<Button>` from the portal.
- Add a compact `MiniDXFDropZone` component (re-uses `DXFDropZone` logic, different styling) visible in the main page body below the geometry/NC panels when state is `done`.
- Alternatively, add this compact drop zone to the navbar portal area on the left (before the algorithm selector) — evaluate visually which feels cleaner.
- Dropping or browsing a new file resets all state and triggers the new auto-generate flow (Track 1).

---

## Track 3: DXF Name as Editable Input + Navbar Cleanup

### 3.1 DXF Name → Editable Input

**Current**: The DXF filename is displayed as read-only text in the navbar portal.  
**Desired**: Render it as a styled `<input>` (inline, borderless or minimal border) so the user can rename it freely.

**Changes required:**

- In `CNCPipelinePage.tsx` (portal content), replace the filename `<span>` / badge with a controlled `<input type="text">` bound to a `dxfDisplayName` state, initialized from the uploaded file's name (strip `.dxf` extension).
- This `dxfDisplayName` becomes the base name used for all NC program naming (Track 5).
- Style it to look like inline text unless focused (transparent background, no border at rest, subtle border/ring on focus).

### 3.2 Remove the Scenario/Algorithm Badge

- Remove the badge currently displayed after the DXF name in the navbar that duplicates information already visible in the algorithm dropdown.
- The algorithm dropdown itself is sufficient.

---

## Track 4: Playback Reset on New Job

**Current bug**: When a new DXF is uploaded and NC is generated, the playback `simTimeRef` and `currentLineIndex` remain at the end of the previous job.  
**Fix required:**

- In `usePlayback.ts` (or wherever playback state is held), expose a `resetPlayback()` function.
- Call `resetPlayback()` in two places inside `useGenerate.ts`:
  1. When a new file upload begins (transition to `uploading`).
  2. When algorithm re-generation begins.
- `resetPlayback()` should set `simTimeRef.current = 0`, `currentLineIndex = 0`, `isPlaying = false`, and clear any in-flight `requestAnimationFrame` handle.

---

## Track 5: NC Settings Dialog (Navbar Settings Button)

### 5.1 Settings Button in Navbar Portal

- Add a `Settings` icon button (use `lucide-react` `Settings2` or `SlidersHorizontal`) in the navbar portal, placed to the right of the algorithm dropdown.
- Clicking it opens a `<Dialog>` (shadcn/ui) titled **"NC Program Settings"**.

### 5.2 Default Algorithm Setting

- A dropdown (mirrors the main algorithm selector) for setting the **default algorithm** used when a new DXF is dropped.
- On app load / page mount, read this preference and pre-select the algorithm.
- Persist to `localStorage` under key `cnc_default_algorithm`.

### 5.3 NC File Naming — Base Name

- The base name for the NC file is always the `dxfDisplayName` (the editable input from Track 3, stripped of extension).
- The Settings dialog shows a **live preview** of the full filename as the user toggles suffixes.

### 5.4 NC File Naming — Suffix Toggles

Each suffix is an on/off toggle (shadcn `Switch`). All are **off by default**. When multiple are active, they are appended **in the fixed order** shown below.

| Toggle | Suffix appended | Example |
|---|---|---|
| Algorithm | `_[AlgorithmName]` | `_Juggler` |
| Estimated time | `_[MM-SS]` (minutes-seconds) | `_08-48` |
| Scenario (toolpath) | short code (see table below) | `_H-F-C` |
| Custom text | user-typed string | `_echoray-industries` |

**Scenario short codes:**

| Scenario key | Display | Short code |
|---|---|---|
| `most_common` | FREZ → CUT | `_F-C` |
| `common` | HOLES → FREZ → CUT | `_H-F-C` |
| `rare` | FREZ → FREZ_135 → CUT | `_F-F135-C` |
| `very_rare` | HOLES → FREZ → FREZ_135 → CUT | `_H-F-F135-C` |
| `cut_only` | CUT only | `_C` |

**Final name assembly** (active suffixes only, in this order):

```
[dxfDisplayName]_[scenario?]_[algorithm?]_[time?]_[custom?].nc
```

Example with all active:
```
panel-left-door_H-F-C_Juggler_08-48_echoray-industries.nc
```

### 5.5 Custom Suffix Input

- A text `<input>` in the Settings dialog for a free-form suffix string.
- Paired with its own `Switch` toggle — the input is only active when the toggle is on.
- Strip any characters that are invalid in filenames (e.g. `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`).

### 5.6 Persist Settings

- Persist all suffix toggle states and the custom suffix string to `localStorage` under a single key `cnc_nc_settings` as a JSON object.
- Read and restore on page mount.

---

## Track 6: Save NC Program to Convex (`nc_programs` Table)

### 6.1 New Convex Table: `nc_programs`

Add the following table to `convex/schema.ts`, following the same pattern as `designs`:

```typescript
nc_programs: defineTable({
  organizationId: v.id("organizations"),
  projectId: v.id("projects"),
  name: v.string(),           // full assembled filename (without .nc extension)
  exportName: v.string(),     // full assembled filename WITH .nc extension
  algorithm: v.string(),      // e.g. "juggler", "raptor", "oracle"
  scenario: v.string(),       // e.g. "most_common", "common"
  estimatedTimeSeconds: v.number(),
  contourCount: v.number(),
  ncCode: v.string(),         // the raw NC text (~4–10 KB)
  dxfSourceName: v.string(),  // original DXF filename used to generate it
  createdBy: v.id("users"),
  updatedBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number(),
  isStarred: v.optional(v.boolean()),
})
  .index("by_project", ["projectId"])
  .index("by_organization", ["organizationId"])
  .index("by_project_updated", ["projectId", "updatedAt"])
```

### 6.2 Backend Functions (`convex/nc_programs.ts`)

Implement the following mutations and queries, all protected by `requireProjectManager(ctx, projectId)`:

- **`saveNcProgram`**: Upsert logic — if an `nc_programs` record with the same `projectId` + `dxfSourceName` already exists, `patch` it (re-generate overwrites); otherwise `insert` a new record. This matches the "save and overwrite with new algorithm" UX intent.
- **`listByProject`**: Returns all NC programs for a project, sorted by `updatedAt` descending.
- **`deleteNcProgram`**: Hard delete.
- **`toggleStar`**: Flips `isStarred`.

### 6.3 Save Button in the Frontend

- Add a **"Save"** button to the navbar portal (visible only in `done` state), placed after the Settings icon.
- On click, call the `saveNcProgram` Convex mutation with:
  - The current `projectId` + `organizationId` (from the workspace context).
  - `name` and `exportName` assembled from the current naming settings (Track 5).
  - `algorithm`, `scenario`, `estimatedTimeSeconds`, `contourCount` from the current job metadata.
  - `ncCode` from the fetched NC preview text.
  - `dxfSourceName` from the original uploaded file name.
- Show a toast notification on success/failure.
- The button should show a loading spinner while the mutation is in-flight.

### 6.4 Access from Project Page (Future)

- On the project detail page, add an "NC Programs" tab alongside "Designs".
- List saved NC programs with name, algorithm, scenario, estimated time, and a download button (reconstructs the `.nc` file from `ncCode`).
- This is **out of scope for this iteration** but the schema is designed to support it.

---

## Non-Functional Notes

- **No file storage**: NC code is stored directly as a string in the Convex document. At ~4–10 KB per record this is well within Convex document size limits and avoids storage bucket complexity.
- **Re-generation = overwrite**: The save flow intentionally overwrites the previous NC for the same DXF source name within a project, keeping one canonical NC per part per project. If the user wants to keep multiple versions (different algorithms), they rename the DXF display name before saving.
- **localStorage keys summary**:
  - `cnc_default_algorithm` — string
  - `cnc_nc_settings` — JSON object `{ suffixes: { algorithm, time, scenario, custom }, customText, defaultAlgorithm }`

---

## Suggested Implementation Order

1. **Track 4** (playback reset bug) — quick win, no new UI
2. **Track 1** (auto-generate flow) — core UX change, everything else builds on this
3. **Track 2** (drop zone + replace "generate another")
4. **Track 3** (editable DXF name + badge removal)
5. **Track 5** (Settings dialog + naming)
6. **Track 6** (Convex save, schema, mutations)