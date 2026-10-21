# LinkWatch

Track the internet speed of your home lab across **multiple internet connections and machines**, store every run, and (later) visualize it in dashboards.

> Status: **MVP + master/worker cluster mode implemented.** Dashboards and the extra features are still to do.

## Getting started

Requirements: Node 24 (`nvm use`), pnpm, and the [Ookla Speedtest CLI](https://www.speedtest.net/apps/cli) on the PATH of every machine that runs a worker (`speedtest --version` must work; the first run needs the license/GDPR flags, which the app passes itself).

```sh
pnpm install
npm start             # builds, then runs the master (API + UI + scheduler + local worker) in the foreground; Ctrl+C stops everything
# UI + API on http://localhost:3000  (API_PORT env var to change; see .env.example)
```

Run in the background with pm2 instead: `npm run daemon` (build + start/restart `linkwatch-master`), `npm run daemon:logs`, `npm run daemon:stop`.

On shutdown (Ctrl+C or SIGTERM) a running speed test is aborted, recorded as a failed run and not retried.

### Adding a remote worker
1. Open **Workers** in the UI, click **Add worker**, enter a name and a site.
2. Copy the one-line command that is shown (check the master address, it must be reachable from the worker machine, not `localhost`).
3. On the worker machine (same repo, `pnpm install`, Node 24, Ookla CLI) run it:
   ```sh
   pnpm worker --master ws://192.168.1.5:3000 --token w1234abcd.xxxxxxxx
   ```
   After the first successful pairing the address and token are saved to `data/worker.json` (mode 0600), so later `pnpm worker` needs no arguments. Flags beat env vars (`MASTER_URL`, `WORKER_TOKEN`) which beat the saved file.
4. Keep it running in the background with `npm run worker:daemon` (`worker:daemon:logs`, `worker:daemon:stop`; uses `ecosystem.worker.config.cjs`).
5. Create interfaces for that worker in **Monitoring** (pick the worker first, then one of the interfaces it reported).

Development: `pnpm dev:master`, `pnpm dev:worker`, `pnpm dev:web` (Vite on :5173, proxying /api to :3000; run `pnpm build` once first so the workspace packages exist in `dist`).
Quality: `pnpm test` (builds, then runs all Vitest suites), `pnpm lint`, `pnpm typecheck`.
The master's SQLite DB is created at `data/linkwatch.db`. Workers store nothing except `data/worker.json`.

## Implementation notes / choices made while building
- A new or re-enabled target runs one test immediately once its worker is connected. After a master restart each target runs once as soon as its worker reconnects (no "worker offline" failures are recorded just because the master booted first). Changing only the interval resets that target's timer without running.
- Timeout bounds: 10-900 seconds (default 120). The UI prefills an interval of 60 minutes (minimum 5).
- Failed/timed-out attempts each store their own run row (attempt 1-3, shared `attemptGroupId`), including stderr and captured stdout.
- **Retries only apply to `failed` and `timeout`** results. These are recorded as a failed run without retrying: engine `unavailable` (e.g. Ookla CLI missing), `aborted`, worker `offline`, connection `lost` mid-test, worker `unresponsive`. (Retrying a missing binary or an absent worker three times in a row would just add noise.)
- Runs keep a snapshot of the worker name, site and target label/binding, so history survives deleting a worker or target.
- Runs left as `running` by a crashed master are marked failed on the next master start.
- The `/api/interfaces` endpoint is gone: interface lists come per worker (`GET /api/workers`).
- `POST /api/targets` defaults the owning worker to the local worker when `workerId` is omitted.
- Tested end to end with a fake `speedtest` binary (local worker, a paired remote worker, killing the remote worker mid-test, restarting it from the saved config); the real Ookla CLI with interface binding was verified on the dev Mac earlier (`--interface=en0`).

## Decisions

| Area | Decision |
|---|---|
| Runtime | Bare metal Linux host (and macOS for development) |
| Repo | pnpm monorepo: `apps/master`, `apps/worker`, `apps/web`, `packages/shared`, `packages/protocol`, `packages/db` |
| Master | Node.js + TypeScript + Express: API, serves the built frontend (single port, behind Caddy later), WebSocket hub for workers, scheduler/queue, supervises the local worker |
| Worker | Separate Node.js process: the Ookla engine plus a WebSocket client. It decides and stores nothing |
| Frontend | React + Vite + TypeScript |
| DB / ORM | SQLite (WAL mode) + Drizzle, master only |
| Speed test engine | Pluggable `SpeedTestEngine` interface; Ookla CLI is the first implementation |
| Ookla install | **User installs it** on each worker machine; the worker detects it and reports status/install hint to the master |
| Server selection | Ookla auto-picks the server (pinning may come later) |
| Interfaces | Per worker; chosen from the worker's reported interface list (or typed manually). Binding by interface name or source IP; **relies on OS routing**, the app never creates or manages VLANs/routes |
| Concurrency | One test at a time **per site** (workers in the same site share an uplink); different sites run in parallel. Default site is `default`, i.e. strictly serial |
| Schedule | Fixed interval in minutes, **configured per interface** |
| Failures | Stored as runs with status and error (a failure likely means that link has no internet, which is valuable to see) |
| Timeout | Default 120s per test, configurable per interface |
| Retries | `failed`/`timeout` results retry up to 2 more times (max 3 attempts), immediately; other failure kinds do not retry (see notes) |
| Min interval | 5 minutes |
| Process manager | pm2 (`ecosystem.config.cjs` runs only the master; `ecosystem.worker.config.cjs` for remote workers) |
| Config | The only env var for the master is the API port (default 3000, listens on all interfaces; `.env.example`). The DB path is fixed (not env-configurable). Workers: flags / `MASTER_URL` + `WORKER_TOKEN` / saved `data/worker.json` |
| DB location | `<repo root>/data/linkwatch.db`, resolved from the package location (not the cwd); `data/` is git-ignored |
| Testing | Unit tests with Vitest for all packages (see Testing) |
| Units / time | Speeds stored as raw bits per second (UI shows Mbps/Gbps); timestamps stored in UTC, shown in the browser's local time |
| Auth | None for the UI (Caddy OAuth later; `/ws/worker` must bypass it, workers authenticate with their token) |
| Retention | Keep everything |
| Live updates | In-process event bus -> SSE (`run_queued/started/progress/finished`, `worker_changed`); not persisted |
| Tooling | pnpm, Node 24 LTS, Biome, Vitest, zod |
| Charts (later) | Apache ECharts |
| History table | TanStack Table (headless) with server-side sort/filter/pagination |

## Architecture

```
 Browser <--HTTP/SSE--> Master (Express + UI + scheduler + WorkerHub) <--SQLite--> data/linkwatch.db
                              ^  ^
                  WebSocket   |  |  WebSocket (worker dials the master at /ws/worker)
              local worker ---+  +--- remote workers (any LAN machine; internet later via wss://)
          (child process, supervised)
```

### Master (`apps/master`)
- `hub.ts`: WebSocket server (upgrade on `/ws/worker`), mutual HMAC handshake, one live connection per worker, ping/pong liveness, `runTest()` with a watchdog, status computation (`online`, `reconnecting` for up to 10s, `offline`, `waiting`, `disabled`, `incompatible`).
- `dispatcher.ts`: per-target timers feeding one serial queue per site, run persistence, retry rules, per-worker activity.
- `supervisor.ts`: spawns and supervises the local worker child process (restart with backoff, SIGTERM then SIGKILL on stop). The local worker is auto-provisioned, cannot be deleted or have its token rotated, only disabled.
- `events.ts`: in-process event bus. `app.ts`: REST API (`/api/workers`, `/api/targets`, `/api/runs`, `/api/events`, `/api/health`). `workers.ts`: worker DTO builder.

### Worker (`apps/worker`)
- `engine/`: `SpeedTestEngine` interface and `OoklaEngine` (spawns `speedtest --format=json --accept-license --accept-gdpr --interface=... / --ip=...`).
- `agent/client.ts`: connection client (handshake, reconnect with 1s-30s jittered backoff, 60s after bad credentials, aborts a running test when the link drops, rejects a second test while busy, reconnects if the master goes silent for 15s).
- `agent/interfaces.ts`: reports the interface list on connect, on change (polled every 10s) and in a full resync every 5 minutes.
- `agent/config.ts`: flags > env > saved file resolution and the 0600 credential file.

### Data model
- `workers`: id, name (unique), site, kind (`local` | `remote`), secret, enabled, created_at, last_seen_at, last_connected_at, info (machine + engine status, JSON), interfaces (JSON) + updated_at
- `targets`: id, worker_id (cascade delete), label, bind_type, bind_value, interval_minutes (>= 5), timeout_seconds, enabled, created_at, updated_at
- `runs`: id, worker_id (set null on delete) + worker_name/site snapshots, target_id (set null) + label/binding snapshots, attempt_group_id, attempt_number, trigger, status (`running` | `ok` | `failed` | `timeout`), engine, timings, every metric the engine reports, error_message, exit_code, stderr, `raw_json`

### Cluster protocol (JSON over WebSocket, validated with zod in `packages/protocol`)
- Handshake (the secret never goes over the wire; both proofs are HMAC-SHA256 over `role|nonceWorker|nonceMaster`, so neither side's proof can be reflected back):
  1. worker -> `hello {protocol, workerId, nonce}`
  2. master -> `challenge {nonce, proof = HMAC(secret, "master"|nonceW|nonceM)}` (the worker verifies the master; unknown worker ids get a dummy challenge so they look like bad secrets)
  3. worker -> `auth {proof = HMAC(secret, "worker"|nonceW|nonceM), info}`
  4. master -> `ready`, or `reject {bad_credentials | incompatible | disabled | throttled}`
- Token = `<workerId>.<secret>` (32 random bytes, base64url), generated by the master, shown once, stored in plain form in the master DB (needed to verify the HMAC; the DB is local to the master).
- Hardening: constant-time comparisons, failed attempts throttled per IP, 1 MB max message, 10s handshake timeout, protocol version checked after authentication, a newer connection of the same worker replaces the old one. Rotating a token or disabling/removing a worker closes its connection.
- master -> worker: `run_test`, `abort`, `ping`, `request_interfaces`, `request_status`. worker -> master: `interfaces`, `status`, `progress`, `result`, `failure`, `pong`.
- Liveness: ping every 5s, no pong within 10s closes the connection. A connection lost mid-test aborts it on the worker and records a failed run ("Worker connection lost during the test"); a worker silent for test timeout + 15s is "unresponsive". A test due while its worker is offline is recorded as failed ("Worker offline").
- When Caddy OAuth is added, `/ws/worker` must bypass it.

### Frontend
- Pages: **Workers** (status, last seen, machine info, Ookla status, latency/uptime, current activity, interfaces, targets with last result, add/edit/enable/disable/rotate token/remove/run now/refresh interfaces, pairing command with editable master address and a localhost warning), **History** (worker/site columns and filters), **Monitoring** (targets; pick a worker, then an interface from its reported list; configured interfaces that disappeared are flagged), status banners (local worker disconnected, remote workers offline/incompatible, Ookla missing) and live progress.
- Table stack: TanStack Table + TanStack Query, server-driven state kept in the URL.

## Testing
Unit tests are written alongside each piece of code, using Vitest (`pnpm test` runs everything).
- **Protocol:** schema validation and handshake proofs (valid, wrong secret, reflection, replay, tampering).
- **Hub:** real WebSocket connections against a hand-rolled protocol client: handshake accept/reject (bad secret, unknown id, incompatible, disabled), throttling, duplicate replacement, ping/pong and pong timeout, status transitions, dispatch/progress/result/failure, lost connection, watchdog, abort, token rotation.
- **Dispatcher:** fake timers and a fake hub: startup behaviour, intervals, per-site serialisation, retry rules per failure kind, offline runs, shutdown abort.
- **Supervisor:** real child processes (restart/backoff, graceful stop, SIGKILL, missing binary).
- **Worker:** engine fixtures, and the client against a fake master speaking the real handshake (reconnect, abort on disconnect, busy rejection, idle timeout), interface watcher, config precedence and file permissions.
- **API:** supertest on an in-memory DB, including a real worker connection for status/rotation.
- **Frontend:** Workers, Monitoring and History pages and helpers.
- Manual end-to-end checks with a fake `speedtest` on the PATH: pairing a real second worker process, killing it mid-test, restarting from the saved config.

## Future features (NOT in scope now; planned for later)
These make use of the multi-interface setup.
- **Dashboards (ECharts):** speed over time per link, etc. (design to be discussed).
- **Side-by-side comparison:** per-cycle download/upload/latency per ISP, with a "winner" per cycle.
- **Failover and outage timeline:** when each link was down or degraded; uptime % per link.
- **Degradation alerts:** notify when a link drops below X% of its rolling median or below contracted speed (webhook, ntfy, Discord).
- **ISP SLA scorecard:** actual vs advertised speed, % of tests under promise, monthly report.
- **Time-of-day heatmaps:** speed by hour/weekday per link to expose peak-hour throttling.
- **Best link recommendation:** best ISP at a given time of day; could feed a routing policy.
- **Correlation view:** do both links dip together (local/router issue) or only one (ISP issue)?
- **Load-balancing ratio hint:** suggest weights for multi-WAN from measured capacity.
- **Latency and DNS probes:** lightweight pings every minute per link to 1.1.1.1 / 8.8.8.8 for finer outage detection.
- **Public IP / ISP change tracking:** log external IP changes (CGNAT, DHCP).
- **Data-cap awareness:** track data consumed by tests per link; monthly budget.
- **Export:** CSV/JSON and a Prometheus `/metrics` endpoint.
- **Server pinning** per target; more engines (librespeed, custom HTTP).

## Open questions
1. **Interface binding check (still to do on your host):** same idea as `ping -I <interface>`, but for the speed test. The Ookla CLI accepts `--interface` and `--ip`; we verify on your host with a manual run before building on it. Nothing to decide now.
