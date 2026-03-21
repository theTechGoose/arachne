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
const TIMEOUTS = { arp: 2, ssh: 5 };

const TARGET = Deno.args[0];
if (!TARGET) {
  console.error("Usage: deno task <pi-name> [command]\n  See config.json for available targets.");
  Deno.exit(2);
}

// --- config ---

interface PiUrls {
  tcp: string;
  http: string;
}

interface PiEntry {
  urls?: PiUrls;
}

type Config = Record<string, PiEntry>;

let _config: Config | undefined;

function loadConfig(): Config {
  if (_config) return _config;
  try {
    _config = JSON.parse(Deno.readTextFileSync("config.json"));
  } catch {
    die(
      "Error: config.json not found.\n  Copy config.example.json to config.json and fill in your Pi URLs.",
      EXIT.GENERAL,
    );
  }
  return _config!;
}

function getPi(): [string, PiEntry] {
  const config = loadConfig();
  const pi = config[TARGET];
  if (!pi) die(`Error: Pi "${TARGET}" not found in config.json.`, EXIT.GENERAL);
  return [TARGET, pi];
}

function loadWifi(): { host: string; port: string } {
  const [name, pi] = getPi();
  if (!pi.urls?.tcp)
    die(`Error: Pi "${name}" has no TCP URL in config.json.`, EXIT.GENERAL);
  const [host, port] = pi.urls.tcp.split(":");
  if (!host || !port)
    die(
      `Error: Invalid TCP URL for Pi "${name}". Expected host:port.`,
      EXIT.USAGE,
    );
  return { host, port };
}

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
    : { transport: "wifi", ...loadWifi() };

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
    const w = loadWifi();
    const wc: Conn = { transport: "wifi", ...w };
    const wp = await sshProbe(wc);
    if (wp.ok) return wc;
    die(
      `Error: Could not connect to Pi.\n` +
        `  USB  (${USB.host}:${USB.port})             — ${probe.error}\n` +
        `  WiFi (${w.host}:${w.port}) — ${wp.error}\n` +
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
    `[ -n "$EXISTING" ] && wpa_cli -i wlan0 remove_network $EXISTING >/dev/null || true`,
    `echo ${esc(password)} | wpa_passphrase ${esc(ssid)} >> /etc/wpa_supplicant/wpa_supplicant.conf`,
    `wpa_cli -i wlan0 reconfigure >/dev/null`,
  ].join(" && ");
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

function stripCr(s: string): string {
  return s.replace(/\r/g, "");
}

async function patchDietpiTxt(volume: string, overrides: Map<string, string>) {
  const path = `${volume}/dietpi.txt`;
  let content = stripCr(await Deno.readTextFile(path));
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
  let content = stripCr(await Deno.readTextFile(path));
  // Match the key part (e.g. "dtoverlay=dwc2") even if commented out
  const key = line.split("=")[0] || line;
  const regex = new RegExp(`^#*${key}\\b.*$`, "m");
  if (regex.test(content)) {
    content = content.replace(regex, line);
  } else {
    content = content.trimEnd() + "\n" + line + "\n";
  }
  await Deno.writeTextFile(path, content);
}

