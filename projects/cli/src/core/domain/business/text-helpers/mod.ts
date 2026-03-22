import type { Network, Transport } from "../../../dto/transport.ts";

export class TextHelpers {
  tag(tr: Transport): string {
    return `[${tr}]`;
  }

  stripCr(s: string): string {
    return s.replace(/\r/g, "");
  }

  parseOverrides(text: string): Map<string, string> {
    const map = new Map<string, string>();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) map.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
    }
    return map;
  }

  networkSummary(nets: Network[]): string {
    if (nets.length === 0) return "(none)";
    return nets
      .map((n) => `${n.ssid}${n.current ? " (current)" : ""}`)
      .join(", ");
  }
}
