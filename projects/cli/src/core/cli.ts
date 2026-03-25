import { Command } from "https://deno.land/x/cliffy@v1.0.0-rc.4/command/mod.ts";
import { Select } from "https://deno.land/x/cliffy@v1.0.0-rc.4/prompt/select.ts";

// --- dto ---
import type { Conn } from "./dto/transport.ts";
import { CliError, EXIT } from "./dto/exit-codes.ts";

// --- business ---
import { SshHelpers } from "./domain/business/ssh-helpers/mod.ts";
import { TextHelpers } from "./domain/business/text-helpers/mod.ts";
import { OverclockHelpers } from "./domain/business/overclock-helpers/mod.ts";
import { StatusFormatters } from "./domain/business/status-formatters/mod.ts";
import { NgrokConfigBuilder } from "./domain/business/ngrok-config/mod.ts";

// --- data ---
import { ConfigStore } from "./domain/data/config-file/mod.ts";
import { SshClient } from "./domain/data/ssh/mod.ts";
import { BootVolumeAdapter } from "./domain/data/boot-volume/mod.ts";
import { SystemAdapter } from "./domain/data/system/mod.ts";
import { WifiManager } from "./domain/data/wifi/mod.ts";
import { OverclockManager } from "./domain/data/overclock-io/mod.ts";

// --- coordinators ---
import { DeployCoordinator } from "./domain/coordinators/deploy/mod.ts";

// --- entrypoints ---
import { TransportResolver } from "./entrypoints/resolve-transport.ts";

// --- bootstrap ---

const CLI_DIR = new URL("../../", import.meta.url).pathname;
const CONFIG_DIR = CLI_DIR + "config";
const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname;
const IMAGE_DIR = new URL("../../assets", import.meta.url).pathname;
const USB = { host: "10.0.0.1", port: "22" };

// --- wiring (constructor injection) ---
const sshHelpers = new SshHelpers();
const text = new TextHelpers();
const ocHelpers = new OverclockHelpers();
const statusFmt = new StatusFormatters();
const ngrokBuilder = new NgrokConfigBuilder();
const ssh = new SshClient({ user: "root", keyPath: `${Deno.env.get("HOME")}/.ssh/arachne_ed25519`, connectTimeout: 5 });
const configStore = new ConfigStore(CONFIG_DIR);
const bootVolume = new BootVolumeAdapter();
const system = new SystemAdapter();
const wifi = new WifiManager(ssh);
const overclockIo = new OverclockManager(ssh);
const transport = new TransportResolver(ssh, configStore, system);