async function ensureCmdlineParam(path: string, param: string) {
  let content = stripCr(await Deno.readTextFile(path));
  // cmdline.txt must be a single line
  const firstLine = content.split("\n")[0].trim();
  if (firstLine.includes(param)) return;
  await Deno.writeTextFile(path, firstLine + " " + param + "\n");
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

    // Prompt for a root password
    const password = prompt("Root password for the Pi:");
    if (!password || password.length < 6)
      die("Error: Password must be at least 6 characters.", EXIT.USAGE);

    console.log(`\nConfiguring ${volume}...\n`);

    // 1. Patch dietpi.txt with overrides
    const envText = await Deno.readTextFile(`${IMAGE_DIR}/dietpi.env`);
    const overrides = parseOverrides(envText);
    overrides.set("AUTO_SETUP_GLOBAL_PASSWORD", password);
    await patchDietpiTxt(volume, overrides);
    console.log("  dietpi.txt      patched");

    // 2. Copy Automation_Custom_Script.sh
    await Deno.copyFile(
      `${IMAGE_DIR}/Automation_Custom_Script.sh`,
      `${volume}/Automation_Custom_Script.sh`,
    );
    console.log("  Automation_Custom_Script.sh  copied");

    // 3. Enable USB gadget overlay in config.txt
    await ensureConfigLine(`${volume}/config.txt`, "dtoverlay=dwc2");
    console.log("  config.txt      dtoverlay=dwc2");

    // 4. Add modules-load to cmdline.txt
    await ensureCmdlineParam(
      `${volume}/cmdline.txt`,
      "modules-load=dwc2,g_ether",
    );
    console.log("  cmdline.txt     modules-load=dwc2,g_ether");

    // 5. Create .env from .env.example if it doesn't exist
    try {
      await Deno.stat(".env");
      console.log("  .env            already exists");
    } catch {
      await Deno.copyFile(".env.example", ".env");
      console.log("  .env            created from .env.example");
    }

    console.log("\nDone. Next steps:");
    console.log("  1. Fill in .env with your ngrok credentials");
    console.log("  2. Eject SD card and insert into Pi");
    console.log("  3. Connect Pi to Mac via USB-C cable");
    console.log("  4. Wait 3-5 minutes for first boot");
    console.log("  5. Run: deno task pi init");
  });

// --- .env reader ---

function readDotEnv(): Map<string, string> {
  let raw: string;
  try {
    raw = Deno.readTextFileSync(".env");
  } catch {
    die("Error: .env not found.\n  Run 'deno task pi setup' first.", EXIT.GENERAL);
  }
  const map = new Map<string, string>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) map.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  return map;
}

