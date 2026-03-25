import type { Conn, SshConfig } from "../../../dto/transport.ts";
import { SshHelpers } from "../../business/ssh-helpers/mod.ts";

const sshHelpers = new SshHelpers();

export class SshClient {
  constructor(private readonly config: SshConfig) {}

  getConfig(): SshConfig {
    return this.config;
  }

  buildArgs(c: Conn, opts?: { batch?: boolean; cmd?: string }): string[] {
    return sshHelpers.sshArgs(c, this.config, opts);
  }

  async exec(c: Conn, cmd: string) {
    const p = new Deno.Command("ssh", {
      args: this.buildArgs(c, { batch: true, cmd }),
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

  async probe(c: Conn) {
    const r = await this.exec(c, "echo ok");
    return { ok: r.ok, error: r.stderr };
  }

  async hasKey(): Promise<boolean> {
    try {
      await Deno.stat(this.config.keyPath);
      return true;
    } catch {
      return false;
    }
  }

  async setupKey(c: Conn) {
    console.log("Generating SSH key...");
    const kg = new Deno.Command("ssh-keygen", {
      args: ["-t", "ed25519", "-f", this.config.keyPath, "-N", "", "-C", "arachne"],
      stdin: "inherit", stdout: "inherit", stderr: "inherit",
    });
    if (!(await kg.output()).success)
      throw new Error("Failed to generate SSH key.");
    console.log(`\nCopying key to ${this.config.user}@${c.host}:${c.port}...`);
    console.log("You will be prompted for the password.\n");
    const cp = new Deno.Command("ssh-copy-id", {
      args: ["-i", this.config.keyPath, "-p", c.port, `${this.config.user}@${c.host}`],
      stdin: "inherit", stdout: "inherit", stderr: "inherit",
    });
    if (!(await cp.output()).success)
      throw new Error("Failed to copy SSH key.");
    console.log("");
  }
}