const TARGET = Deno.args[0];
if (!TARGET) {
  console.error("Usage: deno task <pi-name> [command]\n  See config.json for available targets.");
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

// --- wifi add ---

const wifiAddCmd = new Command()
  .description("Add a WiFi network")
  .arguments("[ssid:string] [password:string]")
  .option("--password-stdin", "Read password from stdin")
  // deno-lint-ignore no-explicit-any
  .action(handleErrors(async (opts: any, ssid?: string, password?: string) => {
    if (opts.passwordStdin && password)
      die("Error: Cannot use both positional password and --password-stdin.", EXIT.USAGE);
    const conn = await transport.resolve(transport.getTransport(opts), TARGET);
    if (!ssid) ssid = await system.getMacSsid();
    if (opts.passwordStdin) {
      password = await system.readPasswordStdin();
    } else if (!password) {
      password = prompt("Password:") ?? undefined;
      if (!password) die("Error: No password provided.", EXIT.USAGE);
    }
    await wifi.add(conn, ssid, password!);
    const nets = await wifi.list(conn);
    console.log(`${text.tag(conn.transport)} Added WiFi network "${ssid}".`);
    console.log(`  Saved networks: ${wifi.formatSummary(nets)}`);
  }));

// --- wifi list ---

const wifiListCmd = new Command()
  .description("List saved WiFi networks")
  // deno-lint-ignore no-explicit-any
  .action(handleErrors(async (opts: any) => {
    const conn = await transport.resolve(transport.getTransport(opts), TARGET);
    const nets = await wifi.list(conn);
    console.log(`${text.tag(conn.transport)} Saved WiFi networks:`);
    if (nets.length === 0) { console.log("  (none)"); return; }
    for (const n of nets)
      console.log(`  ${n.ssid}${n.current ? "    (current)" : ""}`);
  }));

// --- wifi remove ---

const wifiRemoveCmd = new Command()
  .description("Remove a saved WiFi network")
  .arguments("<ssid:string>")
  // deno-lint-ignore no-explicit-any
  .action(handleErrors(async (opts: any, ssid: string) => {
    const conn = await transport.resolve(transport.getTransport(opts), TARGET);
    const nets = await wifi.list(conn);
    const target = nets.find((n) => n.ssid === ssid);
    if (!target)
      die(`${text.tag(conn.transport)} Error: Network "${ssid}" not found.\n  Run 'deno task pi wifi list' to see saved networks.`, EXIT.GENERAL);
    if (target.current && conn.transport === "wifi")
      die(`${text.tag("wifi")} Error: Cannot remove active WiFi network while connected via WiFi.\n  Connect via USB cable and try again.`, EXIT.BLOCKED);
    await wifi.remove(conn, ssid);
    const remaining = await wifi.list(conn);
    console.log(`${text.tag(conn.transport)} Removed WiFi network "${ssid}".`);
    console.log(`  Remaining networks: ${wifi.formatSummary(remaining)}`);
  }));

// --- wifi reset ---

const wifiResetCmd = new Command()
  .description("Wipe all WiFi config (USB only)")
  // deno-lint-ignore no-explicit-any
  .action(handleErrors(async (opts: any) => {
    const conn = await transport.resolve(transport.getTransport(opts), TARGET, true);
    if (conn.transport === "wifi")
      die(`${text.tag("wifi")} Error: Cannot run 'wifi reset' over WiFi — this would disconnect\n  the Pi and lock you out. Connect via USB cable and try again.`, EXIT.BLOCKED);
    if (!confirm("This will remove ALL saved WiFi networks. The Pi will only be\nreachable via USB after this. Continue?")) {
      console.log("Cancelled."); return;
    }
    await wifi.reset(conn);
    console.log(`${text.tag(conn.transport)} All WiFi networks removed. Pi is now USB-only.`);
  }));

// --- wifi (interactive menu) ---

const wifiCmd = new Command()
  .description("Manage WiFi networks on the Pi")
  // deno-lint-ignore no-explicit-any
  .action(handleErrors(async (opts: any) => {
    const conn = await transport.resolve(transport.getTransport(opts), TARGET);
    while (true) {
      const action = await Select.prompt({ message: "What do you want to do?", options: ["add", "remove", "reset"] });
      if (action === "add") {
        const ssidInput = prompt("SSID (blank for current):");
        const ssid = ssidInput || (await system.getMacSsid());
        const password = prompt("Password:");
        if (!password) { console.log("No password provided."); continue; }
        await wifi.add(conn, ssid, password);
        const nets = await wifi.list(conn);
        console.log(`${text.tag(conn.transport)} Added WiFi network "${ssid}".`);
        console.log(`  Saved networks: ${wifi.formatSummary(nets)}`);
        break;
      }
      if (action === "remove") {
        const nets = await wifi.list(conn);
        if (nets.length === 0) { console.log(`${text.tag(conn.transport)} No saved networks.`); break; }
        const selected = await Select.prompt({ message: "SSID:", options: nets.map((n) => n.current ? `${n.ssid}    (current)` : n.ssid) });
        const ssid = selected.replace(/\s+\(current\)$/, "");
        const t = nets.find((n) => n.ssid === ssid);
        if (t?.current && conn.transport === "wifi") {
          console.error(`\n${text.tag("wifi")} Error: Cannot remove active WiFi network while connected via WiFi.\n  Connect via USB cable and try again.\n`);
          continue;
        }
        await wifi.remove(conn, ssid);
        const remaining = await wifi.list(conn);
        console.log(`${text.tag(conn.transport)} Removed WiFi network "${ssid}".`);
        console.log(`  Remaining networks: ${wifi.formatSummary(remaining)}`);
        break;
      }
      if (action === "reset") {
        if (conn.transport === "wifi") {
          console.error(`\n${text.tag("wifi")} Error: Cannot run 'wifi reset' over WiFi — this would disconnect\n  the Pi and lock you out. Connect via USB cable and try again.\n`);
          continue;
        }
        if (!confirm("This will remove ALL saved WiFi networks. The Pi will only be\nreachable via USB after this. Continue?")) { console.log("Cancelled."); continue; }
        await wifi.reset(conn);
        console.log(`${text.tag(conn.transport)} All WiFi networks removed. Pi is now USB-only.`);
        break;
      }
    }
  }))
  .command("add", wifiAddCmd)
  .command("list", wifiListCmd)
  .command("remove", wifiRemoveCmd)
  .command("reset", wifiResetCmd);

// --- setup ---

const setupCmd = new Command()
  .description("Configure a freshly-flashed DietPi SD card")
  .arguments("[volume:string]")
  // deno-lint-ignore no-explicit-any
  .action(handleErrors(async (_opts: any, volume?: string) => {
    if (!volume) volume = await bootVolume.detectBootVolume();
    try { await Deno.stat(`${volume}/dietpi.txt`); } catch {
      die(`Error: ${volume} does not look like a DietPi boot partition.\n  Expected to find dietpi.txt`, EXIT.USAGE);
    }
    const password = prompt("Root password for the Pi:");
    if (!password || password.length < 6) die("Error: Password must be at least 6 characters.", EXIT.USAGE);
    console.log(`\nConfiguring ${volume}...\n`);
    const envText = await Deno.readTextFile(`${IMAGE_DIR}/dietpi.env`);
    const overrides = text.parseOverrides(envText);
    overrides.set("AUTO_SETUP_GLOBAL_PASSWORD", password);
    await bootVolume.patchDietpiTxt(volume, overrides);
    console.log("  dietpi.txt      patched");
    await Deno.copyFile(`${IMAGE_DIR}/Automation_Custom_Script.sh`, `${volume}/Automation_Custom_Script.sh`);
    console.log("  Automation_Custom_Script.sh  copied");
    await bootVolume.ensureConfigLine(`${volume}/config.txt`, "dtoverlay=dwc2");
    console.log("  config.txt      dtoverlay=dwc2");
    await bootVolume.ensureCmdlineParam(`${volume}/cmdline.txt`, "modules-load=dwc2,g_ether");
    console.log("  cmdline.txt     modules-load=dwc2,g_ether");
    try { await Deno.stat(`${CLI_DIR}.env`); console.log("  .env            already exists"); } catch {
      await Deno.copyFile(`${CLI_DIR}assets/.env.example`, `${CLI_DIR}.env`);
      console.log("  .env            created from .env.example");
    }
    console.log("\nDone. Next steps:");
    console.log("  1. Fill in .env with your ngrok credentials");
    console.log("  2. Eject SD card and insert into Pi");
    console.log("  3. Connect Pi to Mac via USB-C cable");
    console.log("  4. Wait 3-5 minutes for first boot");
    console.log("  5. Run: deno task pi init");
  }));

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
  .description("Initialize Pi: SSH key, ngrok, fail2ban, clean login")
  // deno-lint-ignore no-explicit-any
  .action(handleErrors(async (_opts: any) => {
    const conn: Conn = { transport: "usb", ...USB };
    console.log("Connecting to Pi...");
    if (!(await ssh.hasKey())) await ssh.setupKey(conn, text.tag("usb"));
    const probe = await ssh.probe(conn);
    if (!probe.ok) die(`${text.tag("usb")} Error: ${sshHelpers.wrapSshErr(probe.error, conn)}`, EXIT.CONNECTION);
    console.log(`${text.tag("usb")} Connected to root@${USB.host}.`);
    const connectivity = await configStore.loadConnectivity(TARGET);
    if (!connectivity.tcp) die(`Error: Pi "${TARGET}" has no TCP URL in connectivity.json.`, EXIT.GENERAL);
    if (!connectivity.http) die(`Error: Pi "${TARGET}" has no HTTP URL in connectivity.json.`, EXIT.GENERAL);
    const tcpUrl = connectivity.tcp;
    const httpUrl = connectivity.http;
    const users = await configStore.loadUsers(TARGET);
    const httpAuth = users.credentials;
    const env = await configStore.readDotEnv();
    const authtoken = env.get("NGROK_AUTHTOKEN");
    if (!authtoken) die("Error: NGROK_AUTHTOKEN not set in .env", EXIT.GENERAL);
    console.log("\nWaiting for network...");
    const netCheck = await ssh.exec(conn, `for i in $(seq 1 30); do ping -c1 -W2 deb.debian.org >/dev/null 2>&1 && echo ONLINE && exit 0; sleep 2; done; echo OFFLINE`);
    if (!netCheck.stdout.includes("ONLINE")) die(`${text.tag("usb")} Error: Pi has no internet after 60s. Check WiFi config.`, EXIT.TIMEOUT);
    console.log("Installing ngrok...");
    const installNgrok = await ssh.exec(conn, [`curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null`, `echo "deb https://ngrok-agent.s3.amazonaws.com buster main" > /etc/apt/sources.list.d/ngrok.list`, `apt-get update -qq >/dev/null 2>&1`, `apt-get install -y -qq ngrok >/dev/null 2>&1`].join(" && "));
    if (!installNgrok.ok) die(`${text.tag("usb")} Error: Failed to install ngrok.\n  ${installNgrok.stderr}`, EXIT.GENERAL);
    const ngrokConfig = ngrokBuilder.buildYaml({ authtoken, tcpUrl, httpDomain: httpUrl, httpAuth });
    await ssh.exec(conn, "mkdir -p /root/.config/ngrok");
    const writeConfig = await ssh.exec(conn, `cat > /root/.config/ngrok/ngrok.yml << 'CFGEOF'\n${ngrokConfig}\nCFGEOF`);
    if (!writeConfig.ok) die(`${text.tag("usb")} Error: Failed to write ngrok config.\n  ${writeConfig.stderr}`, EXIT.GENERAL);
    const writeNgrokSvc = await ssh.exec(conn, `cat > /etc/systemd/system/ngrok.service << 'SVCEOF'\n${NGROK_SERVICE}SVCEOF`);
    if (!writeNgrokSvc.ok) die(`${text.tag("usb")} Error: Failed to write ngrok service.\n  ${writeNgrokSvc.stderr}`, EXIT.GENERAL);
    const startNgrok = await ssh.exec(conn, "systemctl daemon-reload && systemctl enable ngrok && systemctl start ngrok");
    if (!startNgrok.ok) die(`${text.tag("usb")} Error: Failed to start ngrok service.\n  ${startNgrok.stderr}`, EXIT.GENERAL);
    await new Promise((r) => setTimeout(r, 3000));
    const tunnel = await ssh.exec(conn, `curl -s localhost:4040/api/tunnels`);
    if (tunnel.ok && (tunnel.stdout.includes("tcp://") || tunnel.stdout.includes("https://"))) {
      console.log(`${text.tag("usb")} ngrok installed and configured.`);
      console.log(`${text.tag("usb")} TCP tunnel: ${tcpUrl} -> localhost:22`);
      console.log(`${text.tag("usb")} HTTP tunnel: ${httpUrl} -> localhost:80`);
    } else { console.log(`${text.tag("usb")} ngrok installed but tunnels not yet active. Check: deno task pi status`); }
    console.log("\nInstalling fail2ban...");
    const f2b = await ssh.exec(conn, `apt-get install -y -qq fail2ban >/dev/null 2>&1`);
    if (!f2b.ok) console.log(`${text.tag("usb")} Warning: Failed to install fail2ban. Install manually.`);
    else console.log(`${text.tag("usb")} fail2ban installed.`);
    console.log("Configuring clean login...");
    await ssh.exec(conn, [`touch /root/.hushlogin`, `command -v dietpi-banner >/dev/null && dietpi-banner 0 || true`, `grep -q '^clear$' /root/.bashrc || echo 'clear' >> /root/.bashrc`].join(" && "));
    await ssh.exec(conn, `dpkg -l dropbear >/dev/null 2>&1 && apt-get remove -y -qq dropbear >/dev/null 2>&1 || true`);
    console.log(`\n${text.tag("usb")} Pi initialized.\n`);
    console.log("Next steps:");
    console.log("  Share your WiFi:  deno task pi wifi add");
    console.log("  Health dashboard: deno task pi status");
    console.log("  Disconnect USB and verify remote access:");
    console.log("                    deno task pi -w");
  }));

// --- deploy ---

const deployCoordinator = new DeployCoordinator({
  loadTargets: (piName: string) => configStore.loadTargets(piName),
  resolveSshConn: () => transport.resolve(transport.getTransport({}), TARGET),
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
      throw new CliError(`${text.tag(conn.transport)} Error: Failed to copy ${localPath} to ${remotePath}.`, EXIT.GENERAL);
    }
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);
    const dirName = localPath.replace(/\/$/, "").split("/").pop();
    console.log(`${text.tag(conn.transport)} ${dirName}/ copied (${elapsed}s)`);
  },
  sshExec: (conn, cmd) => ssh.exec(conn, cmd),
  log: (msg: string) => console.log(msg),
  projectRoot: PROJECT_ROOT,
  configDir: CONFIG_DIR + "/",
});