// --- init (USB SSH, interactive provisioning) ---

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
  .action(async (opts: any) => {
    // Force USB for init
    const conn: Conn = { transport: "usb", ...USB };
    console.log("Connecting to Pi...");

    // 1. Deploy SSH key if needed
    if (!(await hasKey())) {
      await setupKey(conn);
    }
    const probe = await sshProbe(conn);
    if (!probe.ok)
      die(`${tag("usb")} Error: ${wrapSshErr(probe.error, conn)}`, EXIT.CONNECTION);
    console.log(`${tag("usb")} Connected to ${SSH_USER}@${USB.host}.`);

    // 2. Read config
    const [piName, pi] = getPi();
    if (!pi.urls?.tcp) die(`Error: Pi "${piName}" has no TCP URL in config.json.`, EXIT.GENERAL);
    if (!pi.urls?.http) die(`Error: Pi "${piName}" has no HTTP URL in config.json.`, EXIT.GENERAL);
    const tcpUrl = pi.urls.tcp;
    const httpUrl = pi.urls.http;
    const env = readDotEnv();
    const authtoken = env.get("NGROK_AUTHTOKEN");
    if (!authtoken) die("Error: NGROK_AUTHTOKEN not set in .env", EXIT.GENERAL);

    // 3. Wait for network
    console.log("\nWaiting for network...");
    const netCheck = await sshExec(conn,
      `for i in $(seq 1 30); do ping -c1 -W2 deb.debian.org >/dev/null 2>&1 && echo ONLINE && exit 0; sleep 2; done; echo OFFLINE`
    );
    if (!netCheck.stdout.includes("ONLINE"))
      die(`${tag("usb")} Error: Pi has no internet after 60s. Check WiFi config.`, EXIT.TIMEOUT);

    // 4. Install ngrok
    console.log("Installing ngrok...");
    const installNgrok = await sshExec(conn, [
      `curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null`,
      `echo "deb https://ngrok-agent.s3.amazonaws.com buster main" > /etc/apt/sources.list.d/ngrok.list`,
      `apt-get update -qq >/dev/null 2>&1`,
      `apt-get install -y -qq ngrok >/dev/null 2>&1`,
    ].join(" && "));
    if (!installNgrok.ok)
      die(`${tag("usb")} Error: Failed to install ngrok.\n  ${installNgrok.stderr}`, EXIT.GENERAL);

    // 5. Write ngrok config
    const ngrokConfig = [
      `version: "3"`,
      `agent:`,
      `  authtoken: ${authtoken}`,
      `tunnels:`,
      `  ssh:`,
      `    proto: tcp`,
      `    addr: 22`,
      `    url: ${tcpUrl}`,
      `  http:`,
      `    proto: http`,
      `    addr: 80`,
      `    domain: ${httpUrl}`,
    ].join("\n");
    await sshExec(conn, "mkdir -p /root/.config/ngrok");
    const writeConfig = await sshExec(conn,
      `cat > /root/.config/ngrok/ngrok.yml << 'CFGEOF'\n${ngrokConfig}\nCFGEOF`);
    if (!writeConfig.ok)
      die(`${tag("usb")} Error: Failed to write ngrok config.\n  ${writeConfig.stderr}`, EXIT.GENERAL);

    // 6. Create and start ngrok service
    const writeNgrokSvc = await sshExec(conn,
      `cat > /etc/systemd/system/ngrok.service << 'SVCEOF'\n${NGROK_SERVICE}SVCEOF`);
    if (!writeNgrokSvc.ok)
      die(`${tag("usb")} Error: Failed to write ngrok service.\n  ${writeNgrokSvc.stderr}`, EXIT.GENERAL);
    const startNgrok = await sshExec(conn,
      "systemctl daemon-reload && systemctl enable ngrok && systemctl start ngrok");
    if (!startNgrok.ok)
      die(`${tag("usb")} Error: Failed to start ngrok service.\n  ${startNgrok.stderr}`, EXIT.GENERAL);

    // 7. Verify tunnels
    await new Promise((r) => setTimeout(r, 3000));
    const tunnel = await sshExec(conn, `curl -s localhost:4040/api/tunnels`);
    if (tunnel.ok && (tunnel.stdout.includes("tcp://") || tunnel.stdout.includes("https://"))) {
      console.log(`${tag("usb")} ngrok installed and configured.`);
      console.log(`${tag("usb")} TCP tunnel: ${tcpUrl} -> localhost:22`);
      console.log(`${tag("usb")} HTTP tunnel: ${httpUrl} -> localhost:80`);
    } else {
      console.log(`${tag("usb")} ngrok installed but tunnels not yet active. Check: deno task pi status`);
    }

    // 8. Install fail2ban
    console.log("\nInstalling fail2ban...");
    const f2b = await sshExec(conn, `apt-get install -y -qq fail2ban >/dev/null 2>&1`);
    if (!f2b.ok)
      console.log(`${tag("usb")} Warning: Failed to install fail2ban. Install manually.`);
    else
      console.log(`${tag("usb")} fail2ban installed.`);

    // 9. Clean login
    console.log("Configuring clean login...");
    await sshExec(conn, [
      `touch /root/.hushlogin`,
      `command -v dietpi-banner >/dev/null && dietpi-banner 0 || true`,
      `grep -q '^clear$' /root/.bashrc || echo 'clear' >> /root/.bashrc`,
    ].join(" && "));

    // 10. Remove dropbear if present
    await sshExec(conn, `dpkg -l dropbear >/dev/null 2>&1 && apt-get remove -y -qq dropbear >/dev/null 2>&1 || true`);

    console.log(`\n${tag("usb")} Pi initialized.\n`);
    console.log("Next steps:");
    console.log("  Share your WiFi:  deno task pi wifi add");
    console.log("  Health dashboard: deno task pi status");
    console.log("  Disconnect USB and verify remote access:");
    console.log("                    deno task pi -w");
  });

// --- deploy ---

