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

const BACKEND_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.arachne.backend</string>
  <key>ProgramArguments</key>
  <array>
    <string>DENO_PATH</string>
    <string>run</string>
    <string>-A</string>
    <string>/usr/local/var/arachne/backend/main.ts</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/usr/local/var/arachne/logs/backend.log</string>
  <key>StandardErrorPath</key>
  <string>/usr/local/var/arachne/logs/backend.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TARGETS_DIR</key>
    <string>/usr/local/var/arachne/targets</string>
  </dict>
</dict>
</plist>`;

const UI_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.arachne.ui</string>
  <key>ProgramArguments</key>
  <array>
    <string>DENO_PATH</string>
    <string>run</string>
    <string>-A</string>
    <string>/usr/local/var/arachne/ui/main.ts</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/usr/local/var/arachne/logs/ui.log</string>
  <key>StandardErrorPath</key>
  <string>/usr/local/var/arachne/logs/ui.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key>
    <string>3001</string>
  </dict>
</dict>
</plist>`;

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

    // 4. Fresh mode: drain and wipe
    if (opts.fresh) {
      await this.freshDrain(conn);
    }

    // 5. Copy stages
    const backendSrc = `${this.deps.projectRoot}projects/backend/`;
    const uiSrc = `${this.deps.projectRoot}projects/ui/`;
    const targetsSrc = `${this.deps.configDir}${piName}/targets/`;

    await this.deps.copyDir(conn, backendSrc, "/usr/local/var/arachne/backend/");
    await this.deps.copyDir(conn, uiSrc, "/usr/local/var/arachne/ui/");
    await this.deps.copyDir(conn, targetsSrc, "/usr/local/var/arachne/targets/");

    // 6. Detect deno path
    const denoPath = await this.detectDenoPath(conn);

    // 7. Post-copy: install Deno if needed
    const hasDeno = await this.deps.sshExec(
      conn,
      `export PATH=/opt/homebrew/bin:$PATH && test -f ${denoPath} && echo yes || echo no`,
    );
    if (hasDeno.stdout.trim() !== "yes") {
      this.deps.log("Installing Deno...");
      const install = await this.deps.sshExec(
        conn,
        "export PATH=/opt/homebrew/bin:$PATH && brew install deno",
      );
      if (!install.ok) {
        throw new CliError(`Error: Failed to install Deno.\n  ${install.stderr}`, EXIT.GENERAL);
      }
    }

    // 8. Cache dependencies
    this.deps.log("Caching dependencies...");
    const cache = await this.deps.sshExec(
      conn,
      `export PATH=/opt/homebrew/bin:$PATH && ${denoPath} cache /usr/local/var/arachne/backend/main.ts`,
    );
    if (!cache.ok) {
      throw new CliError(`Error: Failed to cache dependencies.\n  ${cache.stderr}`, EXIT.GENERAL);
    }

    // 9. Create logs directory
    await this.deps.sshExec(conn, "mkdir -p /usr/local/var/arachne/logs");

    // 10. Write launchd plist files
    const backendPlist = BACKEND_PLIST.replaceAll("DENO_PATH", denoPath);
    const writeBackend = await this.deps.sshExec(
      conn,
      `sudo tee /Library/LaunchDaemons/com.arachne.backend.plist > /dev/null << 'PLISTEOF'\n${backendPlist}\nPLISTEOF`,
    );
    if (!writeBackend.ok) {
      throw new CliError(`Error: Failed to write backend plist.\n  ${writeBackend.stderr}`, EXIT.GENERAL);
    }

    const uiPlist = UI_PLIST.replaceAll("DENO_PATH", denoPath);
    const writeUi = await this.deps.sshExec(
      conn,
      `sudo tee /Library/LaunchDaemons/com.arachne.ui.plist > /dev/null << 'PLISTEOF'\n${uiPlist}\nPLISTEOF`,
    );
    if (!writeUi.ok) {
      throw new CliError(`Error: Failed to write UI plist.\n  ${writeUi.stderr}`, EXIT.GENERAL);
    }

    // 11. Load services via launchctl
    const loadServices = await this.deps.sshExec(
      conn,
      "sudo launchctl load -w /Library/LaunchDaemons/com.arachne.backend.plist && sudo launchctl load -w /Library/LaunchDaemons/com.arachne.ui.plist",
    );
    if (!loadServices.ok) {
      throw new CliError(`Error: Failed to load services.\n  ${loadServices.stderr}`, EXIT.GENERAL);
    }

    // 12. Health check with retries
    await this.healthCheck(conn);
  }

  private async detectDenoPath(conn: Conn): Promise<string> {
    const result = await this.deps.sshExec(
      conn,
      "which deno || echo /opt/homebrew/bin/deno",
    );
    return result.stdout.trim();
  }

  private async freshDrain(conn: Conn): Promise<void> {
    this.deps.log("Fresh deploy: draining backend...");

    // SIGTERM the backend service via launchctl
    await this.deps.sshExec(
      conn,
      "sudo launchctl kill SIGTERM system/com.arachne.backend || true",
    );

    // Wait for drain
    const drainMs = this.deps.drainMs ?? FRESH_DRAIN_MS;
    this.deps.log(`Waiting ${drainMs / 1000}s for drain...`);
    await new Promise((r) => setTimeout(r, drainMs));

    // Unload all services
    await this.deps.sshExec(
      conn,
      "sudo launchctl unload /Library/LaunchDaemons/com.arachne.backend.plist /Library/LaunchDaemons/com.arachne.ui.plist || true",
    );

    // Wipe app directories (NEVER Redis data)
    await this.deps.sshExec(
      conn,
      "rm -rf /usr/local/var/arachne/backend/ /usr/local/var/arachne/ui/ /usr/local/var/arachne/targets/",
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
