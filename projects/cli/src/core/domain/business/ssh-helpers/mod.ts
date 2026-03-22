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

  wrapSshErr(raw: string, c: Conn): string {
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
}
