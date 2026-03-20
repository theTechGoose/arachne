import { Command } from "https://deno.land/x/cliffy@v1.0.0-rc.4/command/mod.ts";
import { Select } from "https://deno.land/x/cliffy@v1.0.0-rc.4/prompt/select.ts";

// --- exit codes (surface.md) ---

const EXIT = {
  OK: 0,
  GENERAL: 1,
  USAGE: 2,
  CONNECTION: 3,
  TIMEOUT: 4,
  BLOCKED: 5,
} as const;

// --- constants ---

const SSH_USER = "root";
const KEY_PATH = `${Deno.env.get("HOME")}/.ssh/arachne_ed25519`;
const USB = { host: "10.0.0.1", port: "22" };
const WIFI = { host: "3.tcp.ngrok.io", port: "21045" };
const TIMEOUTS = { arp: 2, ssh: 5 };

// --- types ---

type Transport = "usb" | "wifi";
interface Conn {
  transport: Transport;
  host: string;
  port: string;
}
interface Flags {
  viaUsb?: boolean;
  viaWifi?: boolean;
}
interface Network {
  id: string;
  ssid: string;
  current: boolean;
}

// --- helpers ---

function tag(tr: Transport): string {
  return `[${tr}]`;
}

function die(msg: string, code: number): never {
  console.error(msg);
  Deno.exit(code);
}