const deployCmd = new Command()
  .description("Deploy backend, UI, and targets to the Pi")
  .option("--dry-run", "Validate config and show deployment plan without executing")
  .option("--fresh", "Drain backend, stop services, wipe app dirs, then deploy fresh")
  // deno-lint-ignore no-explicit-any
  .action(handleErrors(async (opts: any) => {
    await deployCoordinator.run(TARGET, { dryRun: !!opts.dryRun, fresh: !!opts.fresh });
  }));

// --- overclock ---

const overclockStatusCmd = new Command()
  .description("Show current overclock level and temperature")
  // deno-lint-ignore no-explicit-any
  .action(handleErrors(async (opts: any) => {
    const conn = await transport.resolve(transport.getTransport(opts), TARGET);
    const [, profile] = await overclockIo.detectModel(conn);
    console.log(`${text.tag(conn.transport)} Overclock Status`);
    const r = await ssh.exec(conn, ["cat /boot/firmware/config.txt", 'echo "---TEMP---"', "cat /sys/class/thermal/thermal_zone0/temp", 'echo "---FREQ---"', "cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq", 'echo "---THROTTLE---"', "vcgencmd get_throttled 2>/dev/null || echo throttled=n/a"].join(" && "));
    if (!r.ok) die(`${text.tag(conn.transport)} Error: ${r.stderr}`, EXIT.GENERAL);
    const configTxt = r.stdout.split("---TEMP---")[0];
    const temp = parseInt(r.stdout.split("---TEMP---")[1]?.split("---FREQ---")[0]?.trim() || "0") / 1000;
    const freq = Math.round(parseInt(r.stdout.split("---FREQ---")[1]?.split("---THROTTLE---")[0]?.trim() || "0") / 1000);
    const throttle = r.stdout.split("---THROTTLE---")[1]?.trim().split("=")[1] || "n/a";
    const armFreqMatch = configTxt.match(/^arm_freq=(\d+)/m);
    const currentFreq = armFreqMatch ? parseInt(armFreqMatch[1]) : 0;
    let matchedLevel = 0;
    for (let i = 0; i < profile.levels.length; i++) {
      if (profile.levels[i].arm_freq === currentFreq) matchedLevel = i + 1;
    }
    console.log(`  Model:    ${profile.name}`);
    if (matchedLevel > 0) console.log(`  Level:    ${matchedLevel}/5 (${ocHelpers.levelDesc(profile.levels[matchedLevel - 1])})`);
    else console.log(`  Level:    custom (arm_freq=${currentFreq || "stock"})`);
    console.log(`  CPU:      ${freq} MHz @ ${temp.toFixed(1)}\u00B0C`);
    console.log(`  Throttle: ${throttle === "0x0" ? "none" : throttle}`);
  }));