const ARACHNE_SERVICE = `[Unit]
Description=arachne HTTP server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/root/.deno/bin/deno run --allow-net --allow-read --allow-env /opt/arachne/main.ts
WorkingDirectory=/opt/arachne
Restart=always
RestartSec=5
Environment=HOME=/root

[Install]
WantedBy=multi-user.target
`;

const SRC_DIR = new URL("../../src", import.meta.url).pathname;

const deployCmd = new Command()
  .description("Deploy src/ to the Pi and restart the HTTP server")
  // deno-lint-ignore no-explicit-any
  .action(async (opts: any) => {
    const conn = await resolve(getTransport(opts));

    // 1. Tar src/ locally, pipe through SSH to extract on Pi
    console.log(`${tag(conn.transport)} Deploying src/ to ${TARGET}...`);
    const tar = new Deno.Command("tar", {
      args: ["-cf", "-", "-C", SRC_DIR, "."],
      stdout: "piped",
      stderr: "piped",
    });
    const tarProc = tar.spawn();

    const extract = new Deno.Command("ssh", {
      args: sshArgs(conn, { batch: true, cmd: "mkdir -p /opt/arachne && tar -xf - -C /opt/arachne" }),
      stdin: "piped",
      stdout: "inherit",
      stderr: "piped",
    });
    const extractProc = extract.spawn();
    await tarProc.stdout.pipeTo(extractProc.stdin);
    const extractStatus = await extractProc.status;
    if (!extractStatus.success)
      die(`${tag(conn.transport)} Error: Failed to copy files to Pi.`, EXIT.GENERAL);
    console.log(`${tag(conn.transport)} Files copied.`);

    // 2. Install Deno on Pi if needed
    const hasDeno = await sshExec(conn, "test -f /root/.deno/bin/deno && echo yes || echo no");
    if (hasDeno.stdout.trim() !== "yes") {
      console.log("Installing Deno on Pi...");
      await sshExec(conn, "apt-get install -y -qq unzip >/dev/null 2>&1");
      const install = await sshExec(conn, "curl -fsSL https://deno.land/install.sh | sh");
      if (!install.ok)
        die(`${tag(conn.transport)} Error: Failed to install Deno.\n  ${install.stderr}`, EXIT.GENERAL);
    }

    // 3. Install/update systemd service
    const writeService = await sshExec(conn,
      `cat > /etc/systemd/system/arachne.service << 'SVCEOF'\n${ARACHNE_SERVICE}SVCEOF`);
    if (!writeService.ok)
      die(`${tag(conn.transport)} Error: Failed to write service file.\n  ${writeService.stderr}`, EXIT.GENERAL);
    const startService = await sshExec(conn,
      "systemctl daemon-reload && systemctl enable arachne && systemctl restart arachne");
    if (!startService.ok)
      die(`${tag(conn.transport)} Error: Failed to start arachne service.\n  ${startService.stderr}`, EXIT.GENERAL);

    // 4. Verify
    await new Promise((r) => setTimeout(r, 2000));
    const check = await sshExec(conn, "curl -sf http://localhost:80/health");
    if (check.ok && check.stdout === "ok") {
      console.log(`${tag(conn.transport)} Deployed and running.`);
    } else {
      console.log(`${tag(conn.transport)} Deployed but health check failed. Check: systemctl status arachne`);
    }
  });

// --- overclock ---

interface OverclockLevel {
  arm_freq: number;
  over_voltage?: number;
  over_voltage_delta?: number;
  temp_limit: number;
}

interface OverclockProfile {
  name: string;
  temp_max: number;
  levels: OverclockLevel[];
}

const MODEL_MAP: [string, string][] = [
  ["Raspberry Pi Zero 2", "zero2w"],
  ["Raspberry Pi 3 Model B +", "3b_plus"],
  ["Raspberry Pi 4 Model B", "4b"],
  ["Raspberry Pi 5", "5"],
];

