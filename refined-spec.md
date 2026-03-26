# Arachne

A Raspberry Pi job orchestrator. Define HTTP targets, chain them into flows, and let BullMQ handle the rest. Manage everything from the CLI over USB or WiFi.

**Design principle:** The Pi is disposable infrastructure. All durable configuration lives on the Mac in `config/<pi>/`. Redis data is ephemeral job state. A dead SD card is recoverable with `setup` + `init` + `deploy` on fresh hardware in under 15 minutes.

```
Mac                              Pi
┌─────────────┐    USB/WiFi    ┌────────────────────────────────────┐
│  arachne    │ ─────────────► │  /opt/arachne/                     │
│  CLI        │    SSH         │    backend   :3000  (Deno + BullMQ)│
│             │                │    bull-board :3001  (fork, as-is)  │
└─────────────┘                │  Redis       :6379                  │
                               │  ngrok tunnels                      │
                               └────────────────────────────────────┘
```

---

## Concepts

### Target

A named HTTP endpoint paired with a BullMQ queue. Defined as a JSON file in `config/<pi>/targets/` on the Mac. The filename is the target name (`fetch-audio.json` → `"fetch-audio"`).

```typescript
type Target = {
  host: string;                    // base URL — e.g. "https://api.example.com"
  route: string[];                 // path segments joined with "/"
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers: Record<string, string>;
  query: Record<string, string>;   // default query params
  concurrency: number;
  timeoutMs: number;               // per-fetch, via AbortSignal.timeout()
  retries: number;                 // exponential backoff, 3 min base
};
```

Target JSON files are validated against this schema at both deploy time (on the Mac) and backend startup (on the Pi) using Zod. Invalid files cause immediate failure with file-specific error messages.

Each target maps 1:1 to a BullMQ queue + worker. The worker fires the HTTP request and returns the response body. Arachne is a dumb pipe — it does not interpret what a failure means. The target controls retry eligibility via response headers:

| Response | Behavior |
|----------|----------|
| **2xx** | Step passed. Response body flows to the next step. |
| **Non-2xx** + `x-arachne-retryable: true` header | Transient failure. BullMQ retries up to `retries` count with exponential backoff. |
| **Non-2xx** without that header | Permanent failure. `UnrecoverableError` — job moves to failed, no retries. |
| **Network error** (DNS failure, connection refused, TCP timeout, AbortSignal timeout) | Transient failure. Worker throws a standard Error (not UnrecoverableError), allowing BullMQ to retry per the step's retry config. |

Permanent failures (non-2xx without retryable header) are logged to journald with the target name, HTTP status code, and truncated response body (first 500 characters).

Retry options (`attempts`, `backoff`) are passed on each flow node's `opts`, not via `defaultJobOptions` (BullMQ ignores those for flow jobs).

**Backoff formula:** Exponential, base delay 180,000ms (3 min), multiplier 2x, capped at 1,800,000ms (30 min). Configured per flow node as `opts.attempts = target.retries + 1` and `opts.backoff = { type: 'exponential', delay: 180_000 }`.

**Target reload policy:** Targets are loaded once at startup. To update targets, redeploy via `arachne <pi> deploy`, which restarts the backend service.

### Worker execution

Each worker builds and executes a `fetch()` from its target config and job data:

```
URL    = target.host + "/" + target.route.join("/") + "?" + new URLSearchParams(query)
Method = target.method (or overridden by merge/chaining)
```

- `headers` — target defaults, merged with any payload/chaining overrides
- `body` — JSON-serialized, set only for POST/PUT/PATCH
- `query` — target defaults, merged with any payload/chaining overrides
- Timeout via `AbortSignal.timeout(target.timeoutMs)`

The worker returns the parsed JSON response body. Non-JSON responses are returned as a string.

**Data passing between steps:** For step 0, the job's `data` field contains the merged payload (see merge rules below). For steps 1+, the worker calls `job.getChildrenValues()` to retrieve the previous step's return value, then applies the method-based merge rules:

- If the current step's method is POST/PUT/PATCH, the previous response becomes the `body`.
- If the current step's method is GET/DELETE, the previous response is spread into `query` params (values coerced via `String()`).

**Validation:** If a step returns a non-JSON response (string) and the next step's method is GET or DELETE, the job fails with `UnrecoverableError`. Query param spreading requires a flat key-value object.

### Flow

A flow is an ordered list of targets chained via BullMQ's flow producer. Steps are built as a BullMQ flow tree where the LAST step is the root (parent) and the FIRST step is the deepest leaf. BullMQ executes children before parents, so `steps: [A, B, C]` means A runs first, then B, then C. Each step is a child of the step after it.

Data passes from one step to the next automatically based on the receiving step's HTTP method:

| Receiving method | How previous response is passed |
|------------------|--------------------------------|
| **POST / PUT / PATCH** | Previous response becomes `body` |
| **GET / DELETE** | Previous response is spread into `query` (values coerced via `String()`; nested objects/arrays fail the job) |

### Idempotency

BullMQ is the idempotency store. Each job ID is derived from the ingest payload:

```
jobId = SHA-256(canonicalize(body) + nonce + stepName)
```

- `body` — canonicalized via RFC 8785 (`json-canonicalize`)
- `nonce` — from the request's `nonce` field, empty string if absent
- `stepName` — the target name for this step

`matureAt` is excluded — idempotency is about *what* work is being done, not *when*.

| Scenario | Result |
|----------|--------|
| Same payload, no nonce | Same job IDs → BullMQ skips, returns existing IDs |
| Same payload, different `nonce` | Different job IDs → new flow created |
| Concurrent identical requests | BullMQ handles atomically — only one flow created |

**Recovery path:** `FlowProducer.add()` uses a single Redis `MULTI/EXEC` transaction — either all jobs are created or none are. If flow creation succeeds but the HTTP response to the client fails (network error), the client can safely re-ingest the same payload. The idempotency hash ensures BullMQ returns existing job IDs with `duplicate: true`.

Jobs are retained for 24 hours (`removeOnComplete: { age: 86400 }`, `removeOnFail: { age: 86400 }`). This serves both dashboard visibility and the dedup window. The 24-hour window (rather than 72 hours) is chosen to stay within the Pi's 256MB Redis memory budget under continuous load.

---

## API

The backend is a Deno HTTP server on port 3000. It reads target configs from `/opt/arachne/targets/` at startup.

### Startup sequence

1. Load and Zod-validate all target JSON files from `/opt/arachne/targets/`. Fail immediately with file-specific errors if any are invalid. Do NOT skip invalid files.
2. Connect to Redis. Ping it — fail immediately if unreachable.
3. Verify Redis version >= 5.0 via `INFO server` (BullMQ requires Streams). Fail if too old.
4. Log a warning if `maxmemory` is not configured in Redis.
5. Initialize BullMQ workers for each target.
6. Bind HTTP server on `BACKEND_PORT` (default 3000).

Failure at steps 1-5 exits with a non-zero code. Systemd's `Restart=on-failure` handles restart.

### Graceful shutdown

On SIGTERM:

1. Stop HTTP listener (reject new requests with 503).
2. Call `Worker.close()` on all workers (30-second timeout for in-flight HTTP fetches).
3. Close Redis connections.
4. Exit 0.

`TimeoutStopSec=45` in the systemd unit gives 45 seconds for this sequence before SIGKILL.

### `GET /health`

Returns JSON with status 200:

```json
{
  "status": "ok",
  "redis": true,
  "workers": 3
}
```

- `redis` — result of a Redis PING at request time.
- `workers` — count of active BullMQ workers.

If Redis is unreachable, returns `{ "status": "degraded", "redis": false, "workers": 0 }` with status 503.

### `POST /ingest`

Create a flow.