function esc(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function getTransport(f: Flags): Transport | undefined {
  if (f.viaUsb && f.viaWifi)
    die("Error: Cannot use both --via-usb and --via-wifi.", EXIT.USAGE);
  return f.viaUsb ? "usb" : f.viaWifi ? "wifi" : undefined;
}

function wrapSshErr(raw: string, c: Conn): string {
  if (raw.includes("REMOTE HOST IDENTIFICATION HAS CHANGED"))
    return `SSH host key changed (reimaged?).\n  Run: ssh-keygen -R ${c.host}`;
  if (raw.includes("Connection refused"))
    return c.transport === "usb"
      ? "Connection refused. Is the Pi powered on? Check the USB cable."
      : "Connection refused. Is ngrok running on the Pi?";
  if (raw.includes("timed out"))
    return c.transport === "usb"
      ? "Connection timed out. Check the USB cable."
      : "Connection timed out. Check the ngrok tunnel.";
  if (raw.includes("Permission denied"))
    return "Permission denied. SSH key may not be authorized.";
  return raw;
}

function networkSummary(nets: Network[]): string {
  if (nets.length === 0) return "(none)";
  return nets
    .map((n) => `${n.ssid}${n.current ? " (current)" : ""}`)
    .join(", ");
}

// --- SSH ---

function sshArgs(
  c: Conn,
  opts?: { batch?: boolean; cmd?: string },
): string[] {
  const a = [
    "-i",
    KEY_PATH,
    "-p",
    c.port,
    "-o",
    `ConnectTimeout=${TIMEOUTS.ssh}`,
    "-o",
    "SetEnv=TERM=xterm-256color",
  ];
  if (opts?.batch) a.push("-o", "BatchMode=yes");
  a.push(`${SSH_USER}@${c.host}`);
  if (opts?.cmd) a.push(opts.cmd);
  return a;
}

async function sshExec(c: Conn, cmd: string) {
  const p = new Deno.Command("ssh", {
    args: sshArgs(c, { batch: true, cmd }),
    stdout: "piped",
    stderr: "piped",
  });
  const o = await p.output();
  return {
    ok: o.success,
    stdout: new TextDecoder().decode(o.stdout).trim(),
    stderr: new TextDecoder().decode(o.stderr).trim(),
    code: o.code,
  };
}

async function sshProbe(c: Conn) {
  const r = await sshExec(c, "echo ok");
  return { ok: r.ok, error: r.stderr };
}

// --- key management ---

async function hasKey(): Promise<boolean> {
  try {
    await Deno.stat(KEY_PATH);
    return true;
  } catch {
    return false;
  }
}

async function setupKey(c: Conn) {
  console.log("Generating SSH key...");
  const kg = new Deno.Command("ssh-keygen", {
    args: ["-t", "ed25519", "-f", KEY_PATH, "-N", "", "-C", "arachne"],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (!(await kg.output()).success)
    die("Failed to generate SSH key.", EXIT.GENERAL);

  console.log(
    `\n${tag(c.transport)} Copying key to ${SSH_USER}@${c.host}:${c.port}...`,
  );
  console.log("You will be prompted for the password.\n");
  const cp = new Deno.Command("ssh-copy-id", {
    args: ["-i", KEY_PATH, "-p", c.port, `${SSH_USER}@${c.host}`],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (!(await cp.output()).success)
    die("Failed to copy SSH key.", EXIT.GENERAL);
  console.log("");
}

// --- transport detection ---

async function arpDetect(): Promise<boolean> {
  try {
    const p = new Deno.Command("arp", {
      args: ["-n", USB.host],
      stdout: "piped",
      stderr: "piped",
    });
    const child = p.spawn();
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch { /* already exited */ }
    }, TIMEOUTS.arp * 1000);
    const o = await child.output();
    clearTimeout(timer);
    const out = new TextDecoder().decode(o.stdout);
    return out.includes("at ") && !out.includes("(incomplete)");
  } catch {
    return false;
  }
}

async function resolve(
  forced: Transport | undefined,
  blockedOverWifi = false,
): Promise<Conn> {
  const candidate: Transport = forced ??
    ((await arpDetect()) ? "usb" : "wifi");
  const conn: Conn = candidate === "usb"
    ? { transport: "usb", ...USB }
    : { transport: "wifi", ...WIFI };

  if (!(await hasKey())) await setupKey(conn);

  const probe = await sshProbe(conn);
  if (probe.ok) return conn;

  // Forced transport — no fallback
  if (forced) {
    die(
      `${tag(forced)} Error: ${wrapSshErr(probe.error, conn)}`,
      EXIT.CONNECTION,
    );
  }

  // Auto-detect: USB detected by ARP but SSH failed
  if (candidate === "usb") {
    if (blockedOverWifi) {
      die(
        `Error: USB was detected but SSH failed, and this command is blocked over WiFi.\n` +
          `  ${probe.error}\n` +
          `  Check your USB cable connection and try again.`,
        EXIT.BLOCKED,
      );
    }
    console.log(
      `${tag("usb")} SSH connection failed. Falling back to WiFi...`,
    );
    const wc: Conn = { transport: "wifi", ...WIFI };
    const wp = await sshProbe(wc);
    if (wp.ok) return wc;
    die(
      `Error: Could not connect to Pi.\n` +
        `  USB  (${USB.host}:${USB.port})             — ${probe.error}\n` +
        `  WiFi (${WIFI.host}:${WIFI.port}) — ${wp.error}\n` +
        `  Check that the Pi is powered on and reachable.`,
      EXIT.CONNECTION,
    );
  }

  // WiFi candidate failed
  die(
    `${tag("wifi")} Error: ${wrapSshErr(probe.error, conn)}`,
    EXIT.CONNECTION,
  );
}

// --- Mac SSID detection ---

async function getMacSsid(): Promise<string> {
  const p = new Deno.Command("ipconfig", {
    args: ["getsummary", "en0"],
    stdout: "piped",
    stderr: "piped",
  });
  const out = new TextDecoder().decode((await p.output()).stdout);
  const m = out.match(/^\s+SSID\s*:\s*(.+)$/m);
  if (!m)
    die(
      "Error: Could not detect current WiFi network.\n  Specify an SSID: deno task pi wifi add <ssid>",
      EXIT.GENERAL,
    );
  return m[1].trim();
}

// --- WiFi operations ---

async function wifiList(c: Conn): Promise<Network[]> {
  const r = await sshExec(c, "wpa_cli -i wlan0 list_networks");
  if (!r.ok)
    die(
      `${tag(c.transport)} Error: Failed to list WiFi networks.\n  ${r.stderr}`,
      EXIT.GENERAL,
    );
  return r.stdout
    .split("\n")
    .slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const p = line.split("\t");
      return {
        id: p[0],
        ssid: p[1],
        current: (p[3] || "").includes("CURRENT"),
      };
    });
}

async function wifiAdd(c: Conn, ssid: string, password: string) {
  const script = [
    `EXISTING=$(wpa_cli -i wlan0 list_networks | awk -F'\\t' -v s=${esc(ssid)} '$2==s{print $1}')`,
    `[ -n "$EXISTING" ] && wpa_cli -i wlan0 remove_network $EXISTING >/dev/null`,
    `wpa_passphrase ${esc(ssid)} ${esc(password)} >> /etc/wpa_supplicant/wpa_supplicant.conf`,
    `wpa_cli -i wlan0 reconfigure >/dev/null`,
  ].join("; ");
  const r = await sshExec(c, script);
  if (!r.ok)
    die(
      `${tag(c.transport)} Error: Failed to add WiFi network.\n  ${r.stderr || r.stdout}`,
      EXIT.GENERAL,
    );
}

async function wifiRemove(c: Conn, ssid: string) {
  const script = [
    `NETID=$(wpa_cli -i wlan0 list_networks | awk -F'\\t' -v s=${esc(ssid)} '$2==s{print $1}')`,
    `[ -z "$NETID" ] && echo NOT_FOUND && exit 1`,
    `wpa_cli -i wlan0 remove_network $NETID >/dev/null && wpa_cli -i wlan0 save_config >/dev/null`,
  ].join("; ");
  const r = await sshExec(c, script);
  if (r.stdout.includes("NOT_FOUND"))
    die(
      `${tag(c.transport)} Error: Network "${ssid}" not found.\n  Run 'deno task pi wifi list' to see saved networks.`,
      EXIT.GENERAL,
    );
  if (!r.ok)
    die(
      `${tag(c.transport)} Error: Failed to remove network.\n  ${r.stderr}`,
      EXIT.GENERAL,
    );
}

async function wifiDoReset(c: Conn) {
  const script =
    `for id in $(wpa_cli -i wlan0 list_networks | tail -n +2 | awk '{print $1}'); do wpa_cli -i wlan0 remove_network $id >/dev/null; done; wpa_cli -i wlan0 save_config >/dev/null`;
  const r = await sshExec(c, script);
  if (!r.ok)
    die(
      `${tag(c.transport)} Error: Failed to reset WiFi config.\n  ${r.stderr}`,
      EXIT.GENERAL,
    );
}

// --- password from stdin ---

async function readPasswordStdin(): Promise<string> {
  if (Deno.stdin.isTerminal())
    die("Error: --password-stdin requires piped input.", EXIT.USAGE);
  const buf = new Uint8Array(65536);
  const n = await Deno.stdin.read(buf);
  if (n === null) die("Error: No input on stdin.", EXIT.USAGE);
  return new TextDecoder().decode(buf.subarray(0, n)).split("\n")[0];
}

// --- setup helpers (local, no SSH) ---

const IMAGE_DIR = new URL("../../image", import.meta.url).pathname;

async function detectBootVolume(): Promise<string> {
  const volumes: string[] = [];
  for await (const entry of Deno.readDir("/Volumes")) {
    if (!entry.isDirectory) continue;
    try {
      await Deno.stat(`/Volumes/${entry.name}/dietpi.txt`);
      volumes.push(`/Volumes/${entry.name}`);
    } catch { /* not a DietPi volume */ }
  }
  if (volumes.length === 0)
    die(
      "Error: No DietPi SD card found.\n  Insert the SD card and try again.",
      EXIT.GENERAL,
    );
  if (volumes.length === 1) return volumes[0];
  return await Select.prompt({
    message: "Multiple DietPi volumes found:",
    options: volumes,
  });
}

function parseOverrides(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) map.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  return map;
}

