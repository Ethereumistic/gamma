# Authentication and User Management

This document describes how authentication is implemented in the AluGamma project using **Convex Auth**.

## 1. Authentication Tables (`schema.ts`)
The project uses the standard `authTables` provided by `@convex-dev/auth/server`.
- **`users`**: The primary user identity.
- **`sessions`**: Active authentication sessions.
- **`accounts`**: Links users to providers (e.g., Email/Password, Google).

## 2. Authentication Flow (`auth.ts`)
The `auth.ts` file (Convex) typically exports the `auth` object which provides the `getAuthUserId` helper used in backend functions to verify identity.

## 3. Access Control Helpers (`helpers.ts`)
The project implements several layers of security to ensure users can only see their own data:

### `requireViewer(ctx)`
The most basic check. It ensures the user is logged in.
- **Logic**: Calls `getAuthUserId` and fetches the user from the `db`. Throws an error if no user is found.

### `getOrganizationMembership(ctx, organizationId, userId)`
Checks if a specific user belongs to an organization.
- **Index Used**: `by_organization_user` (highly efficient).

### `getProjectMembership(ctx, projectId, userId)`
Checks if a specific user belongs to a project.
- **Index Used**: `by_project_user`.

### Managing vs. Editing roles
- **`isOrganizationManager(role)`**: Returns `true` if the role is `owner` or `admin`.
- **`requireOrganizationManager(ctx, organizationId)`**: A wrapper that throws an error if the user is not an organization manager. Used for inviting users or creating new projects.

## 4. Current Authentication State Lookups
Frontend state is often populated via the `viewerWorkspace` query (in `workspaces.ts`). This query:
1. Verifies the viewer's identity.
2. Lists all organizations the user belongs to.
3. Lists all projects the user is explicitly a member of, OR projects belonging to organizations where the user is a manager.
4. Returns a unified `authenticated: true` response with the user's profile and workspace tree.
