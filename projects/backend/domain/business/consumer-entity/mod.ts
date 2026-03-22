import type {
  JobConsumer,
  Job as IJob,
  JobDetails,
  StatProperty,
  ConsumerStats,
  FailedJob,
  SuccessfulJob,
  Log,
} from "@design";
import * as cron from "#node-cron";
import { nanoid } from "nanoid";
import { httpLogger } from "../../data/http-logger/mod.ts";

export class Consumer implements JobConsumer {
  name: string;
  targetUrls: string[] | null;
  concurrency: number;
  health: "healthy" | "degraded" | "unhealthy";
  stats: ConsumerStats;
  defaultJobDetails: Partial<JobDetails>;
  schedule: string | null;
  pipeline: string[] | null;
  paused: boolean;
  pipelineStepFailures?: Record<string, number>;
  tags: string[];

  // deno-lint-ignore no-explicit-any
  private queueAdapter?: any;
  // deno-lint-ignore no-explicit-any
  private jobAdapter?: any;
  private consumerLookup?: (name: string) => boolean;

  private scheduledTask?: cron.ScheduledTask;
  private scheduleExecutionCount: number = 0;
  private lastScheduledExecution?: Date;
  private nextScheduledExecution?: Date;
  private scheduleEnabled: boolean = false;

  constructor(data: JobConsumer) {
    this.name = data.name;
    this.targetUrls = data.targetUrls;
    this.concurrency = data.concurrency;
    this.health = (data.health as "healthy" | "degraded" | "unhealthy") || "healthy";
    this.stats = data.stats || {
      completed: 0, failed: 0, waiting: 0,
      active: 0, stalled: 0, delayed: 0, removed: 0,
    };
    this.defaultJobDetails = data.defaultJobDetails || {};
    this.schedule = data.schedule || null;
    this.pipeline = data.pipeline || null;
    this.paused = data.paused || false;
    this.pipelineStepFailures = data.pipelineStepFailures || {};
    this.tags = data.tags || [];
  }

  // deno-lint-ignore no-explicit-any
  setAdapters(queueAdapter: any, jobAdapter: any): void {
    this.queueAdapter = queueAdapter;
    this.jobAdapter = jobAdapter;
  }

  setConsumerLookup(lookup: (name: string) => boolean): void {
    this.consumerLookup = lookup;
  }

  async pause(): Promise<void> {
    if (!this.queueAdapter) throw new Error("Queue adapter not set");
    if (this.paused) throw new Error(`Consumer ${this.name} is already paused`);

    await this.queueAdapter.pause(this.name);
    this.paused = true;

    if (this.hasSchedule()) {
      this.stopScheduler();
    }
  }

  async resume(): Promise<void> {
    if (!this.queueAdapter) throw new Error("Queue adapter not set");
    if (!this.paused) throw new Error(`Consumer ${this.name} is not paused`);

    await this.queueAdapter.resume(this.name);
    this.paused = false;

    if (this.hasSchedule()) {
      try {
        await this.startScheduler();
      } catch (error) {
        console.error(`Failed to restart scheduler for ${this.name}:`, error);
      }
    }
  }

  async addJob(job: IJob): Promise<void> {
    if (!this.jobAdapter) throw new Error("Job adapter not set");
    if (job.consumerName !== this.name) {
      throw new Error(`Job ${job.id} is for consumer ${job.consumerName}, not ${this.name}`);
    }

    if (!job.details && this.defaultJobDetails) {
      job.details = { ...this.defaultJobDetails };
    } else if (job.details && this.defaultJobDetails) {
      job.details = { ...this.defaultJobDetails, ...job.details };
    }

    if (!job.status) job.status = "waiting";

    await this.jobAdapter.createJob(job);
    this.stats.waiting++;
  }

