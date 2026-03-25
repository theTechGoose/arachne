import { Command } from "https://deno.land/x/cliffy@v1.0.0-rc.4/command/mod.ts";

// --- dto ---
import { CliError, EXIT } from "./dto/exit-codes.ts";

// --- business ---
import { SshHelpers } from "./domain/business/ssh-helpers/mod.ts";
import { StatusFormatters } from "./domain/business/status-formatters/mod.ts";
import { NgrokConfigBuilder } from "./domain/business/ngrok-config/mod.ts";
import { ThresholdChecker } from "./domain/business/threshold-checker/mod.ts";

// --- data ---
import { ConfigStore } from "./domain/data/config-file/mod.ts";
import { SshClient } from "./domain/data/ssh/mod.ts";

// --- coordinators ---
import { DeployCoordinator } from "./domain/coordinators/deploy/mod.ts";

// --- entrypoints ---
import { TransportResolver } from "./entrypoints/resolve-transport.ts";

// --- bootstrap ---

const CLI_DIR = new URL("../../", import.meta.url).pathname;
const CONFIG_DIR = CLI_DIR + "config";
const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname;

// --- wiring (constructor injection) ---
const sshHelpers = new SshHelpers();
const statusFmt = new StatusFormatters();
const ngrokBuilder = new NgrokConfigBuilder();
const thresholdChecker = new ThresholdChecker();
const ssh = new SshClient({ user: "raphaelcastro", keyPath: `${Deno.env.get("HOME")}/.ssh/arachne_ed25519`, connectTimeout: 10 });
const configStore = new ConfigStore(CONFIG_DIR);
const transport = new TransportResolver(ssh, configStore);

const TARGET = Deno.args[0];
if (!TARGET) {
  console.error("Usage: deno task <target-name> [command]\n  See config.json for available targets.");
  Deno.exit(2);
}

function die(msg: string, code: number): never {
  console.error(msg);
  Deno.exit(code);
}

/** Wrap async command actions to catch CliError and call die() */
function handleErrors<T extends unknown[]>(
  fn: (...args: T) => Promise<void>,
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (e) {
      if (e instanceof CliError) die(e.message, e.code);
      throw e;
    }
  };
}

// ============================================================
// CLI commands
// ============================================================

// --- init ---

const NGROK_SERVICE = `[Unit]
Description=ngrok tunnels (TCP + HTTP)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/ngrok start --all --config /root/.config/ngrok/ngrok.yml
Restart=always
RestartSec=10
Environment=HOME=/root

[Install]
WantedBy=multi-user.target
`;

