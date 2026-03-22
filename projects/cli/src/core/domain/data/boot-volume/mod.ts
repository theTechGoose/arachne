import { Select } from "https://deno.land/x/cliffy@v1.0.0-rc.4/prompt/select.ts";
import { CliError, EXIT } from "../../../dto/exit-codes.ts";
import { TextHelpers } from "../../business/text-helpers/mod.ts";

const text = new TextHelpers();

export class BootVolumeAdapter {
  async detectBootVolume(): Promise<string> {
    const volumes: string[] = [];
    for await (const entry of Deno.readDir("/Volumes")) {
      if (!entry.isDirectory) continue;
      try {
        await Deno.stat(`/Volumes/${entry.name}/dietpi.txt`);
        volumes.push(`/Volumes/${entry.name}`);
      } catch { /* not a DietPi volume */ }
    }
    if (volumes.length === 0)
      throw new CliError("Error: No DietPi SD card found.\n  Insert the SD card and try again.", EXIT.GENERAL);
    if (volumes.length === 1) return volumes[0];
    return await Select.prompt({ message: "Multiple DietPi volumes found:", options: volumes });
  }

  async patchDietpiTxt(volume: string, overrides: Map<string, string>) {
    const path = `${volume}/dietpi.txt`;
    let content = text.stripCr(await Deno.readTextFile(path));
    for (const [key, value] of overrides) {
      const regex = new RegExp(`^${key}=.*$`, "m");
      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${value}`);
      } else {
        content += `${key}=${value}\n`;
      }
    }
    await Deno.writeTextFile(path, content);
  }

  async ensureConfigLine(path: string, line: string) {
    let content = text.stripCr(await Deno.readTextFile(path));
    const key = line.split("=")[0] || line;
    const regex = new RegExp(`^#*${key}\\b.*$`, "m");
    if (regex.test(content)) {
      content = content.replace(regex, line);
    } else {
      content = content.trimEnd() + "\n" + line + "\n";
    }
    await Deno.writeTextFile(path, content);
  }

  async ensureCmdlineParam(path: string, param: string) {
    let content = text.stripCr(await Deno.readTextFile(path));
    const firstLine = content.split("\n")[0].trim();
    if (firstLine.includes(param)) return;
    await Deno.writeTextFile(path, firstLine + " " + param + "\n");
  }
}
