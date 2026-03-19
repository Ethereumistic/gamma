# Organizations, Workspaces, and Projects

This document explains the hierarchical structure of organizations and projects within the AluGamma project, as implemented in `convex/workspaces.ts`.

## 1. Organizations (Workspaces)
The project uses Organizations as the top-level unit of work. An Organization is a workspace shared by many users (members).

- **`createOrganization`**: Any authenticated user can create an organization.
- **Slugification**: Organizations have human-readable slugs (e.g., `alugamma-test`). Simple numeric suffixes are added to ensure uniqueness (e.g., `alugamma-test-2`).
- **Administrative Roles**: The creator is assigned as "owner". Additional "admin" or "member" roles can be assigned via `inviteToOrganization`.

## 2. Projects
Projects are sub-units of Organizations. They serve to group related designs and NC programs.

- **`createProject`**: Only organization managers (owners or admins) can create new projects.
- **Project Structure**: Projects have their own slugs (unique within the organization) and an optional set of `defaults` applied to new designs.
- **Memberships**: While organization managers can access ALL projects by default, other users must be explicitly added as "project members".

## 3. Roles and Permissions
The project uses two sets of validators to manage access:

### Organization Roles (`organizationRoleValidator`)
- **`owner`**: Full control, including deletion of the organization.
- **`admin`**: Full management, including inviting/removing members.
- **`member`**: Basic visibility and participation.

### Project Roles (`projectRoleValidator`)
- **`owner`**: Full control over the project and its designs.
- **`editor`**: Can create, edit, and export designs.
- **`viewer`**: Can only see designs and NC programs.

## 4. Hierarchy Enforcement (`helpers.ts`)
Three critical helpers are used throughout the database logic to enforce this hierarchy:

- **`requireOrganizationManager(ctx, organizationId)`**: Throws if the user is not an owner/admin of the organization.
- **`requireProjectAccess(ctx, projectId)`**: Throws if the user has no membership in the project AND is not a manager of the parent organization.
- **`requireProjectManager(ctx, projectId)`**: Throws if the user is not an owner/editor of the project AND is not a manager of the parent organization.

This ensures a robust "nested" security model where organization admins have total visibility, while project members are restricted to their assigned teams.