const initCmd = new Command()
  .description("Initialize target: SSH key, ngrok, fail2ban, clean login")
  // deno-lint-ignore no-explicit-any
  .action(handleErrors(async (_opts: any) => {
    const conn = await transport.resolve(TARGET);
    console.log("Connecting...");
    if (!(await ssh.hasKey())) await ssh.setupKey(conn);
    const probe = await ssh.probe(conn);
    if (!probe.ok) die(`Error: ${sshHelpers.wrapSshErr(probe.error)}`, EXIT.CONNECTION);
    console.log(`Connected to ${ssh.getConfig().user}@${conn.host}.`);
    const connectivity = await configStore.loadConnectivity(TARGET);
    if (!connectivity.tcp) die(`Error: "${TARGET}" has no TCP URL in connectivity.json.`, EXIT.GENERAL);
    if (!connectivity.http) die(`Error: "${TARGET}" has no HTTP URL in connectivity.json.`, EXIT.GENERAL);
    const tcpUrl = connectivity.tcp;
    const httpUrl = connectivity.http;
    const users = await configStore.loadUsers(TARGET);
    const httpAuth = users.credentials;
    const env = await configStore.readDotEnv();
    const authtoken = env.get("NGROK_AUTHTOKEN");
    if (!authtoken) die("Error: NGROK_AUTHTOKEN not set in .env", EXIT.GENERAL);
    console.log("\nWaiting for network...");
    const netCheck = await ssh.exec(conn, `for i in $(seq 1 30); do ping -c1 -W2 deb.debian.org >/dev/null 2>&1 && echo ONLINE && exit 0; sleep 2; done; echo OFFLINE`);
    if (!netCheck.stdout.includes("ONLINE")) die("Error: No internet after 60s.", EXIT.TIMEOUT);
    console.log("Installing ngrok...");
    const installNgrok = await ssh.exec(conn, [`curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null`, `echo "deb https://ngrok-agent.s3.amazonaws.com buster main" > /etc/apt/sources.list.d/ngrok.list`, `apt-get update -qq >/dev/null 2>&1`, `apt-get install -y -qq ngrok >/dev/null 2>&1`].join(" && "));
    if (!installNgrok.ok) die(`Error: Failed to install ngrok.\n  ${installNgrok.stderr}`, EXIT.GENERAL);
    const ngrokConfig = ngrokBuilder.buildYaml({ authtoken, tcpUrl, httpDomain: httpUrl, httpAuth });
    await ssh.exec(conn, "mkdir -p /root/.config/ngrok");
    const writeConfig = await ssh.exec(conn, `cat > /root/.config/ngrok/ngrok.yml << 'CFGEOF'\n${ngrokConfig}\nCFGEOF`);
    if (!writeConfig.ok) die(`Error: Failed to write ngrok config.\n  ${writeConfig.stderr}`, EXIT.GENERAL);
    const writeNgrokSvc = await ssh.exec(conn, `cat > /etc/systemd/system/ngrok.service << 'SVCEOF'\n${NGROK_SERVICE}SVCEOF`);
    if (!writeNgrokSvc.ok) die(`Error: Failed to write ngrok service.\n  ${writeNgrokSvc.stderr}`, EXIT.GENERAL);
    const startNgrok = await ssh.exec(conn, "systemctl daemon-reload && systemctl enable ngrok && systemctl start ngrok");
    if (!startNgrok.ok) die(`Error: Failed to start ngrok service.\n  ${startNgrok.stderr}`, EXIT.GENERAL);
    await new Promise((r) => setTimeout(r, 3000));
    const tunnel = await ssh.exec(conn, `curl -s localhost:4040/api/tunnels`);
    if (tunnel.ok && (tunnel.stdout.includes("tcp://") || tunnel.stdout.includes("https://"))) {
      console.log("ngrok installed and configured.");
      console.log(`TCP tunnel: ${tcpUrl} -> localhost:22`);
      console.log(`HTTP tunnel: ${httpUrl} -> localhost:80`);
    } else { console.log("ngrok installed but tunnels not yet active. Check: deno task pi status"); }
    console.log("\nInstalling fail2ban...");
    const f2b = await ssh.exec(conn, `apt-get install -y -qq fail2ban >/dev/null 2>&1`);
    if (!f2b.ok) console.log("Warning: Failed to install fail2ban. Install manually.");
    else console.log("fail2ban installed.");
    console.log("Installing Redis...");
    const redis = await ssh.exec(conn, `apt-get install -y -qq redis-server >/dev/null 2>&1`);
    if (!redis.ok) {
      console.log("Warning: Failed to install Redis. Install manually.");
    } else {
      const redisCfg = [
        `sed -i 's/^# *maxmemory .*/maxmemory 256mb/' /etc/redis/redis.conf`,
        `grep -q '^maxmemory ' /etc/redis/redis.conf || echo 'maxmemory 256mb' >> /etc/redis/redis.conf`,
        `sed -i 's/^# *maxmemory-policy .*/maxmemory-policy allkeys-lru/' /etc/redis/redis.conf`,
        `grep -q '^maxmemory-policy ' /etc/redis/redis.conf || echo 'maxmemory-policy allkeys-lru' >> /etc/redis/redis.conf`,
        `sed -i 's/^save .*//' /etc/redis/redis.conf`,
        `echo 'save 300 1' >> /etc/redis/redis.conf`,
        `sed -i 's/^appendonly .*/appendonly no/' /etc/redis/redis.conf`,
        `systemctl enable redis-server`,
        `systemctl restart redis-server`,
      ].join(" && ");
      const cfgResult = await ssh.exec(conn, redisCfg);
      if (!cfgResult.ok) console.log(`Warning: Failed to configure Redis.\n  ${cfgResult.stderr}`);
      // Verify Redis with retry loop (5 seconds)
      const verify = await ssh.exec(conn, `for i in $(seq 1 5); do redis-cli ping 2>/dev/null | grep -q PONG && echo OK && exit 0; sleep 1; done; echo FAIL`);
      if (verify.stdout.includes("OK")) {
        console.log("Redis installed and configured.");
      } else {
        console.log("Warning: Redis installed but ping verification failed.");
      }
    }
    console.log("Configuring journald...");
    const journald = await ssh.exec(conn, [
      `sed -i 's/^#\\?SystemMaxUse=.*/SystemMaxUse=100M/' /etc/systemd/journald.conf`,
      `grep -q '^SystemMaxUse=' /etc/systemd/journald.conf || echo 'SystemMaxUse=100M' >> /etc/systemd/journald.conf`,
      `systemctl restart systemd-journald`,
    ].join(" && "));
    if (!journald.ok) console.log(`Warning: Failed to configure journald.\n  ${journald.stderr}`);
    else console.log("journald configured (SystemMaxUse=100M).");
    console.log("Configuring clean login...");
    await ssh.exec(conn, [`touch /root/.hushlogin`, `command -v dietpi-banner >/dev/null && dietpi-banner 0 || true`, `grep -q '^clear$' /root/.bashrc || echo 'clear' >> /root/.bashrc`].join(" && "));
    await ssh.exec(conn, `dpkg -l dropbear >/dev/null 2>&1 && apt-get remove -y -qq dropbear >/dev/null 2>&1 || true`);
    console.log("\nInitialized.\n");
    console.log("Next steps:");
    console.log("  Health dashboard: deno task pi status");
    console.log("  Deploy:           deno task pi deploy");
  }));

