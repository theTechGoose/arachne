import { Command } from "https://deno.land/x/cliffy@v1.0.0-rc.4/command/mod.ts";

// --- dto ---
import { CliError, EXIT } from "./dto/exit-codes.ts";

// --- business ---
import { SshHelpers } from "./domain/business/ssh-helpers/mod.ts";
import { ThresholdChecker } from "./domain/business/threshold-checker/mod.ts";

// --- data ---
import { ConfigStore } from "./domain/data/config-file/mod.ts";
import { SshClient } from "./domain/data/ssh/mod.ts";

// --- coordinators ---
import { DeployCoordinator } from "./domain/coordinators/deploy/mod.ts";
import { InstallHostCoordinator } from "./domain/coordinators/install-host/mod.ts";
import { InstallClientCoordinator } from "./domain/coordinators/install-client/mod.ts";

// --- entrypoints ---
import { TransportResolver } from "./entrypoints/resolve-transport.ts";

// --- bootstrap ---

const CLI_DIR = new URL("../../", import.meta.url).pathname;
const CONFIG_DIR = CLI_DIR + "config";
const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname;

// --- wiring (constructor injection) ---
const sshHelpers = new SshHelpers();
const thresholdChecker = new ThresholdChecker();
const ssh = new SshClient({ user: "raphaelcastro", keyPath: `${Deno.env.get("HOME")}/.ssh/arachne_ed25519`, connectTimeout: 10 });
const configStore = new ConfigStore(CONFIG_DIR);
const transport = new TransportResolver(ssh, configStore);

const TARGET = Deno.args[0];
if (!TARGET) {
  console.error("Usage: arachne <host> [command]");
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

// --- install ---

const installCmd = new Command()
  .description("Set up arachne on a host or client machine")
  .option("--host", "Run host-side setup (local)")
  .option("--client <conn:string>", "Run client-side setup (pulls config from remote)")
  // deno-lint-ignore no-explicit-any
  .action(handleErrors(async (opts: any) => {
    if (opts.host) {
      const coordinator = new InstallHostCoordinator({
        prompt: (message: string) => prompt(message),
        exec: async (cmd: string) => {
          const p = new Deno.Command("bash", {
            args: ["-c", cmd],
            stdout: "piped",
            stderr: "piped",
          });
          const o = await p.output();
          return {
            ok: o.success,
            stdout: new TextDecoder().decode(o.stdout),
            stderr: new TextDecoder().decode(o.stderr),
          };
        },
        writeFile: async (path: string, content: string) => {
          const dir = path.substring(0, path.lastIndexOf("/"));
          await Deno.mkdir(dir, { recursive: true });
          await Deno.writeTextFile(path, content);
        },
        readFile: (path: string) => Deno.readTextFile(path),
        log: (msg: string) => console.log(msg),
        configDir: CONFIG_DIR,
      });
      await coordinator.run();
    } else if (opts.client) {
      const coordinator = new InstallClientCoordinator({
        sshExec: async (host: string, port: string, user: string, cmd: string) => {
          const r = await ssh.exec({ host, port }, cmd);
          return { ok: r.ok, stdout: r.stdout };
        },
        setupKey: async (host: string, port: string, _user: string) => {
          await ssh.setupKey({ host, port });
        },
        writeFile: async (path: string, content: string) => {
          const dir = path.substring(0, path.lastIndexOf("/"));
          await Deno.mkdir(dir, { recursive: true });
          await Deno.writeTextFile(path, content);
        },
        log: (msg: string) => console.log(msg),
        configDir: CONFIG_DIR,
      });
      await coordinator.run(opts.client);
    } else {
      die("Error: Specify --host or --client", EXIT.USAGE);
    }
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
  .description("Remote Mac health dashboard")
  // deno-lint-ignore no-explicit-any
  .action(handleErrors(async (_opts: any) => {
    const conn = await transport.resolve(TARGET);
    console.log("Status");
    console.log("\u2500".repeat(44));
    const script = [
      'echo "hostname:$(hostname)"',
      'echo "uptime:$(uptime)"',
      'echo "mem_total:$(sysctl -n hw.memsize)"',
      `echo "mem_pages_free:$(vm_stat | awk '/Pages free/{gsub(/\\./,"",$3); print $3}')"`,
      `echo "mem_pages_active:$(vm_stat | awk '/Pages active/{gsub(/\\./,"",$3); print $3}')"`,
      `echo "mem_pages_inactive:$(vm_stat | awk '/Pages inactive/{gsub(/\\./,"",$3); print $3}')"`,
      `echo "mem_pages_wired:$(vm_stat | awk '/Pages wired/{gsub(/\\./,"",$4); print $4}')"`,
      `echo "disk_total:$(df -h / | awk 'NR==2{print $2}')"`,
      `echo "disk_used:$(df -h / | awk 'NR==2{print $3}')"`,
      `echo "disk_pct:$(df -h / | awk 'NR==2{print $5}')"`,
      `echo "load:$(sysctl -n vm.loadavg | tr -d '{}')"`,
      'echo "ngrok:$(launchctl list com.ngrok.tunnel 2>/dev/null && echo active || echo inactive)"',
    ].join(" && ");
    const r = await ssh.exec(conn, script);
    if (!r.ok) die(`Error: Failed to get status.\n  ${r.stderr}`, EXIT.GENERAL);
    const info: Record<string, string> = {};
    for (const line of r.stdout.split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) info[line.slice(0, i)] = line.slice(i + 1).trim();
    }
    console.log(`  Hostname:   ${info.hostname}`);
    console.log(`  Uptime:     ${info.uptime}`);
    // Memory: convert pages to MB (page size = 16384 on ARM Mac)
    const pageSize = 16384;
    const memTotalBytes = parseInt(info.mem_total) || 0;
    const memTotalMB = Math.round(memTotalBytes / 1024 / 1024);
    const freePages = parseInt(info.mem_pages_free) || 0;
    const activePages = parseInt(info.mem_pages_active) || 0;
    const wiredPages = parseInt(info.mem_pages_wired) || 0;
    const usedMB = Math.round((activePages + wiredPages) * pageSize / 1024 / 1024);
    const freeMB = Math.round(freePages * pageSize / 1024 / 1024);
    const memPercent = memTotalMB > 0 ? (usedMB / memTotalMB) * 100 : 0;
    console.log(`  Memory:     ${usedMB}/${memTotalMB} MB (${freeMB} MB free)`);
    console.log(`  Disk:       ${info.disk_used}/${info.disk_total} (${info.disk_pct})`);
    console.log(`  Load:       ${info.load}`);
    console.log(`  ngrok:      ${info.ngrok}`);
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
    const diskPct = parseInt(info.disk_pct) || 0;
    const warnings = thresholdChecker.checkThresholds({ cpuTemp: 0, memPercent, diskPercent: diskPct });
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

const KNOWN_COMMANDS = ["install", "deploy", "status", "ui"];
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
    `arachne \u2014 Remote Mac management over SSH\n\n` +
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
  .command("install", installCmd)
  .command("deploy", deployCmd)
  .command("status", statusCmd)
  .command("ui", uiCmd)
  .parse(Deno.args.slice(1));
