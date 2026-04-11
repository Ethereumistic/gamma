# Convex Cloud → Self-Hosted Migration Plan

## Objective

Migrate the Convex backend from Convex Cloud to a self-hosted Convex instance on the VPS at `72.62.157.125`, with domain `convex.alubeta.com` pointing to it. The plan covers:
1. Restructuring the monorepo so `/convex` lives at the `/gamma` root level
2. Setting up the self-hosted Convex backend on the VPS (Docker, Nginx, SSL)
3. Configuring local development to target the self-hosted instance
4. Importing the existing data snapshot (`~/Downloads/snapshot.zip`)
5. Enabling file storage on the self-hosted instance
6. Reconfiguring the frontend (`alugamma`) to point to the new backend

---

## Current State Analysis

### Project Structure
- **Monorepo root**: `/home/vic/.openclaw/clients/gamma/`
- **Frontend**: `alugamma/` — Vite + React + TypeScript, uses Convex for DB/auth
- **Python backend**: `cnc-pipeline-backend/` — FastAPI, independent of Convex (talks to frontend via REST at `cnc.alubeta.com`)
- **Convex backend**: Currently lives at `alugamma/convex/` — cloud-hosted

### Convex Configuration
- **Schema** (`alugamma/convex/schema.ts:1-151`): 11 tables — auth tables, organizations, projects, designs, nc_programs, cnc_settings, plus invite/membership tables
- **Auth** (`alugamma/convex/auth.ts:1-24`): Uses `@convex-dev/auth` with Password provider only
- **Auth config** (`alugamma/convex/auth.config.ts:1-8`): References `CONVEX_SITE_URL`
- **HTTP routes** (`alugamma/convex/http.ts:1-9`): Only auth routes
- **Frontend connection** (`alugamma/src/lib/convex.ts:1-10`): Reads `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` from env
- **No file storage** is currently used (no `ctx.storage` calls anywhere)
- **Convex version**: `convex@^1.32.0`, `@convex-dev/auth@^0.0.91`
- **Convex Cloud ENV VARS**:
JWKS
JWT_PRIVATE_KEY
SITE_URL

### VPS Info
- **IP**: `72.62.157.125`
- **Domain**: `convex.alubeta.com` → points to VPS IP
- **No existing Nginx/Convex setup** — everything must be scaffolded from scratch
- **Data backup**: `~/Downloads/snapshot.zip` (Convex cloud export)

---

## Implementation Plan

### Phase 1: VPS Infrastructure Setup

- [ ] **1.1. SSH into VPS and install prerequisites**: Ensure Docker and Docker Compose are installed on the VPS. Run `docker --version` and `docker compose version` to verify. Install if missing.
- [ ] **1.2. Create Convex directory on VPS**: Create `/opt/convex` (or similar) to hold `docker-compose.yml`, `.env`, and persistent data volumes.
- [ ] **1.3. Download docker-compose.yml**: Fetch the official Convex self-hosted Docker Compose file from `https://raw.githubusercontent.com/get-convex/convex-backend/main/self-hosted/docker/docker-compose.yml` into `/opt/convex/docker-compose.yml`.
- [ ] **1.4. Create `.env` file on VPS** at `/opt/convex/.env` with the following configuration:
  ```
  # Ports
  PORT=3210
  SITE_PROXY_PORT=3211
  DASHBOARD_PORT=6791

  # Origins — these are the public URLs the client/browser will use
  CONVEX_CLOUD_ORIGIN=https://convex.alubeta.com
  CONVEX_SITE_ORIGIN=https://convex-site.alubeta.com
  NEXT_PUBLIC_DEPLOYMENT_URL=https://convex.alubeta.com

  # Disable SSL requirement for internal Docker communication
  DO_NOT_REQUIRE_SSL=1

  # Logging
  RUST_LOG=info
  ```
  **Note**: `convex-site.alubeta.com` is for HTTP actions (port 3211). If you prefer a single domain with path-based routing, adjust Nginx accordingly. The auth system (`auth.config.ts:4`) uses `CONVEX_SITE_URL` which will resolve to this origin.
