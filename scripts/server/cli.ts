import { Command } from "https://deno.land/x/cliffy@v1.0.0-rc.4/command/mod.ts";

const SSH_USER = "root";
const KEY_PATH = `${Deno.env.get("HOME")}/.ssh/arachne_ed25519`;

const WIRELESS = { host: "3.tcp.ngrok.io", port: "21045" };
const USB = { host: "10.0.0.1", port: "22" };

function sshArgs(
  opts: { usb?: boolean },
  remoteCmd?: string,
): string[] {
  const { host, port } = opts.usb ? USB : WIRELESS;
  const args = [
    "-i", KEY_PATH,
    "-p", port,
    `${SSH_USER}@${host}`,
  ];
  if (remoteCmd) args.push(remoteCmd);
  return args;
}

function sshCmd(opts: { usb?: boolean }, remoteCmd: string) {
  return new Deno.Command("ssh", {
    args: [
      ...sshArgs(opts, remoteCmd),
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=5",
    ],
    stdout: "piped",
    stderr: "piped",
  });
}

async function needsSetup(usb: boolean): Promise<boolean> {
  try {
    await Deno.stat(KEY_PATH);
  } catch {
    return true;
  }

  const { success } = await sshCmd({ usb }, "echo ok").spawn().status;
  return !success;
}

async function runSetup() {
  console.log("SSH not configured. Running setup first...\n");
  const setupScript = new URL("../setup/cli.ts", import.meta.url).pathname;
  const proc = new Deno.Command("deno", {
    args: ["run", "--allow-run", "--allow-env", "--allow-read", setupScript],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const { success } = await proc.spawn().status;
  if (!success) {
    console.error("Setup failed.");
    Deno.exit(1);
  }
  console.log("");
}

async function ensureConnection(usb: boolean) {
  if (await needsSetup(usb)) {
    await runSetup();
  }
}

// --- subcommands ---

const ssh = new Command()
  .description("SSH into the Pi")
  .option("--usb", "Connect over USB (10.0.0.1) instead of wireless")
  .action(async ({ usb }: { usb?: boolean }) => {
    await ensureConnection(!!usb);

    const mode = usb ? "USB" : "wireless";
    const { host, port } = usb ? USB : WIRELESS;
    console.log(`Connecting via ${mode} (${host}:${port})...`);

    const proc = new Deno.Command("ssh", {
      args: sshArgs({ usb }),
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const status = await proc.spawn().status;
    Deno.exit(status.code);
  });

const deploy = new Command()
  .description("Deploy arachne to the Pi")
  .option("--usb", "Connect over USB (10.0.0.1) instead of wireless")
  .action(async ({ usb }: { usb?: boolean }) => {
    await ensureConnection(!!usb);

    console.log("Deploying...");
    const proc = new Deno.Command("ssh", {
      args: sshArgs({ usb }, "echo 'Connected successfully'"),
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const status = await proc.spawn().status;
    Deno.exit(status.code);
  });

const status = new Command()
  .description("Server status dashboard")
  .option("--usb", "Connect over USB (10.0.0.1) instead of wireless")
  .action(async ({ usb }: { usb?: boolean }) => {
    console.log("arachne status");
    console.log("\u2500".repeat(44));

    // check connection
    try {
      await Deno.stat(KEY_PATH);
    } catch {
      console.log("  ssh:       FAIL  no SSH key. run: deno task server deploy");
      Deno.exit(1);
    }

    const start = performance.now();
    const { success } = await sshCmd({ usb }, "echo ok").spawn().status;
    const latency = Math.round(performance.now() - start);

    if (!success) {
      console.log("  ssh:       FAIL  connection failed");
      console.log("\n  cannot reach pi \u2014 skipping system info");
      Deno.exit(1);
    }

    console.log(`  ssh:       OK    connected (${latency}ms)`);

    // gather system info
    const remoteScript = [
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
      'echo "service:$(systemctl is-active arachne 2>/dev/null || echo not found)"',
    ].join(" && ");

    const proc = sshCmd({ usb }, remoteScript).spawn();
    await proc.status;
    const raw = new TextDecoder().decode((await proc.output()).stdout);

    const info: Record<string, string> = {};
    for (const line of raw.trim().split("\n")) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        info[line.slice(0, idx)] = line.slice(idx + 1).trim();
      }
    }

    function formatTemp(raw: string): string {
      if (raw === "n/a") return "n/a";
      const c = parseInt(raw) / 1000;
      return `${c.toFixed(1)}\u00B0C`;
    }

    console.log(`  service:   ${info.service === "active" ? "OK    active" : `WARN  ${info.service}`}`);
    console.log("");
    console.log(`  host:      ${info.hostname}`);
    console.log(`  os:        ${info.os}`);
    console.log(`  kernel:    ${info.kernel}`);
    console.log(`  uptime:    ${info.uptime}`);
    console.log("");
    console.log(`  cpu temp:  ${formatTemp(info.cpu_temp)}`);
    console.log(`  load:      ${info.load}`);
    console.log(`  memory:    ${info.mem_used}/${info.mem_total} MB (${info.mem_avail} MB free)`);
    console.log(`  disk:      ${info.disk_used}/${info.disk_total} (${info.disk_pct})`);
  });

// --- root command: default action is ssh ---

await new Command()
  .name("server")
  .description("Arachne server management")
  .option("--usb", "Connect over USB (10.0.0.1) instead of wireless")
  .action(async ({ usb }: { usb?: boolean }) => {
    // default: ssh into the server
    await ensureConnection(!!usb);

    const mode = usb ? "USB" : "wireless";
    const { host, port } = usb ? USB : WIRELESS;
    console.log(`Connecting via ${mode} (${host}:${port})...`);

    const proc = new Deno.Command("ssh", {
      args: sshArgs({ usb }),
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const s = await proc.spawn().status;
    Deno.exit(s.code);
  })
  .command("ssh", ssh)
  .command("deploy", deploy)
  .command("status", status)
  .parse(Deno.args);