async function patchDietpiTxt(volume: string, overrides: Map<string, string>) {
  const path = `${volume}/dietpi.txt`;
  let content = await Deno.readTextFile(path);
  for (const [key, value] of overrides) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content += `${key}=${value}\n`;
    }
  }
  await Deno.writeTextFile(path, content);
}

async function ensureConfigLine(path: string, line: string) {
  let content = await Deno.readTextFile(path);
  if (content.includes(line)) return;
  content = content.trimEnd() + "\n" + line + "\n";
  await Deno.writeTextFile(path, content);
}

async function ensureCmdlineParam(path: string, param: string) {
  let content = await Deno.readTextFile(path);
  content = content.trim();
  if (content.includes(param)) return;
  content += " " + param;
  await Deno.writeTextFile(path, content + "\n");
}

// ============================================================
// CLI
// ============================================================

// --- wifi add ---

const wifiAddCmd = new Command()
  .description("Add a WiFi network")
  .arguments("[ssid:string] [password:string]")
  .option("--password-stdin", "Read password from stdin")
  // deno-lint-ignore no-explicit-any
  .action(async (opts: any, ssid?: string, password?: string) => {
      if (opts.passwordStdin && password)
        die(
          "Error: Cannot use both positional password and --password-stdin.",
          EXIT.USAGE,
        );
      const conn = await resolve(getTransport(opts));

      if (!ssid) ssid = await getMacSsid();

      if (opts.passwordStdin) {
        password = await readPasswordStdin();
      } else if (!password) {
        password = prompt("Password:") ?? undefined;
        if (!password) die("Error: No password provided.", EXIT.USAGE);
      }

      await wifiAdd(conn, ssid, password!);
      const nets = await wifiList(conn);
      console.log(`${tag(conn.transport)} Added WiFi network "${ssid}".`);
      console.log(`  Saved networks: ${networkSummary(nets)}`);
    },
  );