// --- deploy ---

const deployCoordinator = new DeployCoordinator({
  loadTargets: (piName: string) => configStore.loadTargets(piName),
  resolveSshConn: () => transport.resolve(TARGET),
  copyDir: async (conn, localPath, remotePath) => {
    const start = performance.now();
    const tar = new Deno.Command("tar", { args: ["-cf", "-", "-C", localPath, "."], stdout: "piped", stderr: "piped" });
    const tarProc = tar.spawn();
    const extract = new Deno.Command("ssh", {
      args: sshHelpers.sshArgs(conn, ssh.getConfig(), { batch: true, cmd: `mkdir -p ${remotePath} && tar -xf - -C ${remotePath}` }),
      stdin: "piped", stdout: "inherit", stderr: "piped",
    });
    const extractProc = extract.spawn();
    await tarProc.stdout.pipeTo(extractProc.stdin);
    const extractStatus = await extractProc.status;
    if (!extractStatus.success) {
      throw new CliError(`Error: Failed to copy ${localPath} to ${remotePath}.`, EXIT.GENERAL);
    }
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);
    const dirName = localPath.replace(/\/$/, "").split("/").pop();
    console.log(`${dirName}/ copied (${elapsed}s)`);
  },
  sshExec: (conn, cmd) => ssh.exec(conn, cmd),
  log: (msg: string) => console.log(msg),
  projectRoot: PROJECT_ROOT,
  configDir: CONFIG_DIR + "/",
});

const deployCmd = new Command()
  .description("Deploy backend, UI, and targets")
  .option("--dry-run", "Validate config and show deployment plan without executing")
  .option("--fresh", "Drain backend, stop services, wipe app dirs, then deploy fresh")
  // deno-lint-ignore no-explicit-any
  .action(handleErrors(async (opts: any) => {
    await deployCoordinator.run(TARGET, { dryRun: !!opts.dryRun, fresh: !!opts.fresh });
  }));

// --- status ---

