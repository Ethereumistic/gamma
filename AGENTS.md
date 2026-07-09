# Repository Guidelines

## Project Structure & Module Organization

This repository contains a React/TypeScript frontend and a Python CNC backend. `alugamma/` holds the Vite app, Convex functions, UI components, and domain features. Frontend source lives in `alugamma/src/`: feature code in `src/features/`, routes in `src/routes/`, shared UI in `src/components/`, and static assets in `public/`.

`cnc-pipeline-backend/` contains the FastAPI service and CNC processing modules. Core code is in `cnc_pipeline/`, API entry points are in `main.py`, and Python tests are in `tests/`. DXF/NC samples and fixtures live in `DXF/`, `NC/`, `sample_files/`, and `compare_files/`. Planning docs are kept in `plans/`, `tasks/`, and `explained/`.

## Build, Test, and Development Commands

Frontend commands run from `alugamma/`:

- `pnpm install`: install frontend dependencies.
- `pnpm dev`: start the Vite development server.
- `pnpm build`: type-check with `tsc --noEmit` and build the app.
- `pnpm convex:dev`: run Convex locally for app data functions.
- `pnpm vitest run src/features/.../*.test.ts`: run a specific Vitest test file.

Backend commands run from `cnc-pipeline-backend/`:

- `python -m venv .venv` then `.venv\Scripts\Activate.ps1`: create and activate a venv.
- `pip install -r requirements.txt`: install backend dependencies.
- `uvicorn main:app --reload --port 8765`: start the FastAPI backend.
- `pytest tests`: run the Python test suite.

## Coding Style & Naming Conventions

Use strict TypeScript, React function components, and the `@/` path alias for imports from `alugamma/src`. Keep feature logic inside its feature directory and reusable primitives in `src/components/ui` or `src/lib`. Name tests `*.test.ts` or `*.test.tsx`.

Python modules use snake_case filenames and functions. Keep geometry, DXF parsing, G-code writing, and orchestration in their existing modules.

## Testing Guidelines

Add Vitest coverage beside frontend domain logic, especially geometry, DXF, nesting, and formula behavior. For golden DXF changes, update fixtures intentionally with `pnpm vitest run --update ...` and mention it in the PR. Backend changes should include focused `pytest` tests using existing DXF/NC fixtures where possible.

## Commit & Pull Request Guidelines

Recent commits use short summaries; prefer concise imperative messages such as `fix nesting line join order`. PRs should describe the behavior change, list tests run, link related tasks or plans, and include screenshots or generated DXF/NC notes for UI or manufacturing-output changes.

## Security & Configuration Tips

Do not commit local virtual environments, generated caches, secrets, or private Convex credentials. Treat sample CAD/CNC files as fixtures: keep names clear, avoid overwriting originals, and place generated comparison outputs in the existing fixture directories.
