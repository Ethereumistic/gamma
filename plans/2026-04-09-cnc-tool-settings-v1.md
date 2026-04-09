# CNC Tool Settings — From Hardcoded to Database-Driven

## Objective

Replace the hardcoded tool configuration values in `cnc_pipeline/config.py` with user-editable settings stored in the Convex database. Add a "CNC Settings" tab to the existing Settings dialog (accessible via the gear icon in the sidebar footer) so operators can tweak tool parameters (depth, offset, feed rates, etc.) without touching code or redeploying.

## Architecture Overview

**Current flow (hardcoded):**
```
config.py TOOLS dict → toolpath.py reads depth/offset/feed → gcode_writer.py reads tool metadata → NC output
```

**Target flow (database-driven):**
```
Convex cnc_settings table → frontend reads/writes settings
                              ↓
Frontend sends tool_overrides to Python backend → backend merges overrides onto hardcoded defaults → NC output
```

**Key design decision:** The Python backend keeps its hardcoded `TOOLS` dict as the **fallback defaults**. The frontend stores only **overrides** in Convex. When calling the backend, the frontend sends the full resolved tool config (defaults merged with overrides) as part of the request. This means:
- Backend never needs to connect to Convex
- Backend works standalone with defaults if no overrides exist
- Zero risk of breaking existing pipeline behavior
- Settings are per-organization (all users in an org share the same CNC settings)

---

## Implementation Plan

### Phase 1: Convex Schema & Backend Functions

- [ ] **1.1. Add `cnc_settings` table to Convex schema** in `alugamma/convex/schema.ts`
  - Add a new `cnc_settings` table with fields: `organizationId` (indexed), `toolOverrides` (stored as `v.any()` — a flexible JSON blob keyed by tool number), `updatedBy`, `updatedAt`
  - One document per organization (singleton pattern)
  - The `toolOverrides` field stores a structure like: `{ "7": { "layers": { "CUT": { "depth": -4.4 } }, "feed_cut": 6000 }, "9": { ... } }` — sparse, only keys that differ from defaults

- [ ] **1.2. Create `alugamma/convex/cnc_settings.ts`** with query and mutation functions:
  - `getByOrganization` query — takes `organizationId`, returns the single `cnc_settings` doc or `null`
  - `upsert` mutation — takes `organizationId` + `toolOverrides`, creates or patches the singleton document. Requires organization manager role (reuse `requireOrganizationManager` from `helpers.ts`)
  - `resetToDefaults` mutation — deletes the overrides doc so backend falls back to hardcoded values

- [ ] **1.3. Add default tool config constants to the frontend** in a new file `alugamma/src/features/cnc-pipeline/tool-defaults.ts`
  - Export a TypeScript mirror of the Python `TOOLS` dict (tool numbers, names, layer configs, feed rates, etc.)
  - This serves as the "source of truth" for the frontend UI to know what fields exist and what the defaults are
  - Export a helper `resolveTools(defaults, overrides)` that deep-merges overrides onto defaults

### Phase 2: Python Backend — Accept Tool Overrides

- [ ] **2.1. Modify `cnc_pipeline/config.py`** — add a `build_tools_dict(overrides: dict | None = None) -> dict[int, dict]` function
  - If `overrides` is `None` or empty, return the existing `TOOLS` dict unchanged (backward compatible)
  - If overrides are provided, deep-merge them onto `TOOLS` using a recursive dict merge
  - Keep `TOOLS` as-is for backward compatibility; `build_tools_dict()` is the new entry point

- [ ] **2.2. Modify `cnc_pipeline/pipeline.py`** — `run_from_contours()` and `run_pipeline()` accept an optional `tool_overrides: dict | None = None` parameter
  - Pass it through to a new internal function that calls `build_tools_dict(tool_overrides)` instead of reading `TOOLS` directly
  - `toolpath.py` and `gcode_writer.py` receive the resolved tools dict as a parameter instead of importing `TOOLS` from config

- [ ] **2.3. Modify `cnc_pipeline/toolpath.py`** — change `generate_toolpath()` to accept `tool: dict` (the resolved tool) as a parameter instead of looking it up from `TOOLS[tool_num]`
  - The caller (`pipeline.py`) resolves the tool and passes it in

- [ ] **2.4. Modify `cnc_pipeline/gcode_writer.py`** — `GCodeWriter.write()` accepts a `tools: dict[int, dict]` parameter (the resolved tools dict) instead of importing `TOOLS` from config
  - All `TOOLS[tool_num]` lookups become `tools[tool_num]`

- [ ] **2.5. Modify `main.py`** — both `/api/generate` and `/api/regenerate` endpoints accept an optional `tool_overrides` JSON field in the request body
  - Pass it through to `run_pipeline()` / `run_from_contours()`
  - When `tool_overrides` is absent, behavior is identical to current (uses hardcoded defaults)

### Phase 3: Frontend Settings UI

- [ ] **3.1. Extend the settings context** in `alugamma/src/features/settings/context.tsx`
  - Change the `openSettings` type from `(tab?: "hotkeys") => void` to `(tab?: "hotkeys" | "cnc") => void`
  - Add `activeTab` state (`"hotkeys"` by default, can be `"cnc"`)
  - Expose `activeTab` in the context value so the dialog knows which panel to show

- [ ] **3.2. Modify the sidebar footer settings button** in `alugamma/src/components/layout/sidebar/sidebar-footer-section.tsx`
  - Change the `onClick` from `() => openSettings("hotkeys")` to `() => openSettings("cnc")` — the gear icon now opens the CNC settings tab by default (since hotkeys are reference-only, while CNC settings are the primary action)

