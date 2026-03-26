# Arachne: Pi → Mac Migration Plan

Convert arachne from Raspberry Pi (DietPi Linux) to remote MacBook Air managed over SSH via ngrok.

---

## New CLI Surface

```
arachne install --host                          # run ON the host Mac (local, interactive)
arachne install --client="user@host:port"       # run on the client Mac (pulls config over SSH)
arachne <host>                                  # interactive SSH
arachne <host> deploy [--dry-run] [--fresh]     # deploy backend + targets
arachne <host> status                           # health dashboard
arachne <host> ui [--port N] [--no-open]        # Bull Board via SSH tunnel
```

### Removed commands

`setup`, `init`, `wifi`, `overclock` — all Pi-specific, replaced by `install`.

### Removed global flags

`--via-usb, -u` and `--via-wifi, -w` — single transport (ngrok SSH).

---

## Install Flow

### Host side: `arachne install --host`

Runs locally on the new Mac. No SSH needed. Interactive walkthrough:

```
Name for this host: monster
TCP URL (ngrok fixed address): 3.tcp.ngrok.io:21045
HTTP URL (ngrok domain): deploy.ngrok.app
First basic auth user (user:pass): admin:secretpass
ngrok authtoken: 2Iqk3...

Setting up monster...
  brew          installed
  ngrok         installed + configured
  ngrok         LaunchDaemon loaded (starts on boot)
  redis         installed + running
  deno          installed
  ssh           Remote Login enabled
  app dirs      created
  config/       created

Restarting services...
  ngrok         restarted
  redis         restarted

Verifying tunnels...
  TCP           3.tcp.ngrok.io:21045 ✔
  HTTP          deploy.ngrok.app ✔

Done. On your client machine run:

  deno task install --client="raphaelcastro@3.tcp.ngrok.io:21045"
```

**What it does (idempotent — every step is guarded):**

Phase 1: Config
  1. Prompt for name, TCP URL, HTTP URL, basic auth user, ngrok authtoken
  2. Create `config/<name>/connectivity.json`
  3. Create `config/<name>/users.json`
  4. Write `.env` with `NGROK_AUTHTOKEN`

Phase 2: Dependencies (all guarded with `which <bin> || install`)
  5. Install Homebrew
  6. Ensure brew is in PATH (if not, use absolute `/opt/homebrew/bin/brew`)
  7. `brew install ngrok`
  8. `brew install redis`
  9. `brew install deno`

Phase 3: Configure ngrok
  10. `ngrok config add-authtoken <token>`
  11. Write ngrok config YAML via `NgrokConfigBuilder` (TCP tunnel for SSH, HTTP tunnel for backend)
  12. Write `/Library/LaunchDaemons/com.ngrok.tunnel.plist` (KeepAlive, RunAtLoad)

Phase 4: Configure Redis
  13. Edit `/opt/homebrew/etc/redis.conf`:
      - `maxmemory 2gb`
      - `maxmemory-policy allkeys-lru`
      - `save 300 1`
      - `appendonly no`

Phase 5: System config
  14. Enable Remote Login: `sudo systemsetup -setremotelogin on`
  15. Disable sleep: `sudo pmset -a disablesleep 1`
  16. Create app dirs: `sudo mkdir -p /usr/local/var/arachne/{backend,ui,targets}`
  17. Set ownership: `sudo chown -R $(whoami) /usr/local/var/arachne`

Phase 6: Restart + verify
  18. `sudo launchctl unload /Library/LaunchDaemons/com.ngrok.tunnel.plist` (if loaded)
  19. `sudo launchctl load -w /Library/LaunchDaemons/com.ngrok.tunnel.plist`
  20. `brew services restart redis`
  21. Wait for ngrok tunnels (poll `curl -s localhost:4040/api/tunnels`)
  22. Verify TCP tunnel is reachable
  23. Verify HTTP tunnel is reachable
  24. If verification fails → die with error, don't print client command
  25. Print `deno task install --client="<user>@<host>:<port>"`

### Client side: `arachne install --client="user@host:port"`

Runs on the developer's Mac. Connects to the host over ngrok.

