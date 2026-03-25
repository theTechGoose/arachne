import type { Conn, SshConfig } from "../../../dto/transport.ts";

export class SshHelpers {
  esc(s: string): string {
    return "'" + s.replace(/'/g, "'\\''") + "'";
  }

  sshArgs(
    c: Conn,
    config: SshConfig,
    opts?: { batch?: boolean; cmd?: string },
  ): string[] {
    const a = [
      "-i",
      config.keyPath,
      "-p",
      c.port,
      "-o",
      `ConnectTimeout=${config.connectTimeout}`,
      "-o",
      "SetEnv=TERM=xterm-256color",
    ];
    if (opts?.batch) a.push("-o", "BatchMode=yes");
    a.push(`${config.user}@${c.host}`);
    if (opts?.cmd) a.push(opts.cmd);
    return a;
  }

  wrapSshErr(raw: string): string {
    if (raw.includes("REMOTE HOST IDENTIFICATION HAS CHANGED"))
      return "SSH host key changed (reimaged?).\n  Run: ssh-keygen -R <host>";
    if (raw.includes("Connection refused"))
      return "Connection refused. Verify the SSH service is running.";
    if (raw.includes("timed out"))
      return "Connection timed out. Verify the host is reachable.";
    if (raw.includes("Permission denied"))
      return "Permission denied. SSH key may not be authorized.";
    return raw;
  }
}
