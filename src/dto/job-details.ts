import {
  IsNumber,
  IsObject,
  IsString,
  Min,
  ValidateNested,
  IsOptional,
  IsIn,
} from "class-validator";
import { Type } from "class-transformer";

export class BackoffDto {
  @IsIn(["fixed", "exponential", "linear"])
  type!: "fixed" | "exponential" | "linear";

  @IsNumber()
  @Min(0)
  delay!: number;
}

export class JobDetailsDto<T = unknown> {
  @IsNumber()
  @Min(0)
  delay!: number;

  @IsNumber()
  @Min(0)
  attempts!: number;

  @IsObject()
  headers!: Record<string, string>;

  @IsOptional()
  body!: T;

  @ValidateNested()
  @Type(() => BackoffDto)
  backoff!: BackoffDto;
}
