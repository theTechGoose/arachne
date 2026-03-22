import type {
  ConsumerService,
  JobService,
  JobConsumer,
  Job as JobInterface,
  StatProperty,
  FailedJob,
  SuccessfulJob,
} from "@design";
import { Consumer } from "../consumer-entity/mod.ts";
import { Job } from "../job-entity/mod.ts";
import { BullMqQueueAdapter } from "../../data/bullmq-queue/mod.ts";
import { BullMqJobAdapter } from "../../data/bullmq-job/mod.ts";
import { ConsumerPersistenceAdapter } from "../../data/consumer-persistence/mod.ts";
import type { Redis } from "#ioredis";

export class QueueOrchestrator implements ConsumerService, JobService {
  private consumers = new Map<string, Consumer>();
  private queueAdapter: BullMqQueueAdapter;
  private jobAdapter: BullMqJobAdapter;
  private persistenceAdapter: ConsumerPersistenceAdapter;

  constructor(private readonly redis: Redis) {
    this.queueAdapter = new BullMqQueueAdapter(redis);
    this.jobAdapter = new BullMqJobAdapter(redis);
    this.persistenceAdapter = new ConsumerPersistenceAdapter(redis);
  }

  async onAppBootstrap() {
    await this.queueAdapter.init();
    await this.jobAdapter.init();
    await this.loadPersistedConsumers();
    this.setupEventListeners();
  }

  private async loadPersistedConsumers(): Promise<void> {
    try {
      console.log("Loading persisted consumers from Redis...");
      const persistedConsumers = await this.persistenceAdapter.loadAllConsumers();

      for (const consumerData of persistedConsumers) {
        try {
          const consumer = new Consumer(consumerData);
          consumer.setAdapters(this.queueAdapter, this.jobAdapter);

          const queueInMemory = (this.queueAdapter as unknown as { queues: Map<string, unknown> })["queues"]?.has(consumer.name);
          if (!queueInMemory) {
            await this.queueAdapter.create(consumer.name);
          }

          await this.queueAdapter.createWorker(
            consumer.name,
            consumer.createWorkerProcessor(),
            consumer.concurrency,
          );

          this.jobAdapter.setupQueueEvents(consumer.name);
          this.consumers.set(consumer.name, consumer);
          await consumer.updateStats();

          if (consumer.paused) await consumer.pause();

          if (consumer.hasSchedule() && !consumer.paused) {
            try {
              await consumer.startScheduler();
            } catch (error) {
              console.error(`Failed to start scheduler for ${consumer.name}:`, error);
            }
          }

          console.log(`  Restored consumer: ${consumer.name}`);
        } catch (error) {
          console.error(`  Failed to restore consumer ${consumerData.name}:`, error);
        }
      }

      console.log(`Loaded ${this.consumers.size} consumers from persistence`);
    } catch (error) {
      console.error("Failed to load persisted consumers:", error);
    }
  }

  private setupEventListeners(): void {
    this.jobAdapter.onCompleted(async ({ jobId, returnvalue }) => {
      const job = await this.jobAdapter.readJob(jobId);
      if (!job) return;

      const consumer = this.consumers.get(job.consumerName);
      if (!consumer) return;

      await consumer.updateStats();

      // deno-lint-ignore no-explicit-any
      let pipelineOwnerName = job.pipelineOwner || (returnvalue as any)?._pipelineOwner;
      if (!pipelineOwnerName && consumer.hasPipeline()) {
        pipelineOwnerName = consumer.name;
      }

      if (pipelineOwnerName) {
        const pipelineOwner = this.consumers.get(pipelineOwnerName);
        if (pipelineOwner && pipelineOwner.hasPipeline()) {
          const nextStep = pipelineOwner.getNextPipelineStep(job.currentStep);
          if (nextStep) {
            const nextConsumer = this.consumers.get(nextStep);
            if (nextConsumer) {
              const updatedJob = {
                ...job,
                consumerName: nextStep,
                currentStep: nextStep,
                pipelineOwner: pipelineOwnerName,
                details: {
                  ...job.details,
                  // deno-lint-ignore no-explicit-any
                  body: (returnvalue as any)?._pipelineResults ? returnvalue : { body: returnvalue, headers: (returnvalue as any)?.headers || {} },
                  // deno-lint-ignore no-explicit-any
                  headers: (returnvalue as any)?.headers || job.details?.headers || {},
                },
                // deno-lint-ignore no-explicit-any
                pipelineResults: (returnvalue as any)?._pipelineResults || job.pipelineResults,
              };
              await nextConsumer.addJob(updatedJob);
              console.log(`Job ${jobId} moved to pipeline step: ${nextStep}`);
            }
          }
        }
      }
    });

    this.jobAdapter.onFailed(async ({ jobId }) => {
      const job = await this.jobAdapter.readJob(jobId);
      if (!job) return;

      const consumer = this.consumers.get(job.consumerName);
      if (consumer) {
        await consumer.updateStats();
        if (consumer.hasPipeline() && job.currentStep) {
          consumer.trackPipelineFailure(job.currentStep);
        }
      }
    });

    this.jobAdapter.onStalled(async ({ jobId }) => {
      const job = await this.jobAdapter.readJob(jobId);
      if (!job) return;

      const consumer = this.consumers.get(job.consumerName);
      if (consumer) await consumer.updateStats();
    });
  }

