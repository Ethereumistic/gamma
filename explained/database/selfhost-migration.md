## 1. Removing alugamma/convex/ -- SAFE

Yes, it's safe to delete. Here's the proof:

• All 23 frontend imports use relative paths like ../../../convex/_generated/api which
  resolve to the root convex/ directory (e.g. from
  alugamma/src/components/layout/app-sidebar.tsx:5)
• The root package.json has the convex dev / convex deploy scripts, so the CLI discovers the
  root convex/
• The old alugamma/convex/ is missing files.ts -- it's stale

Run this to remove it:
rm -rf /home/vic/.openclaw/clients/gamma/alugamma/convex

───────────────────────────────────────────────────────────────────────────────────────────


## 2. Where the Convex Data Lives on the VPS

VPS: /opt/convex/
├── docker-compose.yml    # orchestration config
├── .env                  # environment variables
└── (Docker named volume: "data")
    └── /convex/data/     # actual database files inside the container

The database is stored in a Docker named volume called data (defined at the bottom of docker-compose.yml). This means:
• The data persists across container restarts and updates
• It lives at /var/lib/docker/volumes/convex_data/_data on the VPS host filesystem
• To back it up: ssh danirusev "sudo docker run --rm -v convex_data:/data -v /tmp:/backup
  alpine tar czf /backup/convex-backup.tar.gz /data"

───────────────────────────────────────────────────────────────────────────────────────────


## 3. Security Assessment -- Is It Production-Ready?

### What's GOOD (your app-level security is solid):

┌────────────┬───────┬───────────────────────────────────────────────────────────────────┐
│ Layer      │ Statu │ Details                                                           │
│            │ s     │                                                                   │
├────────────┼───────┼───────────────────────────────────────────────────────────────────┤
│ Authentica │ Secur │ Every mutation/query calls requireViewer() which checks           │
│ tion       │ e     │ getAuthUserId() (helpers.ts:34-50)                                │
├────────────┼───────┼───────────────────────────────────────────────────────────────────┤
│ Authorizat │ Secur │ Role-based access: requireProjectAccess, requireProjectManager,   │
│ ion        │ e     │ requireOrganizationManager (helpers.ts:81-112)                    │
├────────────┼───────┼───────────────────────────────────────────────────────────────────┤
│ Project    │ Secur │ Users can only access projects they're members of, or org         │
│ isolation  │ e     │ managers can access all projects in their org                     │
├────────────┼───────┼───────────────────────────────────────────────────────────────────┤
│ Invite     │ Secur │ Email matching, expiry checks, status checks                      │
│ validation │ e     │ (workspaces.ts:606-657)                                           │
├────────────┼───────┼───────────────────────────────────────────────────────────────────┤
│ Input      │ Secur │ Convex validators (v.string(), v.id(), etc.) on every function    │
│ validation │ e     │ argument                                                          │
├────────────┼───────┼───────────────────────────────────────────────────────────────────┤
│ Self-regis │ Contr │ Password-only auth, email normalized (auth.ts:8-23)               │
│ tration    │ olled │                                                                   │
└────────────┴───────┴───────────────────────────────────────────────────────────────────┘

### What NEEDS ATTENTION before production:

┌────────────┬───────┬─────────────────────────────────────────────────────────────────────┐
│ Risk       │ Sever │ Details                                                             │
│            │ ity   │                                                                     │
├────────────┼───────┼─────────────────────────────────────────────────────────────────────┤
│ generateUp │ HIGH  │ files.ts:3-4 allows any authenticated user to upload files. No      │
│ loadUrl    │       │ membership check. A logged-in user could upload unlimited files to  │
│ has NO     │       │ any project. Fix: add requireViewer(ctx) at minimum, ideally check  │
│ auth check │       │ project membership too.                                             │
├────────────┼───────┼─────────────────────────────────────────────────────────────────────┤
│ Admin key  │ MEDIU │ The admin key is in .env.local which is gitignored, but if it ever  │
│ in         │ M     │ leaks, someone gets full admin access to your database. The key is  │
│ .env.local  │       │ also visible in the conversation history.                           │
│ at repo    │       │                                                                     │
│ root       │       │                                                                     │
├────────────┼───────┼─────────────────────────────────────────────────────────────────────┤
│ No rate    │ MEDIU │ No rate limiting on auth attempts. A bot could brute-force          │
│ limiting   │ M     │ passwords. Convex Cloud handles this automatically, but             │
│            │       │ self-hosted doesn't.                                                │
├────────────┼───────┼─────────────────────────────────────────────────────────────────────┤
│ Dashboard  │ MEDIU │ convex-dashboard.alubeta.com is protected only by the admin key.    │
│ is         │ M     │ Anyone who guesses/leaks the key has full DB access. Consider       │
│ publicly   │       │ IP-whitelisting the dashboard in Nginx.                             │
│ accessible │       │                                                                     │
├────────────┼───────┼─────────────────────────────────────────────────────────────────────┤
│ No HTTPS   │ LOW   │ HTTP actions (auth callbacks) go through convex-site.alubeta.com    │
│ on         │       │ which has no SSL yet. Fix this with the DNS records + certbot.      │
│ convex-sit │       │                                                                     │
│ e yet      │       │                                                                     │
├────────────┼───────┼─────────────────────────────────────────────────────────────────────┤
│ v.any()    │ LOW   │ cnc_settings.toolOverrides and nc_programs.lineToSegmentMap use     │
│ in schema  │       │ v.any() (schema.ts:100,137). These accept arbitrary data -- not a   │
│            │       │ direct attack vector since Convex validates at the function level,  │
│            │       │ but it's loose validation.                                          │
├────────────┼───────┼─────────────────────────────────────────────────────────────────────┤
│ No         │ HIGH  │ If the VPS disk dies or Docker volume corrupts, all data is gone.   │
│ backups    │       │ You need automated backups.                                         │
│ configured │       │                                                                     │
└────────────┴───────┴─────────────────────────────────────────────────────────────────────┘

### Recommendations before going to production:

1. Fix generateUploadUrl -- add auth check:
   // files.ts - should verify the user is authenticated
   export const generateUploadUrl = mutation(async (ctx) => {
     const userId = await getAuthUserId(ctx);
     if (!userId) throw new Error("Not authenticated");
     return await ctx.storage.generateUploadUrl();
   });

1. Set up automated backups -- daily cron on the VPS that exports the Docker volume or uses
   npx convex export

2. IP-restrict the dashboard in Nginx:
   # Only allow your IP to access the dashboard
   allow YOUR_HOME_IP;
   deny all;

1. Create the DNS records for convex-site.alubeta.com and get SSL -- auth flows depend on it

2. Rotate the admin key if this conversation is ever shared or stored in an accessible place