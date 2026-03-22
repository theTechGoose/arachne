import type { JobConsumerDto, ConsumerStatsDto } from "./job-consumer.ts";
import type { JobDto } from "./job.ts";
import type { StatProperty } from "@design";

export class HealthResponseDto {
  healthy!: boolean;
  consumers!: JobConsumerDto[];
  timestamp!: string;
}

export class DashboardResponseDto {
  totalConsumers!: number;
  totalJobs!: number;
  consumers!: JobConsumerDto[];
  stats!: ConsumerStatsDto;
  systemHealth!: "healthy" | "degraded" | "unhealthy";
  databaseSizeBytes!: number;
}

export class ActivityResponseDto {
  lastHour!: number;
  last24Hours!: number;
  last7Days!: number;
  currentRate!: number;
  peakRate!: number;
}

export class ConsumerStatsResponseDto {
  consumer!: JobConsumerDto;
  stats!: ConsumerStatsDto;
  recentJobs!: {
    waiting: JobDto[];
    failed: any[];
    successful: any[];
  };
}

export class GlobalStatsResponseDto {
  stats!: ConsumerStatsDto;
  byConsumer!: Record<string, ConsumerStatsDto>;
}

export class ErrorResponseDto {
  statusCode!: number;
  message!: string | string[];
  error!: string;
}

export class PipelineJobDto {
  id!: string;
  name!: string;
  currentStep!: string | null;
  status!: string;
  pipelineResults?: any[];
}

export class PipelineStatsDto {
  consumerName!: string;
  totalProcessed!: number;
  completed!: number;
  failed!: number;
  failuresByStep!: Record<string, number>;
  pipelineSteps!: string[];
}

export class PipelineFailureAnalysisDto {
  pipelines!: Record<string, {
    completed: number;
    failed: number;
    failuresByStep: Record<string, number>;
  }>;
}

export class StatCountResponseDto {
  consumer!: string;
  property!: StatProperty;
  count!: number;
  timestamp!: Date;
}
