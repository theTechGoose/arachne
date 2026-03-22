import type { Conn, Network } from "../../../dto/transport.ts";
import { CliError, EXIT } from "../../../dto/exit-codes.ts";
import { SshHelpers } from "../../business/ssh-helpers/mod.ts";
import { TextHelpers } from "../../business/text-helpers/mod.ts";
import { SshClient } from "../ssh/mod.ts";

const sshHelpers = new SshHelpers();
const text = new TextHelpers();

export class WifiManager {
  constructor(private readonly ssh: SshClient) {}

  async list(c: Conn): Promise<Network[]> {
    const r = await this.ssh.exec(c, "wpa_cli -i wlan0 list_networks");
    if (!r.ok)
      throw new CliError(`${text.tag(c.transport)} Error: Failed to list WiFi networks.\n  ${r.stderr}`, EXIT.GENERAL);
    return r.stdout.split("\n").slice(1).filter((l) => l.trim()).map((line) => {
      const p = line.split("\t");
      return { id: p[0], ssid: p[1], current: (p[3] || "").includes("CURRENT") };
    });
  }

  async add(c: Conn, ssid: string, password: string) {
    const script = [
      `EXISTING=$(wpa_cli -i wlan0 list_networks | awk -F'\\t' -v s=${sshHelpers.esc(ssid)} '$2==s{print $1}')`,
      `[ -n "$EXISTING" ] && wpa_cli -i wlan0 remove_network $EXISTING >/dev/null || true`,
      `echo ${sshHelpers.esc(password)} | wpa_passphrase ${sshHelpers.esc(ssid)} >> /etc/wpa_supplicant/wpa_supplicant.conf`,
      `wpa_cli -i wlan0 reconfigure >/dev/null`,
    ].join(" && ");
    const r = await this.ssh.exec(c, script);
    if (!r.ok)
      throw new CliError(`${text.tag(c.transport)} Error: Failed to add WiFi network.\n  ${r.stderr || r.stdout}`, EXIT.GENERAL);
  }

  async remove(c: Conn, ssid: string) {
    const script = [
      `NETID=$(wpa_cli -i wlan0 list_networks | awk -F'\\t' -v s=${sshHelpers.esc(ssid)} '$2==s{print $1}')`,
      `[ -z "$NETID" ] && echo NOT_FOUND && exit 1`,
      `wpa_cli -i wlan0 remove_network $NETID >/dev/null && wpa_cli -i wlan0 save_config >/dev/null`,
    ].join("; ");
    const r = await this.ssh.exec(c, script);
    if (r.stdout.includes("NOT_FOUND"))
      throw new CliError(`${text.tag(c.transport)} Error: Network "${ssid}" not found.\n  Run 'deno task pi wifi list' to see saved networks.`, EXIT.GENERAL);
    if (!r.ok)
      throw new CliError(`${text.tag(c.transport)} Error: Failed to remove network.\n  ${r.stderr}`, EXIT.GENERAL);
  }

  async reset(c: Conn) {
    const script = `for id in $(wpa_cli -i wlan0 list_networks | tail -n +2 | awk '{print $1}'); do wpa_cli -i wlan0 remove_network $id >/dev/null; done; wpa_cli -i wlan0 save_config >/dev/null`;
    const r = await this.ssh.exec(c, script);
    if (!r.ok)
      throw new CliError(`${text.tag(c.transport)} Error: Failed to reset WiFi config.\n  ${r.stderr}`, EXIT.GENERAL);
  }

  formatSummary(nets: Network[]): string {
    if (nets.length === 0) return "(none)";
    return nets.map((n) => `${n.ssid}${n.current ? " (current)" : ""}`).join(", ");
  }
}
