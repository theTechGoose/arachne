import { FlowProducer } from "#bullmq";
import type { FlowNode } from "@domain/business/flow-builder/mod.ts";
import type { IngestJobResponse } from "@dto/ingest.ts";

type RedisConnection = {
  getClient(): unknown;
};

type FlowProducerAdapterDeps = {
  redisConnection: RedisConnection;
};

type AddResult = {
  flowId: string;
  jobs: IngestJobResponse[];
  duplicate: boolean;
};

export class FlowProducerAdapter {
  #redisConnection: RedisConnection;
  #producer: FlowProducer | null = null;

  constructor(deps: FlowProducerAdapterDeps) {
    this.#redisConnection = deps.redisConnection;
  }

  async add(flowTree: FlowNode): Promise<AddResult> {
    const client = this.#redisConnection.getClient();
    if (!client) {
      throw new Error("Redis client not available");
    }

    this.#producer = new FlowProducer({ connection: client as never });

    const flow = await this.#producer.add(flowTree);

    const jobs: IngestJobResponse[] = [];
    const collectJobs = (node: typeof flow): void => {
      if (node.job) {
        jobs.push({
          id: node.job.id ?? "",
          step: node.job.name,
          queue: node.job.queueName,
        });
      }
      if (node.children) {
        for (const child of node.children) {
          collectJobs(child);
        }
      }
    };
    collectJobs(flow);

    const flowId = flow.job?.id ?? "";

    return {
      flowId,
      jobs,
      duplicate: false,
    };
  }

  async close(): Promise<void> {
    if (this.#producer) {
      await this.#producer.close();
      this.#producer = null;
    }
  }
}
