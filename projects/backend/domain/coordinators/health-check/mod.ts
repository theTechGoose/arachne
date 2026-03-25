import type { HealthResponse } from "@dto/health.ts";

type HealthCheckDeps = {
  ping: () => Promise<boolean>;
  workerCount: () => number;
};

export class HealthCheck {
  #ping: () => Promise<boolean>;
  #workerCount: () => number;

  constructor(deps: HealthCheckDeps) {
    this.#ping = deps.ping;
    this.#workerCount = deps.workerCount;
  }

  async check(): Promise<HealthResponse> {
    try {
      const redis = await this.#ping();
      if (!redis) {
        return { status: "degraded", redis: false, workers: 0 };
      }
      return { status: "ok", redis: true, workers: this.#workerCount() };
    } catch {
      return { status: "degraded", redis: false, workers: 0 };
    }
  }
}
