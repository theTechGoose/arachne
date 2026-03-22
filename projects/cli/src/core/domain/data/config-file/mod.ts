import type { Config, PiEntry } from "../../../dto/config.ts";
import { CliError, EXIT } from "../../../dto/exit-codes.ts";

export class ConfigStore {
  constructor(private readonly cliDir: string) {}

  loadConfig(): Config {
    try {
      return JSON.parse(Deno.readTextFileSync(`${this.cliDir}config.json`));
    } catch {
      throw new CliError(
        "Error: config.json not found.\n  Copy assets/config.example.json to config.json and fill in your Pi URLs.",
        EXIT.GENERAL,
      );
    }
  }

  getPi(target: string): [string, PiEntry] {
    const config = this.loadConfig();
    const pi = config[target];
    if (!pi)
      throw new CliError(`Error: Pi "${target}" not found in config.json.`, EXIT.GENERAL);
    return [target, pi];
  }

  loadWifi(target: string): { host: string; port: string } {
    const [name, pi] = this.getPi(target);
    if (!pi.ngrok?.tcp)
      throw new CliError(`Error: Pi "${name}" has no TCP URL in config.json.`, EXIT.GENERAL);
    const [host, port] = pi.ngrok.tcp.split(":");
    if (!host || !port)
      throw new CliError(`Error: Invalid TCP URL for Pi "${name}". Expected host:port.`, EXIT.USAGE);
    return { host, port };
  }

  readDotEnv(): Map<string, string> {
    let raw: string;
    try {
      raw = Deno.readTextFileSync(`${this.cliDir}.env`);
    } catch {
      throw new CliError("Error: .env not found.\n  Run 'deno task pi setup' first.", EXIT.GENERAL);
    }
    const map = new Map<string, string>();
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) map.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
    }
    return map;
  }
}
