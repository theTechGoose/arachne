export type Warning = {
  metric: "cpu_temp" | "memory" | "disk";
  message: string;
};

export type Metrics = {
  cpuTemp: number;
  memPercent: number;
  diskPercent: number;
};

export class ThresholdChecker {
  checkThresholds(metrics: Metrics): Warning[] {
    const warnings: Warning[] = [];
    if (metrics.cpuTemp > 95) {
      warnings.push({ metric: "cpu_temp", message: `CPU temperature ${metrics.cpuTemp}°C exceeds 95°C` });
    }
    if (metrics.memPercent > 85) {
      warnings.push({ metric: "memory", message: `Memory usage ${metrics.memPercent}% exceeds 85%` });
    }
    if (metrics.diskPercent > 85) {
      warnings.push({ metric: "disk", message: `Disk usage ${metrics.diskPercent}% exceeds 85%` });
    }
    return warnings;
  }

  levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
      Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
    );
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0),
        );
      }
    }
    return dp[m][n];
  }

  suggestCommand(input: string, known: string[]): string | null {
    const distances = known.map((cmd) => ({ cmd, dist: this.levenshtein(input, cmd) }));
    const best = distances.sort((a, b) => a.dist - b.dist)[0];
    return best.dist <= 3 ? best.cmd : null;
  }
}