  async updateStats(): Promise<void> {
    if (!this.queueAdapter) throw new Error("Queue adapter not set");

    const counts = await this.queueAdapter.getJobCounts(this.name);
    this.stats = {
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      stalled: counts.stalled || 0,
      delayed: counts.delayed || 0,
      removed: this.stats.removed || 0,
    };
    this.updateHealth();
  }

  updateHealth(): void {
    const totalProcessed = this.stats.completed + this.stats.failed;
    const failureRate = totalProcessed > 0 ? this.stats.failed / totalProcessed : 0;
    const queueDepth = this.stats.waiting + this.stats.delayed;

    if (failureRate > 0.5 || this.stats.stalled > 10) {
      this.health = "unhealthy";
    } else if (failureRate > 0.2 || this.stats.stalled > 5 || queueDepth > 100) {
      this.health = "degraded";
    } else {
      this.health = "healthy";
    }
  }

  async clearStats(property?: StatProperty): Promise<void> {
    if (!this.queueAdapter) throw new Error("Queue adapter not set");

    if (property) {
      switch (property) {
        case "completed":
          await this.queueAdapter.clean(this.name, 0, 0, "completed");
          break;
        case "failed":
          await this.queueAdapter.clean(this.name, 0, 0, "failed");
          break;
        case "waiting":
          await this.queueAdapter.drain(this.name);
          break;
        case "delayed":
          await this.queueAdapter.removeJobs(this.name, "delayed");
          break;
        default:
          console.log(`Cannot clear ${property} jobs`);
      }
      this.stats[property] = 0;
    } else {
      await this.queueAdapter.drain(this.name);
      await this.queueAdapter.clean(this.name, 0, 0, "completed");
      await this.queueAdapter.clean(this.name, 0, 0, "failed");
      this.stats = {
        completed: 0, failed: 0, waiting: 0,
        active: 0, stalled: 0, delayed: 0, removed: 0,
      };
    }
  }

  getTally(property: StatProperty): number {
    return this.stats[property];
  }

  async getWaitingJobs(): Promise<IJob[]> {
    if (!this.jobAdapter) throw new Error("Job adapter not set");
    return await this.jobAdapter.getJobsByState(this.name, "waiting");
  }

  async getFailedJobs(): Promise<FailedJob[]> {
    if (!this.queueAdapter) throw new Error("Queue adapter not set");

    // deno-lint-ignore no-explicit-any
    const failedBullJobs = await this.queueAdapter.getFailed(this.name);

    // deno-lint-ignore no-explicit-any
    return failedBullJobs.map((job: any) => ({
      id: job.id || "",
      name: job.name,
      consumerName: this.name,
      priority: job.opts.priority || 0,
      createdAt: new Date(job.timestamp),
      status: "failed" as StatProperty,
      currentStep: job.data.currentStep || null,
      pipelineOwner: null,
      pipelineResults: [],
      details: {
        delay: job.opts.delay || 0,
        attempts: job.opts.attempts || 3,
        headers: job.data.headers || {},
        body: job.data.body || {},
        backoff: job.opts.backoff || { type: "exponential", delay: 1000 },
      },
      errorMessages: job.failedReason ? [job.failedReason] : [],
      failedAt: job.finishedOn ? new Date(job.finishedOn) : new Date(),
      attemptsMade: job.attemptsMade || 0,
    }));
  }

  async getSuccessfulJobs(): Promise<SuccessfulJob[]> {
    if (!this.queueAdapter) throw new Error("Queue adapter not set");

    const completedBullJobs = await this.queueAdapter.getCompleted(this.name);

    // deno-lint-ignore no-explicit-any
    return completedBullJobs.map((job: any) => ({
      id: job.id || "",
      name: job.name,
      consumerName: this.name,
      priority: job.opts.priority || 0,
      createdAt: new Date(job.timestamp),
      status: "completed" as StatProperty,
      currentStep: job.data.currentStep || null,
      pipelineOwner: null,
      pipelineResults: [],
      details: {
        delay: job.opts.delay || 0,
        attempts: job.opts.attempts || 3,
        headers: job.data.headers || {},
        body: job.data.body || {},
        backoff: job.opts.backoff || { type: "exponential", delay: 1000 },
      },
      completedAt: job.finishedOn ? new Date(job.finishedOn) : new Date(),
      attemptsMade: job.attemptsMade || 0,
      result: job.returnvalue || {},
    }));
  }