// --- wifi list ---

const wifiListCmd = new Command()
  .description("List saved WiFi networks")
  // deno-lint-ignore no-explicit-any
  .action(async (opts: any) => {
    const conn = await resolve(getTransport(opts));
    const nets = await wifiList(conn);
    console.log(`${tag(conn.transport)} Saved WiFi networks:`);
    if (nets.length === 0) {
      console.log("  (none)");
      return;
    }
    for (const n of nets)
      console.log(`  ${n.ssid}${n.current ? "    (current)" : ""}`);
  });

// --- wifi remove ---

const wifiRemoveCmd = new Command()
  .description("Remove a saved WiFi network")
  .arguments("<ssid:string>")
  // deno-lint-ignore no-explicit-any
  .action(async (opts: any, ssid: string) => {
    const conn = await resolve(getTransport(opts));
    const nets = await wifiList(conn);
    const target = nets.find((n) => n.ssid === ssid);

    if (!target)
      die(
        `${tag(conn.transport)} Error: Network "${ssid}" not found.\n  Run 'deno task pi wifi list' to see saved networks.`,
        EXIT.GENERAL,
      );

    if (target.current && conn.transport === "wifi")
      die(
        `${tag("wifi")} Error: Cannot remove active WiFi network while connected via WiFi.\n  Connect via USB cable and try again.`,
        EXIT.BLOCKED,
      );

    await wifiRemove(conn, ssid);
    const remaining = await wifiList(conn);
    console.log(`${tag(conn.transport)} Removed WiFi network "${ssid}".`);
    console.log(`  Remaining networks: ${networkSummary(remaining)}`);
  });

// --- wifi reset ---

const wifiResetCmd = new Command()
  .description("Wipe all WiFi config (USB only)")
  // deno-lint-ignore no-explicit-any
  .action(async (opts: any) => {
    const conn = await resolve(getTransport(opts), true);

    if (conn.transport === "wifi")
      die(
        `${tag("wifi")} Error: Cannot run 'wifi reset' over WiFi — this would disconnect\n  the Pi and lock you out. Connect via USB cable and try again.`,
        EXIT.BLOCKED,
      );

    if (
      !confirm(
        "This will remove ALL saved WiFi networks. The Pi will only be\nreachable via USB after this. Continue?",
      )
    ) {
      console.log("Cancelled.");
      return;
    }

    await wifiDoReset(conn);
    console.log(
      `${tag(conn.transport)} All WiFi networks removed. Pi is now USB-only.`,
    );
  });

// --- wifi (interactive menu) ---

