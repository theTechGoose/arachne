import { Worker, type Job as BullMqJob } from "#bullmq";
import type { RedisConnection } from "@domain/data/redis-connection/mod.ts";
import type { Target } from "@dto/target.ts";

type Closeable = { close: (force?: boolean) => Promise<void> };

// deno-lint-ignore no-explicit-any
type WorkerFactory = (name: string, processorFn: (job: any) => Promise<unknown>, opts: Record<string, unknown>) => Closeable;

type WorkerManagerDeps = {
  redisConnection: { getClient: () => ReturnType<RedisConnection["getClient"]> };
  processor: (job: BullMqJob, target: Target) => Promise<unknown>;
  workerFactory?: WorkerFactory;
};

const CLOSE_TIMEOUT_MS = 30_000;

export class WorkerManager {
  #workers: Closeable[] = [];
  #redisConnection: WorkerManagerDeps["redisConnection"];
  #processor: WorkerManagerDeps["processor"];
  #workerFactory: WorkerFactory;

  constructor(deps: WorkerManagerDeps) {
    this.#redisConnection = deps.redisConnection;
    this.#processor = deps.processor;
    this.#workerFactory = deps.workerFactory ?? ((name, processorFn, opts) => {
      return new Worker(name, processorFn, opts) as Closeable;
    });
  }

  createWorkers(targets: Map<string, Target>): void {
    for (const [targetName, target] of targets) {
      const redis = this.#redisConnection.getClient();
      const connection = redis ? (redis as unknown as { duplicate: () => unknown }).duplicate() : undefined;

      const processorFn = (job: BullMqJob) => this.#processor(job, target);

      const worker = this.#workerFactory(targetName, processorFn, {
        connection,
        concurrency: target.concurrency,
      });

      this.#workers.push(worker);
    }
  }

  getWorkerCount(): number {
    return this.#workers.length;
  }

  async closeAll(): Promise<void> {
    const closePromises = this.#workers.map((worker) => {
      let timerId: ReturnType<typeof setTimeout>;
      const timeout = new Promise<void>((_, reject) => {
        timerId = setTimeout(() => reject(new Error("Worker close timed out")), CLOSE_TIMEOUT_MS);
      });
      return Promise.race([worker.close(), timeout]).finally(() => clearTimeout(timerId));
    });

    await Promise.allSettled(closePromises);
    this.#workers = [];
  }
}