  // ── ConsumerService ──

  async getAll(): Promise<JobConsumer[]> {
    const consumers: JobConsumer[] = [];
    for (const consumer of this.consumers.values()) {
      await consumer.updateStats();
      consumers.push(consumer.toJSON());
    }
    return consumers;
  }

  async get(name: string): Promise<JobConsumer | null>;
  async get(nameOrId: string): Promise<JobInterface | null>;
  async get(nameOrId: string): Promise<JobConsumer | JobInterface | null> {
    const consumer = this.consumers.get(nameOrId);
    if (consumer) {
      await consumer.updateStats();
      return consumer.toJSON();
    }
    return this.getJob(nameOrId);
  }

  async add(consumerData: JobConsumer): Promise<void>;
  async add(jobData: JobInterface): Promise<void>;
  async add(data: JobConsumer | JobInterface): Promise<void> {
    if ("targetUrls" in data) {
      return this.addConsumer(data as JobConsumer);
    } else {
      return this.addJob(data as JobInterface);
    }
  }

  private async addConsumer(consumerData: JobConsumer): Promise<void> {
    if (this.consumers.has(consumerData.name)) {
      throw new Error(`Consumer ${consumerData.name} already exists`);
    }

    const consumer = new Consumer(consumerData);
    consumer.setAdapters(this.queueAdapter, this.jobAdapter);
    consumer.setConsumerLookup((name: string) => this.consumers.has(name));

    await this.queueAdapter.create(consumer.name);
    await this.queueAdapter.createWorker(
      consumer.name,
      consumer.createWorkerProcessor(),
      consumer.concurrency,
    );

    this.jobAdapter.setupQueueEvents(consumer.name);
    this.consumers.set(consumer.name, consumer);
    await this.persistenceAdapter.saveConsumer(consumer.toJSON());

    if (consumer.paused) await consumer.pause();

    if (consumer.hasSchedule() && !consumer.paused) {
      try {
        await consumer.startScheduler();
      } catch (error) {
        console.error(`Failed to start scheduler for ${consumer.name}:`, error);
      }
    }

    console.log(`Added consumer: ${consumer.name}`);
  }

  async remove(name: string): Promise<void> {
    const consumer = this.consumers.get(name);
    if (!consumer) throw new Error(`Consumer ${name} not found`);

    if (consumer.hasSchedule()) consumer.stopScheduler();

    await consumer.updateStats();
    if (consumer.stats.active > 0) {
      throw new Error(`Cannot remove consumer ${name}: ${consumer.stats.active} jobs are still active`);
    }

    await this.queueAdapter.delete(name);
    await this.persistenceAdapter.deleteConsumer(name);
    this.consumers.delete(name);
  }

  async update(consumerUpdate: Partial<JobConsumer>): Promise<void>;
  async update(jobData: JobInterface): Promise<void>;
  async update(data: Partial<JobConsumer> | JobInterface): Promise<void> {
    if ("targetUrls" in data || "concurrency" in data || "paused" in data) {
      return this.updateConsumer(data as Partial<JobConsumer>);
    } else {
      return this.updateJob(data as JobInterface);
    }
  }

  private async updateConsumer(consumerUpdate: Partial<JobConsumer>): Promise<void> {
    if (!consumerUpdate.name) throw new Error("Consumer name is required for update");

    const consumer = this.consumers.get(consumerUpdate.name);
    if (!consumer) throw new Error(`Consumer ${consumerUpdate.name} not found`);

    const oldSchedule = consumer.schedule;
    consumer.update(consumerUpdate);
    await this.persistenceAdapter.saveConsumer(consumer.toJSON());

    if (consumerUpdate.concurrency !== undefined) {
      await this.queueAdapter.closeWorker(consumer.name);
      await this.queueAdapter.createWorker(
        consumer.name,
        consumer.createWorkerProcessor(),
        consumer.concurrency,
      );
    }

    if (consumerUpdate.schedule !== undefined && consumerUpdate.schedule !== oldSchedule) {
      consumer.stopScheduler();
      if (consumer.hasSchedule()) {
        try {
          await consumer.startScheduler();
        } catch (error) {
          console.error(`Failed to start scheduler for ${consumer.name}:`, error);
        }
      }
    }
  }