const wifiCmd = new Command()
  .description("Manage WiFi networks on the Pi")
  // deno-lint-ignore no-explicit-any
  .action(async (opts: any) => {
    const conn = await resolve(getTransport(opts));

    while (true) {
      const action = await Select.prompt({
        message: "What do you want to do?",
        options: ["add", "remove", "reset"],
      });

      if (action === "add") {
        const ssidInput = prompt("SSID (blank for current):");
        const ssid = ssidInput || (await getMacSsid());
        const password = prompt("Password:");
        if (!password) {
          console.log("No password provided.");
          continue;
        }
        await wifiAdd(conn, ssid, password);
        const nets = await wifiList(conn);
        console.log(`${tag(conn.transport)} Added WiFi network "${ssid}".`);
        console.log(`  Saved networks: ${networkSummary(nets)}`);
        break;
      }

      if (action === "remove") {
        const nets = await wifiList(conn);
        if (nets.length === 0) {
          console.log(`${tag(conn.transport)} No saved networks.`);
          break;
        }
        const selected = await Select.prompt({
          message: "SSID:",
          options: nets.map((n) =>
            n.current ? `${n.ssid}    (current)` : n.ssid
          ),
        });
        const ssid = selected.replace(/\s+\(current\)$/, "");
        const target = nets.find((n) => n.ssid === ssid);
        if (target?.current && conn.transport === "wifi") {
          console.error(
            `\n${tag("wifi")} Error: Cannot remove active WiFi network while connected via WiFi.\n  Connect via USB cable and try again.\n`,
          );
          continue;
        }
        await wifiRemove(conn, ssid);
        const remaining = await wifiList(conn);
        console.log(`${tag(conn.transport)} Removed WiFi network "${ssid}".`);
        console.log(`  Remaining networks: ${networkSummary(remaining)}`);
        break;
      }

      if (action === "reset") {
        if (conn.transport === "wifi") {
          console.error(
            `\n${tag("wifi")} Error: Cannot run 'wifi reset' over WiFi — this would disconnect\n  the Pi and lock you out. Connect via USB cable and try again.\n`,
          );
          continue;
        }
        if (
          !confirm(
            "This will remove ALL saved WiFi networks. The Pi will only be\nreachable via USB after this. Continue?",
          )
        ) {
          console.log("Cancelled.");
          continue;
        }
        await wifiDoReset(conn);
        console.log(
          `${tag(conn.transport)} All WiFi networks removed. Pi is now USB-only.`,
        );
        break;
      }
    }
  })
  .command("add", wifiAddCmd)
  .command("list", wifiListCmd)
  .command("remove", wifiRemoveCmd)
  .command("reset", wifiResetCmd);

// --- setup (local, no SSH) ---

const setupCmd = new Command()
  .description("Configure a freshly-flashed DietPi SD card")
  .arguments("[volume:string]")
  // deno-lint-ignore no-explicit-any
  .action(async (_opts: any, volume?: string) => {
    if (!volume) volume = await detectBootVolume();

    // Validate
    try {
      await Deno.stat(`${volume}/dietpi.txt`);
    } catch {
      die(
        `Error: ${volume} does not look like a DietPi boot partition.\n  Expected to find dietpi.txt`,
        EXIT.USAGE,
      );
    }

    console.log(`Configuring ${volume}...\n`);

    // 1. Patch dietpi.txt with overrides
    const envText = await Deno.readTextFile(`${IMAGE_DIR}/dietpi.env`);
    const overrides = parseOverrides(envText);
    await patchDietpiTxt(volume, overrides);
    console.log("  dietpi.txt      patched");

    // 2. Copy first-boot.sh
    await Deno.copyFile(
      `${IMAGE_DIR}/first-boot.sh`,
      `${volume}/first-boot.sh`,
    );
    console.log("  first-boot.sh   copied");

    // 3. Enable USB gadget overlay in config.txt
    await ensureConfigLine(`${volume}/config.txt`, "dtoverlay=dwc2");
    console.log("  config.txt      dtoverlay=dwc2");

    // 4. Add modules-load to cmdline.txt
    await ensureCmdlineParam(
      `${volume}/cmdline.txt`,
      "modules-load=dwc2,g_ether",
    );
    console.log("  cmdline.txt     modules-load=dwc2,g_ether");

    console.log("\nDone. Eject the SD card, insert into Pi, and power on.");
    console.log("First boot takes a few minutes to complete setup.");
    console.log(`After boot, connect via USB: ssh root@${USB.host}`);
  });

// --- deploy ---