const statusCmd = new Command()
  .description("Health dashboard")
  // deno-lint-ignore no-explicit-any
  .action(handleErrors(async (_opts: any) => {
    const conn = await transport.resolve(TARGET);
    console.log("Status");
    console.log("\u2500".repeat(44));
    const script = [
      'echo "hostname:$(hostname)"', 'echo "uptime:$(uptime -p 2>/dev/null || uptime)"',
      'echo "cpu_temp:$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo n/a)"',
      'echo "cpu_freq:$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq 2>/dev/null || echo n/a)"',
      'echo "throttle:$(vcgencmd get_throttled 2>/dev/null | cut -d= -f2 || echo n/a)"',
      'echo "mem_total:$(free -m | awk \'/Mem:/{print $2}\')"', 'echo "mem_used:$(free -m | awk \'/Mem:/{print $3}\')"',
      'echo "mem_avail:$(free -m | awk \'/Mem:/{print $7}\')"',
      'echo "disk_total:$(df -h / | awk \'NR==2{print $2}\')"', 'echo "disk_used:$(df -h / | awk \'NR==2{print $3}\')"',
      'echo "disk_pct:$(df -h / | awk \'NR==2{print $5}\')"',
      'echo "load:$(cat /proc/loadavg | cut -d\\" \\" -f1-3)"',
      'echo "wifi_ssid:$(wpa_cli -i wlan0 status 2>/dev/null | grep ^ssid= | cut -d= -f2-)"',
      'echo "wifi_signal:$(iw dev wlan0 link 2>/dev/null | grep signal | awk \'{print $2, $3}\')"',
      'echo "ngrok:$(systemctl is-active ngrok 2>/dev/null || echo not installed)"',
      'echo "ngrok_tunnels:$(curl -sf localhost:4040/api/tunnels 2>/dev/null | grep -o \'"public_url":"[^"]*"\' | tr \'\\n\' \' \' || echo none)"',
      'echo "failed:$(systemctl --failed --no-legend 2>/dev/null | head -5)"',
      'echo "firstboot:$(cat /var/tmp/dietpi/logs/dietpi-automation_custom_script.log 2>/dev/null | tail -1 || echo n/a)"',
    ].join(" && ");
    const r = await ssh.exec(conn, script);
    if (!r.ok) die(`Error: Failed to get status.\n  ${r.stderr}`, EXIT.GENERAL);
    const info: Record<string, string> = {};
    for (const line of r.stdout.split("\n")) { const i = line.indexOf(":"); if (i > 0) info[line.slice(0, i)] = line.slice(i + 1).trim(); }
    console.log(`  Host:       ${conn.host}:${conn.port}`);
    console.log(`  Hostname:   ${info.hostname}`);
    console.log(`  Uptime:     ${info.uptime}`);
    console.log(`  CPU:        ${statusFmt.fmtFreq(info.cpu_freq)} @ ${statusFmt.fmtTemp(info.cpu_temp)}`);
    console.log(`  Throttle:   ${statusFmt.fmtThrottle(info.throttle)}`);
    console.log(`  Memory:     ${info.mem_used}/${info.mem_total} MB (${info.mem_avail} MB free)`);
    console.log(`  Disk:       ${info.disk_used}/${info.disk_total} (${info.disk_pct})`);
    console.log(`  Load:       ${info.load}`);
    console.log(`  WiFi:       ${info.wifi_ssid ? `${info.wifi_ssid}${info.wifi_signal ? ` (signal: ${info.wifi_signal})` : ""}` : "Not connected"}`);
    console.log(`  ngrok:      ${info.ngrok}`);
    console.log(`  First-boot: ${info.firstboot || "n/a"}`);
    if (info.failed) console.log(`  Failed:     ${info.failed}`);
    // Backend health check
    const health = await ssh.exec(conn, "curl -sf http://localhost:3000/health");
    if (health.ok) {
      try {
        const parsed = JSON.parse(health.stdout);
        console.log(`  Backend:    ${parsed.status} (${parsed.workers} workers)`);
      } catch {
        console.log(`  Backend:    ${health.stdout}`);
      }
    } else {
      console.log(`  Backend:    unreachable`);
    }
    // Threshold warnings
    const cpuTemp = info.cpu_temp === "n/a" ? 0 : parseInt(info.cpu_temp) / 1000;
    const memTotal = parseInt(info.mem_total) || 1;
    const memUsed = parseInt(info.mem_used) || 0;
    const memPercent = (memUsed / memTotal) * 100;
    const diskPct = parseInt(info.disk_pct) || 0;
    const warnings = thresholdChecker.checkThresholds({ cpuTemp, memPercent, diskPercent: diskPct });
    if (warnings.length > 0) {
      console.log("");
      for (const w of warnings) console.log(`  WARNING: ${w.message}`);
      Deno.exit(EXIT.GENERAL);
    }
  }));

