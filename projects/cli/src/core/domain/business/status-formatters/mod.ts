export class StatusFormatters {
  fmtTemp(raw: string): string {
    return raw === "n/a" ? "n/a" : `${(parseInt(raw) / 1000).toFixed(1)}\u00B0C`;
  }

  fmtFreq(raw: string): string {
    return raw === "n/a" ? "n/a" : `${Math.round(parseInt(raw) / 1000)} MHz`;
  }

  fmtThrottle(raw: string): string {
    return raw === "n/a" ? "n/a" : raw === "0x0" ? "none" : raw;
  }
}
