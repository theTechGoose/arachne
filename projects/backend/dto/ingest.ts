import { z } from "#zod";

const HttpMethod = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export const IngestPayloadSchema = z.object({
  route: z.array(z.string()).optional(),
  method: HttpMethod.optional(),
  headers: z.record(z.string(), z.string()).optional(),
  query: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
}).strict();

export const IngestRequestSchema = z.object({
  steps: z.array(z.string()).nonempty({ message: "steps array must not be empty" }),
  payload: IngestPayloadSchema.optional(),
  nonce: z.string().optional(),
  matureAt: z.string().datetime({ message: "matureAt must be a valid ISO 8601 date" }).optional(),
});

export type IngestPayload = z.infer<typeof IngestPayloadSchema>;
export type IngestRequest = z.infer<typeof IngestRequestSchema>;

export type IngestJobResponse = {
  id: string;
  step: string;
  queue: string;
};

export type IngestResponse = {
  flowId: string;
  jobs: IngestJobResponse[];
  duplicate: boolean;
};

export const ErrorCode = {
  INVALID_STEP: "INVALID_STEP",
  EMPTY_STEPS: "EMPTY_STEPS",
  INVALID_PAYLOAD: "INVALID_PAYLOAD",
  INVALID_DATE: "INVALID_DATE",
  REDIS_UNAVAILABLE: "REDIS_UNAVAILABLE",
  FLOW_CREATION_FAILED: "FLOW_CREATION_FAILED",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export type ErrorResponse = {
  error: ErrorCode;
  message: string;
  statusCode: number;
};