```
Connecting to raphaelcastro@3.tcp.ngrok.io:21045...
Password: ********

  ssh key       generated + copied
  config/       pulled from host

Ready. Try:
  arachne monster
```

**What it does:**
  1. Parse user/host/port from connection string
  2. Generate `~/.ssh/arachne_ed25519` (if missing)
  3. `ssh-copy-id` to host (prompts for password once)
  4. Verify key-based login works
  5. SSH in, read host's `config/<name>/connectivity.json` + `users.json`
  6. Copy to local `config/<name>/`
  7. Print summary

---

## Batch 1 — Delete Pi-only modules (parallel)

### 1A: Delete `setup` command + `BootVolumeAdapter` + Pi assets

**Delete files:**
- `projects/cli/src/core/domain/data/boot-volume/mod.ts`
- `projects/cli/src/core/domain/data/boot-volume/smk.test.ts`
- `projects/cli/assets/dietpi.env`
- `projects/cli/assets/Automation_Custom_Script.sh`
- `projects/cli/assets/overclock.json`

**Edit files:**
- `cli.ts` — remove `setup` command (lines 209-244), `BootVolumeAdapter` import, `bootVolume` wiring, `IMAGE_DIR` constant, `"setup"` from `KNOWN_COMMANDS`

### 1B: Delete `wifi` command + `WifiManager`

**Delete files:**
- `projects/cli/src/core/domain/data/wifi/mod.ts`
- `projects/cli/src/core/domain/data/wifi/smk.test.ts`

**Edit files:**
- `cli.ts` — remove wifi commands (lines 82-207), `WifiManager` import, `wifi` wiring, `"wifi"` from `KNOWN_COMMANDS`

### 1C: Delete `overclock` command + modules + DTO

**Delete files:**
- `projects/cli/src/core/domain/data/overclock-io/mod.ts`
- `projects/cli/src/core/domain/data/overclock-io/smk.test.ts`
- `projects/cli/src/core/domain/business/overclock-helpers/mod.ts`
- `projects/cli/src/core/domain/business/overclock-helpers/test.ts`
- `projects/cli/src/core/dto/overclock.ts`

**Edit files:**
- `cli.ts` — remove overclock commands (lines 392-508), `OverclockHelpers`/`OverclockManager` imports, wiring, `"overclock"` from `KNOWN_COMMANDS`

---

## Batch 2 — Rewrite transport layer (depends on Batch 1, parallel within)

### 2A: Simplify `Conn`, `SshHelpers`, `SshClient`

**Edit files:**
- `dto/transport.ts` — remove `Transport`, `Flags`, `Network`. `Conn` becomes `{ host: string; port: string }`
- `ssh-helpers/mod.ts` — update `sshArgs()` for new `Conn`. Remove Pi-specific messages from `wrapSshErr()`
- `ssh-helpers/test.ts` — rewrite for new `Conn`
- `ssh/mod.ts` — follows new `Conn` signature
- `ssh/smk.test.ts` — update test data
- `cli.ts` wiring — `SshClient`: `user: "raphaelcastro"`, `connectTimeout: 10`

### 2B: Rewrite `TransportResolver`, clean up `TextHelpers`, `SystemAdapter`

**Edit files:**
- `entrypoints/resolve-transport.ts` — single path: parse TCP URL from `connectivity.json`, probe SSH, return `Conn`. Remove ARP, USB fallback, `getTransport()`
- `text-helpers/mod.ts` — remove `tag()`, `parseOverrides()`, `networkSummary()`. Keep `stripCr()`
- `text-helpers/test.ts` — remove deleted method tests
- `system/mod.ts` — remove `arpDetect()`. Keep `getMacSsid()`, `readPasswordStdin()`
- `system/smk.test.ts` — remove ARP test

---

## Batch 3 — Rewrite commands + new install (depends on Batch 2, parallel within)

### 3A: New `install --host` command

**New files:**
- `projects/cli/src/core/domain/coordinators/install-host/mod.ts`
- `projects/cli/src/core/domain/coordinators/install-host/int.test.ts`