const overclockCmd = new Command()
  .description("Overclock the Pi (auto-tune or set level directly)")
  .arguments("[level:number]")
  .option("--resume", "Resume auto-tune from current level")
  // deno-lint-ignore no-explicit-any
  .action(handleErrors(async (opts: any, level?: number) => {
    const conn = await transport.resolve(transport.getTransport(opts), TARGET);
    const [, profile] = await overclockIo.detectModel(conn);
    if (level !== undefined) {
      if (level < 1 || level > 5) die("Error: Level must be between 1 and 5.", EXIT.USAGE);
      const target = profile.levels[level - 1];
      console.log(`${text.tag(conn.transport)} Applying level ${level}/5 (${ocHelpers.levelDesc(target)}) to ${profile.name}`);
      const patch = await ssh.exec(conn, ocHelpers.patchConfigTxtScript(target));
      if (!patch.ok) die(`${text.tag(conn.transport)} Error: Failed to patch config.txt\n  ${patch.stderr}`, EXIT.GENERAL);
      console.log("Rebooting...");
      await ssh.exec(conn, "reboot");
      if (await overclockIo.waitForReboot(conn)) {
        const t = await overclockIo.readTemp(conn);
        console.log(`${text.tag(conn.transport)} Level ${level}/5 applied. CPU @ ${t.toFixed(1)}\u00B0C`);
      } else {
        console.log(`\nPi didn't come back after 3 minutes.\n`);
        console.log("Recovery options:");
        console.log("  1. Wait — it may still be booting");
        console.log("  2. Power cycle the Pi");
        console.log("  3. Hold Shift during boot to skip overclock (safe mode)");
      }
      return;
    }
    console.log(`${text.tag(conn.transport)} Overclock auto-tune \u2014 ${profile.name}`);
    console.log("Estimated time: ~60 minutes (5 levels x 10-min stress tests + reboots)\n");
    let startLevel = 0;
    if (opts.resume) {
      const cfg = await ssh.exec(conn, "cat /boot/firmware/config.txt");
      const m = cfg.stdout.match(/^arm_freq=(\d+)/m);
      if (m) { const curFreq = parseInt(m[1]); for (let i = 0; i < profile.levels.length; i++) { if (profile.levels[i].arm_freq === curFreq) startLevel = i + 1; } }
      if (startLevel > 0) console.log(`Resuming from level ${startLevel + 1}/5\n`);
    }
    console.log("Installing stress-ng...");
    const stressInstall = await ssh.exec(conn, "command -v stress-ng >/dev/null || apt-get install -y -qq stress-ng >/dev/null 2>&1");
    if (!stressInstall.ok) die(`${text.tag(conn.transport)} Error: Failed to install stress-ng.\n  ${stressInstall.stderr}`, EXIT.GENERAL);
    await overclockIo.setupWatchdog(conn);
    let bestLevel = startLevel;
    for (let i = startLevel; i < profile.levels.length; i++) {
      const lvl = profile.levels[i];
      const num = i + 1;
      console.log(`\nLevel ${num}/5 (${ocHelpers.levelDesc(lvl)})`);
      await overclockIo.installDeadManSwitch(conn);
      const patch = await ssh.exec(conn, ocHelpers.patchConfigTxtScript(lvl));
      if (!patch.ok) { console.log(`  Error patching config.txt: ${patch.stderr}`); await overclockIo.cancelDeadManSwitch(conn); break; }
      await Deno.stdout.write(new TextEncoder().encode("  Rebooting... "));
      await ssh.exec(conn, "reboot");
      const came_back = await overclockIo.waitForReboot(conn);
      if (!came_back) {
        console.log("no response after 3 minutes.\n");
        console.log("  The Pi may have crashed. Recovery options:");
        console.log("    1. Wait \u2014 the dead man's switch will revert settings in ~20 min");
        console.log("    2. Power cycle \u2014 the Pi will boot with reverted settings");
        console.log("    3. Hold Shift during boot to skip overclock (safe mode)");
        return;
      }
      console.log("connected.");
      const cpuCount = await ssh.exec(conn, "nproc");
      const cores = parseInt(cpuCount.stdout) || 4;
      await ssh.exec(conn, `nohup stress-ng --cpu ${cores} --timeout 600 >/dev/null 2>&1 &`);
      let peakTemp = 0;
      const stressDuration = 600;
      const pollInterval = 5;
      for (let s = 0; s < stressDuration; s += pollInterval) {
        await new Promise((r) => setTimeout(r, pollInterval * 1000));
        const t = await overclockIo.readTemp(conn);
        if (t > peakTemp) peakTemp = t;
        const remaining = Math.ceil((stressDuration - s - pollInterval) / 60);
        await Deno.stdout.write(new TextEncoder().encode(`\r  Stress test: ~${remaining}m remaining [peak ${peakTemp.toFixed(1)}\u00B0C]    `));
      }
      console.log("");
      if (peakTemp >= profile.temp_max) {
        console.log(`  Failed \u2014 peak ${peakTemp.toFixed(1)}\u00B0C exceeds threshold (${profile.temp_max}\u00B0C)`);
        if (bestLevel > 0) { console.log(`  Reverting to level ${bestLevel}...`); await ssh.exec(conn, ocHelpers.patchConfigTxtScript(profile.levels[bestLevel - 1])); }
        await overclockIo.cancelDeadManSwitch(conn);
        if (bestLevel > 0) { await ssh.exec(conn, "reboot"); await overclockIo.waitForReboot(conn); }
        break;
      }
      console.log(`  Passed \u2014 peak ${peakTemp.toFixed(1)}\u00B0C (threshold: ${profile.temp_max}\u00B0C)`);
      await overclockIo.cancelDeadManSwitch(conn);
      bestLevel = num;
    }
    console.log(`\nResult: Level ${bestLevel}/5${bestLevel > 0 ? ` (${ocHelpers.levelDesc(profile.levels[bestLevel - 1])})` : " (stock)"}`);
  }))
  .command("status", overclockStatusCmd);

