---
name: expose-tunnel
description: Builds the app for production and exposes it publicly via Cloudflare Tunnel. Use when the user asks to expose the app, start a public URL, launch the tunnel, or rebuild for testing a branch.
allowed-tools: Bash
---

# Expose App via Cloudflare Tunnel (Production Build)

When the user asks to expose the application or start the tunnel, execute the steps below **autonomously** — run the Bash commands directly, do not just describe them.

**Why production mode?** In dev mode, Vite serves assets on a separate port with WebSocket HMR — tunnels cannot forward these. A production build bundles everything on a single port (3333).

**Tool:** Cloudflare Tunnel (`cloudflared`) — authenticated named tunnel routing to `preview.miximodel.com`.

**Tunnel name:** `miximodel-preview` (persistent, DNS already configured).
**Public URL:** `https://preview.miximodel.com`

## Steps to Execute

### 1. Kill any existing processes

Stop any running server (dev or prod) and tunnel. A leftover `npm run dev` on port 3333 will block the prod server and the tunnel will silently serve the dev version instead.

```bash
lsof -ti tcp:3333 | xargs kill -9 2>/dev/null; pkill -f "node ace serve" 2>/dev/null; pkill -f cloudflared 2>/dev/null; echo "done"
```

Verify the port is free:

```bash
lsof -ti tcp:3333 | head -1
```

If a PID is still returned, kill it with `kill -9` followed by that PID.

### 2. Build for production

```bash
npm run build
```

**Read the full output.** If the build fails, stop and report the error. Do not proceed with stale artifacts.

`npm run build` wipes and recreates `build/`. All subsequent steps must be re-run after every build.

### 3. Install production dependencies

```bash
cd build && npm ci --omit="dev"
```

The project has a `.npmrc` with `legacy-peer-deps=true` copied into `build/` via `adonisrc.ts` `metaFiles`. If `npm ci` fails with ERESOLVE, the `.npmrc` is missing — copy it manually: `cp .npmrc build/.npmrc` and retry.

### 4. Symlink the storage directory

User uploads (avatars, gallery, banners, posts, notices, bookings) live in `storage/` at the project root. AdonisJS resolves storage relative to the running server (`build/storage/`), so without a symlink all images return 404. **This symlink is destroyed on every build.**

```bash
ln -sfn ../storage build/storage
```

### 5. Start the production server

Run from inside `build/` — if launched from the project root, Node resolves modules from the wrong `node_modules/` causing 500 errors.

**Important:** Start with `HOST=0.0.0.0` to ensure the server listens on IPv4 (not just IPv6), which is required for cloudflared to connect.

```bash
cd build && HOST=0.0.0.0 node --env-file=../.env.production.local bin/server.js > /tmp/adonis-prod.log 2>&1 &
```

Wait and verify:

```bash
sleep 5 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3333
```

If not `200`, check logs:

```bash
cat /tmp/adonis-prod.log
```

### 6. Launch Cloudflare Tunnel

**Strategy:** Try the persistent named tunnel first (`preview.miximodel.com`). If it fails (missing credentials, auth issues), fall back to an anonymous tunnel.

#### 6a. Try named tunnel first

```bash
cloudflared tunnel run miximodel-preview > /tmp/cloudflared-output.log 2>&1 &
```

Wait and verify:

```bash
sleep 5 && curl -s -o /dev/null -w "%{http_code}" https://preview.miximodel.com
```

If the response is `200` or `403` (403 = Bot Fight Mode blocking curl but tunnel works for browsers), the named tunnel is up. Use `https://preview.miximodel.com` as the URL.

#### 6b. Fallback to anonymous tunnel

If the named tunnel fails to start (check `/tmp/cloudflared-output.log` for errors like "missing credentials" or "tunnel not found"), kill it and fall back:

```bash
pkill -f cloudflared 2>/dev/null; sleep 1
cloudflared tunnel --url http://localhost:3333 > /tmp/cloudflared-output.log 2>&1 &
```

Wait and extract the random URL:

```bash
sleep 8 && grep -o 'https://[^ ]*\.trycloudflare\.com' /tmp/cloudflared-output.log | tail -1
```

### 7. Report back

Respond with the tunnel URL as a **clickable link**:

> Tunnel actif (mode production)
>
> https://preview.miximodel.com (or the random trycloudflare.com URL if fallback was used)

## Rebuilding for a different branch

When the user switches branch and wants to test via the tunnel:

1. Kill the server only:
   ```bash
   lsof -ti tcp:3333 | xargs kill -9 2>/dev/null
   ```
2. Re-run steps 2 - 5 (build, deps, symlink, start server)
3. **Do NOT kill cloudflared** — the tunnel stays alive and serves the new server automatically
4. Tell the user to refresh the same URL

## Notes

- Background processes keep running after this skill completes.
- To stop everything:
  ```bash
  lsof -ti tcp:3333 | xargs kill -9 2>/dev/null; pkill -f cloudflared 2>/dev/null
  ```
- The URL `preview.miximodel.com` is persistent — it never changes between restarts.
- Cloudflare config is at `~/.cloudflared/config.yml`, credentials at `~/.cloudflared/9048403e-d5d5-4e97-8711-382a49bac9ce.json`.

## Troubleshooting

| Symptom                                    | Cause                                                     | Fix                                           |
| :----------------------------------------- | :-------------------------------------------------------- | :-------------------------------------------- |
| Images return 404                          | `build/storage` symlink missing (destroyed by each build) | `ln -sfn ../storage build/storage`            |
| 500 errors (`booted`, `vine.file`)         | Server launched from project root instead of `build/`     | Always `cd build &&` before starting          |
| `npm ci` fails with ERESOLVE               | `.npmrc` missing from `build/`                            | `cp .npmrc build/.npmrc` and retry            |
| `EADDRINUSE` or tunnel serves dev mode     | Dev server still running on port 3333                     | `lsof -ti tcp:3333 \| xargs kill -9`          |
| Tunnel connects but 502/connection refused | Server listening on IPv6 only, tunnel connects IPv4       | Start server with `HOST=0.0.0.0`              |
| 403 on `preview.miximodel.com`             | Cloudflare Bot Fight Mode blocking bots/curl              | Access via real browser, or add WAF exception |
