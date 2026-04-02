# SFTP Plan

## What We Built

### 1. ngrok LaunchDaemon Plist (install-host)

The Mac needs ngrok running at all times so it stays reachable from the
internet. Without it, SFTP dies on every reboot.

Added to `InstallHostCoordinator`:
- Creates `/usr/local/var/arachne/logs/` directory (already handled in Phase 5)
- Writes the ngrok plist to a temp file then sudo copies it to
  `/Library/LaunchDaemons/com.ngrok.tunnel.plist`
- macOS reads that file on boot and keeps ngrok alive automatically

To apply: SSH into the Mac and run `arachne install --host`.

---

### 2. SFTP Permission

Added `"sftp"` as a valid permission to the Arachne user system.

Files changed:
- `projects/backend/dto/user.ts` — `Permission = "auth" | "queue" | "sftp"`
- `projects/backend/entrypoints/users-controller.ts` — added `sftp` to the
  valid permissions check in both create and update
- `projects/backend/bootstrap.ts` — Swagger docs updated to show `sftp`

---

### 3. SFTP Server

Arachne runs its own SFTP server on port 2222. No OS-level user accounts,
no sshd config, no chroot setup required. The server handles everything
internally.

File: `projects/backend/entrypoints/sftp-server.ts`

How it works:
- Listens on port 2222 (override with `SFTP_PORT` env var)
- On first start, generates an RSA host key at `~/arachne/host_key` and
  reuses it forever
- When a client connects, validates username and password against Arachne's
  user system — rejects if the user doesn't have the `sftp` permission
- Every file operation is scoped to `~/arachne/sftp/<username>/` — path
  traversal is blocked in code, users cannot navigate above their folder
- The user's directory is created automatically on first file upload

Wired into `projects/backend/bootstrap.ts` — starts alongside the HTTP
server on every deploy.

To give a user SFTP access: `PUT /users/<username>` with
`{ "permissions": ["sftp"] }` (or whatever permissions they already have
plus sftp). They can then SFTP in on port 2222 with their Arachne
credentials. Files land in `~/arachne/sftp/<username>/`.

---

## What's Next

### 4. Folder-Watching Daemon

A background process that watches `~/arachne/sftp/` for new files. When
a file appears:
1. Uploads it to S3
2. Recursively deletes the file and any empty folders left behind

Needs: AWS credentials, S3 bucket name configured via env vars.

### 5. Webhook Config UI

Admin panel (likely a new HTTP endpoint + simple UI) to configure rules:
- File path pattern (e.g. `*/recordings/*.mp3`)
- Webhook URL to call when a matching file is uploaded to S3
- Rules stored in Redis

When the daemon uploads a file, it checks the rules and fires matching
webhooks.

### 6. S3 Delete Cloud Function

A small serverless function (AWS Lambda) that takes a file path and deletes
it from S3. Called externally when a recording needs to be removed.
