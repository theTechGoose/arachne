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

const BACKEND_SERVICE = `[Unit]
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
`;

const UI_SERVICE = `[Unit]
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
`;

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
      this.deps.log(`    Stage 1: Copy backend/ -> /opt/arachne/backend/`);
      this.deps.log(`    Stage 2: Copy ui/ -> /opt/arachne/ui/`);
      this.deps.log(`    Stage 3: Copy targets/ -> /opt/arachne/targets/`);
      this.deps.log(`    Post-copy: Install Deno, cache deps, write systemd units, restart services`);
      if (opts.fresh) {
        this.deps.log(`    Fresh mode: Will drain backend, stop services, wipe app dirs first`);
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

    await this.deps.copyDir(conn, backendSrc, "/opt/arachne/backend/");
    await this.deps.copyDir(conn, uiSrc, "/opt/arachne/ui/");
    await this.deps.copyDir(conn, targetsSrc, "/opt/arachne/targets/");

    // 6. Post-copy: install Deno if needed
    const hasDeno = await this.deps.sshExec(conn, "test -f /root/.deno/bin/deno && echo yes || echo no");
    if (hasDeno.stdout.trim() !== "yes") {
      this.deps.log("Installing Deno on Pi...");
      await this.deps.sshExec(conn, "apt-get install -y -qq unzip >/dev/null 2>&1");
      const install = await this.deps.sshExec(conn, "curl -fsSL https://deno.land/install.sh | sh");
      if (!install.ok) {
        throw new CliError(`Error: Failed to install Deno.\n  ${install.stderr}`, EXIT.GENERAL);
      }
    }

    // 7. Cache dependencies
    this.deps.log("Caching dependencies...");
    const cache = await this.deps.sshExec(conn, "deno cache /opt/arachne/backend/main.ts");
    if (!cache.ok) {
      throw new CliError(`Error: Failed to cache dependencies.\n  ${cache.stderr}`, EXIT.GENERAL);
    }

    // 8. Write systemd service files
    const writeBackend = await this.deps.sshExec(
      conn,
      `cat > /etc/systemd/system/arachne-backend.service << 'SVCEOF'\n${BACKEND_SERVICE}SVCEOF`,
    );
    if (!writeBackend.ok) {
      throw new CliError(`Error: Failed to write backend service.\n  ${writeBackend.stderr}`, EXIT.GENERAL);
    }

    const writeUi = await this.deps.sshExec(
      conn,
      `cat > /etc/systemd/system/arachne-ui.service << 'SVCEOF'\n${UI_SERVICE}SVCEOF`,
    );
    if (!writeUi.ok) {
      throw new CliError(`Error: Failed to write UI service.\n  ${writeUi.stderr}`, EXIT.GENERAL);
    }

    // 9. Reload, enable, restart
    const restart = await this.deps.sshExec(
      conn,
      "systemctl daemon-reload && systemctl enable arachne-backend arachne-ui && systemctl restart arachne-backend arachne-ui",
    );
    if (!restart.ok) {
      throw new CliError(`Error: Failed to restart services.\n  ${restart.stderr}`, EXIT.GENERAL);
    }

    // 10. Health check with retries
    await this.healthCheck(conn);
  }

  private async freshDrain(conn: Conn): Promise<void> {
    this.deps.log("Fresh deploy: draining backend...");

    // SIGTERM the backend service
    await this.deps.sshExec(
      conn,
      "systemctl kill --signal=SIGTERM arachne-backend.service || true",
    );

    // Wait for drain
    const drainMs = this.deps.drainMs ?? FRESH_DRAIN_MS;
    this.deps.log(`Waiting ${drainMs / 1000}s for drain...`);
    await new Promise((r) => setTimeout(r, drainMs));

    // Stop all services
    await this.deps.sshExec(
      conn,
      "systemctl stop arachne-backend.service arachne-ui.service || true",
    );

    // Wipe app directories (NEVER Redis data)
    await this.deps.sshExec(
      conn,
      "rm -rf /opt/arachne/backend/ /opt/arachne/ui/ /opt/arachne/targets/",
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
    this.deps.log("Deployed but health check failed after retries. Check: systemctl status arachne-backend");
  }
}
