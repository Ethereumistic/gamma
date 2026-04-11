# Refactoring Plan: AppNavbar & AppSidebar

## Objective

Refactor `app-navbar.tsx` (316 lines) and `app-sidebar.tsx` (730 lines) into clean, modular, single-responsibility components following React + shadcn/ui best practices. The goal is to eliminate duplication, reduce cognitive complexity, improve maintainability, and establish clear separation of concerns — while preserving all existing functionality and visual design.

---

## Current State Analysis

### app-navbar.tsx (316 lines)
- **Single monolithic component** with 5 route-specific rendering branches (Home, Organizations, Projects, CNC Pipeline, Sheet Metal)
- **Mixed concerns**: Sheet Metal domain logic (presets, dimensions, invert, export) is hardcoded inside a layout component
- **Inline sub-component** `NavNumberField` (lines 18-46) defined in the same file
- **Notification bell** with invite-acceptance logic (lines 257-313) embedded directly
- **Portal placeholders** (`#project-navbar-portal`, `#cnc-navbar-portal`) for external injection
- Imports 6 different contexts/features just to render

### app-sidebar.tsx (730 lines)
- **Single monolithic component** with deeply nested conditional rendering
- **Duplicated patterns**: The "Designs list" section (lines 272-419) and "NC Programs list" section (lines 422-552) are structurally identical — search bar, sort dropdown, grouped list with date headers, item actions (star, rename, duplicate, delete)
- **Duplicated rename dialogs**: Two nearly identical `AlertDialog` blocks for design rename (lines 645-684) and NC program rename (lines 686-727)
- **Inline data fetching**: Convex mutations (`duplicateDesign`, `toggleStarDesign`, `renameDesign`, `toggleStarNcProgram`, `deleteNcProgram`, `updateNcProgram`) and a query (`nc_programs.listByProject`) are called directly inside the component
- **Duplicated sort/search state**: Two separate `useState` pairs for `searchQuery`+`sortOrder` and `ncSearchQuery`+`ncSortOrder` with identical logic
- **Duplicated `useMemo` grouping**: `groupedDesigns` and `groupedNcPrograms` perform the same filter → sort → groupBy pipeline
- **Navigation config** (`systemItems`, `toolItems`) defined inline at module scope — good, but could live in a dedicated config

### Key Metrics
| Metric | Navbar | Sidebar |
|--------|--------|---------|
| Lines of code | 316 | 730 |
| Route branches | 5 | 2 (conditional panels) |
| Duplicated patterns | 0 | ~4 (list panel, rename dialog, sort/search, grouping) |
| Context hooks used | 2 | 4 |
| Convex mutations | 1 | 6 |
| Inline sub-components | 1 | 0 |

---

## Implementation Plan

### Phase 1: Extract Shared Utilities & Hooks

- [ ] **1.1 Create `src/hooks/use-filterable-list.ts`** — A generic hook encapsulating the repeated search + sort + group-by-date pattern used in both the Designs and NC Programs sidebar panels. Parameters: `{ items, searchFields, sortField }`. Returns: `{ searchQuery, setSearchQuery, sortOrder, setSortOrder, groupedItems }`. This eliminates the duplicated state + `useMemo` logic in `app-sidebar.tsx` (lines 94-95, 110-111, 114-141, 149-175).

- [ ] **1.2 Create `src/hooks/use-rename-dialog.ts`** — A generic hook for the rename dialog pattern: `{ itemToRename, setItemToRename, renameValue, setRenameValue, confirmRename }`. Accepts a generic `onConfirm` callback. Eliminates the duplicated `designToRename` and `ncProgramToRename` state + dialog logic (lines 97, 112, 645-727).

- [ ] **1.3 Create `src/lib/navigation.ts`** — Move `systemItems` and `toolItems` navigation config from `app-sidebar.tsx` (lines 51-80) into a dedicated module. This allows reuse if needed elsewhere and keeps the sidebar component focused on rendering.

### Phase 2: Decompose AppSidebar (730 → ~150 lines)

