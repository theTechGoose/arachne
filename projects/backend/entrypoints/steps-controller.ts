import type { Target } from "@dto/target.ts";

type StepsControllerDeps = {
  targets: Map<string, Target>;
};

export class StepsController {
  #targets: Map<string, Target>;

  constructor(deps: StepsControllerDeps) {
    this.#targets = deps.targets;
  }

  handle(_req: Request): Response {
    const steps = [...this.#targets.keys()];
    return new Response(JSON.stringify({ steps }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}
