import type { Target } from "../../../dto/config.ts";
import type { Conn } from "../../../dto/transport.ts";
import { CliError, EXIT } from "../../../dto/exit-codes.ts";

export interface SshExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

export interface DeployDeps {
  loadTargets: (piName: string) => Promise<Map<string, Target>>;
  resolveSshConn: () => Promise<Conn>;
  copyDir: (conn: Conn, localPath: string, remotePath: string) => Promise<void>;
  sshExec: (conn: Conn, cmd: string) => Promise<SshExecResult>;
  log: (msg: string) => void;
  projectRoot: string;
  configDir: string;
  /** Override for testing — default 30000 */
  drainMs?: number;
  /** Override for testing — default 3000 */
  healthIntervalMs?: number;
  /** Override for testing — default 5 */
  healthMaxAttempts?: number;
}

export interface DeployOpts {
  dryRun: boolean;
  fresh: boolean;
}

function backendPlist(denoPath: string, homeDir: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.arachne.backend</string>
  <key>ProgramArguments</key>
  <array>
    <string>${denoPath}</string>
    <string>run</string>
    <string>-A</string>
    <string>${homeDir}/arachne/backend/main.ts</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${homeDir}/arachne/logs/backend.log</string>
  <key>StandardErrorPath</key>
  <string>${homeDir}/arachne/logs/backend.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${homeDir}</string>
    <key>TARGETS_DIR</key>
    <string>${homeDir}/arachne/targets</string>
  </dict>
</dict>
</plist>`;
}

const HEALTH_RETRY_INTERVAL_MS = 3000;
const HEALTH_MAX_ATTEMPTS = 5;
const FRESH_DRAIN_MS = 30_000;

export class DeployCoordinator {
  constructor(private readonly deps: DeployDeps) {}

  async run(piName: string, opts: DeployOpts): Promise<void> {
    // 1. Pre-deploy validation
    const targets = await this.deps.loadTargets(piName);

    if (targets.size === 0) {
      throw new CliError(
        `Error: No target files found for "${piName}".`,
        EXIT.GENERAL,
      );
    }

    // 2. Dry-run mode
    if (opts.dryRun) {
      this.deps.log(`Dry-run: validation passed for "${piName}".`);
      this.deps.log(`  Targets validated: ${[...targets.keys()].join(", ")}`);
      this.deps.log(`  Deployment plan:`);
      this.deps.log(`    Stage 1: Copy backend/ -> /usr/local/var/arachne/backend/`);
      this.deps.log(`    Stage 2: Copy ui/ -> /usr/local/var/arachne/ui/`);
      this.deps.log(`    Stage 3: Copy targets/ -> /usr/local/var/arachne/targets/`);
      this.deps.log(`    Post-copy: Install Deno, cache deps, write launchd plists, load services`);
      if (opts.fresh) {
        this.deps.log(`    Fresh mode: Will drain backend, unload services, wipe app dirs first`);
      }
      return;
    }

    // 3. Resolve SSH connection
    const conn = await this.deps.resolveSshConn();

    // 4. Detect remote home dir
    const homeResult = await this.deps.sshExec(conn, "echo $HOME");
    if (!homeResult.ok || !homeResult.stdout.trim()) {
      throw new CliError("Error: Failed to detect remote home directory.", EXIT.GENERAL);
    }
    const homeDir = homeResult.stdout.trim();
    const arachneDir = `${homeDir}/arachne`;

    // 5. Fresh mode: drain and wipe
    if (opts.fresh) {
      await this.freshDrain(conn, arachneDir);
    }

    // 6. Copy stages
    const backendSrc = `${this.deps.projectRoot}projects/backend/`;
    const uiSrc = `${this.deps.projectRoot}projects/ui/`;
    const targetsSrc = `${this.deps.projectRoot}targets/`;

    await this.deps.copyDir(conn, backendSrc, `${arachneDir}/backend/`);
    await this.deps.copyDir(conn, uiSrc, `${arachneDir}/ui/`);
    await this.deps.copyDir(conn, targetsSrc, `${arachneDir}/targets/`);

    // 7. Detect deno path
    const denoPath = await this.detectDenoPath(conn);

    // 8. Post-copy: install Deno if needed
    const hasDeno = await this.deps.sshExec(
      conn,
      `test -f ${denoPath} && echo yes || echo no`,
    );
    if (hasDeno.stdout.trim() !== "yes") {
      throw new CliError(`Error: Deno not found at ${denoPath}. Install Deno on the remote first.`, EXIT.GENERAL);
    }

    // 9. Write root deno.json so Deno workspace resolution doesn't choke
    await this.deps.sshExec(
      conn,
      `echo '{"workspace":["./backend"]}' > ${arachneDir}/deno.json`,
    );

    // 10. Cache dependencies
    this.deps.log("Caching dependencies...");
    const cache = await this.deps.sshExec(
      conn,
      `${denoPath} cache ${arachneDir}/backend/main.ts`,
    );
    if (!cache.ok) {
      throw new CliError(`Error: Failed to cache dependencies.\n  ${cache.stderr}`, EXIT.GENERAL);
    }

    // 11. Create logs directory
    await this.deps.sshExec(conn, `mkdir -p ${arachneDir}/logs`);

    // 11. Write launchd plist (only if it doesn't exist yet)
    const plist = backendPlist(denoPath, homeDir);
    const launchAgentsDir = `${homeDir}/Library/LaunchAgents`;
    const plistPath = `${launchAgentsDir}/com.arachne.backend.plist`;
    const plistExists = await this.deps.sshExec(conn, `test -f ${plistPath} && echo yes || echo no`);
    if (plistExists.stdout.trim() !== "yes") {
      const writeBackend = await this.deps.sshExec(
        conn,
        `mkdir -p ${launchAgentsDir} && cat > ${plistPath} << 'PLISTEOF'\n${plist}\nPLISTEOF`,
      );
      if (!writeBackend.ok) {
        throw new CliError(`Error: Failed to write backend plist.\n  ${writeBackend.stderr}`, EXIT.GENERAL);
      }
      await this.deps.sshExec(conn, `chmod 644 ${plistPath}`);
    }

    // 12. Reload service — kill any running process, unload, then load
    await this.deps.sshExec(conn, `pkill -f "arachne/backend/main.ts" 2>/dev/null || true`);
    await this.deps.sshExec(conn, `launchctl unload ${plistPath} 2>/dev/null || true`);
    const loadService = await this.deps.sshExec(
      conn,
      `launchctl load -w ${plistPath}`,
    );
    if (!loadService.ok) {
      throw new CliError(`Error: Failed to load backend service.\n  ${loadService.stderr}`, EXIT.GENERAL);
    }

    // 13. Health check with retries
    await this.healthCheck(conn);
  }

  private async detectDenoPath(conn: Conn): Promise<string> {
    const result = await this.deps.sshExec(
      conn,
      "command -v deno 2>/dev/null || echo $HOME/.deno/bin/deno",
    );
    return result.stdout.trim();
  }

  private async freshDrain(conn: Conn, arachneDir: string): Promise<void> {
    this.deps.log("Fresh deploy: draining backend...");

    // SIGTERM the backend service via launchctl
    await this.deps.sshExec(
      conn,
      "launchctl kill SIGTERM gui/$(id -u)/com.arachne.backend 2>/dev/null || true",
    );

    // Wait for drain
    const drainMs = this.deps.drainMs ?? FRESH_DRAIN_MS;
    this.deps.log(`Waiting ${drainMs / 1000}s for drain...`);
    await new Promise((r) => setTimeout(r, drainMs));

    // Unload service
    await this.deps.sshExec(
      conn,
      "launchctl unload ~/Library/LaunchAgents/com.arachne.backend.plist 2>/dev/null || true",
    );

    // Wipe app directories (NEVER Redis data)
    await this.deps.sshExec(
      conn,
      `rm -rf ${arachneDir}/backend/ ${arachneDir}/ui/ ${arachneDir}/targets/`,
    );

    this.deps.log("Fresh deploy: app dirs wiped.");
  }

  private async healthCheck(conn: Conn): Promise<void> {
    const maxAttempts = this.deps.healthMaxAttempts ?? HEALTH_MAX_ATTEMPTS;
    const intervalMs = this.deps.healthIntervalMs ?? HEALTH_RETRY_INTERVAL_MS;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, intervalMs));
      const check = await this.deps.sshExec(
        conn,
        "curl -sf http://localhost:3000/health",
      );
      if (check.ok) {
        this.deps.log("Deployed and healthy.");
        return;
      }
    }
    this.deps.log("Deployed but health check failed after retries. Check: sudo launchctl list com.arachne.backend");
  }
}