async function loadProfiles(): Promise<Record<string, OverclockProfile>> {
  const path = new URL("../../image/overclock.json", import.meta.url).pathname;
  return JSON.parse(await Deno.readTextFile(path));
}

async function detectModel(c: Conn): Promise<[string, OverclockProfile]> {
  const r = await sshExec(c, "cat /proc/device-tree/model");
  if (!r.ok) die(`${tag(c.transport)} Error: Could not detect Pi model.`, EXIT.GENERAL);
  const model = r.stdout;
  const profiles = await loadProfiles();
  for (const [substr, key] of MODEL_MAP) {
    if (model.includes(substr)) {
      const profile = profiles[key];
      if (!profile) die(`${tag(c.transport)} Error: No overclock profile for ${model}.`, EXIT.GENERAL);
      return [key, profile];
    }
  }
  die(`${tag(c.transport)} Error: Unknown Pi model: ${model}\n  Supported: ${MODEL_MAP.map(([s]) => s).join(", ")}`, EXIT.GENERAL);
}

function levelDesc(level: OverclockLevel): string {
  const volt = level.over_voltage_delta !== undefined
    ? `over_voltage_delta=${level.over_voltage_delta}`
    : `over_voltage=${level.over_voltage}`;
  return `arm_freq=${level.arm_freq}, ${volt}`;
}

function overclockLines(level: OverclockLevel): string {
  const lines = [`arm_freq=${level.arm_freq}`, `temp_limit=${level.temp_limit}`];
  if (level.over_voltage_delta !== undefined) {
    lines.push(`over_voltage_delta=${level.over_voltage_delta}`);
  } else if (level.over_voltage !== undefined) {
    lines.push(`over_voltage=${level.over_voltage}`);
  }
  return lines.join("\n");
}

const OVERCLOCK_KEYS = ["arm_freq", "over_voltage", "over_voltage_delta", "temp_limit"];

function patchConfigTxtScript(level: OverclockLevel): string {
  // Strip existing overclock lines, append new ones — idempotent
  const sedParts = OVERCLOCK_KEYS.map((k) => `-e '/^${k}=/d'`).join(" ");
  const newLines = overclockLines(level);
  return `sed -i ${sedParts} /boot/firmware/config.txt && echo '${newLines}' >> /boot/firmware/config.txt`;
}

const REVERT_SERVICE = `[Unit]
Description=Revert overclock settings

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'cp /boot/firmware/config.txt.known-good /boot/firmware/config.txt && reboot'
`;

const REVERT_TIMER = `[Unit]
Description=Revert overclock after 20 min if not cancelled

[Timer]
OnBootSec=20min
Unit=overclock-revert.service

[Install]
WantedBy=timers.target
`;

async function setupWatchdog(c: Conn) {
  await sshExec(c, [
    `grep -q '^dtparam=watchdog=on' /boot/firmware/config.txt || echo 'dtparam=watchdog=on' >> /boot/firmware/config.txt`,
    `modprobe bcm2835_wdt 2>/dev/null || true`,
    `grep -q '^RuntimeWatchdogSec' /etc/systemd/system.conf || sed -i 's/^#RuntimeWatchdogSec=.*/RuntimeWatchdogSec=30/' /etc/systemd/system.conf`,
  ].join(" && "));
}

async function installDeadManSwitch(c: Conn) {
  await sshExec(c, [
    `cp /boot/firmware/config.txt /boot/firmware/config.txt.known-good`,
    `cat > /etc/systemd/system/overclock-revert.service << 'EOF'\n${REVERT_SERVICE}EOF`,
    `cat > /etc/systemd/system/overclock-revert.timer << 'EOF'\n${REVERT_TIMER}EOF`,
    `systemctl daemon-reload`,
    `systemctl enable --now overclock-revert.timer`,
  ].join(" && "));
}

async function cancelDeadManSwitch(c: Conn) {
  await sshExec(c, [
    `systemctl disable --now overclock-revert.timer 2>/dev/null || true`,
    `rm -f /etc/systemd/system/overclock-revert.service /etc/systemd/system/overclock-revert.timer`,
    `systemctl daemon-reload`,
  ].join(" && "));
}

