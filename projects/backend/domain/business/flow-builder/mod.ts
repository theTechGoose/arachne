import type { Target } from "@dto/target.ts";
import type { IngestPayload } from "@dto/ingest.ts";
import type { MergeRules } from "../merge-rules/mod.ts";

export type FlowNode = {
  name: string;
  queueName: string;
  data: Record<string, unknown>;
  opts: Record<string, unknown>;
  children?: FlowNode[];
};

export type FlowTree = FlowNode;

type FlowBuilderDeps = {
  generateId: (
    body: unknown,
    nonce: string,
    stepName: string,
  ) => Promise<string>;
  mergeRules: MergeRules;
};

type BuildParams = {
  steps: string[];
  targets: Map<string, Target>;
  payload?: IngestPayload;
  nonce?: string;
  body?: unknown;
  matureAt?: string;
};

export class FlowBuilder {
  private generateId: FlowBuilderDeps["generateId"];
  private mergeRules: FlowBuilderDeps["mergeRules"];

  constructor(deps: FlowBuilderDeps) {
    this.generateId = deps.generateId;
    this.mergeRules = deps.mergeRules;
  }

  async build(params: BuildParams): Promise<FlowTree> {
    const { steps, targets, payload, nonce = "", matureAt } = params;
    const body = params.body ?? payload?.body;

    // Build nodes from deepest leaf (step 0) to root (last step)
    // We'll build each node then nest them
    const nodes: FlowNode[] = [];

    for (let i = 0; i < steps.length; i++) {
      const stepName = steps[i];
      const target = targets.get(stepName)!;
      const jobId = await this.generateId(body, nonce, stepName);

      let data: Record<string, unknown>;
      if (i === 0) {
        // Step 0 gets merged payload data
        const merged = this.mergeRules.mergePayload(target, payload);
        data = { ...merged };
      } else {
        // Steps 1+ get empty object (workers use getChildrenValues)
        data = {};
      }

      const opts: Record<string, unknown> = {
        jobId,
        attempts: target.retries + 1,
        backoff: { type: "exponential", delay: 180_000 },
        removeOnComplete: { age: 86400 },
        removeOnFail: { age: 86400 },
      };

      // matureAt delay only on the deepest leaf (step 0)
      if (i === 0 && matureAt !== undefined) {
        const delay = Math.max(0, Date.parse(matureAt) - Date.now());
        opts.delay = delay;
      }

      nodes.push({
        name: stepName,
        queueName: stepName,
        data,
        opts,
      });
    }

    // Build tree: LAST step = root, FIRST step = deepest leaf
    // steps = [A, B, C] -> tree: C { children: [B { children: [A] }] }
    // Start with A (deepest leaf), each next node wraps it as a child
    let tree: FlowNode = nodes[0];

    for (let i = 1; i < nodes.length; i++) {
      tree = { ...nodes[i], children: [tree] };
    }

    return tree;
  }
}