  async clear(consumerData: JobConsumer, property?: StatProperty): Promise<void> {
    const consumer = this.consumers.get(consumerData.name);
    if (!consumer) throw new Error(`Consumer ${consumerData.name} not found`);
    await consumer.clearStats(property);
  }

  async tally(consumerData: JobConsumer, property: StatProperty): Promise<number> {
    const consumer = this.consumers.get(consumerData.name);
    if (!consumer) return 0;
    await consumer.updateStats();
    return consumer.getTally(property);
  }

  async getWaitingJobs(consumerName: string): Promise<JobInterface[]> {
    const consumer = this.consumers.get(consumerName);
    if (!consumer) throw new Error(`Consumer ${consumerName} not found`);
    return await consumer.getWaitingJobs();
  }

  async getFailedJobs(consumerName: string): Promise<FailedJob[]> {
    const consumer = this.consumers.get(consumerName);
    if (!consumer) throw new Error(`Consumer ${consumerName} not found`);
    return await consumer.getFailedJobs();
  }

  async getSuccessfulJobs(consumerName: string): Promise<SuccessfulJob[]> {
    const consumer = this.consumers.get(consumerName);
    if (!consumer) throw new Error(`Consumer ${consumerName} not found`);
    return await consumer.getSuccessfulJobs();
  }

  async pause(consumerName: string): Promise<void> {
    const consumer = this.consumers.get(consumerName);
    if (!consumer) throw new Error(`Consumer ${consumerName} not found`);
    await consumer.pause();
  }

  async resume(consumerName: string): Promise<void> {
    const consumer = this.consumers.get(consumerName);
    if (!consumer) throw new Error(`Consumer ${consumerName} not found`);
    await consumer.resume();
  }

  // ── JobService ──

  private async addJob(jobData: JobInterface): Promise<void> {
    const consumer = this.consumers.get(jobData.consumerName);
    if (!consumer) throw new Error(`Consumer ${jobData.consumerName} not found`);
    await consumer.addJob(jobData);
  }

  private async getJob(nameOrId: string): Promise<JobInterface | null> {
    let jobData = await this.jobAdapter.readJob(nameOrId);

    if (!jobData) {
      const states: StatProperty[] = ["waiting", "active", "completed", "failed", "delayed", "stalled"];
      for (const consumer of this.consumers.values()) {
        for (const state of states) {
          const jobs = await this.jobAdapter.getJobsByState(consumer.name, state);
          jobData = jobs.find((j: JobInterface) => j.name === nameOrId || j.id === nameOrId) || null;
          if (jobData) break;
        }
        if (jobData) break;
      }
    }

    if (!jobData) return null;
    const job = new Job(jobData);
    job.setAdapter(this.jobAdapter);
    return job.toJSON();
  }

  async retry(jobData: JobInterface): Promise<void> {
    const job = new Job(jobData);
    job.setAdapter(this.jobAdapter);
    await job.retry();
  }

  async cancel(jobData: JobInterface): Promise<void> {
    const job = new Job(jobData);
    job.setAdapter(this.jobAdapter);
    await job.cancel();
  }

  private async updateJob(jobData: JobInterface): Promise<void> {
    const existingJob = await this.jobAdapter.readJob(jobData.id);
    if (!existingJob) throw new Error(`Job ${jobData.id} not found`);

    const job = new Job(existingJob);
    job.setAdapter(this.jobAdapter);
    await job.update(jobData);
  }

  async getFor(consumerName: string, filter?: StatProperty): Promise<JobInterface[]> {
    const consumer = this.consumers.get(consumerName);
    if (!consumer) throw new Error(`Consumer ${consumerName} not found`);

    if (filter) return await this.jobAdapter.getJobsByState(consumerName, filter);

    const states: StatProperty[] = ["waiting", "active", "completed", "failed", "delayed", "stalled"];
    const allJobs: JobInterface[] = [];
    for (const state of states) {
      const jobs = await this.jobAdapter.getJobsByState(consumerName, state);
      allJobs.push(...jobs);
    }
    return allJobs;
  }
}
