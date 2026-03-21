import { Queue, QueueEvents } from "#bullmq";
import type { Job as BullJob } from "#bullmq";
import type { bullMqJobService, bullMqJobEventsService, Job as IJob, JobDetails, StatProperty } from "@design";
import type { Redis } from "#ioredis";

export class BullMqJobAdapter implements bullMqJobService, bullMqJobEventsService {
  private queues: Map<string, Queue> = new Map();
  private queueEvents: Map<string, QueueEvents> = new Map();

  // deno-lint-ignore no-explicit-any
  private completedCallbacks: Array<(args: { jobId: string; returnvalue: any }) => void> = [];
  private failedCallbacks: Array<(args: { jobId: string; failedReason: string }) => void> = [];
  private stalledCallbacks: Array<(args: { jobId: string }) => void> = [];
  // deno-lint-ignore no-explicit-any
  private progressCallbacks: Array<(args: { jobId: string; progress: any }) => void> = [];
  private errorCallbacks: Array<(err: Error) => void> = [];

  constructor(private readonly redis: Redis) {}

  async init(): Promise<void> {
    console.log("BullMQ Job Adapter initialized");
  }

  async getAll(consumerFilter?: string): Promise<string[]> {
    const jobIds: string[] = [];
    if (consumerFilter) {
      const queue = await this.getQueue(consumerFilter);
      if (queue) {
        const jobs = await queue.getJobs();
        jobIds.push(...jobs.map((job) => job.id!));
      }
    } else {
      for (const queue of this.queues.values()) {
        const jobs = await queue.getJobs();
        jobIds.push(...jobs.map((job) => job.id!));
      }
    }
    return jobIds;
  }

  async createJob(job: IJob): Promise<void> {
    const queue = await this.getOrCreateQueue(job.consumerName);

    const bullJobOptions = {
      priority: job.priority,
      delay: job.details?.delay,
      attempts: job.details?.attempts,
      backoff: job.details?.backoff
        ? { type: job.details.backoff.type as "fixed" | "exponential", delay: job.details.backoff.delay }
        : undefined,
    };

    await queue.add(
      job.name,
      {
        headers: job.details?.headers || {},
        body: job.details?.body || {},
        currentStep: job.currentStep,
        pipelineResults: job.pipelineResults,
        consumerName: job.consumerName,
      },
      { ...bullJobOptions, jobId: job.id },
    );
  }

  async readJob(jobId: string): Promise<IJob | null> {
    for (const [consumerName, queue] of this.queues.entries()) {
      const bullJob = await queue.getJob(jobId);
      if (bullJob) return await this.mapBullJobToJob(bullJob, consumerName);
    }
    return null;
  }

  async updateJob(job: IJob): Promise<void> {
    const queue = await this.getQueue(job.consumerName);
    if (!queue) throw new Error(`Queue ${job.consumerName} not found`);

    const bullJob = await queue.getJob(job.id);
    if (!bullJob) throw new Error(`Job ${job.id} not found`);

    if (job.details) {
      await bullJob.updateData({
        headers: job.details.headers || bullJob.data.headers,
        body: job.details.body || bullJob.data.body,
        currentStep: job.currentStep,
        pipelineResults: job.pipelineResults || bullJob.data.pipelineResults,
        consumerName: job.consumerName || bullJob.data.consumerName,
      });
    }

    if (job.priority !== undefined && job.priority !== bullJob.opts.priority) {
      await bullJob.changePriority({ priority: job.priority });
    }

    if (job.details?.delay !== undefined && job.details.delay !== bullJob.opts.delay) {
      await bullJob.changeDelay(job.details.delay);
    }
  }

  async deleteJob(jobId: string): Promise<void> {
    for (const queue of this.queues.values()) {
      const bullJob = await queue.getJob(jobId);
      if (bullJob) {
        const state = await bullJob.getState();
        if (state === "active") throw new Error(`Cannot delete active job ${jobId}`);
        await bullJob.remove();
        return;
      }
    }
    throw new Error(`Job ${jobId} not found`);
  }

  async retryJob(jobId: string): Promise<void> {
    for (const queue of this.queues.values()) {
      const bullJob = await queue.getJob(jobId);
      if (bullJob) { await bullJob.retry(); return; }
    }
    throw new Error(`Job ${jobId} not found`);
  }

  async promoteJob(jobId: string): Promise<void> {
    for (const queue of this.queues.values()) {
      const bullJob = await queue.getJob(jobId);
      if (bullJob) { await bullJob.promote(); return; }
    }
    throw new Error(`Job ${jobId} not found`);
  }

  async getJobState(jobId: string): Promise<string | null> {
    for (const queue of this.queues.values()) {
      const bullJob = await queue.getJob(jobId);
      if (bullJob) return await bullJob.getState();
    }
    return null;
  }

