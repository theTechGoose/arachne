import {
  IsString,
  IsNumber,
  IsDateString,
  ValidateNested,
  IsOptional,
  IsIn,
  IsArray,
  Min,
  Max,
  ValidateIf,
} from "class-validator";
import { Type } from "class-transformer";
import { JobDetailsDto } from "./job-details.ts";
import type { StatProperty } from "@design";

export class JobDto {
  @IsString()
  name!: string;

  @IsString()
  consumerName!: string;

  @IsNumber()
  @Min(0)
  @Max(10)
  priority!: number;

  @IsDateString()
  createdAt!: Date;

  @IsIn([
    "completed",
    "failed",
    "waiting",
    "active",
    "stalled",
    "delayed",
    "removed",
  ])
  status!: StatProperty;

  @IsOptional()
  @IsString()
  currentStep?: string | null;

  @ValidateIf((obj) => obj.pipelineOwner !== null)
  @IsString()
  pipelineOwner!: string | null;

  @IsArray()
  pipelineResults!: unknown[];

  @IsOptional()
  @ValidateNested()
  @Type(() => JobDetailsDto)
  details?: Partial<JobDetailsDto>;
}