```json
{
  "steps": ["fetch-audio", "transcribe", "summarize"],
  "payload": { "url": "https://example.com/audio.mp3" },
  "nonce": "abc123",
  "matureAt": "2026-03-25T00:00:00Z"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `steps` | yes | Ordered list of target names (non-empty) |
| `payload` | no | Override fields merged into step 0 (see IngestPayload type and merge rules) |
| `nonce` | no | Included in job ID hash — escape hatch to bypass dedup |
| `matureAt` | no | ISO 8601 timestamp — delays execution until the given time |

**IngestPayload type:**

```typescript
type IngestPayload = {
  route?: string[];
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
};
```

`host`, `concurrency`, `timeoutMs`, and `retries` cannot be overridden via payload — these are target-level configuration only. `body` is the initial request body for step 0 only; it is not a Target config field. Subsequent steps receive their body from the previous step's response.

Arachne validates all step names against existing targets, then builds the BullMQ flow. Each step runs in its target's queue with per-step retries.

#### Response

```json
{
  "flowId": "sha256-...",
  "jobs": [
    { "id": "sha256-...", "step": "fetch-audio", "queue": "fetch-audio" },
    { "id": "sha256-...", "step": "transcribe", "queue": "transcribe" },
    { "id": "sha256-...", "step": "summarize", "queue": "summarize" }
  ],
  "duplicate": false
}
```

- `flowId` — the root job's ID (the last step in the chain). This is the ID returned by `FlowProducer.add()` for the root node.
- `duplicate: true` when all job IDs already existed (idempotency dedup).

#### Error responses

All errors use a consistent envelope:

```json
{
  "error": "<CODE>",
  "message": "<human-readable description>",
  "statusCode": 400
}
```

| Code | HTTP Status | Cause |
|------|-------------|-------|
| `INVALID_STEP` | 400 | One or more step names do not match any loaded target |
| `EMPTY_STEPS` | 400 | `steps` array is empty or missing |
| `INVALID_PAYLOAD` | 422 | Payload fails validation (wrong types, disallowed fields) |
| `INVALID_DATE` | 422 | `matureAt` is not a valid ISO 8601 date or is in the past |
| `REDIS_UNAVAILABLE` | 503 | Redis connection is down |
| `FLOW_CREATION_FAILED` | 500 | BullMQ `FlowProducer.add()` threw an unexpected error |

#### Merge rules (payload → step 0)

| Field | Strategy |
|-------|----------|
| `route` | Concat: `[...target.route, ...payload.route]` |
| `method` | Replace |
| `headers` | Spread merge: `{ ...target.headers, ...payload.headers }` |
| `query` | Spread merge: `{ ...target.query, ...payload.query }` |
| `body` | Replace (initial request body for step 0 only) |

---

## UI

Fork of [Bull Board](https://github.com/felixmosh/bull-board) deployed as-is in `projects/ui`. No custom code. Runs as a separate process on port 3001, connected to the same Redis instance.

Provides: queue list with job counts by state, job inspection (data, return value, logs, timestamps), manual retry / promote / remove, pause / resume queues, real-time updates.

Accessed via `arachne <pi> ui` — SSH port-forwards port 3001 to localhost and opens the browser. SSH is the auth layer; no extra credentials needed.

---

## CLI

Raspberry Pi management over USB or WiFi.

```
arachne <pi> [command] [options]
```

`<pi>` maps to a directory under `config/` (e.g. `arachne pi` reads `config/pi/`). Transport is auto-detected via ARP lookup — falls back to WiFi if USB is unavailable. Output is prefixed with `[usb]` or `[wifi]`.

**Unknown subcommand handling:** If `args[1]` is present and does not match a known command or flag, compute Levenshtein distance against known commands and emit a "did you mean X?" suggestion instead of silently opening an SSH session.

### Global options

| Flag | Description |
|------|-------------|
| `-u, --via-usb` | Force USB transport |
| `-w, --via-wifi` | Force WiFi transport |

### Mac-side config layout

```
projects/cli/
  .env                        ← NGROK_AUTHTOKEN
  config/
    <pi>/
      connectivity.json       ← ngrok tcp/http endpoints
      users.json              ← ngrok basic auth credentials
      targets/
        <name>.json           ← one target per file
