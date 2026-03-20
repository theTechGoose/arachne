import { Command } from "https://deno.land/x/cliffy@v1.0.0-rc.4/command/mod.ts";

const SSH_HOST = "3.tcp.ngrok.io";
const SSH_PORT = "21045";
const SSH_USER = "root";
const KEY_PATH = `${Deno.env.get("HOME")}/.ssh/arachne_ed25519`;

function ssh(remoteCmd: string) {
  return new Deno.Command("ssh", {
    args: [
      "-i", KEY_PATH,
      "-p", SSH_PORT,
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=5",
      `${SSH_USER}@${SSH_HOST}`,
      remoteCmd,
    ],
    stdout: "piped",
    stderr: "piped",
  });
}

async function checkConnection(): Promise<{ ok: boolean; label: string }> {
  try {
    await Deno.stat(KEY_PATH);
  } catch {
    return { ok: false, label: "FAIL  no SSH key. run: deno task deploy" };
  }

  const start = performance.now();
  const { success } = await ssh("echo ok").spawn().status;
  const latency = Math.round(performance.now() - start);

  return success
    ? { ok: true, label: `OK    connected (${latency}ms)` }
    : { ok: false, label: "FAIL  connection failed" };
}

async function getPiInfo(): Promise<Record<string, string>> {
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
    'echo "load:$(cat /proc/loadavg | cut -d\" \" -f1-3)"',
    'echo "os:$(cat /etc/os-release 2>/dev/null | grep ^PRETTY_NAME | cut -d= -f2 | tr -d \\\")"',
    'echo "kernel:$(uname -r)"',
    'echo "service:$(systemctl is-active arachne 2>/dev/null || echo not found)"',
  ].join(" && ");

  const proc = ssh(remoteScript).spawn();
  await proc.status;
  const raw = new TextDecoder().decode((await proc.output()).stdout);

  const info: Record<string, string> = {};
  for (const line of raw.trim().split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      info[line.slice(0, idx)] = line.slice(idx + 1).trim();
    }
  }
  return info;
}

function formatTemp(raw: string): string {
  if (raw === "n/a") return "n/a";
  const c = parseInt(raw) / 1000;
  return `${c.toFixed(1)}°C`;
}

await new Command()
  .name("status")
  .description("Arachne status dashboard")
  .action(async () => {
    console.log("arachne status");
    console.log("─".repeat(44));

    const conn = await checkConnection();
    console.log(`  ssh:       ${conn.label}`);

    if (!conn.ok) {
      console.log("\n  cannot reach pi — skipping system info");
      Deno.exit(1);
    }

    const info = await getPiInfo();

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
  })
  .parse(Deno.args);
