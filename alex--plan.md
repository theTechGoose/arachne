# Arachne: Complete install-host gaps

## Context

The Pi → Mac migration (plan.md) is 95% done across all 4 batches. Three specific
steps from plan.md Phase 3 and Phase 4 were never implemented in
`InstallHostCoordinator`:

1. ngrok config YAML not written (`NgrokConfigBuilder` exists but is never called)
2. ngrok LaunchDaemon plist not written (code loads it but never creates it)
3. Redis config not applied post-install (maxmemory, policy, save, appendonly)

Tests for the coordinator do not cover these 3 steps either.

---

## Files to modify

- `projects/cli/src/core/domain/coordinators/install-host/mod.ts` — add missing phases
- `projects/cli/src/core/domain/coordinators/install-host/int.test.ts` — add test cases
- `projects/cli/src/core/cli.ts` — pass `homeDir` to `InstallHostDeps`

---

## Changes

### 1. `InstallHostDeps` — add `homeDir`

Add `homeDir: string` to the interface so the coordinator can construct the ngrok
config path `~/.config/ngrok/ngrok.yml` without calling `exec("echo $HOME")`.

In `cli.ts`, wire it: `homeDir: Deno.env.get("HOME") ?? ""`.

### 2. Add ngrok YAML (Phase 3, step 11)

After `ngrok config add-authtoken`:

```typescript
import { NgrokConfigBuilder } from "../../business/ngrok-config/mod.ts";

const ngrokYaml = new NgrokConfigBuilder().buildYaml({
  authtoken,
  tcpUrl,
  httpDomain: httpUrl,
  httpAuth: [authUser],
});
await this.deps.exec(`mkdir -p ${this.deps.homeDir}/.config/ngrok`);
await this.deps.writeFile(
  `${this.deps.homeDir}/.config/ngrok/ngrok.yml`,
  ngrokYaml,
);
this.deps.log("  ngrok         config written");
```

### 3. Add ngrok LaunchDaemon plist (Phase 3, step 12)

After writing the YAML, write the plist via `exec` with `sudo tee`:

```typescript
const ngrokPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.ngrok.tunnel</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/ngrok</string>
    <string>start</string>
    <string>--all</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/usr/local/var/arachne/logs/ngrok.log</string>
  <key>StandardErrorPath</key>
  <string>/usr/local/var/arachne/logs/ngrok.err</string>
</dict>
</plist>`;

await this.deps.exec(
  `sudo tee /Library/LaunchDaemons/com.ngrok.tunnel.plist > /dev/null << 'PLISTEOF'\n${ngrokPlist}\nPLISTEOF`,
);
this.deps.log("  ngrok         LaunchDaemon written");
```

### 4. Add Redis config (Phase 4, step 13)

After `installIfMissing("redis-server", ...)`, use `sed -i ''` (macOS in-place) to
set/replace each config line idempotently:

```typescript
const redisCfg = "/opt/homebrew/etc/redis.conf";
const settings = [
  ["maxmemory", "maxmemory 2gb"],
  ["maxmemory-policy", "maxmemory-policy allkeys-lru"],
  ["save 300", "save 300 1"],
  ["appendonly", "appendonly no"],
];
for (const [key, line] of settings) {
  await this.deps.exec(
    `grep -q '^${key}' ${redisCfg} ` +
    `&& sed -i '' 's|^${key}.*|${line}|' ${redisCfg} ` +
    `|| echo '${line}' >> ${redisCfg}`,
  );
}
this.deps.log("  redis         configured");
```

### 5. Add tests

Three new test cases in `int.test.ts`:

- `install-host writes ngrok config YAML to ~/.config/ngrok/ngrok.yml`
  - Assert `writtenFiles` has the YAML path, content contains `tcp://...` and `authtoken`
- `install-host writes ngrok LaunchDaemon plist`
  - Assert `execCalls` contains a command including `com.ngrok.tunnel.plist`
- `install-host configures redis.conf`
  - Assert `execCalls` contains sed commands for `maxmemory`, `maxmemory-policy`,
    `save 300`, `appendonly`

---

## Ordering within `run()`

Current order:
1. Prompts → config files
2. `installIfMissing` (brew, ngrok, redis, deno)
3. `ngrok config add-authtoken`  ← insert YAML write + plist write here
4. System config (SSH, sleep, app dirs)
5. Restart + verify

Final order in `run()`:
1. Prompts → config files
2. `installIfMissing` brew, ngrok
3. `installIfMissing` redis-server → immediately configure redis.conf
4. `installIfMissing` deno
5. `ngrok config add-authtoken` → write YAML → write plist
6. System config
7. Restart + verify

---

## Verification

```bash
# integration tests only
deno test projects/cli/src/core/domain/coordinators/install-host/int.test.ts

# full suite
deno task test:unit
```