- [ ] **1.5. Start the Convex backend**: Run `docker compose up -d` in `/opt/convex/`. Verify with `docker compose logs backend` that it starts successfully and shows "Listening on port 3210".
- [ ] **1.6. Generate admin key**: Run `docker compose exec backend ./generate_admin_key.sh` and save the output — this is the `CONVEX_SELF_HOSTED_ADMIN_KEY`.
- [ ] **1.7. Verify backend health**: Run `curl -f http://localhost:3210/version` on the VPS to confirm the backend is responding.

### Phase 2: Nginx + SSL Reverse Proxy

- [ ] **2.1. Install Nginx** on the VPS if not already present: `sudo apt install nginx`.
- [ ] **2.2. Install Certbot** for Let's Encrypt SSL: `sudo apt install certbot python3-certbot-nginx`.
- [ ] **2.3. Create Nginx config for `convex.alubeta.com`** at `/etc/nginx/sites-available/convex.alubeta.com`:
  ```
  # Convex API (main backend) — port 3210
  server {
      listen 80;
      server_name convex.alubeta.com;

      location / {
          proxy_pass http://127.0.0.1:3210;
          proxy_http_version 1.1;
          proxy_set_header Upgrade $http_upgrade;
          proxy_set_header Connection "upgrade";
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
          proxy_read_timeout 86400s;
          proxy_send_timeout 86400s;
      }
  }

  # Convex Site (HTTP actions) — port 3211
  server {
      listen 80;
      server_name convex-site.alubeta.com;

      location / {
          proxy_pass http://127.0.0.1:3211;
          proxy_http_version 1.1;
          proxy_set_header Upgrade $http_upgrade;
          proxy_set_header Connection "upgrade";
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
          proxy_read_timeout 86400s;
          proxy_send_timeout 86400s;
      }
  }

  # Convex Dashboard — port 6791 (optional, can restrict to IP)
  server {
      listen 80;
      server_name convex-dashboard.alubeta.com;

      location / {
          proxy_pass http://127.0.0.1:6791;
          proxy_http_version 1.1;
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
      }
  }
  ```
  **Alternative**: If you don't want subdomains for site/dashboard, use path-based routing on a single domain or access dashboard via SSH tunnel.
- [ ] **2.4. Enable the site**: Symlink to sites-enabled and reload Nginx:
  ```bash
  sudo ln -s /etc/nginx/sites-available/convex.alubeta.com /etc/nginx/sites-enabled/
  sudo nginx -t && sudo systemctl reload nginx
  ```
- [ ] **2.5. Set up DNS records**: Ensure the following A records point to `72.62.157.125`:
  - `convex.alubeta.com` (already done per task description)
  - `convex-site.alubeta.com` (new — needed for HTTP actions/auth)
  - `convex-dashboard.alubeta.com` (optional — for dashboard access)
- [ ] **2.6. Obtain SSL certificates**: Run certbot for each domain:
  ```bash
  sudo certbot --nginx -d convex.alubeta.com
  sudo certbot --nginx -d convex-site.alubeta.com
  sudo certbot --nginx -d convex-dashboard.alubeta.com
  ```
- [ ] **2.7. Verify HTTPS access**: Test that `https://convex.alubeta.com/version` returns a version response.

### Phase 3: Monorepo Restructuring — Move `/convex` to Root

- [ ] **3.1. Move `alugamma/convex/` to `gamma/convex/`**: This makes the Convex backend a first-class citizen at the monorepo root level, separate from the frontend. Copy all files from `alugamma/convex/` (including `_generated/`, `schema.ts`, `auth.ts`, `auth.config.ts`, `http.ts`, `designs.ts`, `helpers.ts`, `workspaces.ts`, `nc_programs.ts`, `cnc_settings.ts`, `validators.ts`, `tsconfig.json`) to `gamma/convex/`.
- [ ] **3.2. Create `gamma/convex/tsconfig.json`**: Keep the existing config from `alugamma/convex/tsconfig.json:1-25` — it's self-contained and doesn't reference the parent.
- [ ] **3.3. Update `gamma/convex/_generated/` references**: After moving, the `_generated` directory will be regenerated by `npx convex dev` pointing at the self-hosted instance. The existing generated code references relative paths (`../auth.js`, `../designs.js`, etc.) which will still work.
- [ ] **3.4. Create a root `gamma/package.json`** (or use the existing `alugamma/package.json` for convex commands): Since `npx convex dev` needs to run in a directory with `convex` as a dependency, you have two options:
  - **Option A (recommended)**: Create a minimal `gamma/package.json` with just `convex` as a dependency, and run `npx convex dev` from `gamma/`.
  - **Option B**: Keep running convex commands from `alugamma/` but with the `--convex-url` flag or `.env.local` pointing to the self-hosted instance. The `convex/` directory path can be configured.