const deployCmd = new Command()
  .description("Deploy arachne to the Pi")
  // deno-lint-ignore no-explicit-any
  .action(async (opts: any) => {
    const conn = await resolve(getTransport(opts));
    console.log(`${tag(conn.transport)} Deploying to Pi...`);
    const proc = new Deno.Command("ssh", {
      args: sshArgs(conn, { cmd: "echo 'deploy placeholder'" }),
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const s = await proc.spawn().status;
    if (!s.success)
      die(`${tag(conn.transport)} Error: Deploy failed.`, EXIT.GENERAL);
    console.log("Done.");
  });

// --- status ---

const statusCmd = new Command()
  .description("Pi health dashboard")
  // deno-lint-ignore no-explicit-any
  .action(async (opts: any) => {
    const conn = await resolve(getTransport(opts));
    console.log(`${tag(conn.transport)} Pi Status`);
    console.log("\u2500".repeat(44));

    const script = [
      'echo "hostname:$(hostname)"',
      'echo "uptime:$(uptime -p 2>/dev/null || uptime)"',
      'echo "cpu_temp:$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo n/a)"',
      'echo "mem_total:$(free -m | awk \'/Mem:/{print $2}\')"',
      'echo "mem_used:$(free -m | awk \'/Mem:/{print $3}\')"',
      'echo "mem_avail:$(free -m | awk \'/Mem:/{print $7}\')"',
      'echo "disk_total:$(df -h / | awk \'NR==2{print $2}\')"',
      'echo "disk_used:$(df -h / | awk \'NR==2{print $3}\')"',
      'echo "disk_pct:$(df -h / | awk \'NR==2{print $5}\')"',
      'echo "load:$(cat /proc/loadavg | cut -d\\" \\" -f1-3)"',
      'echo "os:$(cat /etc/os-release 2>/dev/null | grep ^PRETTY_NAME | cut -d= -f2 | tr -d \\\\\\\")"',
      'echo "kernel:$(uname -r)"',
      'echo "wifi_ssid:$(wpa_cli -i wlan0 status 2>/dev/null | grep ^ssid= | cut -d= -f2-)"',
      'echo "service:$(systemctl is-active arachne 2>/dev/null || echo not found)"',
    ].join(" && ");

    const r = await sshExec(conn, script);
    if (!r.ok)
      die(
        `${tag(conn.transport)} Error: Failed to get status.\n  ${r.stderr}`,
        EXIT.GENERAL,
      );

    const info: Record<string, string> = {};
    for (const line of r.stdout.split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) info[line.slice(0, i)] = line.slice(i + 1).trim();
    }

    const fmtTemp = (raw: string) =>
      raw === "n/a" ? "n/a" : `${(parseInt(raw) / 1000).toFixed(1)}\u00B0C`;

    console.log(
      `  Transport:  ${conn.transport === "usb" ? "USB" : "WiFi"} (${conn.host})`,
    );
    console.log(`  Host:       ${info.hostname}`);
    console.log(`  OS:         ${info.os}`);
    console.log(`  Kernel:     ${info.kernel}`);
    console.log(`  Uptime:     ${info.uptime}`);
    console.log(
      `  WiFi:       ${info.wifi_ssid ? `Connected to "${info.wifi_ssid}"` : "Not connected"}`,
    );
    console.log(
      `  Service:    ${info.service === "active" ? "active" : info.service}`,
    );
    console.log("");
    console.log(`  CPU Temp:   ${fmtTemp(info.cpu_temp)}`);
    console.log(`  Load:       ${info.load}`);
    console.log(
      `  Memory:     ${info.mem_used}/${info.mem_total} MB (${info.mem_avail} MB free)`,
    );
    console.log(
      `  Disk:       ${info.disk_used}/${info.disk_total} (${info.disk_pct})`,
    );
  });

// --- root: bare `deno task pi` = SSH ---

await new Command()
  .name("pi")
  .version("1.0.0")
  .description(
    "arachne \u2014 Raspberry Pi management over USB or WiFi\n\n" +
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
  .action(async (opts: any) => {
    const conn = await resolve(getTransport(opts));
    console.log(`${tag(conn.transport)} Connected.`);
    const proc = new Deno.Command("ssh", {
      args: sshArgs(conn),
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const s = await proc.spawn().status;
    Deno.exit(s.code);
  })
  .command("setup", setupCmd)
  .command("deploy", deployCmd)
  .command("status", statusCmd)
  .command("wifi", wifiCmd)
  .parse(Deno.args);
