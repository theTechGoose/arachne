# Arachne Quickstart

Arachne is a job orchestration server. You send it a list of named steps and it
fires off HTTP requests in order — automatically passing each response into the
next step.

---

## Setup (one time)

You'll need [Deno](https://deno.com) installed. Then from the repo root:

```bash
deno task install
```

This installs the `arachne` CLI globally. Then run:

```bash
arachne install --client="raphaelcastro@3.tcp.ngrok.io:21045"
```

This generates your SSH key, copies it to the server, and pulls the host config
down to your machine. You won't need to touch keys or tunnels again.

---

## Accessing the API

```bash
arachne monster ui
```

That's it. Opens a tunnel and launches your browser automatically. Everything
is available at `http://localhost:3001`:

| URL | What it is |
|-----|------------|
| `http://localhost:3001/docs` | Swagger UI — interact with the API here |
| `http://localhost:3001/ui` | Bull Board — monitor queues and jobs |
| `http://localhost:3001/steps` | List of available step names |
| `http://localhost:3001/health` | Server health |

Press `Ctrl-C` when you're done to close the tunnel.

> **Without the CLI** — you can still reach the API manually:
> ```bash
> ssh -i ~/.ssh/arachne_ed25519 -p 21045 raphaelcastro@3.tcp.ngrok.io \
>   -L 3000:localhost:3000 -N
> ```
> Then use `http://localhost:3000` instead.

---

## Targets

A **target** is a named HTTP destination. Each target is a JSON file on the
server at `~/arachne/targets/<name>.json`. The filename (without `.json`) is
the step name used in requests.

```json
{
  "host": "https://api.example.com",
  "route": ["users", "search"],
  "method": "POST",
  "headers": { "Authorization": "Bearer token" },
  "query": { "version": "2" },
  "concurrency": 5,
  "timeoutMs": 10000,
  "retries": 3
}
```

| Field | Type | Description |
|-------|------|-------------|
| `host` | `string` | Base URL — must include protocol, no trailing slash |
| `route` | `string[]` | Path segments joined with `/` — e.g. `["users","search"]` → `/users/search` |
| `method` | `string` | HTTP method: `GET`, `POST`, `PUT`, `PATCH`, or `DELETE` |
| `headers` | `object` | Default request headers — key/value strings |
| `query` | `object` | Default query params — key/value strings |
| `concurrency` | `number` | Max parallel jobs for this target (positive integer) |
| `timeoutMs` | `number` | Request timeout in milliseconds (positive integer) |
| `retries` | `number` | Max retry attempts on failure (0 = no retries) |

All fields are required. `headers` and `query` can be empty objects `{}`.

Currently loaded: `sample`, `webhook`, `webhooks`

---

## Send Your First Job

Open Swagger at **`http://localhost:3001/docs`**, click **POST /ingest**,
click **Try it out**, and paste a request body.

Minimal request:

```json
{
  "steps": ["sample"]
}
```

Response:

```json
{
  "flowId": "abc123...",
  "jobs": [{ "id": "abc123...", "step": "sample", "queue": "sample" }],
  "duplicate": false
}
```

> **Prefer curl?**
> ```bash
> curl -X POST http://localhost:3001/ingest \
>   -H "Content-Type: application/json" \
>   -d '{ "steps": ["sample"] }'
> ```

---

## Override the Request (payload)

Use `payload` to customize what gets sent for the first step. Everything in
`payload` is merged on top of the target's defaults.

```json
{
  "steps": ["sample"],
  "payload": {
    "method": "POST",
    "route": ["extra", "path"],
    "query": { "env": "prod" },
    "headers": { "x-custom": "value" },
    "body": { "key": "value" }
  }
}
```

| Field | Behavior |
|-------|----------|
| `route` | Appended to the target's base route |
| `headers` | Merged — your values override the target's |
| `query` | Merged — your values override the target's |
| `method` | Replaces the target's method |
| `body` | Sent as JSON body (POST / PUT / PATCH only) |

---

## Multi-Step Flows

Steps run left to right. Each step's HTTP response is automatically passed into
the next step as input.

```json
{ "steps": ["fetch", "transform", "deliver"] }
```

How the response is piped:

- Next step is **POST / PUT / PATCH** → previous response becomes the **request body**
- Next step is **GET / DELETE** → previous response spreads into **query params**
  *(must be a flat key/value object — nested or array responses will fail permanently)*

`payload` overrides only apply to the first step. The rest use whatever flowed
in from the step before.

---

## Schedule a Job

Pass `matureAt` to hold the job until a specific time:

```json
{
  "steps": ["sample"],
  "matureAt": "2026-04-01T09:00:00Z"
}
```

Must be a future ISO 8601 datetime. The job sits in the queue until then.

---

## Deduplication and Nonce

Arachne generates a deterministic job ID from the request body and step name.
Submitting the same request twice will be detected as a duplicate — BullMQ
skips re-queuing it and returns `"duplicate": true`.

To force a new job despite an identical body, add a `nonce`:

```json
{
  "steps": ["sample"],
  "nonce": "run-2"
}
```

A different nonce = a different job ID = a new job, always.

---

## Retries

Retry behavior is configured per target via the `retries` field. Failed jobs
retry with exponential backoff starting at 3 minutes.

To signal that a failure is retryable, return this header from your server:

```
x-arachne-retryable: true
```

Any non-2xx response **without** that header is a permanent failure — no retry.
You can inspect and manually retry failed jobs in Bull Board.

---

## Add a New Target

1. SSH into the Mac:
   ```bash
   ssh -i ~/.ssh/arachne_ed25519 -p 21045 raphaelcastro@3.tcp.ngrok.io
   ```
2. Create a JSON file in `~/arachne/targets/my-target.json`
3. Restart the backend:
   ```bash
   launchctl unload ~/Library/LaunchAgents/com.arachne.backend.plist
   launchctl load  ~/Library/LaunchAgents/com.arachne.backend.plist
   ```
4. Confirm it loaded: `curl http://localhost:3000/steps`

---

## Monitor Jobs (Bull Board)

Open **`http://localhost:3001/ui`** to see every queue in real time.

| State | Meaning |
|-------|---------|
| Waiting | Queued, not yet picked up |
| Active | Currently executing |
| Completed | Finished successfully (kept 24 hours) |
| Failed | Hit max retries or permanent failure |
| Delayed | Scheduled via `matureAt` |

You can inspect job data, view responses, and manually retry failed jobs here.
