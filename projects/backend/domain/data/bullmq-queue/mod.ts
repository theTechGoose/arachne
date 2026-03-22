import { Queue, QueueEvents, Worker, type Job as BullMqJob } from "#bullmq";
import type { bullMqQueueService, bullMqQueueEventsService } from "@design";
import type { Redis } from "#ioredis";

export class BullMqQueueAdapter implements bullMqQueueService, bullMqQueueEventsService {
  private queues: Map<string, Queue> = new Map();
  private queueEvents: Map<string, QueueEvents> = new Map();
  private workers: Map<string, Worker> = new Map();

  private drainedCallbacks: Array<() => void> = [];
  private cleanedCallbacks: Array<(args: { jobs: string[]; type: string }) => void> = [];
  private pausedCallbacks: Array<() => void> = [];
  private resumedCallbacks: Array<() => void> = [];
  private errorCallbacks: Array<(err: Error) => void> = [];

  constructor(private readonly redis: Redis) {}

  async init(): Promise<void> {
    console.log("BullMQ Queue Adapter initialized");
  }

  async getAll(): Promise<string[]> {
    return Array.from(this.queues.keys());
  }

  async get(consumerName: string): Promise<string | null> {
    return this.queues.has(consumerName) ? consumerName : null;
  }

  async create(consumerName: string): Promise<void> {
    if (this.queues.has(consumerName)) {
      throw new Error(`Queue ${consumerName} already exists`);
    }

    const queueRedis = this.redis.duplicate();
    const queue = new Queue(consumerName, {
      connection: queueRedis,
      defaultJobOptions: {
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: { age: 24 * 3600, count: 1000 },
      },
    });

    const eventsRedis = this.redis.duplicate();
    const queueEvents = new QueueEvents(consumerName, { connection: eventsRedis });

    queueEvents.on("drained", () => this.drainedCallbacks.forEach((cb) => cb()));
    // deno-lint-ignore no-explicit-any
    queueEvents.on("cleaned", (jobs: any, type: any) => {
      this.cleanedCallbacks.forEach((cb) => cb({ jobs: jobs.map((j: unknown) => String(j)), type }));
    });
    queueEvents.on("paused", () => this.pausedCallbacks.forEach((cb) => cb()));
    queueEvents.on("resumed", () => this.resumedCallbacks.forEach((cb) => cb()));
    queueEvents.on("error", (err: Error) => this.errorCallbacks.forEach((cb) => cb(err)));

    this.queues.set(consumerName, queue);
    this.queueEvents.set(consumerName, queueEvents);
  }

  async delete(consumerName: string): Promise<void> {
    const queue = this.queues.get(consumerName);
    if (!queue) throw new Error(`Queue ${consumerName} does not exist`);

    const counts = await queue.getJobCounts();
    if (counts.active > 0 || counts.waiting > 0 || counts.delayed > 0) {
      throw new Error(`Cannot delete queue ${consumerName}: has active/waiting/delayed jobs`);
    }

    const worker = this.workers.get(consumerName);
    if (worker) { await worker.close(); this.workers.delete(consumerName); }

    const queueEvents = this.queueEvents.get(consumerName);
    if (queueEvents) { await queueEvents.close(); this.queueEvents.delete(consumerName); }

    await queue.obliterate({ force: true });
    await queue.close();
    this.queues.delete(consumerName);
  }

  async pause(consumerName: string): Promise<void> {
    const queue = this.queues.get(consumerName);
    if (!queue) throw new Error(`Queue ${consumerName} does not exist`);
    await queue.pause();
  }

  async resume(consumerName: string): Promise<void> {
    const queue = this.queues.get(consumerName);
    if (!queue) throw new Error(`Queue ${consumerName} does not exist`);
    await queue.resume();
  }

  async getJobCounts(consumerName: string): Promise<Record<string, number>> {
    const queue = this.queues.get(consumerName);
    if (!queue) {
      return { completed: 0, failed: 0, waiting: 0, active: 0, stalled: 0, delayed: 0, removed: 0 };
    }
    return await queue.getJobCounts();
  }

  // deno-lint-ignore no-explicit-any
  async clean(consumerName: string, grace: number, limit: number, type?: string): Promise<void> {
    const queue = this.queues.get(consumerName);
    if (!queue) throw new Error(`Queue ${consumerName} does not exist`);
    // deno-lint-ignore no-explicit-any
    await queue.clean(grace, limit, type as any);
  }

  async drain(consumerName: string): Promise<void> {
    const queue = this.queues.get(consumerName);
    if (!queue) throw new Error(`Queue ${consumerName} does not exist`);
    await queue.drain();
  }

  async removeJobs(consumerName: string, _pattern: string): Promise<void> {
    const queue = this.queues.get(consumerName);
    if (!queue) throw new Error(`Queue ${consumerName} does not exist`);
    // BullMQ doesn't have removeJobs - drain delayed jobs instead
    await queue.drain(true);
  }

  async createWorker(
    consumerName: string,
    // deno-lint-ignore no-explicit-any
    processor: (job: BullMqJob) => Promise<any>,
    concurrency: number,
  ): Promise<void> {
    if (this.workers.has(consumerName)) return;

    const workerRedis = this.redis.duplicate();
    const worker = new Worker(consumerName, processor, {
      connection: workerRedis,
      concurrency,
      autorun: true,
    });
    this.workers.set(consumerName, worker);
  }

  async closeWorker(consumerName: string): Promise<void> {
    const worker = this.workers.get(consumerName);
    if (worker) { await worker.close(); this.workers.delete(consumerName); }
  }

  async getCompleted(consumerName: string): Promise<BullMqJob[]> {
    const queue = this.queues.get(consumerName);
    if (!queue) return [];
    return await queue.getCompleted();
  }

  async getFailed(consumerName: string): Promise<BullMqJob[]> {
    const queue = this.queues.get(consumerName);
    if (!queue) return [];
    return await queue.getFailed();
  }

  onDrained(cb: () => void): void { this.drainedCallbacks.push(cb); }
  onCleaned(cb: (args: { jobs: string[]; type: string }) => void): void { this.cleanedCallbacks.push(cb); }
  onPaused(cb: () => void): void { this.pausedCallbacks.push(cb); }
  onResumed(cb: () => void): void { this.resumedCallbacks.push(cb); }
  onError(cb: (err: Error) => void): void { this.errorCallbacks.push(cb); }

  async close(): Promise<void> {
    for (const worker of this.workers.values()) await worker.close();
    for (const queue of this.queues.values()) await queue.close();
    for (const events of this.queueEvents.values()) await events.close();
    this.queues.clear();
    this.queueEvents.clear();
    this.workers.clear();
  }
}
