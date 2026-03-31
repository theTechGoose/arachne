import type {
  ConnectivityConfig,
  Target,
  UsersConfig,
} from "../../../dto/config.ts";
import { TargetSchema } from "../../../dto/config.ts";
import { CliError, EXIT } from "../../../dto/exit-codes.ts";

export class ConfigStore {
  constructor(private readonly configDir: string) {}

  async loadConnectivity(piName: string): Promise<ConnectivityConfig> {
    const path = `${this.configDir}/${piName}/connectivity.json`;
    try {
      const raw = await Deno.readTextFile(path);
      return JSON.parse(raw) as ConnectivityConfig;
    } catch {
      throw new CliError(
        `Error: connectivity.json not found for "${piName}".\n  Expected at: ${path}`,
        EXIT.GENERAL,
      );
    }
  }

  async loadUsers(piName: string): Promise<UsersConfig> {
    const path = `${this.configDir}/${piName}/users.json`;
    try {
      const raw = await Deno.readTextFile(path);
      return JSON.parse(raw) as UsersConfig;
    } catch {
      throw new CliError(
        `Error: users.json not found for "${piName}".\n  Expected at: ${path}`,
        EXIT.GENERAL,
      );
    }
  }

  async loadTargets(piName: string): Promise<Map<string, Target>> {
    const dir = `${this.configDir}/${piName}/targets`;
    return this.loadTargetsFromDir(dir);
  }

  async loadTargetsFromDir(dir: string): Promise<Map<string, Target>> {
    const targets = new Map<string, Target>();
    let entries: AsyncIterable<Deno.DirEntry>;
    try {
      entries = Deno.readDir(dir);
    } catch {
      throw new CliError(
        `Error: targets/ directory not found.\n  Expected at: ${dir}`,
        EXIT.GENERAL,
      );
    }
    for await (const entry of entries) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;
      const filePath = `${dir}/${entry.name}`;
      const raw = await Deno.readTextFile(filePath);
      const parsed = JSON.parse(raw);
      const result = TargetSchema.safeParse(parsed);
      if (!result.success) {
        throw new CliError(
          `Error: Invalid target in ${filePath}.\n  ${result.error.message}`,
          EXIT.GENERAL,
        );
      }
      const name = entry.name.replace(/\.json$/, "");
      targets.set(name, result.data);
    }
    return targets;
  }

  async listHosts(): Promise<string[]> {
    const hosts: string[] = [];
    for await (const entry of Deno.readDir(this.configDir)) {
      if (entry.isDirectory) hosts.push(entry.name);
    }
    return hosts;
  }

  async readDotEnv(): Promise<Map<string, string>> {
    let raw: string;
    try {
      raw = await Deno.readTextFile(`${this.configDir}/.env`);
    } catch {
      throw new CliError(
        "Error: .env not found.\n  Run 'arachne install --host' first.",
        EXIT.GENERAL,
      );
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