  hasPipeline(): boolean {
    return true;
  }

  getPipelineSteps(): string[] {
    return this.pipeline || [this.name];
  }

  trackPipelineFailure(step: string): void {
    if (!this.pipelineStepFailures) this.pipelineStepFailures = {};
    if (!this.pipelineStepFailures[step]) this.pipelineStepFailures[step] = 0;
    this.pipelineStepFailures[step]++;
  }

  getNextPipelineStep(currentStep?: string | null): string | null {
    const steps = this.getPipelineSteps();
    if (!currentStep) return steps[0];

    const currentIndex = steps.indexOf(currentStep);
    if (currentIndex >= 0 && currentIndex < steps.length - 1) {
      return steps[currentIndex + 1];
    }
    return null;
  }

  async processJobThroughPipeline(job: IJob, result: unknown): Promise<IJob | null> {
    if (!this.hasPipeline()) return null;

    const nextStep = this.getNextPipelineStep(job.currentStep);
    if (!nextStep) return null;

    const pipelineJob: IJob = {
      id: `${job.id}-${nextStep}`,
      name: `${job.name}-pipeline`,
      consumerName: nextStep,
      priority: job.priority,
      createdAt: new Date(),
      status: "waiting",
      currentStep: nextStep,
      pipelineOwner: job.pipelineOwner || this.name,
      pipelineResults: job.pipelineResults || [],
      details: {
        ...job.details,
        body: result,
      },
    };
    return pipelineJob;
  }

  update(updates: Partial<JobConsumer>): void {
    if (updates.name && updates.name !== this.name) {
      throw new Error("Consumer name is immutable and cannot be changed");
    }

    if (updates.targetUrls !== undefined) this.targetUrls = updates.targetUrls;
    if (updates.concurrency !== undefined) this.concurrency = updates.concurrency;
    if (updates.defaultJobDetails !== undefined) this.defaultJobDetails = updates.defaultJobDetails;
    if (updates.schedule !== undefined) this.schedule = updates.schedule;
    if (updates.pipeline !== undefined) this.pipeline = updates.pipeline;
    if (updates.health !== undefined) this.health = updates.health as "healthy" | "degraded" | "unhealthy";
    if (updates.paused !== undefined) this.paused = updates.paused;
    if (updates.pipelineStepFailures !== undefined) this.pipelineStepFailures = updates.pipelineStepFailures;
    if (updates.tags !== undefined) this.tags = updates.tags;
  }

