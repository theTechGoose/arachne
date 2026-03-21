import type {
  Job as IJob,
  JobDetails,
  StatProperty,
} from "@design";

export class Job implements IJob {
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

  // deno-lint-ignore no-explicit-any
  private jobAdapter?: any;

  constructor(data: IJob) {
    this.id = data.id;
    this.name = data.name;
    this.consumerName = data.consumerName;
    this.priority = data.priority;
    this.createdAt = data.createdAt instanceof Date ? data.createdAt : new Date(data.createdAt);
    this.status = data.status || "waiting";
    this.currentStep = data.currentStep || null;
    this.pipelineOwner = data.pipelineOwner || null;
    this.details = data.details || {};
    this.pipelineResults = data.pipelineResults || [];
  }

  // deno-lint-ignore no-explicit-any
  setAdapter(jobAdapter: any): void {
    this.jobAdapter = jobAdapter;
  }

  async retry(): Promise<void> {
    if (!this.jobAdapter) throw new Error("Job adapter not set");
    if (this.status !== "failed" && this.status !== "stalled") {
      throw new Error(`Job ${this.id} is not in a retryable state (current: ${this.status})`);
    }
    await this.jobAdapter.retryJob(this.id);
    this.status = "waiting";
  }

  async cancel(): Promise<void> {
    if (!this.jobAdapter) throw new Error("Job adapter not set");
    if (this.status === "active") throw new Error(`Cannot cancel active job ${this.id}`);
    if (this.status === "completed") throw new Error(`Cannot cancel completed job ${this.id}`);

    await this.jobAdapter.deleteJob(this.id);
    this.status = "removed";
  }

  async updateStatus(newStatus: StatProperty): Promise<void> {
    if (!this.jobAdapter) throw new Error("Job adapter not set");
    if (!this.isValidStatusTransition(this.status, newStatus)) {
      throw new Error(`Invalid status transition from ${this.status} to ${newStatus}`);
    }
    this.status = newStatus;
    await this.jobAdapter.updateJob(this);
  }

  async update(updates: Partial<IJob>): Promise<void> {
    if (!this.jobAdapter) throw new Error("Job adapter not set");
    if (this.status === "completed" || this.status === "active") {
      throw new Error(`Job ${this.id} is immutable in ${this.status} state`);
    }
    if (updates.id && updates.id !== this.id) {
      throw new Error("Job ID is immutable and cannot be changed");
    }

    if (updates.name !== undefined) this.name = updates.name;
    if (updates.consumerName !== undefined) this.consumerName = updates.consumerName;
    if (updates.priority !== undefined) this.priority = updates.priority;
    if (updates.currentStep !== undefined) this.currentStep = updates.currentStep;
    if (updates.details !== undefined) this.details = updates.details;
    if (updates.status !== undefined) this.status = updates.status;
    if (updates.pipelineResults !== undefined) this.pipelineResults = updates.pipelineResults;

    await this.jobAdapter.updateJob(this);
  }

  async promote(): Promise<void> {
    if (!this.jobAdapter) throw new Error("Job adapter not set");
    if (this.status !== "delayed") throw new Error(`Job ${this.id} is not delayed (current: ${this.status})`);
    await this.jobAdapter.promoteJob(this.id);
    this.status = "waiting";
  }

  async refreshStatus(): Promise<void> {
    if (!this.jobAdapter) throw new Error("Job adapter not set");
    const state = await this.jobAdapter.getJobState(this.id);
    if (state) this.status = this.mapStateToStatus(state);
  }

  isTerminal(): boolean {
    return this.status === "completed" || this.status === "failed" || this.status === "removed";
  }

  isActive(): boolean {
    return this.status === "active";
  }

  isWaiting(): boolean {
    return this.status === "waiting" || this.status === "delayed";
  }

  canRetry(): boolean {
    return this.status === "failed" || this.status === "stalled";
  }

  canCancel(): boolean {
    return this.status !== "active" && this.status !== "completed";
  }

  getAge(): number {
    return Date.now() - this.createdAt.getTime();
  }

  hasDelay(): boolean {
    return this.details?.delay !== undefined && this.details.delay > 0;
  }

  getMaxAttempts(): number {
    return this.details?.attempts || 3;
  }

  private isValidStatusTransition(from: StatProperty, to: StatProperty): boolean {
    const transitions: Record<StatProperty, StatProperty[]> = {
      waiting: ["active", "delayed", "removed"],
      active: ["completed", "failed", "stalled"],
      completed: [],
      failed: ["waiting", "removed"],
      delayed: ["waiting", "removed"],
      stalled: ["active", "failed", "waiting"],
      removed: [],
    };
    return transitions[from]?.includes(to) || false;
  }

  private mapStateToStatus(state: string): StatProperty {
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

  clone(overrides?: Partial<IJob>): Job {
    return new Job({ ...this.toJSON(), ...overrides });
  }

  toJSON(): IJob {
    return {
      id: this.id,
      name: this.name,
      consumerName: this.consumerName,
      priority: this.priority,
      createdAt: this.createdAt,
      status: this.status,
      currentStep: this.currentStep,
      pipelineOwner: this.pipelineOwner,
      details: this.details,
      pipelineResults: this.pipelineResults,
    };
  }
}