  async getJobsByState(consumerName: string, state: StatProperty): Promise<IJob[]> {
    const queue = await this.getQueue(consumerName);
    if (!queue) return [];

    let bullJobs: BullJob[] = [];
    switch (state) {
      case "completed": bullJobs = await queue.getCompleted(); break;
      case "failed": bullJobs = await queue.getFailed(); break;
      case "waiting": bullJobs = await queue.getWaiting(); break;
      case "active": bullJobs = await queue.getActive(); break;
      case "delayed": bullJobs = await queue.getDelayed(); break;
      default: return [];
    }
    return await Promise.all(bullJobs.map((job) => this.mapBullJobToJob(job, consumerName)));
  }

  setupQueueEvents(consumerName: string): void {
    if (this.queueEvents.has(consumerName)) return;

    const eventsRedis = this.redis.duplicate();
    const queueEvents = new QueueEvents(consumerName, { connection: eventsRedis });

    queueEvents.on("completed", (event) => {
      this.completedCallbacks.forEach((cb) => cb({ jobId: event.jobId, returnvalue: event.returnvalue }));
    });
    queueEvents.on("failed", (event) => {
      this.failedCallbacks.forEach((cb) => cb({ jobId: event.jobId, failedReason: event.failedReason || "Unknown error" }));
    });
    queueEvents.on("stalled", (event) => {
      this.stalledCallbacks.forEach((cb) => cb({ jobId: event.jobId }));
    });
    queueEvents.on("progress", (event) => {
      this.progressCallbacks.forEach((cb) => cb({ jobId: event.jobId, progress: event.data }));
    });
    queueEvents.on("error", (err) => {
      this.errorCallbacks.forEach((cb) => cb(err as Error));
    });

    this.queueEvents.set(consumerName, queueEvents);
  }

  // deno-lint-ignore no-explicit-any
  onCompleted(cb: (args: { jobId: string; returnvalue: any }) => void): void { this.completedCallbacks.push(cb); }
  onFailed(cb: (args: { jobId: string; failedReason: string }) => void): void { this.failedCallbacks.push(cb); }
  onStalled(cb: (args: { jobId: string }) => void): void { this.stalledCallbacks.push(cb); }
  // deno-lint-ignore no-explicit-any
  onProgress(cb: (args: { jobId: string; progress: any }) => void): void { this.progressCallbacks.push(cb); }
  onError(cb: (err: Error) => void): void { this.errorCallbacks.push(cb); }

  private async getQueue(consumerName: string): Promise<Queue | null> {
    if (this.queues.has(consumerName)) return this.queues.get(consumerName)!;

    const queue = new Queue(consumerName, { connection: this.redis });
    try {
      await queue.getJobCounts();
      this.queues.set(consumerName, queue);
      this.setupQueueEvents(consumerName);
      return queue;
    } catch {
      await queue.close();
      return null;
    }
  }

  private async getOrCreateQueue(consumerName: string): Promise<Queue> {
    let queue = await this.getQueue(consumerName);
    if (!queue) {
      queue = new Queue(consumerName, { connection: this.redis });
      this.queues.set(consumerName, queue);
      this.setupQueueEvents(consumerName);
    }
    return queue;
  }

  private async mapBullJobToJob(bullJob: BullJob, consumerName: string): Promise<IJob> {
    const details: Partial<JobDetails> = {
      delay: bullJob.opts.delay,
      attempts: bullJob.opts.attempts,
      headers: bullJob.data.headers || {},
      body: bullJob.data.body || {},
      backoff: bullJob.opts.backoff
        ? {
            type: typeof bullJob.opts.backoff === "object" ? bullJob.opts.backoff.type : "fixed",
            delay: typeof bullJob.opts.backoff === "object" ? (bullJob.opts.backoff.delay ?? 0) : bullJob.opts.backoff,
          }
        : { type: "fixed", delay: 0 },
    };

    const bullState = await bullJob.getState();
    const status = this.mapBullStateToStatus(bullState);

    return {
      id: bullJob.id!,
      name: bullJob.name,
      consumerName,
      priority: bullJob.opts.priority || 0,
      createdAt: new Date(bullJob.timestamp),
      status,
      currentStep: bullJob.data.currentStep || null,
      pipelineOwner: bullJob.data.pipelineOwner || null,
      details,
      pipelineResults: bullJob.data.pipelineResults || [],
    };
  }

  private mapBullStateToStatus(state: string): StatProperty {
    switch (state) {
      case "completed": return "completed";
      case "failed": return "failed";
      case "waiting": return "waiting";
      case "active": return "active";
      case "delayed": return "delayed";
      case "paused": return "waiting";
      case "stuck": return "stalled";
      default: return "waiting";
    }
  }

  async close(): Promise<void> {
    for (const queue of this.queues.values()) await queue.close();
    for (const events of this.queueEvents.values()) await events.close();
    this.queues.clear();
    this.queueEvents.clear();
  }
}