  // deno-lint-ignore no-explicit-any
  createWorkerProcessor(): (job: any) => Promise<any> {
    const targetUrls = this.targetUrls;
    const consumerName = this.name;
    const hasPipeline = this.hasPipeline();
    const jobAdapter = this.jobAdapter;
    const self = this;

    // deno-lint-ignore no-explicit-any
    return async (job: any) => {
      console.log(`[Worker ${consumerName}] Processing job ${job.id} (${job.name})`);

      try {
        if (hasPipeline && jobAdapter) {
          job.data.currentStep = consumerName;
          job.data.pipelineOwner = consumerName;
          await jobAdapter.updateJob({
            id: job.id,
            consumerName: job.data.consumerName,
            currentStep: consumerName,
            pipelineOwner: consumerName,
          });
        }

        let result = null;

        if (targetUrls === null || !targetUrls || targetUrls.length === 0) {
          if (hasPipeline && job.data.pipelineResults) {
            result = { aggregatedResults: job.data.pipelineResults, finalStep: consumerName };
          } else {
            result = { skipped: true, reason: "No targetUrls configured" };
          }
        } else {
          // deno-lint-ignore no-explicit-any
          const results: any[] = [];

          for (const targetUrl of targetUrls) {
            if (self.consumerLookup && self.consumerLookup(targetUrl)) {
              const chainedJob = {
                id: `${job.id}-chained-${Date.now()}`,
                name: `${job.name}-from-${consumerName}`,
                consumerName: targetUrl,
                currentStep: null,
                pipelineOwner: targetUrl,
                pipelineResults: [],
                status: "waiting",
                priority: job.data.priority || 0,
                createdAt: new Date(),
                details: {
                  body: { ...job.data.body, previousPipeline: consumerName, previousPipelineResults: job.data.pipelineResults },
                  headers: job.data.headers,
                  attempts: job.data.attempts || 3,
                  delay: 0,
                  backoff: job.data.backoff || { type: "exponential", delay: 1000 },
                },
              };

              await jobAdapter.createJob(chainedJob);
              results.push({ targetUrl, type: "consumer-chain", chainedTo: targetUrl, chainedJobId: chainedJob.id });
            } else {
              try {
                const requestBody = JSON.stringify(job.data.body);
                const jobMetadataHeaders: Record<string, string> = {
                  "X-Job-ID": job.id,
                  "X-Job-Name": job.name,
                  "X-Job-Consumer": consumerName,
                  "X-Job-Current-Step": job.data.currentStep || consumerName,
                  "X-Job-Priority": String(job.opts?.priority || 0),
                  "X-Job-Attempt": String((job.attemptsMade || 0) + 1),
                };

                if (job.data.pipelineOwner) {
                  jobMetadataHeaders["X-Job-Pipeline-Owner"] = job.data.pipelineOwner;
                }

                const requestHeaders = {
                  "Content-Type": "application/json",
                  ...jobMetadataHeaders,
                  ...job.data.headers,
                };

                const response = await fetch(targetUrl, {
                  method: "POST",
                  headers: requestHeaders,
                  body: requestBody,
                });

                const isSuccess = response.ok || response.status === 404 || response.status === 410;

                let urlResult;
                try {
                  const clone = response.clone();
                  urlResult = await clone.json();
                } catch {
                  urlResult = await response.text();
                }

                results.push({ targetUrl, type: "http", status: response.status, success: isSuccess, result: urlResult });
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                results.push({ targetUrl, type: "http", status: 0, success: false, error: errorMessage });
              }
            }
          }

          // deno-lint-ignore no-explicit-any
          const loggableFailures = results.filter((r: any) => r.success === false || r.status === 404 || r.status === 410);
          if (loggableFailures.length > 0) {
            const hasNetworkErrors = loggableFailures.some((f: { success: boolean }) => f.success === false);
            const logEntry: Log = {
              time: new Date().toISOString(),
              lvl: hasNetworkErrors ? "ERROR" : "WARN",
              id: `${consumerName}-${job.id}`,
              msg: hasNetworkErrors ? "Failed to reach target URLs" : "Target URLs returned 404/410",
              svc: "arachne",
              job: job.data,
              consumer: self.toJSON(),
              failedUrls: loggableFailures.map((f: { targetUrl: string; status: number; error?: string }) => ({
                url: f.targetUrl, status: f.status || 0, error: f.error,
              })),
            };
            const logResult = httpLogger(JSON.stringify(logEntry));
            if (logResult instanceof Promise) logResult.catch(() => {});
          }

          // deno-lint-ignore no-explicit-any
          const allFailed = results.every((r: any) => r.success === false);
          if (allFailed && results.length > 0) {
            // deno-lint-ignore no-explicit-any
            const failedUrls = results.map((r: any) => `${r.targetUrl}: ${r.status || "network error"}`).join(", ");
            throw new Error(`All destinations failed: ${failedUrls}`);
          }

          result = {
            destinations: results.length,
            // deno-lint-ignore no-explicit-any
            succeeded: results.filter((r: any) => r.success === true).length,
            // deno-lint-ignore no-explicit-any
            failed: results.filter((r: any) => r.success === false).length,
            results,
          };
        }

        if (hasPipeline) {
          if (!job.data.pipelineResults) job.data.pipelineResults = [];
          job.data.pipelineResults.push({ step: consumerName, result });
        }

        return {
          ...(typeof result === "string" ? { result } : result),
          _consumerName: consumerName,
          _jobId: job.id,
          _pipelineOwner: job.data.pipelineOwner,
          _pipelineResults: job.data.pipelineResults,
        };
      } catch (error) {
        console.error(`[Worker ${consumerName}] Job ${job.id} failed:`, error);
        if (hasPipeline && job.data.currentStep) {
          self.trackPipelineFailure(job.data.currentStep);
        }
        throw error;
      }
    };
  }

