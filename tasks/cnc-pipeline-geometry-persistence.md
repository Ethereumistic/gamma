# NC Programs — Geometry Persistence Implementation Plan

## Goal

When a user saves an NC program, persist the geometry data and line mapping
alongside the NC code so the full `GeometryViewer` + synchronized playback
renders correctly on the saved program page (`/cnc-pipeline/:programId`)
without re-uploading the DXF or calling the backend again.

---

## Why This Works

The `GeometryViewer` component renders entirely from:
- `geometry.segments` — flat array of `{x1,y1,x2,y2,layer,seq_index}`
- `geometry.bbox` — bounding box `{min_x,min_y,max_x,max_y}`

Both of these are already returned by `POST /api/generate` and live in frontend
memory while the user is on `/cnc-pipeline/new`. The DXF file itself is never
needed again after the backend has processed it. We just need to carry these
two objects through to the save payload and store them in Convex.

`lineToSegmentMap` (maps NC line numbers → `seq_index`) must also be saved —
without it the geometry dot animation and `NCPreview` click-to-seek will not
work on the saved viewer page.

---

## Step 1 — Update the Convex Schema

File: `convex/schema.ts`

Add two fields to the `nc_programs` table. Do not remove or change any
existing fields — only add:

```typescript
nc_programs: defineTable({
  // ... all existing fields unchanged ...

  // ADD THESE TWO:
  geometryData: v.object({
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
  }),

  lineToSegmentMap: v.any(),
  // v.any() is intentional — the map is Record<number, number> which Convex
  // stores fine as a plain object. Using v.any() avoids validator complexity
  // for a numeric-keyed dictionary.
})
```

---

## Step 2 — Update the `saveNcProgram` Mutation

File: `convex/nc_programs.ts`

The mutation already accepts a payload object. Add `geometryData` and
`lineToSegmentMap` to both the validator and the insert/patch body.

**Validator addition:**

```typescript
geometryData: v.object({
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
}),
lineToSegmentMap: v.any(),
```

**Insert / patch body:** include both fields in both the `ctx.db.insert` call
and the `ctx.db.patch` call (the upsert logic). Do not change the upsert
matching logic — it stays keyed on `projectId + dxfSourceName`.

---

## Step 3 — Pass the Data from the Frontend Save Handler

File: `CNCPipelinePage.tsx` (wherever the Save button's `onClick` calls
`saveNcProgram`)

The generate response already holds `geometry` (type `GeometryResponse`) and
`generateResult` (which contains `line_to_segment_map`). Both are in the
component's state or refs. Add them to the save payload:

```typescript
await saveNcProgram({
  // ... all existing fields unchanged ...
  geometryData: {
    segments: geometry.segments,   // GeometryResponse.segments
    bbox: geometry.bbox,           // GeometryResponse.bbox
  },
  lineToSegmentMap: generateResult.line_to_segment_map,
});
```

**Where to find these values:**
- `geometry` — comes from the `useGenerate` hook's state, typed as
  `GeometryResponse`. It is the object currently passed as the `geometry` prop
  to `GeometryViewer` on the `/new` page.
- `generateResult.line_to_segment_map` — also returned by `useGenerate`, it is
  the same map currently passed as `lineToSegmentMap` to `GeometryViewer`.

If the save button is disabled when `geometry` is null, no guard is needed.
Otherwise add: `if (!geometry || !generateResult) return;` before the call.

---

## Step 4 — Update the `getById` Query Return Type

File: `convex/nc_programs.ts`

The `getById` query fetches a record by `_id`. It already returns the full
document. No logic change is needed — the new fields will be included
automatically once they exist in the document.

However, update the TypeScript return type annotation (if one exists) to
include the two new fields so the viewer page gets proper types.

---

## Step 5 — Rebuild the Viewer State on the Saved Program Page

File: `src/routes/cnc-pipeline/$programId.tsx` (or
`CNCProgramViewerPage.tsx` — wherever the saved program viewer lives)

After fetching the record with `useQuery(api.nc_programs.getById, { id })`,
reconstruct the state objects the viewer components expect:

```typescript
const program = useQuery(api.nc_programs.getById, { id: programId });

// Reconstruct GeometryResponse from stored data
const geometry: GeometryResponse | null = program?.geometryData ?? null;

// NC lines array for NCPreview and playback
const ncLines: string[] = useMemo(
  () => program?.ncCode.split("\n") ?? [],
  [program?.ncCode]
);

// lineToSegmentMap — keys come back as strings from JSON, convert to numbers
const lineToSegmentMap: Record<number, number> = useMemo(() => {
  if (!program?.lineToSegmentMap) return {};
  return Object.fromEntries(
    Object.entries(program.lineToSegmentMap).map(([k, v]) => [Number(k), v as number])
  );
}, [program?.lineToSegmentMap]);

// segmentToLineMap — invert the line→segment map for click-to-seek
const segmentToLineMap: Record<number, number> = useMemo(() => {
  return Object.fromEntries(
    Object.entries(lineToSegmentMap).map(([line, seq]) => [seq, Number(line)])
  );
}, [lineToSegmentMap]);
```

**Important — the key conversion:** Convex round-trips JSON, which converts
numeric object keys to strings. Always re-parse them with `Number(k)` as shown
above. Without this, `lineToSegmentMap[42]` will be `undefined` even though
the data is present, because the key is stored as `"42"`.

---

## Step 6 — Wire Components on the Saved Viewer Page

Pass the reconstructed values into the same components used on `/new`:

```tsx
{geometry && (
  <>
    <LayerControls
      layers={[...new Set(geometry.segments.map(s => s.layer))]}
      visible={visible}
      onToggle={...}
      onSeekToLayer={...}
    />

    <GeometryViewer
      geometry={geometry}
      visible={visible}
      showRapids={true}
      currentLineIndex={currentLineIndex}
      lineToSegmentMap={lineToSegmentMap}
      segmentToLineMap={segmentToLineMap}
      onSeek={seekToLine}
      playbackSpeed={playbackSpeed}
      rapidSpeedMultiplier={rapidPlaybackSpeed}
      seekTrigger={seekTrigger}
      ncLines={ncLines}
      isPlaying={isPlaying}
    />
  </>
)}

<NCPreview
  ncLines={ncLines}
  currentLineIndex={currentLineIndex}
  onSeek={seekToLine}
/>

<PlaybackControls
  isPlaying={isPlaying}
  onPlayPause={togglePlay}
  currentTime={currentSimTime}
  totalDuration={totalDuration}
  onSeek={seekToTime}
  playbackSpeed={playbackSpeed}
  onSpeedChange={setPlaybackSpeed}
/>
```

The `usePlayback` hook should be initialized with `ncLines`, `lineToSegmentMap`,
and `geometry.segments` exactly as it is on the `/new` page. No changes to
`usePlayback` itself are needed.

---

## Step 7 — Loading and Empty States

On the saved viewer page, handle the three possible states:

```tsx
if (!program) {
  return <LoadingSpinner />  // query in flight
}

if (program === null) {
  return <NotFoundCard />    // record deleted or no access
}

if (!program.geometryData) {
  // Record was saved before this feature shipped — geometry not available.
  // Show NCPreview + PlaybackControls only, no GeometryViewer.
  // This handles backwards compatibility with any records saved before Step 1.
  return <NcOnlyViewer ncLines={ncLines} ... />
}
```

The third case is the backwards-compatibility guard. Any NC programs saved
before this implementation will have `geometryData: undefined`. Gracefully
degrade to NC-code-only view rather than crashing.

---

## Step 8 — Download Button

The saved viewer page should offer a download of the `.nc` file. Reconstruct
it from `ncCode` on the client — no backend call needed:

```typescript
function downloadNc(name: string, ncCode: string) {
  const blob = new Blob([ncCode], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name + ".nc";
  a.click();
  URL.revokeObjectURL(url);
}
```

Call this from a Download button in the page header.

---

## Data Size Reference

For the agent's awareness — these are not limits to enforce in code, just
context for why this approach is safe:

| Data | Typical size |
|---|---|
| `segments` (300–600 items) | 20–60 KB JSON |
| `bbox` | ~100 bytes |
| `lineToSegmentMap` (350 entries) | ~5 KB |
| `ncCode` (350 lines) | 4–10 KB |
| **Total per document** | **~30–75 KB** |

Convex document limit is 1 MB. These records are well within it.

---

## Summary of Files to Touch

| File | Change |
|---|---|
| `convex/schema.ts` | Add `geometryData` and `lineToSegmentMap` fields to `nc_programs` table |
| `convex/nc_programs.ts` | Add both fields to `saveNcProgram` validator + insert/patch body |
| `CNCPipelinePage.tsx` | Pass `geometryData` and `lineToSegmentMap` in save payload |
| `CNCProgramViewerPage.tsx` | Reconstruct viewer state from stored fields, wire into components |

No changes needed to: `GeometryViewer.tsx`, `usePlayback.ts`, `NCPreview.tsx`,
`PlaybackControls.tsx`, `useGenerate.ts`, or any backend Python files.