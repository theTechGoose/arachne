# Arachne

A remote Mac job orchestrator. Define HTTP targets, chain them into flows, and let BullMQ handle the rest. Manage everything from the CLI over SSH.

**Design principle:** The remote Mac is managed infrastructure. All durable configuration lives on the client in `config/<host>/`. Redis data is ephemeral job state.

```
Client Mac                       Remote Mac
+-----------+    SSH (ngrok)    +------------------------------------+
| arachne   | -----------------> /usr/local/var/arachne/             |
| CLI       |                  |   backend   :3000  (Deno + BullMQ)  |
+-----------+                  |   bull-board :3001  (fork, as-is)   |
                               | Redis       :6379                   |
                               | ngrok tunnels (LaunchDaemon)        |
                               +------------------------------------+
```

---

## Concepts

### Target

A named HTTP endpoint paired with a BullMQ queue. Defined as a JSON file in `config/<host>/targets/` on the client. The filename is the target name (`fetch-audio.json` -> `"fetch-audio"`).

```typescript
type Target = {
  host: string;                    // base URL -- e.g. "https://api.example.com"
  route: string[];                 // path segments joined with "/"
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers: Record<string, string>;
  query: Record<string, string>;   // default query params
  concurrency: number;
  timeoutMs: number;               // per-fetch, via AbortSignal.timeout()
  retries: number;                 // exponential backoff, 3 min base
};
```

Validated against this schema (Zod) at both deploy time (on the client) and backend startup (on the remote Mac). Invalid files cause immediate failure with file-specific error messages.

Each target maps 1:1 to a BullMQ queue + worker. The worker fires the HTTP request and returns the response body. Arachne is a dumb pipe -- it does not interpret what a failure means. The target controls retry eligibility via response headers:

| Response | Behavior |
|----------|----------|
| **2xx** | Step passed. Response body flows to the next step. |
| **Non-2xx** + `x-arachne-retryable: true` header | Transient failure. BullMQ retries up to `retries` count with exponential backoff. |
| **Non-2xx** without that header | Permanent failure. `UnrecoverableError` -- job moves to failed, no retries. |
| **Network error** (DNS, connection refused, TCP timeout, AbortSignal timeout) | Transient failure. BullMQ retries per the step's retry config. |

**Backoff formula:** Exponential, base delay 180,000ms (3 min), multiplier 2x, capped at 1,800,000ms (30 min). Configured per flow node as `opts.attempts = target.retries + 1` and `opts.backoff = { type: 'exponential', delay: 180_000 }`.

Retry options (`attempts`, `backoff`) are passed on each flow node's `opts`, not via `defaultJobOptions` (BullMQ ignores those for flow jobs).

**Target reload policy:** Targets are loaded once at startup. To update targets, redeploy via `arachne <host> deploy`, which restarts the backend service.

### Worker Execution

Each worker builds and executes a `fetch()` from its target config and job data:

```
URL    = target.host + "/" + target.route.join("/") + "?" + new URLSearchParams(query)
Method = target.method (or overridden by merge/chaining)
```

- `headers` -- target defaults, merged with any payload/chaining overrides
- `body` -- JSON-serialized, set only for POST/PUT/PATCH
- `query` -- target defaults, merged with any payload/chaining overrides
- Timeout via `AbortSignal.timeout(target.timeoutMs)`

The worker returns the parsed JSON response body. Non-JSON responses are returned as a string.

**Data passing between steps:** For step 0, the job's `data` field contains the merged payload (see merge rules below). For steps 1+, the worker calls `job.getChildrenValues()` to retrieve the previous step's return value, then applies the method-based merge rules:

- POST/PUT/PATCH: the previous response becomes the `body`.
- GET/DELETE: the previous response is spread into `query` params (values coerced via `String()`).

**Validation:** If a step returns a non-JSON response (string) and the next step's method is GET or DELETE, the job fails with `UnrecoverableError`. Query param spreading requires a flat key-value object.

### Flow

A flow is an ordered list of targets chained via BullMQ's flow producer. Steps are built as a BullMQ flow tree where the LAST step is the root (parent) and the FIRST step is the deepest leaf. BullMQ executes children before parents, so `steps: [A, B, C]` means A runs first, then B, then C.

