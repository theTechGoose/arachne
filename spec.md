# Arachne

A Raspberry Pi job orchestrator. Define HTTP targets, chain them into flows, and let BullMQ handle the rest. Manage everything from the CLI over USB or WiFi.

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

Each target maps 1:1 to a BullMQ queue + worker. The worker fires the HTTP request and returns the response body. Arachne is a dumb pipe — it does not interpret what a failure means. The target controls retry eligibility via response headers:

| Response | Behavior |
|----------|----------|
| **2xx** | Step passed. Response body flows to the next step. |
| **Non-2xx** + `x-arachne-retryable: true` header | Transient failure. BullMQ retries up to `retries` count with exponential backoff. |
| **Non-2xx** without that header | Permanent failure. `UnrecoverableError` — job moves to failed, no retries. |

Retry options (`attempts`, `backoff`) are passed on each flow node's `opts`, not via `defaultJobOptions` (BullMQ ignores those for flow jobs).

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

### Flow

A flow is an ordered list of targets chained via BullMQ's flow producer. Data passes from one step to the next automatically based on the receiving step's HTTP method:

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

Jobs are retained for 72 hours (`removeOnComplete`, `removeOnFail`). This serves both dashboard visibility and the dedup window.

---

## API

The backend is a Deno HTTP server on port 3000. It reads target configs from `/opt/arachne/targets/` at startup.

### `GET /health`

Returns `"ok"` with status 200. Used by the deploy command to verify the service is running.

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
| `steps` | yes | Ordered list of target names |
| `payload` | no | `Partial<Target>` (excluding `name` and queue fields), merged into step 0 |
| `nonce` | no | Included in job ID hash — escape hatch to bypass dedup |
| `matureAt` | no | Delays execution until the given time |

Arachne validates all step names against existing targets, then builds the BullMQ flow. Each step runs in its target's queue with per-step retries.

#### Response

```json
{
  "flowId": "abc123",
  "jobs": [
    { "id": "sha256-...", "step": "fetch-audio", "queue": "fetch-audio" },
    { "id": "sha256-...", "step": "transcribe", "queue": "transcribe" },
    { "id": "sha256-...", "step": "summarize", "queue": "summarize" }
  ],
  "duplicate": false
}
```

`duplicate: true` when all job IDs already existed (idempotency dedup).

#### Merge rules (payload → step 0)

| Field | Strategy |
|-------|----------|
| `route` | Concat: `[...target.route, ...payload.route]` |
| `method` | Replace |
| `headers` | Spread merge: `{ ...target.headers, ...payload.headers }` |
| `query` | Spread merge: `{ ...target.query, ...payload.query }` |
| `body` | Replace |

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

First-boot initialization over USB. Sets up SSH key, installs and configures ngrok tunnels, installs fail2ban, installs Redis, cleans up login.

#### `arachne <pi> deploy`

Deploys to the Pi over SSH:

1. Copies `projects/backend/` → `/opt/arachne/backend/`
2. Copies `projects/ui/` → `/opt/arachne/ui/`
3. Copies `config/<pi>/targets/` → `/opt/arachne/targets/`
4. Installs Deno if needed
5. Writes and enables systemd services (`arachne-backend`, `arachne-ui`)
6. Restarts both services
7. Health-checks `GET /health` on port 3000

#### `arachne <pi> status`

Health dashboard: CPU temp/frequency, memory, disk, WiFi signal, ngrok tunnels, throttle state.

#### `arachne <pi> ui`

Opens Bull Board in the browser. SSH-forwards port 3001 on the Pi to a local port, then opens `localhost:<port>`. Keeps the tunnel alive until Ctrl-C.

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

- **ConfigStore** (`src/core/domain/data/config-file/mod.ts`) — currently reads a flat `config.json`. Needs to read the directory-based layout (`config/<pi>/connectivity.json`, `config/<pi>/users.json`).
- **Config DTO** (`src/core/dto/config.ts`) — `NgrokConfig`/`PiEntry` types need to match the per-file JSON shapes.
- **deploy command** — currently copies only backend source. Needs to also copy `config/<pi>/targets/` and `projects/ui/`, write two systemd services, and health-check on port 3000 instead of 80.
- **init command** — needs to install Redis (`apt-get install redis-server`).
- **ui command** — new command, not yet implemented.
