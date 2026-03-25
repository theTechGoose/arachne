import { CliError, EXIT } from "../dto/exit-codes.ts";
import { ConfigStore } from "../domain/data/config-file/mod.ts";
import { SshClient } from "../domain/data/ssh/mod.ts";
import type { Conn } from "../dto/transport.ts";

function parseTcpUrl(tcpUrl: string): Conn {
  const stripped = tcpUrl.replace(/^tcp:\/\//, "");
  const colonIdx = stripped.lastIndexOf(":");
  if (colonIdx < 0) {
    throw new CliError(`Error: Invalid TCP URL "${tcpUrl}". Expected format: host:port`, EXIT.GENERAL);
  }
  return { host: stripped.slice(0, colonIdx), port: stripped.slice(colonIdx + 1) };
}

export class TransportResolver {
  constructor(
    private readonly ssh: SshClient,
    private readonly configStore: ConfigStore,
  ) {}

  async resolve(target: string): Promise<Conn> {
    const connectivity = await this.configStore.loadConnectivity(target);
    const conn = parseTcpUrl(connectivity.tcp);
    if (!(await this.ssh.hasKey())) await this.ssh.setupKey(conn);
    const probe = await this.ssh.probe(conn);
    if (!probe.ok) {
      throw new CliError(`Error: SSH connection failed to ${conn.host}:${conn.port}\n  ${probe.error}`, EXIT.CONNECTION);
    }
    return conn;
  }
}
