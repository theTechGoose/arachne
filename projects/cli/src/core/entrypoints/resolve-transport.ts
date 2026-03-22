import type { Conn, Transport } from "../dto/transport.ts";
import { CliError, EXIT } from "../dto/exit-codes.ts";
import { TextHelpers } from "../domain/business/text-helpers/mod.ts";
import { SshHelpers } from "../domain/business/ssh-helpers/mod.ts";
import { ConfigStore } from "../domain/data/config-file/mod.ts";
import { SystemAdapter } from "../domain/data/system/mod.ts";
import { SshClient } from "../domain/data/ssh/mod.ts";

const text = new TextHelpers();
const sshHelpers = new SshHelpers();
const USB = { host: "10.0.0.1", port: "22" };

export class TransportResolver {
  constructor(
    private readonly ssh: SshClient,
    private readonly configStore: ConfigStore,
    private readonly system: SystemAdapter,
  ) {}

  getTransport(f: { viaUsb?: boolean; viaWifi?: boolean }): Transport | undefined {
    if (f.viaUsb && f.viaWifi)
      throw new CliError("Error: Cannot use both --via-usb and --via-wifi.", EXIT.USAGE);
    return f.viaUsb ? "usb" : f.viaWifi ? "wifi" : undefined;
  }

  async resolve(
    forced: Transport | undefined,
    target: string,
    blockedOverWifi = false,
  ): Promise<Conn> {
    const candidate: Transport = forced ?? ((await this.system.arpDetect()) ? "usb" : "wifi");
    const conn: Conn = candidate === "usb"
      ? { transport: "usb", ...USB }
      : { transport: "wifi", ...this.configStore.loadWifi(target) };

    if (!(await this.ssh.hasKey())) await this.ssh.setupKey(conn, text.tag(conn.transport));

    const probe = await this.ssh.probe(conn);
    if (probe.ok) return conn;

    if (forced) {
      throw new CliError(`${text.tag(forced)} Error: ${sshHelpers.wrapSshErr(probe.error, conn)}`, EXIT.CONNECTION);
    }

    if (candidate === "usb") {
      if (blockedOverWifi) {
        throw new CliError(
          `Error: USB was detected but SSH failed, and this command is blocked over WiFi.\n  ${probe.error}\n  Check your USB cable connection and try again.`,
          EXIT.BLOCKED,
        );
      }
      console.log(`${text.tag("usb")} SSH connection failed. Falling back to WiFi...`);
      const w = this.configStore.loadWifi(target);
      const wc: Conn = { transport: "wifi", ...w };
      const wp = await this.ssh.probe(wc);
      if (wp.ok) return wc;
      throw new CliError(
        `Error: Could not connect to Pi.\n  USB  (${USB.host}:${USB.port})             — ${probe.error}\n  WiFi (${w.host}:${w.port}) — ${wp.error}\n  Check that the Pi is powered on and reachable.`,
        EXIT.CONNECTION,
      );
    }

    throw new CliError(`${text.tag("wifi")} Error: ${sshHelpers.wrapSshErr(probe.error, conn)}`, EXIT.CONNECTION);
  }
}
