import type { OverclockLevel } from "../../../dto/overclock.ts";

const OVERCLOCK_KEYS = ["arm_freq", "over_voltage", "over_voltage_delta", "temp_limit"];

export class OverclockHelpers {
  levelDesc(level: OverclockLevel): string {
    const volt = level.over_voltage_delta !== undefined
      ? `over_voltage_delta=${level.over_voltage_delta}`
      : `over_voltage=${level.over_voltage}`;
    return `arm_freq=${level.arm_freq}, ${volt}`;
  }

  overclockLines(level: OverclockLevel): string {
    const lines = [`arm_freq=${level.arm_freq}`, `temp_limit=${level.temp_limit}`];
    if (level.over_voltage_delta !== undefined) {
      lines.push(`over_voltage_delta=${level.over_voltage_delta}`);
    } else if (level.over_voltage !== undefined) {
      lines.push(`over_voltage=${level.over_voltage}`);
    }
    return lines.join("\n");
  }

  patchConfigTxtScript(level: OverclockLevel): string {
    const sedParts = OVERCLOCK_KEYS.map((k) => `-e '/^${k}=/d'`).join(" ");
    const newLines = this.overclockLines(level);
    return `sed -i ${sedParts} /boot/firmware/config.txt && echo '${newLines}' >> /boot/firmware/config.txt`;
  }
}