- [ ] **2.1 Create `src/components/layout/sidebar/sidebar-header-section.tsx`** — Extract the `SidebarHeader` block (lines 180-194) containing the logo and `WorkspaceSwitcher`. Pure presentational.

- [ ] **2.2 Create `src/components/layout/sidebar/sidebar-nav-section.tsx`** — Extract the "System" nav menu (lines 197-235) and "Internal Tools" grid (lines 237-270). Receives `systemItems`, `toolItems`, and `location` as props.

- [ ] **2.3 Create `src/components/layout/sidebar/sidebar-item-list.tsx`** — A generic, reusable component for the filtered/searchable list pattern. Props: `{ title, items, searchPlaceholder, onAdd, renderIcon, renderItemMeta, onStar, onRename, onDelete, onDuplicate, getItemUrl, isStarred, activeItemId }`. This replaces both the Designs panel (lines 272-419) and NC Programs panel (lines 422-552) with a single component used twice.

- [ ] **2.4 Create `src/components/layout/sidebar/sidebar-rename-dialog.tsx`** — A single generic rename dialog component. Props: `{ open, onOpenChange, title, description, value, onChange, onConfirm, confirmLabel, minLength }`. Replaces both `AlertDialog` blocks (lines 645-684 and 686-727).

- [ ] **2.5 Create `src/components/layout/sidebar/sidebar-footer-section.tsx`** — Extract the user footer with dropdown menu (lines 557-642). Contains the sign-out, settings, and navigation links.

- [ ] **2.6 Refactor `app-sidebar.tsx`** — Replace the 730-line monolith with a slim orchestrator (~100-150 lines) that composes the extracted sub-components. The sidebar becomes a clean layout shell:
  ```
  <Sidebar>
    <SidebarHeaderSection />
    <SidebarContent>
      <SidebarNavSection />
      {pathIsSheetMetal && <SidebarItemList type="designs" />}
      {pathIsCNCPipeline && <SidebarItemList type="nc-programs" />}
    </SidebarContent>
    <SidebarFooterSection />
  </Sidebar>
  <SidebarRenameDialog />
  ```

### Phase 3: Decompose AppNavbar (316 → ~80 lines)

- [ ] **3.1 Create `src/components/layout/navbar/sheet-metal-toolbar.tsx`** — Extract the entire Sheet Metal toolbar section (lines 165-255) into its own component. This includes the design name input, preset selector, dimension fields, invert checkboxes, and save/export buttons. It receives the necessary props from the `useSheetMetal` context. This is the largest single block in the navbar and the most domain-specific.

- [ ] **3.2 Create `src/components/layout/navbar/notification-bell.tsx`** — Extract the notification bell dropdown (lines 257-313) with invite acceptance logic. Self-contained with its own `useMutation` for `acceptProjectInvite`.

- [ ] **3.3 Create `src/components/layout/navbar/navbar-breadcrumb.tsx`** — Extract the project detail breadcrumb + column selector (lines 120-163). Currently the only route that uses breadcrumbs.

- [ ] **3.4 Move `NavNumberField` to `src/components/layout/navbar/nav-number-field.tsx`** — Extract the inline helper component (lines 18-46) into its own file for reuse and testability.

- [ ] **3.5 Create `src/components/layout/navbar/navbar-content.tsx`** — A thin routing-aware component that renders the correct content section based on the current route (Home greeting, Organizations title, Projects portal, CNC portal, Sheet Metal toolbar, Project breadcrumb). Uses a simple route-to-component mapping instead of chained conditionals.

- [ ] **3.6 Refactor `app-navbar.tsx`** — Replace the 316-line monolith with a slim shell (~60-80 lines):
  ```
  <header>
    <SidebarTrigger />
    <NavbarContent />       {/* route-aware content */}
    <NotificationBell />    {/* always rendered */}
  </header>
  ```

### Phase 4: Clean Up & Polish

- [ ] **4.1 Remove the `any` type escapes in sidebar** — The NC programs list uses `any` type annotations (lines 152, 156, 168, 483). Define a proper `NcProgramSummary` type (or import from a shared types file) and use it consistently.