- [ ] **3.5. Create `gamma/.env.local`** (gitignored) with the self-hosted connection:
  ```
  CONVEX_SELF_HOSTED_URL=https://convex.alubeta.com
  CONVEX_SELF_HOSTED_ADMIN_KEY=<the admin key from step 1.6>
  ```
- [ ] **3.6. Delete the old `alugamma/convex/` directory** after confirming the move works. Or keep it as a backup temporarily.
- [ ] **3.7. Update `alugamma/.env.local`** (or `.env`) for the frontend:
  ```
  VITE_CONVEX_URL=https://convex.alubeta.com
  VITE_CONVEX_SITE_URL=https://convex-site.alubeta.com
  ```
  This is consumed by `alugamma/src/lib/convex.ts:3` and `alugamma/src/vite-env.d.ts:4-5`.

### Phase 4: Convex Auth Setup for Self-Hosted

- [ ] **4.1. Generate JWT key pair**: The self-hosted Convex auth requires `JWT_PRIVATE_KEY` and `JWKS` environment variables. Create a `generateKeys.mjs` script in `gamma/`:
  ```javascript
  import { exportJWK, exportPKCS8, generateKeyPair } from "jose";
  const keys = await generateKeyPair("RS256", { extractable: true });
  const privateKey = await exportPKCS8(keys.privateKey);
  const publicKey = await exportJWK(keys.publicKey);
  const jwks = JSON.stringify({ keys: [{ use: "sig", ...publicKey }] });
  process.stdout.write(`JWT_PRIVATE_KEY="${privateKey.trimEnd().replace(/\n/g, " ")}"\n`);
  process.stdout.write(`JWKS=${jwks}\n`);
  ```
  Run with `node generateKeys.mjs` (requires `jose` package: `npm install jose`).
- [ ] **4.2. Set auth environment variables on the self-hosted instance**: Use the Convex CLI to set env vars:
  ```bash
  npx convex env set JWT_PRIVATE_KEY "<value from step 4.1>"
  npx convex env set JWKS "<value from step 4.1>"
  npx convex env set SITE_URL https://convex-site.alubeta.com
  ```
  **Important**: `SITE_URL` is used by the auth system for redirects. The `auth.config.ts:4` references `process.env.CONVEX_SITE_URL` which is automatically set by the Convex runtime to the site origin.
- [ ] **4.3. Verify auth config**: The existing `alugamma/convex/auth.config.ts:1-8` and `alugamma/convex/auth.ts:1-24` should work as-is with self-hosted. No code changes needed — the Password provider doesn't require external OAuth configuration.

### Phase 5: Data Import

- [ ] **5.1. Transfer snapshot to VPS**: Copy `~/Downloads/snapshot.zip` to the VPS:
  ```bash
  scp ~/Downloads/snapshot.zip user@72.62.157.125:/tmp/snapshot.zip
  ```
- [ ] **5.2. Import the snapshot**: From the local machine (with `gamma/.env.local` configured), run:
  ```bash
  cd /home/vic/.openclaw/clients/gamma
  npx convex import --replace-all /tmp/snapshot.zip
  ```
  Or if the file is local:
  ```bash
  npx convex import --replace-all ~/Downloads/snapshot.zip
  ```
- [ ] **5.3. Verify data import**: Use the dashboard at `https://convex-dashboard.alubeta.com` to browse tables and confirm data was imported correctly. Check tables: `users`, `organizations`, `projects`, `designs`, `nc_programs`, `cnc_settings`, etc.

### Phase 6: Deploy Convex Functions

- [ ] **6.1. Push Convex functions to self-hosted**: From `gamma/`:
  ```bash
  npx convex dev
  ```
  This will push all function modules from `gamma/convex/` to the self-hosted backend, regenerate `_generated/`, and watch for changes.
