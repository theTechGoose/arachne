import { Controller, Get, Post, Patch, Param, Body, Query, HttpCode, Inject, UseGuard } from "@danet/core";
import type { JobService, ConsumerService, Job as IJob, FailedJob, StatProperty } from "@design";
import { BasicAuthGuard } from "./auth-guard.ts";
import { notFound } from "./http-error.ts";
import { nanoid } from "nanoid";

@UseGuard(BasicAuthGuard)
@Controller("jobs")
export class JobController {
  constructor(
    @Inject("JobService") private readonly jobService: JobService,
    @Inject("ConsumerService") private readonly consumerService: ConsumerService,
  ) {}

  @Post("/")
  @HttpCode(201)
  async add(@Body() job: IJob): Promise<{ id: string }> {
    const jobId = nanoid();
    const jobWithId = { ...job, id: jobId };
    await this.jobService.add(jobWithId);
    return { id: jobId };
  }

  @Get("/:nameOrId")
  async get(@Param("nameOrId") nameOrId: string): Promise<IJob> {
    const job = await this.jobService.get(nameOrId);
    if (!job) notFound(`Job ${nameOrId} not found`);
    return job;
  }

  @Post("/:id/retry")
  @HttpCode(202)
  async retry(@Param("id") id: string): Promise<void> {
    const job = await this.jobService.get(id);
    if (!job) notFound(`Job ${id} not found`);
    await this.jobService.retry(job);
  }

  @Post("/:id/cancel")
  @HttpCode(202)
  async cancel(@Param("id") id: string): Promise<void> {
    const job = await this.jobService.get(id);
    if (!job) notFound(`Job ${id} not found`);
    await this.jobService.cancel(job);
  }

  @Patch("/:id")
  async update(@Param("id") id: string, @Body() updates: Partial<IJob>): Promise<void> {
    const existingJob = await this.jobService.get(id);
    if (!existingJob) notFound(`Job ${id} not found`);
    const updatedJob = { ...existingJob, ...updates, id };
    await this.jobService.update(updatedJob);
  }

  @Get("/:id/failed")
  async getFailedJob(@Param("id") id: string): Promise<FailedJob> {
    const job = await this.jobService.get(id);
    if (!job) notFound(`Job ${id} not found`);
    if (job.status !== "failed") notFound(`Job ${id} is not in failed state (current: ${job.status})`);

    const failedJobs = await this.consumerService.getFailedJobs(job.consumerName);
    const failedJob = failedJobs.find((fj: FailedJob) => fj.id === job.id);
    if (!failedJob) notFound(`Failed job details for ${id} not found`);
    return failedJob;
  }
}

@UseGuard(BasicAuthGuard)
@Controller("consumers/:consumerName/jobs")
export class ConsumerJobsController {
  constructor(@Inject("JobService") private readonly jobService: JobService) {}

  @Get("/")
  async getFor(
    @Param("consumerName") consumerName: string,
    @Query("filter") filter?: StatProperty,
  ): Promise<IJob[]> {
    return await this.jobService.getFor(consumerName, filter);
  }
}