async function waitForReboot(c: Conn, timeoutSec = 180): Promise<boolean> {
  // Wait a bit for shutdown
  await new Promise((r) => setTimeout(r, 5000));
  const start = Date.now();
  while (Date.now() - start < timeoutSec * 1000) {
    const probe = await sshProbe(c);
    if (probe.ok) return true;
    await new Promise((r) => setTimeout(r, 10000));
  }
  return false;
}

async function readTemp(c: Conn): Promise<number> {
  const r = await sshExec(c, "cat /sys/class/thermal/thermal_zone0/temp");
  return r.ok ? parseInt(r.stdout) / 1000 : -1;
}

// overclock status
const overclockStatusCmd = new Command()
  .description("Show current overclock level and temperature")
  // deno-lint-ignore no-explicit-any
  .action(async (opts: any) => {
    const conn = await resolve(getTransport(opts));
    const [, profile] = await detectModel(conn);
    console.log(`${tag(conn.transport)} Overclock Status`);

    const r = await sshExec(conn, [
      "cat /boot/firmware/config.txt",
      'echo "---TEMP---"',
      "cat /sys/class/thermal/thermal_zone0/temp",
      'echo "---FREQ---"',
      "cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq",
      'echo "---THROTTLE---"',
      "vcgencmd get_throttled 2>/dev/null || echo throttled=n/a",
    ].join(" && "));
    if (!r.ok) die(`${tag(conn.transport)} Error: ${r.stderr}`, EXIT.GENERAL);

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
    if (matchedLevel > 0) {
      console.log(`  Level:    ${matchedLevel}/5 (${levelDesc(profile.levels[matchedLevel - 1])})`);
    } else {
      console.log(`  Level:    custom (arm_freq=${currentFreq || "stock"})`);
    }
    console.log(`  CPU:      ${freq} MHz @ ${temp.toFixed(1)}\u00B0C`);
    console.log(`  Throttle: ${throttle === "0x0" ? "none" : throttle}`);
  });

