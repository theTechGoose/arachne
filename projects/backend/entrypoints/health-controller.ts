import type { HealthResponse } from "@dto/health.ts";

type HealthControllerDeps = {
  check: () => Promise<HealthResponse>;
};

export class HealthController {
  #check: () => Promise<HealthResponse>;

  constructor(deps: HealthControllerDeps) {
    this.#check = deps.check;
  }

  async handle(_req: Request): Promise<Response> {
    const health = await this.#check();
    const status = health.status === "ok" ? 200 : 503;
    return new Response(JSON.stringify(health), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