- [ ] **6.2. Verify function deployment**: Check the dashboard to see all functions listed: `designs/listByProject`, `designs/getDesign`, `designs/saveDesign`, `workspaces/viewerWorkspace`, `nc_programs/saveNcProgram`, `auth/*`, etc.

### Phase 7: Frontend Reconfiguration

- [ ] **7.1. Update `alugamma/src/lib/convex.ts`**: No code changes needed — it already reads from `VITE_CONVEX_URL` env var (`alugamma/src/lib/convex.ts:3`). Just ensure the `.env.local` file is set correctly (done in step 3.7).
- [ ] **7.2. Create `alugamma/.env.local`** if it doesn't exist:
  ```
  VITE_CONVEX_URL=https://convex.alubeta.com
  VITE_CONVEX_SITE_URL=https://convex-site.alubeta.com
  ```
- [ ] **7.3. Test local frontend**: Run `pnpm dev` in `alugamma/` and verify:
  - The app connects to the self-hosted Convex backend
  - Login/password auth works
  - Data loads (organizations, projects, designs, NC programs)
  - Real-time updates work (WebSocket connections through Nginx)
- [ ] **7.4. Test CNC pipeline integration**: Verify that the CNC pipeline page still works — it talks to the Python backend at `cnc.alubeta.com` (independent of Convex) and saves results to Convex via mutations. End-to-end: upload DXF → generate NC → save to Convex.

### Phase 8: File Storage Enablement

- [ ] **8.1. Decide on file storage backend**: Two options:
  - **Option A (simple)**: Use local filesystem storage inside the Docker container (default). Files persist in the Docker volume. Good for getting started.
  - **Option B (production)**: Use S3-compatible storage (MinIO on VPS, or Cloudflare R2, or AWS S3). Required for better reliability and backup.
- [ ] **8.2. If using S3-compatible storage**, add to `/opt/convex/.env`:
  ```
  AWS_REGION=us-east-1
  AWS_ACCESS_KEY_ID=<key>
  AWS_SECRET_ACCESS_KEY=<secret>
  S3_STORAGE_FILES_BUCKET=convex-user-files
  S3_STORAGE_EXPORTS_BUCKET=convex-exports
  S3_STORAGE_SNAPSHOT_IMPORTS_BUCKET=convex-snapshot-imports
  S3_STORAGE_MODULES_BUCKET=convex-modules
  S3_STORAGE_SEARCH_BUCKET=convex-search-indexes
  # For MinIO or R2:
  S3_ENDPOINT_URL=https://<your-s3-endpoint>
  AWS_S3_FORCE_PATH_STYLE=1
  ```
- [ ] **8.3. Restart Convex backend** after storage config changes: `docker compose restart backend`.
- [ ] **8.4. Add file storage functions** to `gamma/convex/`: Create a new file (e.g., `gamma/convex/files.ts`) with upload URL generation:
  ```typescript
  import { mutation } from "./_generated/server";
  export const generateUploadUrl = mutation(async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  });
  ```
- [ ] **8.5. Use file storage in the frontend**: Wherever file uploads are needed, call the `generateUploadUrl` mutation, then POST the file to the returned URL. Retrieve files via `ctx.storage.getUrl(storageId)`.

### Phase 9: Local Development Setup

- [ ] **9.1. Create `gamma/.env.local`** for local development pointing to VPS:
  ```
  CONVEX_SELF_HOSTED_URL=https://convex.alubeta.com
  CONVEX_SELF_HOSTED_ADMIN_KEY=<admin key>
  ```
- [ ] **9.2. Alternative — run Convex locally in Docker**: For fully offline development, copy `docker-compose.yml` to `gamma/docker-compose.yml` and run `docker compose up` locally. Then set:
  ```
  CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
  CONVEX_SELF_HOSTED_ADMIN_KEY=<local admin key>
  ```
  And for the frontend:
  ```
  VITE_CONVEX_URL=http://127.0.0.1:3210
  VITE_CONVEX_SITE_URL=http://127.0.0.1:3211
  ```
