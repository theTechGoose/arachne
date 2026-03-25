import { CliError, EXIT } from "../../../dto/exit-codes.ts";

export class SystemAdapter {
  async getMacSsid(): Promise<string> {
    const p = new Deno.Command("ipconfig", { args: ["getsummary", "en0"], stdout: "piped", stderr: "piped" });
    const out = new TextDecoder().decode((await p.output()).stdout);
    const m = out.match(/^\s+SSID\s*:\s*(.+)$/m);
    if (!m)
      throw new CliError("Error: Could not detect current WiFi network.\n  Specify an SSID: deno task pi wifi add <ssid>", EXIT.GENERAL);
    return m[1].trim();
  }

  async readPasswordStdin(): Promise<string> {
    if (Deno.stdin.isTerminal())
      throw new CliError("Error: --password-stdin requires piped input.", EXIT.USAGE);
    const buf = new Uint8Array(65536);
    const n = await Deno.stdin.read(buf);
    if (n === null) throw new CliError("Error: No input on stdin.", EXIT.USAGE);
    return new TextDecoder().decode(buf.subarray(0, n)).split("\n")[0];
  }
}