// --- ui ---

const uiCmd = new Command()
  .description("Open Bull Board UI in browser via SSH tunnel")
  .option("--port <port:number>", "Override local port (default 3001)")
  .option("--no-open", "Skip automatic browser launch")
  // deno-lint-ignore no-explicit-any
  .action(handleErrors(async (_opts: any) => {
    const conn = await transport.resolve(TARGET);
    const localPort = _opts.port ?? 3001;
    // Check if local port is available
    try {
      const listener = Deno.listen({ port: localPort });
      listener.close();
    } catch {
      die(`Error: Port ${localPort} is already in use. Use --port <N> to override.`, EXIT.GENERAL);
    }
    console.log(`Forwarding remote:3001 -> localhost:${localPort}`);
    // SSH port forward
    const sshProc = new Deno.Command("ssh", {
      args: [...sshHelpers.sshArgs(conn, ssh.getConfig(), { batch: true }),
        "-N", "-L", `${localPort}:localhost:3001`],
      stdin: "inherit", stdout: "inherit", stderr: "inherit",
    });
    const child = sshProc.spawn();
    // Open browser (unless --no-open)
    if (_opts.open !== false) {
      setTimeout(async () => {
        await new Deno.Command("open", { args: [`http://localhost:${localPort}`] }).spawn().status;
      }, 1000);
    }
    console.log(`  Bull Board: http://localhost:${localPort}`);
    console.log("  Press Ctrl-C to stop the tunnel.");
    await child.status;
  }));

// --- unknown subcommand handler ---

const KNOWN_COMMANDS = ["init", "deploy", "status", "ui"];
const subcommand = Deno.args[1];
if (subcommand && !subcommand.startsWith("-") && !KNOWN_COMMANDS.includes(subcommand)) {
  const suggestion = thresholdChecker.suggestCommand(subcommand, KNOWN_COMMANDS);
  if (suggestion) {
    console.error(`Unknown command "${subcommand}". Did you mean "${suggestion}"?`);
  } else {
    console.error(`Unknown command "${subcommand}".`);
  }
  Deno.exit(EXIT.USAGE);
}

// --- root command ---

await new Command()
  .name("arachne")
  .version("1.0.0")
  .description(
    `arachne \u2014 Remote machine management via SSH\n\n` +
      `Target: ${TARGET}\n\n` +
      "Connects to the target via SSH (ngrok tunnel).\n\n" +
      "Exit codes:\n" +
      "  0  Success          3  Connection failed\n" +
      "  1  General error    4  Timeout\n" +
      "  2  Usage error      5  Operation blocked",
  )
  // deno-lint-ignore no-explicit-any
  .action(handleErrors(async (_opts: any) => {
    const conn = await transport.resolve(TARGET);
    console.log("Connected.");
    const proc = new Deno.Command("ssh", {
      args: sshHelpers.sshArgs(conn, ssh.getConfig()),
      stdin: "inherit", stdout: "inherit", stderr: "inherit",
    });
    const s = await proc.spawn().status;
    Deno.exit(s.code);
  }))
  .command("init", initCmd)
  .command("deploy", deployCmd)
  .command("status", statusCmd)
  .command("ui", uiCmd)
  .parse(Deno.args.slice(1));
