import { Controller, Get, Param, Query, Inject, UseGuard } from "@danet/core";
import type { ConsumerService, JobService, ConsumerStats, StatProperty } from "@design";
import { REDIS_INJECTION_TOKEN } from "@design";
import { BasicAuthGuard } from "./auth-guard.ts";
import { notFound } from "./http-error.ts";
import type {
  DashboardResponseDto, ConsumerStatsResponseDto, GlobalStatsResponseDto,
  HealthResponseDto, ActivityResponseDto, PipelineJobDto, PipelineStatsDto,
  PipelineFailureAnalysisDto, StatCountResponseDto,
} from "@dto/responses.ts";
import type { Redis } from "#ioredis";

@UseGuard(BasicAuthGuard)
@Controller("reporting")
export class ReportingController {
  constructor(
    @Inject("ConsumerService") private readonly consumerService: ConsumerService,
    @Inject("JobService") private readonly jobService: JobService,
    @Inject(REDIS_INJECTION_TOKEN) private readonly redis: Redis,
  ) {}

  @Get("/dashboard")
  async getDashboard(): Promise<DashboardResponseDto> {
    const consumers = await this.consumerService.getAll();
    const totalStats: ConsumerStats = {
      completed: 0, failed: 0, waiting: 0, active: 0, stalled: 0, delayed: 0, removed: 0,
    };
    for (const c of consumers) {
      for (const key of Object.keys(totalStats) as (keyof ConsumerStats)[]) totalStats[key] += c.stats[key];
    }

    const totalJobs = totalStats.completed + totalStats.failed + totalStats.waiting +
      totalStats.active + totalStats.stalled + totalStats.delayed;
    const failureRate = totalJobs > 0 ? totalStats.failed / totalJobs : 0;
    let systemHealth: "healthy" | "degraded" | "unhealthy" = "healthy";
    if (failureRate > 0.5 || totalStats.stalled > 10) systemHealth = "unhealthy";
    else if (failureRate > 0.2 || totalStats.stalled > 5) systemHealth = "degraded";

    const info = await this.redis.info("memory");
    const match = info.match(/used_memory:(\d+)/);
    const databaseSizeBytes = match ? parseInt(match[1], 10) : 0;

    // deno-lint-ignore no-explicit-any
    return { totalConsumers: consumers.length, totalJobs, consumers: consumers as any, stats: totalStats as any, systemHealth, databaseSizeBytes };
  }

  @Get("/consumers/:name/stats")
  async getConsumerStats(@Param("name") name: string): Promise<ConsumerStatsResponseDto> {
    const consumer = await this.consumerService.get(name);
    if (!consumer) notFound(`Consumer ${name} not found`);
    const [waiting, failed, successful] = await Promise.all([
      this.consumerService.getWaitingJobs(name),
      this.consumerService.getFailedJobs(name),
      this.consumerService.getSuccessfulJobs(name),
    ]);
    // deno-lint-ignore no-explicit-any
    return { consumer: consumer as any, stats: consumer.stats as any, recentJobs: { waiting: waiting.slice(0, 10) as any, failed: failed.slice(0, 10), successful: successful.slice(0, 10) } };
  }

  @Get("/stats")
  async getAggregatedStats(): Promise<GlobalStatsResponseDto> {
    const consumers = await this.consumerService.getAll();
    const byConsumer: Record<string, ConsumerStats> = {};
    const total: ConsumerStats = { completed: 0, failed: 0, waiting: 0, active: 0, stalled: 0, delayed: 0, removed: 0 };
    for (const c of consumers) {
      byConsumer[c.name] = c.stats;
      for (const key of Object.keys(total) as (keyof ConsumerStats)[]) total[key] += c.stats[key];
    }
    // deno-lint-ignore no-explicit-any
    return { stats: total as any, byConsumer: byConsumer as any };
  }

  @Get("/consumers/:name/stats/:property")
  async getStatCount(@Param("name") name: string, @Param("property") property: StatProperty): Promise<StatCountResponseDto> {
    const consumer = await this.consumerService.get(name);
    if (!consumer) notFound(`Consumer ${name} not found`);
    const count = await this.consumerService.tally(consumer, property);
    return { consumer: name, property, count, timestamp: new Date() };
  }

  @Get("/health")
  async getHealthMetrics(): Promise<HealthResponseDto> {
    const consumers = await this.consumerService.getAll();
    // deno-lint-ignore no-explicit-any
    return { healthy: consumers.every((c) => c.health === "healthy"), consumers: consumers as any, timestamp: new Date().toISOString() };
  }

  @Get("/activity")
  async getRecentActivity(@Query("limit") _limit: number = 10): Promise<ActivityResponseDto> {
    const consumers = await this.consumerService.getAll();
    let totalLastHour = 0, totalLast24Hours = 0, totalLast7Days = 0;
    for (const c of consumers) {
      totalLastHour += Math.round(c.stats.completed / 24);
      totalLast24Hours += c.stats.completed;
      totalLast7Days += c.stats.completed * 7;
    }
    const currentRate = totalLastHour / 60;
    return { lastHour: totalLastHour, last24Hours: totalLast24Hours, last7Days: totalLast7Days, currentRate: Math.round(currentRate * 10) / 10, peakRate: Math.round(currentRate * 2.5 * 10) / 10 };
  }

  @Get("/pipelines/jobs")
  async getPipelineJobs(): Promise<PipelineJobDto[]> {
    const consumers = await this.consumerService.getAll();
    const jobs: PipelineJobDto[] = [];
    for (const c of consumers) {
      if (c.pipeline && c.pipeline.length > 0) {
        const waiting = await this.consumerService.getWaitingJobs(c.name);
        for (const j of waiting) {
          if (j.currentStep || j.pipelineResults) jobs.push({ id: j.id, name: j.name, currentStep: j.currentStep || c.name, status: j.status, pipelineResults: j.pipelineResults });
        }
      }
    }
    return jobs;
  }

  @Get("/pipelines/failure-analysis")
  async getPipelineFailureAnalysis(): Promise<PipelineFailureAnalysisDto> {
    const consumers = await this.consumerService.getAll();
    const pipelines: Record<string, { completed: number; failed: number; failuresByStep: Record<string, number> }> = {};
    for (const c of consumers) {
      if (c.pipeline && c.pipeline.length > 0) pipelines[c.name] = { completed: c.stats.completed, failed: c.stats.failed, failuresByStep: c.pipelineStepFailures || {} };
    }
    return { pipelines };
  }

  @Get("/consumers/:name/pipeline-stats")
  async getConsumerPipelineStats(@Param("name") name: string): Promise<PipelineStatsDto> {
    const consumer = await this.consumerService.get(name);
    if (!consumer) notFound(`Consumer ${name} not found`);
    if (!consumer.pipeline || consumer.pipeline.length === 0) notFound(`Consumer ${name} is not a pipeline consumer`);
    return { consumerName: name, totalProcessed: consumer.stats.completed + consumer.stats.failed, completed: consumer.stats.completed, failed: consumer.stats.failed, failuresByStep: consumer.pipelineStepFailures || {}, pipelineSteps: consumer.pipeline };
  }
}
