/**
 * Arachne Backend - Core Types & Service Contracts
 *
 * Domain entities, DI tokens, and service interfaces for
 * BullMQ-backed queue orchestration over HTTP.
 */

export const REDIS_INJECTION_TOKEN = "REDIS";

const levels = ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"] as const;
export type LogLevel = (typeof levels)[number];

export interface Log {
  time: string;
  lvl: LogLevel;
  id: string;
  msg: string;
  svc: string;
  [key: string]: unknown;
}

export type LoggingFn = (obj: string) => void | Promise<void>;

export const statProperty = [
  "completed",
  "failed",
  "waiting",
  "active",
  "stalled",
  "delayed",
  "removed",
] as const;

export type StatProperty = (typeof statProperty)[number];

export type ConsumerStats = Record<StatProperty, number>;

type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface JobConsumer {
  name: string;
  targetUrls: string[] | null;
  concurrency: number;
  health: HealthStatus;
  paused: boolean;
  defaultJobDetails: Partial<JobDetails>;
  schedule: string | null;
  pipeline: string[] | null;
  stats: ConsumerStats;
  pipelineStepFailures?: Record<string, number>;
  tags?: string[];
}

export interface Job {
  id: string;
  name: string;
  consumerName: string;
  priority: number;
  createdAt: Date;
  status: StatProperty;
  currentStep: string | null;
  pipelineOwner: string | null;
  details: Partial<JobDetails>;
  pipelineResults: unknown[];
}

export interface FailedJob extends Job {
  errorMessages: string[];
  failedAt: Date;
  attemptsMade: number;
}

export interface SuccessfulJob extends Job {
  completedAt: Date;
  attemptsMade: number;
  result: unknown;
}

export interface JobDetails<T = unknown> {
  delay: number;
  attempts: number;
  headers: Record<string, string>;
  body: T;
  backoff: {
    type: string;
    delay: number;
  };
}

// ── Service Contracts ──

export interface ConsumerService {
  getAll(): Promise<JobConsumer[]>;
  get(name: string): Promise<JobConsumer | null>;
  add(consumer: JobConsumer): Promise<void>;
  remove(name: string): Promise<void>;
  update(consumer: Partial<JobConsumer>): Promise<void>;
  clear(consumer: JobConsumer, property?: StatProperty): Promise<void>;
  tally(consumer: JobConsumer, property: StatProperty): Promise<number>;
  getWaitingJobs(consumerName: string): Promise<Job[]>;
  getFailedJobs(consumerName: string): Promise<FailedJob[]>;
  getSuccessfulJobs(consumerName: string): Promise<SuccessfulJob[]>;
  pause(consumerName: string): Promise<void>;
  resume(consumerName: string): Promise<void>;
}

export interface JobService {
  add(job: Job): Promise<void>;
  get(jobName: string): Promise<Job | null>;
  retry(job: Job): Promise<void>;
  cancel(job: Job): Promise<void>;
  update(job: Job): Promise<void>;
  getFor(consumerName: string, filter?: StatProperty): Promise<Job[]>;
}

// ── BullMQ Integration Contracts ──

export interface bullMqQueueEventsService {
  init(): Promise<void>;
  onDrained(cb: () => void): void;
  onCleaned(cb: (args: { jobs: string[]; type: string }) => void): void;
  onPaused(cb: () => void): void;
  onResumed(cb: () => void): void;
  onError(cb: (err: Error) => void): void;
}

export interface bullMqQueueService {
  init(): Promise<void>;
  getAll(): Promise<string[]>;
  get(consumerName: string): Promise<string | null>;
  create(consumerName: string): Promise<void>;
  delete(consumerName: string): Promise<void>;
  onDrained(cb: () => void): void;
}

export interface bullMqJobEventsService {
  init(): Promise<void>;
  onCompleted(
    cb: (args: { jobId: string; returnvalue: unknown }) => void,
  ): void;
  onFailed(cb: (args: { jobId: string; failedReason: string }) => void): void;
  onStalled(cb: (args: { jobId: string }) => void): void;
  onProgress(
    cb: (args: { jobId: string; progress: number | object }) => void,
  ): void;
  onError(cb: (err: Error) => void): void;
}

export interface bullMqJobService {
  init(): Promise<void>;
  getAll(consumerFilter?: string): Promise<string[]>;
  createJob(job: Job): Promise<void>;
  readJob(jobId: string): Promise<Job | null>;
  updateJob(job: Job): Promise<void>;
  deleteJob(jobId: string): Promise<void>;
}