**Edit files:**
- `cli.ts` — add `install` command with `--host` flag
- `ngrok-config/mod.ts` — keep as-is (platform-agnostic YAML builder)

**Behavior:** See "Host side" flow above. All steps idempotent.

### 3B: New `install --client` command

**New files:**
- `projects/cli/src/core/domain/coordinators/install-client/mod.ts`
- `projects/cli/src/core/domain/coordinators/install-client/int.test.ts`

**Edit files:**
- `cli.ts` — add `--client` flag to `install` command

**Behavior:** See "Client side" flow above.

### 3C: Rewrite `DeployCoordinator` for macOS

**Edit files:**
- `coordinators/deploy/mod.ts`
- `coordinators/deploy/int.test.ts`

**Changes:**
- Remote paths: `/opt/arachne/` → `/usr/local/var/arachne/`
- Deno path: detect via `which deno` (not `/root/.deno/bin/deno`)
- Systemd units → launchd plists:
  - `/Library/LaunchDaemons/com.arachne.backend.plist`
  - `/Library/LaunchDaemons/com.arachne.ui.plist`
- `systemctl` → `launchctl`:
  - `daemon-reload` → not needed
  - `enable/restart` → `sudo launchctl load -w <plist>`
  - `stop` → `sudo launchctl unload <plist>`
  - `kill --signal=SIGTERM` → `sudo launchctl kill SIGTERM system/com.arachne.backend`
- Fresh drain: `rm -rf /usr/local/var/arachne/{backend,ui,targets}`
- Remove `apt-get install unzip`
- SSH commands: prefix PATH with `/opt/homebrew/bin`
- Health check message: remove `systemctl status` reference

### 3D: Rewrite `status` command + `StatusFormatters` for macOS

**Edit files:**
- `cli.ts` (status section)
- `status-formatters/mod.ts`
- `status-formatters/test.ts`

**macOS remote script:**
- Hostname: `hostname`
- Uptime: `uptime`
- CPU temp: `sudo powermetrics --samplers smc -i1 -n1 2>/dev/null | grep -i 'CPU die' | awk '{print $NF}'`
- Memory: `sysctl hw.memsize` + `vm_stat`
- Disk: `df -h /`
- Load: `sysctl -n vm.loadavg`
- ngrok: `launchctl list com.ngrok.tunnel 2>/dev/null`
- Backend: `curl -sf http://localhost:3000/health`

**Remove:** WiFi signal, throttle, first-boot log, `vcgencmd`

**StatusFormatters:**
- `fmtTemp()` — degrees C directly (not millidegrees)
- `fmtFreq()` — remove (not useful on Mac)
- `fmtThrottle()` — remove

---

## Batch 4 — Adapt remaining pieces (depends on Batch 3)

### 4A: Update root CLI, thresholds, config, backend, tests

**Edit files:**
- `cli.ts` root command:
  - Description: "Remote Mac management over SSH"
  - Remove `--via-usb/-u`, `--via-wifi/-w` global options
  - Update `KNOWN_COMMANDS` to `["install", "deploy", "status", "ui"]`
  - Root action: use `TransportResolver` directly
- `threshold-checker/mod.ts` — CPU threshold 70C → 95C
- `threshold-checker/test.ts` — update expectations
- `config-file/mod.ts`:
  - Rename `listPis()` → `listHosts()`
  - Fix `readDotEnv()` error message
- `config-file/smk.test.ts` — update for rename
- `backend/bootstrap.ts` — default `TARGETS_DIR`: `/usr/local/var/arachne/targets`
- `cli.ts` ui section — "Forwarding remote:3001" (not "Pi:3001")
- `core/test.ts` — remove assertions for deleted Pi assets
- `dto/config.ts` — keep `ConnectivityConfig` with `tcp` and `http`

---

## Out of scope

- `users.json` on-disk format mismatch (pre-existing bug, separate fix)
- ngrok authtoken rotation (operational concern)
- macOS TCC/SIP permissions (documented as manual prerequisite for Full Disk Access)
- UI project (`projects/ui/`) has no code — unchanged, separate concern
