import { Command } from "https://deno.land/x/cliffy@v1.0.0-rc.4/command/mod.ts";

const SSH_USER = "root";
const KEY_PATH = `${Deno.env.get("HOME")}/.ssh/arachne_ed25519`;

const WIRELESS = { host: "3.tcp.ngrok.io", port: "21045" };
const USB = { host: "10.0.0.1", port: "22" };

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

async function getSsid(): Promise<string> {
  const proc = new Deno.Command("ipconfig", {
    args: ["getsummary", "en0"],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await proc.output();
  const stdout = new TextDecoder().decode(output.stdout);
  const match = stdout.match(/^\s+SSID\s*:\s*(.+)$/m);
  if (!match) throw new Error("Not connected to WiFi");
  return match[1].trim();
}

await new Command()
  .name("set-wifi")
  .description("Set Pi WiFi to match this Mac's current network")
  .option("--over-usb", "Connect to Pi over USB")
  .action(async ({ overUsb }: { overUsb?: boolean }) => {
    const ssid = await getSsid();
    console.log(`WiFi: ${ssid}`);

    const password = prompt("Password:");
    if (!password) {
      console.error("No password provided.");
      Deno.exit(1);
    }

    const { host, port } = overUsb ? USB : WIRELESS;

    const remoteScript = [
      `cat > /etc/wpa_supplicant/wpa_supplicant.conf << 'WPAEOF'`,
      `ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev`,
      `update_config=1`,
      `country=US`,
      `WPAEOF`,
      `wpa_passphrase ${shellEscape(ssid)} ${shellEscape(password)} >> /etc/wpa_supplicant/wpa_supplicant.conf`,
      `wpa_cli -i wlan0 reconfigure`,
    ].join("\n");

    console.log("Configuring...");
    const proc = new Deno.Command("ssh", {
      args: [
        "-i", KEY_PATH, "-p", port,
        "-o", "BatchMode=yes",
        `${SSH_USER}@${host}`,
        remoteScript,
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const output = await proc.output();
    const stdout = new TextDecoder().decode(output.stdout).trim();

    if (!output.success || !stdout.includes("OK")) {
      const stderr = new TextDecoder().decode(output.stderr).trim();
      console.error(`Failed: ${stderr || stdout}`);
      Deno.exit(1);
    }

    console.log(`Done. Pi is connecting to "${ssid}".`);
  })
  .parse(Deno.args);
