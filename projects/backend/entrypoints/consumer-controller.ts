import { Controller, Get, Post, Delete, Patch, Param, Body, HttpCode, Inject, UseGuard } from "@danet/core";
import type { ConsumerService, JobConsumer, Job, FailedJob, SuccessfulJob } from "@design";
import { BasicAuthGuard } from "./auth-guard.ts";
import { notFound, badRequest, conflict } from "./http-error.ts";
import { createConsumer } from "@domain/coordinators/consumer-create/mod.ts";
import { getConsumer } from "@domain/coordinators/consumer-get/mod.ts";
import { listConsumers } from "@domain/coordinators/consumer-list/mod.ts";
import { updateConsumer } from "@domain/coordinators/consumer-update/mod.ts";
import { deleteConsumer } from "@domain/coordinators/consumer-delete/mod.ts";
import { pauseConsumer } from "@domain/coordinators/consumer-pause/mod.ts";
import { resumeConsumer } from "@domain/coordinators/consumer-resume/mod.ts";
import { resetConsumerStats } from "@domain/coordinators/consumer-reset-stats/mod.ts";
import { getConsumerWaitingJobs } from "@domain/coordinators/consumer-waiting-jobs/mod.ts";
import { getConsumerFailedJobs } from "@domain/coordinators/consumer-failed-jobs/mod.ts";
import { getConsumerSuccessfulJobs } from "@domain/coordinators/consumer-successful-jobs/mod.ts";

@UseGuard(BasicAuthGuard)
@Controller("consumers")
export class ConsumerController {
  constructor(@Inject("ConsumerService") private readonly consumerService: ConsumerService) {}

  @Get("/")
  async getAll(): Promise<JobConsumer[]> {
    return await listConsumers(this.consumerService);
  }

  @Get("/:name")
  async get(@Param("name") name: string): Promise<JobConsumer> {
    const data = await getConsumer(this.consumerService, name);
    if (!data) notFound(`Consumer ${name} not found`);
    return data;
  }

  @Post("/")
  @HttpCode(201)
  async add(@Body() consumer: JobConsumer): Promise<void> {
    try {
      await createConsumer(this.consumerService, consumer);
    } catch (error: unknown) {
      const err = error as { statusCode?: number; message: string };
      if (err.statusCode === 409) conflict(err.message);
      badRequest(err.message);
    }
  }

  @Delete("/:name")
  @HttpCode(204)
  async remove(@Param("name") name: string): Promise<void> {
    try {
      await deleteConsumer(this.consumerService, name);
    } catch (error: unknown) {
      const err = error as { statusCode?: number; message: string };
      if (err.statusCode === 404) notFound(err.message);
      conflict(err.message);
    }
  }

  @Patch("/:name")
  async update(@Param("name") name: string, @Body() updates: Partial<JobConsumer>): Promise<void> {
    try {
      await updateConsumer(this.consumerService, name, updates);
    } catch (error: unknown) {
      const err = error as { statusCode?: number; message: string };
      if (err.statusCode === 404) notFound(err.message);
      if (err.statusCode === 400) badRequest(err.message);
      throw error;
    }
  }

  @Get("/:name/jobs/waiting")
  async getWaitingJobs(@Param("name") name: string): Promise<Job[]> {
    try {
      return await getConsumerWaitingJobs(this.consumerService, name);
    } catch (error: unknown) {
      const err = error as { statusCode?: number; message: string };
      if (err.statusCode === 404) notFound(err.message);
      throw error;
    }
  }

  @Get("/:name/jobs/failed")
  async getFailedJobs(@Param("name") name: string): Promise<FailedJob[]> {
    try {
      return await getConsumerFailedJobs(this.consumerService, name);
    } catch (error: unknown) {
      const err = error as { statusCode?: number; message: string };
      if (err.statusCode === 404) notFound(err.message);
      throw error;
    }
  }

  @Get("/:name/jobs/successful")
  async getSuccessfulJobs(@Param("name") name: string): Promise<SuccessfulJob[]> {
    try {
      return await getConsumerSuccessfulJobs(this.consumerService, name);
    } catch (error: unknown) {
      const err = error as { statusCode?: number; message: string };
      if (err.statusCode === 404) notFound(err.message);
      throw error;
    }
  }

  @Post("/:name/pause")
  @HttpCode(202)
  async pause(@Param("name") name: string): Promise<void> {
    try {
      await pauseConsumer(this.consumerService, name);
    } catch (error: unknown) {
      const err = error as { statusCode?: number; message: string };
      if (err.statusCode === 404) notFound(err.message);
      badRequest(err.message);
    }
  }

  @Post("/:name/resume")
  @HttpCode(202)
  async resume(@Param("name") name: string): Promise<void> {
    try {
      await resumeConsumer(this.consumerService, name);
    } catch (error: unknown) {
      const err = error as { statusCode?: number; message: string };
      if (err.statusCode === 404) notFound(err.message);
      badRequest(err.message);
    }
  }

  @Post("/:name/reset-stats")
  @HttpCode(202)
  async resetStats(@Param("name") name: string): Promise<void> {
    try {
      await resetConsumerStats(this.consumerService, name);
    } catch (error: unknown) {
      const err = error as { statusCode?: number; message: string };
      if (err.statusCode === 404) notFound(err.message);
      badRequest(err.message);
    }
  }
}