// --- status ---

const statusCmd = new Command()
  .description("Pi health dashboard")
  // deno-lint-ignore no-explicit-any
  .action(handleErrors(async (opts: any) => {
    const conn = await transport.resolve(transport.getTransport(opts), TARGET);
    console.log(`${text.tag(conn.transport)} Pi Status`);
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
    if (!r.ok) die(`${text.tag(conn.transport)} Error: Failed to get status.\n  ${r.stderr}`, EXIT.GENERAL);
    const info: Record<string, string> = {};
    for (const line of r.stdout.split("\n")) { const i = line.indexOf(":"); if (i > 0) info[line.slice(0, i)] = line.slice(i + 1).trim(); }
    console.log(`  Transport:  ${conn.transport === "usb" ? "USB" : "WiFi"} (${conn.host})`);
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
  }));

// --- root command ---

await new Command()
  .name("arachne")
  .version("1.0.0")
  .description(
    `arachne \u2014 Raspberry Pi management over USB or WiFi\n\n` +
      `Target: ${TARGET}\n\n` +
      "Transport is auto-detected via ARP lookup. Falls back to WiFi\n" +
      "if USB is unavailable. Output is prefixed with [usb] or [wifi].\n\n" +
      "Exit codes:\n" +
      "  0  Success          3  Connection failed\n" +
      "  1  General error    4  Timeout\n" +
      "  2  Usage error      5  Operation blocked",
  )
  .globalOption("--via-usb, -u", "Force USB transport (no fallback)")
  .globalOption("--via-wifi, -w", "Force WiFi transport (no fallback)")
  // deno-lint-ignore no-explicit-any
  .action(handleErrors(async (opts: any) => {
    const conn = await transport.resolve(transport.getTransport(opts), TARGET);
    console.log(`${text.tag(conn.transport)} Connected.`);
    const proc = new Deno.Command("ssh", {
      args: sshHelpers.sshArgs(conn, ssh.getConfig()),
      stdin: "inherit", stdout: "inherit", stderr: "inherit",
    });
    const s = await proc.spawn().status;
    Deno.exit(s.code);
  }))
  .command("setup", setupCmd)
  .command("init", initCmd)
  .command("deploy", deployCmd)
  .command("status", statusCmd)
  .command("wifi", wifiCmd)
  .command("overclock", overclockCmd)
  .parse(Deno.args.slice(1));