- [ ] **3.3. Update `alugamma/src/features/settings/settings-dialog.tsx`** to support tabbed navigation:
  - Add a left nav with two tabs: "Hotkeys" and "CNC Tools"
  - The "Hotkeys" tab renders the existing `<HotkeysPanel />`
  - The "CNC Tools" tab renders the new `<CNCSettingsPanel />`
  - Active tab is driven by context, with ability to switch between tabs
  - Style the active tab the same way the current single "Hotkeys" button is styled (primary bg, bold text)

- [ ] **3.4. Create `alugamma/src/features/settings/cnc-settings-panel.tsx`** — the main settings panel:
  - Fetches CNC settings from Convex using the `getByOrganization` query (get current org from workspace context)
  - Displays all 3 tools (T7, T9, T11) as collapsible sections or accordion items
  - Each tool section shows:
    - **Tool-level fields**: `diameter`, `gauge_length`, `flutes`, `spindle_rpm`, `feed_cut`, `feed_plunge` (read-only display with edit capability)
    - **Per-layer overrides**: For each layer the tool operates on (e.g., T7 has CUT + HOLES), show `depth` and `offset` as editable number inputs
  - Pre-fill inputs with the resolved value (default merged with any existing override)
  - Show a visual indicator (e.g., a small dot or color change) when a value differs from the hardcoded default
  - "Save" button calls the `upsert` mutation with only the changed fields (sparse overrides)
  - "Reset to Defaults" button calls `resetToDefaults` mutation
  - Use optimistic updates for snappy UX

- [ ] **3.5. Create reusable `ToolField` component** within the cnc-settings-panel file (or as a small helper):
  - A labeled number input that shows the current value, the default value, and a reset-to-default button
  - Handles the "dirty" state visual indicator

### Phase 4: Wire Settings into CNC Pipeline Calls

- [ ] **4.1. Modify `alugamma/src/features/cnc-pipeline/api.ts`** — update `uploadDXF` and `regenerate` functions to accept an optional `toolOverrides` parameter
  - `uploadDXF(file, algorithm, toolOverrides?)` — sends overrides as a JSON field in the multipart form or as a query parameter
  - `regenerate(payload)` — the `RegeneratePayload` type gets an optional `tool_overrides` field

- [ ] **4.2. Modify `alugamma/src/features/cnc-pipeline/hooks/useGenerate.ts`** — the `upload` callback fetches CNC settings from Convex before calling the backend
  - Before uploading, query the current org's `cnc_settings` from Convex
  - If overrides exist, include them in the API call
  - This ensures every generation uses the latest settings

- [ ] **4.3. Update `RegeneratePayload` type** in `types.ts` to include `tool_overrides?: Record<string, any>`

- [ ] **4.4. Update the `RegenerateRequest` Pydantic model** in `main.py` to accept `tool_overrides: dict | None = None`

---

## Verification Criteria

- [ ] All existing CNC pipeline tests pass without modification (backward compatibility)
- [ ] Uploading a DXF with no custom settings produces identical NC output as before
- [ ] Changing a tool's CUT depth in the settings UI, then regenerating, produces NC code with the new depth value
- [ ] Resetting to defaults restores the original hardcoded values
- [ ] Settings are scoped per-organization — switching orgs shows different settings
- [ ] The settings dialog shows two tabs (Hotkeys / CNC Tools) and the gear icon opens to CNC Tools
- [ ] Partial overrides work — changing only T7's CUT depth doesn't affect T9 or T11
- [ ] The Python backend still works standalone without any frontend (defaults still hardcoded)

## Potential Risks and Mitigations

1. **Risk: Incorrect tool parameters could produce dangerous CNC machine behavior**
   Mitigation: Add a confirmation dialog before saving settings that warns "Changes will affect all future NC program generation." Consider adding min/max validation bounds on numeric inputs (e.g., depth should always be negative, feed rates should be positive).

2. **Risk: Deep merge logic could produce unexpected nested dict results**
   Mitigation: Keep the merge logic simple and explicit. Only allow overriding leaf values (numbers), not restructuring the tool dict. Write unit tests for the merge function in both Python and TypeScript.

3. **Risk: Frontend sends stale overrides after schema changes**
   Mitigation: Version the tool config structure. Add a `schemaVersion` field to the overrides doc. If the backend's default schema version doesn't match, warn the user or auto-migrate.

4. **Risk: Race condition — two users edit settings simultaneously**
   Mitigation: Convex uses optimistic concurrency control. The last write wins, which is acceptable for this use case (single-operator shop). Could add `updatedAt` display in the UI.

5. **Risk: Breaking existing `TOOLS` import in Python modules**
   Mitigation: `TOOLS` dict stays exactly as-is. All new code uses `build_tools_dict()` which falls back to `TOOLS` when no overrides are provided. Existing tests don't need changes.

## Alternative Approaches

1. **Python backend reads from Convex directly**: Would require the Python server to authenticate with Convex and adds a network dependency. Rejected — the current approach of frontend passing overrides keeps the backend stateless and simpler.

2. **Store full tool configs (not sparse overrides) in Convex**: Simpler merge logic but means every new tool or field addition requires a migration of stored data. Sparse overrides are more resilient to schema evolution.

3. **Settings per-project instead of per-organization**: Could be useful if different projects need different tool params. Rejected for now — org-level is simpler and matches the "global defaults" requirement. Can be extended later by adding a `projectId` field to the settings table.

4. **Environment variable / config file overrides on the Python backend**: Would avoid frontend changes but requires server restart and doesn't provide a UI. Rejected — the user explicitly wants a frontend settings UI.