- [ ] **9.3. Add `.env.local` to `.gitignore`**: Ensure both `gamma/.env.local` and `alugamma/.env.local` are gitignored.
- [ ] **9.4. Create `gamma/.gitignore`** (or update existing):
  ```
  .env.local
  .env
  node_modules/
  ```
- [ ] **9.5. Document the local dev workflow**: From `gamma/`:
  ```bash
  # Terminal 1: Run Convex dev (pushes functions, watches for changes)
  npx convex dev

  # Terminal 2: Run the frontend
  cd alugamma && pnpm dev
  ```

### Phase 10: Production Hardening

- [ ] **10.1. Set up automatic Docker restart**: Ensure `restart: unless-stopped` is in `docker-compose.yml` for both backend and dashboard services.
- [ ] **10.2. Set up database backups**: Create a cron job on the VPS to periodically export Convex data:
  ```bash
  # Example: daily backup via snapshot export
  0 2 * * * cd /opt/convex && docker compose exec -T backend ./convex export --path /convex/data/backup-$(date +\%Y\%m\%d).zip
  ```
- [ ] **10.3. Configure firewall**: Ensure only ports 80 and 443 are open externally. Ports 3210, 3211, 6791 should only be accessible locally (Nginx proxies them).
  ```bash
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw deny 3210/tcp
  sudo ufw deny 3211/tcp
  sudo ufw deny 6791/tcp
  ```
- [ ] **10.4. Restrict dashboard access**: Either use `convex-dashboard.alubeta.com` with HTTP Basic Auth in Nginx, or only access via SSH tunnel:
  ```bash
  ssh -L 6791:localhost:6791 user@72.62.157.125
  # Then visit http://localhost:6791
  ```
- [ ] **10.5. Set up log rotation**: Configure Docker logging driver or logrotate for Convex logs.
- [ ] **10.6. Consider Postgres migration**: For production workloads, consider migrating from SQLite to Postgres for better concurrency and reliability. Add `POSTGRES_URL` to the `.env` and create the `convex_self_hosted` database.

---

## Verification Criteria

- [ ] **VC-1**: `curl -s https://convex.alubeta.com/version` returns a version JSON response
- [ ] **VC-2**: Dashboard accessible at `https://convex-dashboard.alubeta.com` (or via SSH tunnel) and shows all tables with imported data
- [ ] **VC-3**: `npx convex dev` from `gamma/` successfully pushes functions to the self-hosted backend
- [ ] **VC-4**: Frontend at `http://localhost:5173` connects to self-hosted Convex, auth works, data loads
- [ ] **VC-5**: All existing functionality works end-to-end: login, create org, create project, create/save design, CNC pipeline generate + save NC program
- [ ] **VC-6**: File storage works — `generateUploadUrl` mutation returns a valid upload URL, files can be stored and retrieved
- [ ] **VC-7**: WebSocket real-time updates work through Nginx (design changes reflect immediately)
- [ ] **VC-8**: All 11 database tables have been imported with data intact

---

## Potential Risks and Mitigations

1. **Snapshot import incompatibility**
   - Risk: The cloud export format may differ from what the self-hosted version expects (version mismatch).
   - Mitigation: Ensure the self-hosted Docker image uses the `latest` tag. If import fails, try `npx convex import` with `--replace-all` flag. As a last resort, manually recreate data or use the Convex cloud API to export as JSON.

2. **Auth breaking after migration**
   - Risk: Existing user sessions/passwords may not transfer because auth tokens are tied to the instance.
   - Mitigation: Users will need to re-register or you can manually insert user records. The Password provider hashes are stored in the `authTables` so they should transfer with the data import. Test with a known account.

3. **WebSocket proxy issues through Nginx**
   - Risk: Convex relies heavily on WebSockets for real-time updates. Nginx may drop long-lived connections.
   - Mitigation: The Nginx config includes `proxy_read_timeout 86400s` and `Upgrade`/`Connection` headers. If issues persist, increase timeouts or use Nginx stream module.

4. **DNS propagation delay for new subdomains**
   - Risk: `convex-site.alubeta.com` and `convex-dashboard.alubeta.com` may take time to propagate.
   - Mitigation: Set up DNS records early. Use `/etc/hosts` overrides for local testing during propagation.