// overclock (auto-tune or direct set)
const overclockCmd = new Command()
  .description("Overclock the Pi (auto-tune or set level directly)")
  .arguments("[level:number]")
  .option("--resume", "Resume auto-tune from current level")
  // deno-lint-ignore no-explicit-any
  .action(async (opts: any, level?: number) => {
    const conn = await resolve(getTransport(opts));
    const [, profile] = await detectModel(conn);

    if (level !== undefined) {
      // --- Direct set ---
      if (level < 1 || level > 5)
        die("Error: Level must be between 1 and 5.", EXIT.USAGE);

      const target = profile.levels[level - 1];
      console.log(`${tag(conn.transport)} Applying level ${level}/5 (${levelDesc(target)}) to ${profile.name}`);

      const patch = await sshExec(conn, patchConfigTxtScript(target));
      if (!patch.ok) die(`${tag(conn.transport)} Error: Failed to patch config.txt\n  ${patch.stderr}`, EXIT.GENERAL);

      console.log("Rebooting...");
      await sshExec(conn, "reboot");
      if (await waitForReboot(conn)) {
        const temp = await readTemp(conn);
        console.log(`${tag(conn.transport)} Level ${level}/5 applied. CPU @ ${temp.toFixed(1)}\u00B0C`);
      } else {
        console.log(`\nPi didn't come back after 3 minutes.\n`);
        console.log("Recovery options:");
        console.log("  1. Wait — it may still be booting");
        console.log("  2. Power cycle the Pi");
        console.log("  3. Hold Shift during boot to skip overclock (safe mode)");
      }
      return;
    }

    // --- Auto-tune ---
    console.log(`${tag(conn.transport)} Overclock auto-tune \u2014 ${profile.name}`);
    console.log("Estimated time: ~60 minutes (5 levels x 10-min stress tests + reboots)\n");

    // Determine start level
    let startLevel = 0;
    if (opts.resume) {
      const cfg = await sshExec(conn, "cat /boot/firmware/config.txt");
      const m = cfg.stdout.match(/^arm_freq=(\d+)/m);
      if (m) {
        const curFreq = parseInt(m[1]);
        for (let i = 0; i < profile.levels.length; i++) {
          if (profile.levels[i].arm_freq === curFreq) startLevel = i + 1;
        }
      }
      if (startLevel > 0) {
        console.log(`Resuming from level ${startLevel + 1}/5\n`);
      }
    }

    // Install stress-ng
    console.log("Installing stress-ng...");
    const stressInstall = await sshExec(conn, "command -v stress-ng >/dev/null || apt-get install -y -qq stress-ng >/dev/null 2>&1");
    if (!stressInstall.ok)
      die(`${tag(conn.transport)} Error: Failed to install stress-ng.\n  ${stressInstall.stderr}`, EXIT.GENERAL);

    // Setup hardware watchdog
    await setupWatchdog(conn);

    let bestLevel = startLevel;

    for (let i = startLevel; i < profile.levels.length; i++) {
      const lvl = profile.levels[i];
      const num = i + 1;
      console.log(`\nLevel ${num}/5 (${levelDesc(lvl)})`);

      // Install dead man's switch + patch config
      await installDeadManSwitch(conn);
      const patch = await sshExec(conn, patchConfigTxtScript(lvl));
      if (!patch.ok) {
        console.log(`  Error patching config.txt: ${patch.stderr}`);
        await cancelDeadManSwitch(conn);
        break;
      }

      // Reboot
      await Deno.stdout.write(new TextEncoder().encode("  Rebooting... "));
      await sshExec(conn, "reboot");
      const came_back = await waitForReboot(conn);
      if (!came_back) {
        console.log("no response after 3 minutes.\n");
        console.log("  The Pi may have crashed. Recovery options:");
        console.log("    1. Wait \u2014 the dead man's switch will revert settings in ~20 min");
        console.log("    2. Power cycle \u2014 the Pi will boot with reverted settings");
        console.log("    3. Hold Shift during boot to skip overclock (safe mode)");
        return;
      }
      console.log("connected.");

      // Run stress test (10 minutes)
      const cpuCount = await sshExec(conn, "nproc");
      const cores = parseInt(cpuCount.stdout) || 4;
      // Start stress-ng in background
      await sshExec(conn, `nohup stress-ng --cpu ${cores} --timeout 600 >/dev/null 2>&1 &`);

      let peakTemp = 0;
      const stressDuration = 600; // 10 minutes
      const pollInterval = 5;
      for (let s = 0; s < stressDuration; s += pollInterval) {
        await new Promise((r) => setTimeout(r, pollInterval * 1000));
        const temp = await readTemp(conn);
        if (temp > peakTemp) peakTemp = temp;
        const remaining = Math.ceil((stressDuration - s - pollInterval) / 60);
        await Deno.stdout.write(new TextEncoder().encode(`\r  Stress test: ~${remaining}m remaining [peak ${peakTemp.toFixed(1)}\u00B0C]    `));
      }
      console.log("");

      if (peakTemp >= profile.temp_max) {
        console.log(`  Failed \u2014 peak ${peakTemp.toFixed(1)}\u00B0C exceeds threshold (${profile.temp_max}\u00B0C)`);
        // Revert to previous level
        if (bestLevel > 0) {
          console.log(`  Reverting to level ${bestLevel}...`);
          const prev = profile.levels[bestLevel - 1];
          await sshExec(conn, patchConfigTxtScript(prev));
        }
        await cancelDeadManSwitch(conn);
        if (bestLevel > 0) {
          await sshExec(conn, "reboot");
          await waitForReboot(conn);
        }
        break;
      }

      console.log(`  Passed \u2014 peak ${peakTemp.toFixed(1)}\u00B0C (threshold: ${profile.temp_max}\u00B0C)`);
      await cancelDeadManSwitch(conn);
      bestLevel = num;
    }

    console.log(`\nResult: Level ${bestLevel}/5${bestLevel > 0 ? ` (${levelDesc(profile.levels[bestLevel - 1])})` : " (stock)"}`);
  })
  .command("status", overclockStatusCmd);

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
      'echo "cpu_freq:$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq 2>/dev/null || echo n/a)"',
      'echo "throttle:$(vcgencmd get_throttled 2>/dev/null | cut -d= -f2 || echo n/a)"',
      'echo "mem_total:$(free -m | awk \'/Mem:/{print $2}\')"',
      'echo "mem_used:$(free -m | awk \'/Mem:/{print $3}\')"',
      'echo "mem_avail:$(free -m | awk \'/Mem:/{print $7}\')"',
      'echo "disk_total:$(df -h / | awk \'NR==2{print $2}\')"',
      'echo "disk_used:$(df -h / | awk \'NR==2{print $3}\')"',
      'echo "disk_pct:$(df -h / | awk \'NR==2{print $5}\')"',
      'echo "load:$(cat /proc/loadavg | cut -d\\" \\" -f1-3)"',
      'echo "wifi_ssid:$(wpa_cli -i wlan0 status 2>/dev/null | grep ^ssid= | cut -d= -f2-)"',
      'echo "wifi_signal:$(iw dev wlan0 link 2>/dev/null | grep signal | awk \'{print $2, $3}\')"',
      'echo "ngrok:$(systemctl is-active ngrok 2>/dev/null || echo not installed)"',
      'echo "ngrok_tunnels:$(curl -sf localhost:4040/api/tunnels 2>/dev/null | grep -o \'"public_url":"[^"]*"\' | tr \'\\n\' \' \' || echo none)"',
      'echo "failed:$(systemctl --failed --no-legend 2>/dev/null | head -5)"',
      'echo "firstboot:$(cat /var/tmp/dietpi/logs/dietpi-automation_custom_script.log 2>/dev/null | tail -1 || echo n/a)"',
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
    const fmtFreq = (raw: string) =>
      raw === "n/a" ? "n/a" : `${Math.round(parseInt(raw) / 1000)} MHz`;
    const fmtThrottle = (raw: string) =>
      raw === "n/a" ? "n/a" : raw === "0x0" ? "none" : raw;

    console.log(
      `  Transport:  ${conn.transport === "usb" ? "USB" : "WiFi"} (${conn.host})`,
    );
    console.log(`  Hostname:   ${info.hostname}`);
    console.log(`  Uptime:     ${info.uptime}`);
    console.log(`  CPU:        ${fmtFreq(info.cpu_freq)} @ ${fmtTemp(info.cpu_temp)}`);
    console.log(`  Throttle:   ${fmtThrottle(info.throttle)}`);
    console.log(
      `  Memory:     ${info.mem_used}/${info.mem_total} MB (${info.mem_avail} MB free)`,
    );
    console.log(
      `  Disk:       ${info.disk_used}/${info.disk_total} (${info.disk_pct})`,
    );
    console.log(`  Load:       ${info.load}`);
    console.log(
      `  WiFi:       ${info.wifi_ssid ? `${info.wifi_ssid}${info.wifi_signal ? ` (signal: ${info.wifi_signal})` : ""}` : "Not connected"}`,
    );
    console.log(`  ngrok:      ${info.ngrok}`);
    console.log(`  First-boot: ${info.firstboot || "n/a"}`);
    if (info.failed) console.log(`  Failed:     ${info.failed}`);
  });

// --- root: bare `deno task pi` = SSH ---

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
  .command("init", initCmd)
  .command("deploy", deployCmd)
  .command("status", statusCmd)
  .command("wifi", wifiCmd)
  .command("overclock", overclockCmd)
  .parse(Deno.args.slice(1));