Data passes from one step to the next based on the receiving step's HTTP method:

| Receiving method | How previous response is passed |
|------------------|--------------------------------|
| **POST / PUT / PATCH** | Previous response becomes `body` |
| **GET / DELETE** | Previous response is spread into `query` (values coerced via `String()`; nested objects/arrays fail the job) |

### Idempotency

BullMQ is the idempotency store. Each job ID is derived from the ingest payload:

```
jobId = SHA-256(canonicalize(body) + nonce + stepName)
```

- `body` -- canonicalized via RFC 8785 (`json-canonicalize`)
- `nonce` -- from the request's `nonce` field, empty string if absent
- `stepName` -- the target name for this step

`matureAt` is excluded -- idempotency is about *what* work is being done, not *when*.

| Scenario | Result |
|----------|--------|
| Same payload, no nonce | Same job IDs -- BullMQ skips, returns existing IDs |
| Same payload, different `nonce` | Different job IDs -- new flow created |
| Concurrent identical requests | BullMQ handles atomically -- only one flow created |

Jobs are retained for 24 hours (`removeOnComplete: { age: 86400 }`, `removeOnFail: { age: 86400 }`).

---

## API

The backend is a Deno HTTP server on port 3000. It reads target configs from `/usr/local/var/arachne/targets/` at startup.

### Startup Sequence

1. Load and Zod-validate all target JSON files. Fail immediately with file-specific errors if any are invalid.
2. Connect to Redis. Ping -- fail immediately if unreachable.
3. Verify Redis version >= 5.0 via `INFO server` (BullMQ requires Streams).
4. Log a warning if `maxmemory` is not configured in Redis.
5. Initialize BullMQ workers for each target.
6. Bind HTTP server on `BACKEND_PORT` (default 3000).

Failure at steps 1-5 exits with a non-zero code. launchd's `KeepAlive` handles restart.

### Graceful Shutdown

On SIGTERM:

1. Stop HTTP listener (reject new requests with 503).
2. Call `Worker.close()` on all workers (30-second timeout for in-flight HTTP fetches).
3. Close Redis connections.
4. Exit 0.

### `GET /health`

Returns JSON with status 200:

```json
{
  "status": "ok",
  "redis": true,
  "workers": 3
}
```

- `redis` -- result of a Redis PING at request time.
- `workers` -- count of active BullMQ workers.

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
| `payload` | no | Override fields merged into step 0 |
| `nonce` | no | Included in job ID hash -- escape hatch to bypass dedup |
| `matureAt` | no | ISO 8601 timestamp -- delays execution until the given time |

#### Merge Rules (payload -> step 0)

| Field | Strategy |
|-------|----------|
| `route` | Concat: `[...target.route, ...payload.route]` |
| `method` | Replace |
| `headers` | Spread merge: `{ ...target.headers, ...payload.headers }` |
| `query` | Spread merge: `{ ...target.query, ...payload.query }` |
| `body` | Replace (initial request body for step 0 only) |

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

#### Error Responses

```json
{ "error": "<CODE>", "message": "<description>", "statusCode": 400 }
```

| Code | HTTP Status | Cause |
|------|-------------|-------|
| `INVALID_STEP` | 400 | Step names don't match any loaded target |
| `EMPTY_STEPS` | 400 | `steps` array is empty or missing |
| `INVALID_PAYLOAD` | 422 | Payload fails validation |
| `INVALID_DATE` | 422 | `matureAt` is not valid ISO 8601 or is in the past |
| `REDIS_UNAVAILABLE` | 503 | Redis connection is down |
| `FLOW_CREATION_FAILED` | 500 | BullMQ `FlowProducer.add()` threw |

---

## UI