5. **Data loss during cutover**
   - Risk: Any writes to the cloud instance after the snapshot export will be lost.
   - Mitigation: Schedule the migration during low-traffic period. Export snapshot immediately before migration. Consider a brief maintenance window.

6. **Docker volume data loss**
   - Risk: If the Docker container is recreated without proper volumes, all data is lost.
   - Mitigation: The `docker-compose.yml` uses named volumes (`data:`). Never run `docker compose down -v`. Set up regular backups (step 10.2).

7. **`_generated/` directory conflicts**
   - Risk: Moving `convex/` from `alugamma/` to `gamma/` may cause path issues in generated code.
   - Mitigation: Delete `_generated/` after the move and let `npx convex dev` regenerate it fresh.

---

## Alternative Approaches

1. **Keep convex/ inside alugamma/**: Instead of moving to root, keep the Convex backend inside `alugamma/convex/` and just reconfigure the deployment target. This avoids restructuring but means the Convex backend is coupled to the frontend. Run `npx convex dev` from `alugamma/` with `CONVEX_SELF_HOSTED_URL` in `alugamma/.env.local`. **Trade-off**: Less restructuring but doesn't match the monorepo architecture goal.

2. **Use a single domain with path-based routing**: Instead of `convex-site.alubeta.com`, route everything through `convex.alubeta.com` with Nginx paths (e.g., `/api/` → 3210, `/site/` → 3211). **Trade-off**: Simpler DNS but more complex Nginx config and potential path conflicts.

3. **Use MinIO on the VPS for S3-compatible storage**: Instead of local filesystem or cloud S3, run MinIO alongside Convex in Docker Compose for file storage. **Trade-off**: Self-contained but adds another service to manage.

4. **Use Cloudflare Tunnel instead of Nginx**: Expose the Convex backend via Cloudflare Tunnel (zero-trust). **Trade-off**: No open ports needed but adds Cloudflare dependency and tunnel daemon overhead.

---

## Key Files Reference

| File | Role | Changes Needed |
|------|------|----------------|
| `alugamma/src/lib/convex.ts:3` | Reads `VITE_CONVEX_URL` | No code change — update env var |
| `alugamma/src/vite-env.d.ts:4-5` | TypeScript env types | No change needed |
| `alugamma/src/main.tsx:8,12` | ConvexAuthProvider setup | No change needed |
| `alugamma/convex/auth.ts:1-24` | Auth with Password provider | No change needed |
| `alugamma/convex/auth.config.ts:4` | Uses `CONVEX_SITE_URL` | No change needed |
| `alugamma/convex/schema.ts:1-151` | 11-table schema | No change needed |
| `alugamma/convex/http.ts:1-9` | HTTP routes for auth | No change needed |
| `alugamma/vite.config.ts:14-17` | Proxy to Python backend | No change needed |
| `alugamma/src/features/cnc-pipeline/api.ts:5` | CNC backend URL | No change needed |

## Architecture After Migration

```
gamma/                               ← Monorepo root
├── convex/                          ← Convex backend (moved from alugamma/)
│   ├── _generated/                  ← Auto-generated by npx convex dev
│   ├── schema.ts
│   ├── auth.ts
│   ├── auth.config.ts
│   ├── http.ts
│   ├── designs.ts
│   ├── helpers.ts
│   ├── workspaces.ts
│   ├── nc_programs.ts
│   ├── cnc_settings.ts
│   ├── validators.ts
│   ├── files.ts                     ← NEW: File storage functions
│   └── tsconfig.json
├── alugamma/                        ← Frontend (unchanged)
│   ├── src/
│   ├── .env.local                   ← VITE_CONVEX_URL=https://convex.alubeta.com
│   ├── package.json
│   └── vite.config.ts
├── cnc-pipeline-backend/            ← Python backend (unchanged)
├── .env.local                       ← CONVEX_SELF_HOSTED_URL + admin key
├── package.json                     ← NEW: convex dependency for CLI
└── .gitignore                       ← NEW: gitignore env files

VPS (72.62.157.125):
├── /opt/convex/
│   ├── docker-compose.yml           ← Convex backend + dashboard
│   ├── .env                         ← Origins, ports, DB config
│   └── (Docker volumes for data)
└── /etc/nginx/sites-available/
    └── convex.alubeta.com           ← Reverse proxy config
```