  hasSchedule(): boolean {
    return !!this.schedule && this.schedule !== null;
  }

  async startScheduler(): Promise<void> {
    if (!this.schedule) return;
    if (this.scheduledTask) return;

    if (!cron.validate(this.schedule)) {
      throw new Error(`Invalid cron expression: ${this.schedule}`);
    }

    this.scheduledTask = cron.schedule(this.schedule, async () => {
      try {
        await this.generateScheduledJob();
      } catch (error) {
        console.error(`Failed to generate scheduled job for ${this.name}:`, error);
      }
    });

    this.scheduleEnabled = true;
    this.updateNextExecution();
  }

  stopScheduler(): void {
    if (this.scheduledTask) {
      this.scheduledTask.stop();
      this.scheduledTask = undefined;
      this.scheduleEnabled = false;
    }
  }

  private async generateScheduledJob(): Promise<void> {
    if (!this.jobAdapter) throw new Error("Job adapter not set");

    this.scheduleExecutionCount++;
    this.lastScheduledExecution = new Date();

    const job: IJob = {
      id: `sched-${this.name}-${Date.now()}-${nanoid(6)}`,
      name: `scheduled-${this.name}-${this.scheduleExecutionCount}`,
      consumerName: this.name,
      priority: 0,
      createdAt: new Date(),
      status: "waiting",
      currentStep: null,
      pipelineOwner: this.hasPipeline() ? this.name : null,
      pipelineResults: [],
      details: {
        ...this.defaultJobDetails,
        body: {
          ...((this.defaultJobDetails?.body as Record<string, unknown>) || {}),
          scheduledExecution: {
            expression: this.schedule!,
            executionTime: new Date().toISOString(),
            executionNumber: this.scheduleExecutionCount,
          },
        },
      },
    };

    await this.addJob(job);
    this.updateNextExecution();
  }

  private updateNextExecution(): void {
    if (!this.schedule) return;

    const now = Date.now();
    if (this.schedule === "* * * * *") {
      this.nextScheduledExecution = new Date(now + 60000);
    } else if (this.schedule.startsWith("*/5 * * * *")) {
      this.nextScheduledExecution = new Date(now + 300000);
    } else if (this.schedule === "0 * * * *") {
      const next = new Date();
      next.setHours(next.getHours() + 1);
      next.setMinutes(0);
      next.setSeconds(0);
      this.nextScheduledExecution = next;
    } else if (this.schedule === "0 0 * * *") {
      const next = new Date();
      next.setDate(next.getDate() + 1);
      next.setHours(0);
      next.setMinutes(0);
      next.setSeconds(0);
      this.nextScheduledExecution = next;
    } else {
      this.nextScheduledExecution = new Date(now + 3600000);
    }
  }

  toJSON(): JobConsumer {
    return {
      name: this.name,
      targetUrls: this.targetUrls,
      concurrency: this.concurrency,
      health: this.health,
      stats: this.stats,
      defaultJobDetails: this.defaultJobDetails,
      schedule: this.schedule,
      pipeline: this.pipeline,
      paused: this.paused,
      pipelineStepFailures: this.pipelineStepFailures,
      tags: this.tags,
    };
  }
}
