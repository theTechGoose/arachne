import { TargetSchema, type Target } from "@dto/target.ts";
import { ZodError } from "#zod";

export class TargetLoader {
  #targetsDir: string;

  constructor({ targetsDir }: { targetsDir: string }) {
    this.#targetsDir = targetsDir;
  }

  async load(): Promise<Map<string, Target>> {
    let dirEntries: Deno.DirEntry[];
    try {
      dirEntries = [];
      for await (const entry of Deno.readDir(this.#targetsDir)) {
        dirEntries.push(entry);
      }
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        throw new Error(`targets directory not found: ${this.#targetsDir}`);
      }
      throw err;
    }

    const targets = new Map<string, Target>();

    for (const entry of dirEntries) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;

      const filePath = `${this.#targetsDir}/${entry.name}`;
      const content = await Deno.readTextFile(filePath);

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new Error(`invalid JSON in ${entry.name}`);
      }

      let validated: Target;
      try {
        validated = TargetSchema.parse(parsed);
      } catch (err) {
        if (err instanceof ZodError) {
          const issues = err.issues
            .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
            .join("\n");
          throw new Error(
            `validation failed for ${entry.name}:\n${issues}`,
          );
        }
        throw err;
      }

      const name = entry.name.replace(/\.json$/, "");
      targets.set(name, validated);
    }

    if (targets.size === 0) {
      throw new Error(`no target files found in ${this.#targetsDir}`);
    }

    return targets;
  }
}
