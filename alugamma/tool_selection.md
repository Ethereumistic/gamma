# Tool Selection Architecture

## The Core Concept

Tools are uniquely identified by **string ID** (e.g. `"prav"`, `"prav_slow"`), **not** by CNC pocket number. Multiple tools can share the same pocket number (e.g. two different T7 tools). The `number` field is just the physical CNC pocket — it goes into NC code headers but is **never** used as a lookup key.

## Data Flow

```
Settings Panel (frontend)
  ↓ saves to Convex: customTools, toolOverrides, layerToolMap (all id-keyed)
  ↓
CNCPipelinePage (frontend)
  ↓ resolves tools via tool-defaults.ts → resolvedTools: Record<string, ToolConfig>
  ↓ resolves layer→tool map → resolvedLayerToolMap: Record<string, string>
  ↓ sends to backend: tool_overrides (id-keyed), custom_sequence: [[layer, toolId], ...]
  ↓
Backend (cnc-pipeline-backend/)
  config.py → build_tools_dict() → dict[str, dict] (id-keyed)
  pipeline.py → _resolve_custom_sequence() → [(layer, tool_id), ...]
  gcode_writer.py → looks up tools[tool_id] → writes NC with correct params
```

## Key Files

### Frontend

| File | Purpose |
|---|---|
| `src/features/cnc-pipeline/tool-defaults.ts` | Tool types, defaults (`TOOL_DEFAULTS`), `resolveTools()`, `computeOverrides()`, `deriveDefaultSequence()`. All id-keyed. |
| `src/features/settings/cnc-settings-panel.tsx` | Settings UI — add/edit/delete tools and layer→tool mappings. |
| `src/features/cnc-pipeline/CNCPipelinePage.tsx` | Main CNC page. Builds `resolvedTools`, `resolvedLayerToolMap`, `cncLayerNames`. Manages `layerSequence: IdSequence` (id-based). Sends id-keyed data to backend. |
| `src/features/cnc-pipeline/types.ts` | `IdSequence = [string, string][]` (internal), `CustomSequence = [string, number][]` (legacy). |
| `src/features/cnc-pipeline/api.ts` | API calls — sends `tool_overrides` and `custom_sequence` to backend. |
| `src/features/cnc-pipeline/hooks/useGenerate.ts` | Upload hook — accepts both sequence formats. |
| `src/features/cnc-pipeline/components/LayerControls.tsx` | Layer toggle bar — uses `cncLayerNames` prop + `getLayerColor()` for custom layer colors. |
| `src/features/cnc-pipeline/components/GeometryViewer.tsx` | Geometry preview — uses `cncLayerNames` prop to distinguish CNC vs ref layers (solid vs dashed). |
| `src/routes/cnc-pipeline/$programId.tsx` | Saved program viewer — translates id-based sequences to number-based for internal use, sends to backend. |

### Backend

| File | Purpose |
|---|---|
| `cnc-pipeline-backend/cnc_pipeline/config.py` | `TOOLS: dict[str, dict]` (id-keyed). `build_tools_dict()` merges overrides, auto-migrates old number-keyed data. |
| `cnc-pipeline-backend/cnc_pipeline/pipeline.py` | `_resolve_custom_sequence()` handles both id-based and legacy number-based sequences. Toolpath uses `tools[tool_id]`. |
| `cnc-pipeline-backend/cnc_pipeline/gcode_writer.py` | `toolpath_blocks: list[tuple[str, str, list[Move]]]` — first element is tool_id. Looks up `resolved_tools[tool_id]`. |
| `cnc-pipeline-backend/main.py` | FastAPI endpoints — passes `tool_overrides` and `custom_sequence` through to pipeline. |

## Key Types & Props

```ts
// tool-defaults.ts
TOOL_DEFAULTS: Record<string, ToolConfig>        // keyed by tool id
LAYER_TOOL_MAP_DEFAULTS: Record<string, string>  // layer → tool id

// Types
IdSequence = [string, string][]   // [layer, toolId] — internal & new backend format
CustomSequence = [string, number][] // [layer, toolNum] — legacy format

// Component props (both LayerControls and GeometryViewer accept this)
cncLayerNames?: Set<string>  // which layers are CNC-active (not ref-only)
```

## CNC Layer Recognition

Layers are classified as CNC-active or reference-only based on the `cncLayerNames` set, built from the resolved layer→tool map:

```ts
const cncLayerNames = useMemo(() => {
  const s = new Set(["CUT", "FREZ", "FREZ_135", "HOLES"])
  for (const layer of Object.keys(resolvedLayerToolMap)) s.add(layer)
  return s
}, [resolvedLayerToolMap])
```

This set is passed to both `LayerControls` (controls "ref" label / transparency) and `GeometryViewer` (controls solid vs dashed rendering, info card "(ref only)" tag).

## App Navbar (CNCPipelinePage portal)

The navbar content is rendered via `createPortal` into `#cnc-navbar-portal`. The tool selector in the sequence bar uses `availableTools` (sorted by pocket number) with tool **id** as the Select value:

```tsx
// Tool selector per layer in sequence
<Select value={toolId} onValueChange={(val) => handleLayerToolChange(idx, val)}>
  {availableTools.map((t) => (
    <SelectItem key={t.key} value={t.key}>  {/* t.key = tool id */}
      T{t.number} — {t.name}
    </SelectItem>
  ))}
</Select>
```