Fork of [Bull Board](https://github.com/felixmosh/bull-board) deployed as-is in `projects/ui`. No custom code. Runs as a separate process on port 3001, connected to the same Redis instance.

Provides: queue list with job counts by state, job inspection (data, return value, logs, timestamps), manual retry / promote / remove, pause / resume queues, real-time updates.

Accessed via `arachne <host> ui` -- SSH port-forwards port 3001 to localhost and opens the browser.

---

## CLI

Remote Mac management over SSH.

```
arachne <host> [command]
```

`<host>` maps to a directory under `config/` (e.g., `arachne monster` reads `config/monster/`). Connection uses the ngrok TCP tunnel defined in `connectivity.json`.

### Config Layout

```
config/
  <host>/
    connectivity.json       <- ngrok tcp/http endpoints
    users.json              <- ngrok basic auth credentials
    targets/
      <name>.json           <- one target per file
```

- `connectivity.json` -> `{ tcp: string, http: string }`
- `users.json` -> `{ credentials: string[] }`
- `targets/*.json` -> validated against Target schema

### Remote Mac Filesystem

```
/usr/local/var/arachne/
  backend/                    <- deployed from projects/backend
  ui/                         <- deployed from projects/ui
  targets/                    <- deployed from config/<host>/targets/
  logs/                       <- backend/ui stdout/stderr logs
```

Services managed via launchd:
- `/Library/LaunchDaemons/com.arachne.backend.plist`
- `/Library/LaunchDaemons/com.arachne.ui.plist`
- `/Library/LaunchDaemons/com.ngrok.tunnel.plist`

### Commands

#### `arachne install --host`

Run locally on a new Mac to set up everything from scratch. Interactive walkthrough:

1. Prompts for: host name, ngrok TCP URL, ngrok HTTP URL, basic auth credentials, ngrok authtoken
2. Creates `config/<name>/` with `connectivity.json`, `users.json`, `targets/`
3. Installs Homebrew, ngrok, Redis, Deno (idempotent -- skips if already installed)
4. Configures ngrok with authtoken and tunnel definitions
5. Writes ngrok LaunchDaemon (starts on boot, auto-restarts)
6. Enables Remote Login (SSH), disables sleep
7. Creates `/usr/local/var/arachne/` directory structure
8. Restarts all services
9. Verifies tunnels are reachable
10. Prints the `--client` command for the developer's machine

#### `arachne install --client="user@host:port"`

Run on the developer's Mac to pull config from an already-configured host.

1. Generates SSH key (`~/.ssh/arachne_ed25519`) if missing
2. Copies key to host via `ssh-copy-id` (prompts for password once)
3. SSHes in, discovers and reads `config/<name>/` from the host's repo
4. Copies `connectivity.json` and `users.json` to local `config/<name>/`

#### `arachne <host>`

Opens an interactive SSH session.

#### `arachne <host> deploy [--dry-run] [--fresh]`

Deploys to the remote Mac over SSH.

**Pre-deploy validation:** Validates all target JSON files against the Target schema.

**Copy stages:**
1. `projects/backend/` -> `/usr/local/var/arachne/backend/`
2. `projects/ui/` -> `/usr/local/var/arachne/ui/`
3. `config/<host>/targets/` -> `/usr/local/var/arachne/targets/`

**Post-copy:**
4. Detects Deno path (installs via `brew install deno` if missing)
5. Runs `deno cache` to pre-compile dependencies
6. Writes launchd plists for backend and UI services
7. Loads services via `launchctl`
8. Health-checks `GET http://localhost:3000/health` with retries

| Flag | Description |
|------|-------------|
| `--dry-run` | Validate config + show deployment plan without executing |
| `--fresh` | SIGTERM backend, wait for drain, unload services, wipe app dirs (never Redis data), then deploy fresh |

#### `arachne <host> status`

Health dashboard showing: hostname, uptime, memory (via `vm_stat`/`sysctl`), disk, load average, ngrok status (via `launchctl`), backend health (`/health` endpoint).

**Threshold warnings:**

| Metric | Warning Threshold |
|--------|-------------------|
| CPU temperature | > 95C |
| Memory usage | > 85% |
| Disk usage | > 85% |

Exit code 1 when any warning threshold is exceeded.

#### `arachne <host> ui [--port N] [--no-open]`

Opens Bull Board in the browser:

1. Checks local port 3001 is available (or uses `--port <N>`)
2. SSH-forwards remote port 3001 to localhost
3. Opens browser (skip with `--no-open`)
4. Keeps tunnel alive until Ctrl-C

---

## Project Structure

```
arachne/
  deno.json                   <- workspace root
  spec.md                     <- this file
  projects/
    cli/                      <- Mac management CLI (Deno)
    backend/                  <- Deno + BullMQ + Redis
    ui/                       <- Bull Board fork (as-is)
```