- [ ] **4.2 Extract the scenario label map** — The inline object mapping `{{ most_common: "F-C", ... }}` at `app-sidebar.tsx:505` should be a constant, ideally in a CNC pipeline feature module.

- [ ] **4.3 Replace `confirm()` with a proper dialog** — The NC program delete action at `app-sidebar.tsx:533` uses `window.confirm()`. Use the existing `AlertDialog` pattern (like the design delete dialog) for consistency.

- [ ] **4.4 Audit and reduce context hook usage** — Both components destructure many values from context hooks. Ensure only the needed values are destructured, and consider if any derived values can be computed in the sub-components rather than passed through.

- [ ] **4.5 Add barrel export** — Create `src/components/layout/index.ts` barrel file exporting `AppNavbar`, `AppSidebar`, and `WorkspaceSwitcher` for cleaner imports in `app.tsx`.

- [ ] **4.6 Verify no visual regressions** — Run the app and verify every route renders identically: Home, Organizations, Projects, Project Detail, Sheet Metal (new + existing), CNC Pipeline (new + existing). Test sidebar design/NC program list interactions: search, sort, star, rename, duplicate, delete.

---

## Verification Criteria

- [ ] `app-navbar.tsx` is under 100 lines
- [ ] `app-sidebar.tsx` is under 160 lines
- [ ] No component file in `src/components/layout/` exceeds 200 lines
- [ ] Zero `any` type annotations in the layout components
- [ ] The duplicated list panel pattern (designs vs NC programs) is unified into a single reusable component
- [ ] The duplicated rename dialog pattern is unified into a single reusable component
- [ ] All existing routes render identically with no visual or functional regressions
- [ ] No `window.confirm()` calls remain in layout components
- [ ] Navigation config (`systemItems`, `toolItems`) lives in a dedicated config module

## Potential Risks and Mitigations

1. **Context dependency propagation** — Extracted sub-components still need context values (workspace, sheet metal, settings). Rather than prop-drilling extensively, continue using the existing context hooks within sub-components. This is acceptable since the contexts are already app-wide providers.
   Mitigation: Keep context consumption at the lowest reasonable level; pass only primitive props where possible.

2. **Sidebar conditional rendering complexity** — The sidebar shows different panels based on route AND authentication state AND project selection. Extracting these into separate components requires passing multiple conditional flags.
   Mitigation: Each sub-component handles its own visibility logic internally (e.g., `SidebarItemList` returns null if no project is selected).

3. **Portal-based navbar sections** — The Projects and CNC Pipeline routes use portal divs (`#project-navbar-portal`, `#cnc-navbar-portal`) where external pages inject their own navbar content. This pattern must be preserved.
   Mitigation: Keep the portal divs in the route-aware `NavbarContent` component as pass-through containers.

4. **Convex mutation co-location** — Some mutations (like `acceptProjectInvite` in the navbar) are tightly coupled to UI event handlers. Moving them into sub-components is safe but needs careful review.
   Mitigation: Keep mutations co-located with the components that trigger them; don't centralize all mutations in a parent.

## Alternative Approaches

1. **Route-based navbar via React Router nested layouts** — Instead of a single `AppNavbar` that conditionally renders based on route, each route could define its own navbar section via React Router's nested layout pattern. This would eliminate the `isSheetMetal`/`isCncPipeline`/`isHome` checks entirely.
   Trade-off: More files, but better separation. Would require restructuring the route definitions. Consider for a future iteration.

2. **Compound component pattern for sidebar list** — Instead of a single `SidebarItemList` component with many props, use a compound component API: `<ItemList><ItemList.Search /><ItemList.Sort /><ItemList.Items /></ItemList>`.
   Trade-off: More flexible API but more boilerplate for the two current use cases. The props-based approach is simpler and sufficient here.

3. **State machine for rename dialogs** — Use `xstate` or a reducer for the rename dialog flow instead of the `useRenameDialog` hook.
   Trade-off: Overkill for a simple open/close/rename flow. The hook approach is proportional to the complexity.
