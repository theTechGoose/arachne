import { IngestRequestSchema, ErrorCode } from "@dto/ingest.ts";
import type { IngestRequest, IngestResponse, ErrorResponse } from "@dto/ingest.ts";
import { IngestError } from "@domain/coordinators/ingest/mod.ts";

type IngestControllerDeps = {
  ingest: (request: IngestRequest) => Promise<IngestResponse>;
};

export class IngestController {
  #ingest: IngestControllerDeps["ingest"];

  constructor(deps: IngestControllerDeps) {
    this.#ingest = deps.ingest;
  }

  async handle(req: Request): Promise<Response> {
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return this.#errorResponse(ErrorCode.EMPTY_STEPS, "Invalid JSON in request body", 400);
    }

    const parsed = IngestRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      const issues = parsed.error.issues;
      const isStepsIssue = issues.some(
        (i) => i.path[0] === "steps" || i.path.length === 0,
      );
      const isPayloadIssue = issues.some((i) => i.path[0] === "payload");

      if (isPayloadIssue) {
        return this.#errorResponse(
          ErrorCode.INVALID_PAYLOAD,
          `Invalid payload: ${parsed.error.message}`,
          422,
        );
      }

      if (isStepsIssue || issues.some((i) => i.message?.includes("steps"))) {
        return this.#errorResponse(
          ErrorCode.EMPTY_STEPS,
          `Invalid steps: ${parsed.error.message}`,
          400,
        );
      }

      return this.#errorResponse(
        ErrorCode.INVALID_PAYLOAD,
        `Validation failed: ${parsed.error.message}`,
        422,
      );
    }

    try {
      const result = await this.#ingest(parsed.data);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      if (err instanceof IngestError) {
        return this.#errorResponse(err.code, err.message, err.statusCode);
      }
      return this.#errorResponse(
        ErrorCode.FLOW_CREATION_FAILED,
        `Unexpected error: ${(err as Error).message}`,
        500,
      );
    }
  }

  #errorResponse(error: ErrorCode, message: string, statusCode: number): Response {
    const body: ErrorResponse = { error, message, statusCode };
    return new Response(JSON.stringify(body), {
      status: statusCode,
      headers: { "Content-Type": "application/json" },
    });
  }
}
