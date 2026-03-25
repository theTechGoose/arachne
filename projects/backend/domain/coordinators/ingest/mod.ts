import type { IngestRequest, IngestResponse } from "@dto/ingest.ts";
import { ErrorCode } from "@dto/ingest.ts";
import type { Target } from "@dto/target.ts";
import type { FlowNode } from "@domain/business/flow-builder/mod.ts";

export class IngestError extends Error {
  code: ErrorCode;
  statusCode: number;

  constructor(code: ErrorCode, message: string, statusCode: number) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

type FlowBuilderLike = {
  build(params: {
    steps: string[];
    targets: Map<string, Target>;
    payload?: IngestRequest["payload"];
    nonce?: string;
    body?: unknown;
    matureAt?: string;
  }): Promise<FlowNode>;
};

type FlowProducerLike = {
  add(flowTree: FlowNode): Promise<IngestResponse>;
};

type IngestCoordinatorDeps = {
  targets: Map<string, Target>;
  flowBuilder: FlowBuilderLike;
  flowProducer: FlowProducerLike;
};

export class IngestCoordinator {
  #targets: Map<string, Target>;
  #flowBuilder: FlowBuilderLike;
  #flowProducer: FlowProducerLike;

  constructor(deps: IngestCoordinatorDeps) {
    this.#targets = deps.targets;
    this.#flowBuilder = deps.flowBuilder;
    this.#flowProducer = deps.flowProducer;
  }

  async ingest(request: IngestRequest): Promise<IngestResponse> {
    this.#validateSteps(request.steps);
    this.#validateMatureAt(request.matureAt);

    const flowTree = await this.#flowBuilder.build({
      steps: request.steps,
      targets: this.#targets,
      payload: request.payload,
      nonce: request.nonce,
      body: request.payload?.body,
      matureAt: request.matureAt,
    });

    try {
      return await this.#flowProducer.add(flowTree);
    } catch (err) {
      if (err instanceof IngestError) throw err;
      throw new IngestError(
        ErrorCode.FLOW_CREATION_FAILED,
        `Flow creation failed: ${(err as Error).message}`,
        500,
      );
    }
  }

  #validateSteps(steps: string[]): void {
    const invalid = steps.filter((s) => !this.#targets.has(s));
    if (invalid.length > 0) {
      throw new IngestError(
        ErrorCode.INVALID_STEP,
        `Unknown steps: ${invalid.join(", ")}`,
        400,
      );
    }
  }

  #validateMatureAt(matureAt?: string): void {
    if (matureAt === undefined) return;
    const date = Date.parse(matureAt);
    if (isNaN(date)) {
      throw new IngestError(
        ErrorCode.INVALID_DATE,
        `Invalid date: ${matureAt}`,
        422,
      );
    }
    if (date < Date.now()) {
      throw new IngestError(
        ErrorCode.INVALID_DATE,
        `matureAt must not be in the past`,
        422,
      );
    }
  }
}
