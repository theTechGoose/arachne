import {
  IsString,
  IsNumber,
  IsIn,
  IsOptional,
  IsArray,
  ValidateNested,
  Min,
  Max,
  IsBoolean,
} from "class-validator";
import { Type } from "class-transformer";
import { JobDetailsDto } from "./job-details.ts";

export class ConsumerStatsDto {
  @IsNumber()
  @Min(0)
  completed!: number;

  @IsNumber()
  @Min(0)
  failed!: number;

  @IsNumber()
  @Min(0)
  waiting!: number;

  @IsNumber()
  @Min(0)
  active!: number;

  @IsNumber()
  @Min(0)
  stalled!: number;

  @IsNumber()
  @Min(0)
  delayed!: number;

  @IsNumber()
  @Min(0)
  removed!: number;
}

export class JobConsumerDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetUrls!: string[] | null;

  @IsNumber()
  @Min(1)
  @Max(100)
  concurrency!: number;

  @IsIn(["healthy", "degraded", "unhealthy"])
  health!: "healthy" | "degraded" | "unhealthy";

  @IsBoolean()
  paused!: boolean;

  @ValidateNested()
  @Type(() => JobDetailsDto)
  defaultJobDetails!: JobDetailsDto;

  @IsOptional()
  @IsString()
  schedule!: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  pipeline!: string[] | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ValidateNested()
  @Type(() => ConsumerStatsDto)
  stats!: ConsumerStatsDto;
}