```

**ConfigStore** reads the directory-based layout:
- `connectivity.json` → `ConnectivityConfig { tcp: string; http: string }`
- `users.json` → `UsersConfig { credentials: string[] }`
- `targets/*.json` → `Map<string, Target>` (filename minus `.json` is the target name)

### Pi-side filesystem layout

```
/opt/arachne/
  backend/                    ← backend source (deployed from projects/backend)
  ui/                         ← bull board source (deployed from projects/ui)
  targets/                    ← target configs (deployed from config/<pi>/targets/)
```

The backend reads `REDIS_HOST`, `REDIS_PORT`, and `BACKEND_PORT` from env vars (defaults: `localhost`, `6379`, `3000`). Auth is ngrok basic auth at the tunnel level using credentials from `users.json` — no app-level auth.

### Commands

#### `arachne <pi>`

Opens an interactive SSH session.

#### `arachne <pi> setup`

Configures a freshly-flashed DietPi SD card. Patches `dietpi.txt`, copies the automation script, enables USB gadget mode. Run on the Mac before first boot.

#### `arachne <pi> init`

First-boot initialization over USB:

1. Sets up SSH key
2. Installs and configures ngrok tunnels (with its own systemd unit: `Restart=always`, `After=network-online.target`)
3. Installs fail2ban
4. Installs Redis:
   - `apt-get install -y redis-server`
   - Configures `/etc/redis/redis.conf`:
     ```
     maxmemory 256mb
     maxmemory-policy allkeys-lru
     save 300 1
     appendonly no
     ```
   - `systemctl enable redis-server`
   - Verifies with `redis-cli ping` (5-second retry loop)
5. Configures journald: sets `SystemMaxUse=100M` in `/etc/systemd/journald.conf`
6. Cleans up login

The Redis configuration is critical for Pi longevity: `maxmemory 256mb` prevents OOM on 1GB devices, `allkeys-lru` evicts old data under pressure as a safety net, `appendonly no` with periodic RDB snapshots (`save 300 1`) protects SD card write cycles. Accept that a crash loses at most 5 minutes of job state — callers can re-ingest.

#### `arachne <pi> deploy`

Deploys to the Pi over SSH.

**Pre-deploy validation:**
- Verify `config/<pi>/targets/` exists and contains at least one `.json` file
- Validate every target JSON file against the Target schema. Fail fast with file-specific errors.

**Copy stages (with per-step timing output):**
1. Copies `projects/backend/` → `/opt/arachne/backend/`
2. Copies `projects/ui/` → `/opt/arachne/ui/`
3. Copies `config/<pi>/targets/` → `/opt/arachne/targets/`

**Post-copy:**
4. Installs Deno if needed
5. Runs `deno cache` to pre-compile dependencies
6. Writes and enables systemd services:
   - `arachne-backend.service`:
     ```ini
     [Unit]
     Description=Arachne Backend
     After=redis-server.service
     Requires=redis-server.service

     [Service]
     Type=simple
     ExecStart=/root/.deno/bin/deno run -A /opt/arachne/backend/main.ts
     Restart=on-failure
     RestartSec=5
     StartLimitBurst=5
     StartLimitIntervalSec=60
     TimeoutStopSec=45

     [Install]
     WantedBy=multi-user.target
     ```
   - `arachne-ui.service`:
     ```ini
     [Unit]
     Description=Arachne Bull Board UI
     After=redis-server.service

     [Service]
     Type=simple
     ExecStart=/root/.deno/bin/deno run -A /opt/arachne/ui/main.ts
     Restart=on-failure
     RestartSec=5
     StartLimitBurst=5
     StartLimitIntervalSec=60
     TimeoutStopSec=10

     [Install]
     WantedBy=multi-user.target
     ```
7. Restarts both services
8. Health-checks `GET http://localhost:3000/health` (retries for up to 15 seconds)

| Flag | Description |
|------|-------------|
| `--dry-run` | Validate config + show deployment plan without executing |
| `--fresh` | Drain sequence: SIGTERM backend → wait 30s for drain → stop all services → wipe `/opt/arachne/` app dirs (never Redis data) → deploy fresh |

#### `arachne <pi> status`

Health dashboard: CPU temp/frequency, memory, disk, WiFi signal, ngrok tunnels, throttle state.

**Backend health:** Hits `localhost:3000/health` and displays `Backend: ok (N workers)` or `Backend: unreachable`.

**Threshold warnings:**

| Metric | Warning Threshold |
|--------|-------------------|
| CPU temperature | > 70C |
| Memory usage | > 85% |
| Disk usage | > 85% |

Exit code 1 when any warning threshold is exceeded. This makes `status` scriptable for external monitoring.

#### `arachne <pi> ui`

Opens Bull Board in the browser:

1. Checks that local port 3001 is available (or uses `--port <N>` override)
2. SSH-forwards Pi port 3001 to `localhost:3001` (foreground process)
3. Opens `http://localhost:3001` in the default browser (macOS `open`)
4. Keeps the tunnel alive until Ctrl-C

| Flag | Description |
|------|-------------|
| `--port <N>` | Override local port (default 3001) |
| `--no-open` | Skip automatic browser launch |

#### `arachne <pi> wifi`

Manage WiFi networks. Interactive menu or subcommands:

| Subcommand | Description |
|------------|-------------|
| `wifi add [ssid] [password]` | Add a network (defaults to current Mac SSID) |
| `wifi list` | List saved networks |
| `wifi remove <ssid>` | Remove a network |
| `wifi reset` | Wipe all WiFi config (USB only) |

#### `arachne <pi> overclock`

Auto-tune or set overclock level (1–5). Runs 10-minute stress tests per level with temperature monitoring and a dead man's switch that reverts settings if the Pi crashes.

The dead man's switch check runs as a `Before=` dependency of `arachne-backend.service` — the backend does not start until overclock state is confirmed stable after a crash/reboot.

| Subcommand | Description |
|------------|-------------|
| `overclock [level]` | Set a specific level |
| `overclock --resume` | Resume auto-tune from current level |
| `overclock status` | Show current level and temperature |

---

## Project structure

```
arachne/
  deno.json                   ← workspace root
  projects/
    cli/                      ← Pi management CLI (Deno)
    backend/                  ← Deno + BullMQ + Redis (rewrite — new target/flow architecture)
    ui/                       ← Bull Board fork (as-is)
```

---

## CLI modifications needed

The existing CLI (`projects/cli/`) needs these changes to match this spec:

- **ConfigStore** (`src/core/domain/data/config-file/mod.ts`) — currently reads a flat `config.json`. Rewrite to read the directory-based layout: `config/<pi>/connectivity.json` → `ConnectivityConfig { tcp, http }`, `config/<pi>/users.json` → `UsersConfig { credentials }`. Add `loadTargets(target): Map<string, Target>` that reads and validates all `config/<pi>/targets/*.json`.
- **Config DTO** (`src/core/dto/config.ts`) — Replace `NgrokConfig`/`PiEntry` types with `ConnectivityConfig`, `UsersConfig`, and `Target` types matching the per-file JSON shapes.
- **deploy command** — Rewrite with: pre-deploy target validation, three copy stages with timing output, `deno cache` step, two systemd service units (with restart policies), health check on port 3000. Add `--dry-run` and `--fresh` flags.
- **init command** — Add Redis installation and configuration (`maxmemory 256mb`, `maxmemory-policy allkeys-lru`, `appendonly no`, `save 300 1`), journald `SystemMaxUse=100M`, and ngrok systemd unit with `Restart=always`.
- **ui command** — New command: SSH port-forward 3001, port availability check, browser open, `--port` and `--no-open` flags.
- **status command** — Add backend health check (`localhost:3000/health`), threshold warnings (CPU >70C, Mem >85%, Disk >85%), exit code 1 on warnings.
- **Unknown subcommand handling** — Levenshtein distance suggestions instead of silently opening SSH.
