import type { Target } from "@dto/target.ts";
import type { IngestPayload } from "@dto/ingest.ts";

export type MergedData = {
  route: string[];
  method: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body?: unknown;
};

export class MergeRules {
  mergePayload(target: Target, payload?: IngestPayload): MergedData {
    return {
      route: [...target.route, ...(payload?.route ?? [])],
      method: payload?.method ?? target.method,
      headers: { ...target.headers, ...(payload?.headers ?? {}) },
      query: { ...target.query, ...(payload?.query ?? {}) },
      body: payload?.body,
    };
  }

  mergeStepData(
    previousResponse: unknown,
    currentMethod: string,
  ): { body?: unknown; query?: Record<string, string> } | Error {
    const bodyMethods = ["POST", "PUT", "PATCH"];

    if (bodyMethods.includes(currentMethod)) {
      return { body: previousResponse };
    }

    // GET/DELETE: spread into query, values coerced via String()
    if (
      previousResponse === null ||
      previousResponse === undefined ||
      typeof previousResponse !== "object" ||
      Array.isArray(previousResponse)
    ) {
      return new Error(
        "Cannot spread non-flat response into query parameters",
      );
    }

    const obj = previousResponse as Record<string, unknown>;
    const query: Record<string, string> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (
        value !== null &&
        value !== undefined &&
        typeof value === "object"
      ) {
        return new Error(
          "Cannot spread non-flat response into query parameters",
        );
      }
      query[key] = String(value);
    }

    return { query };
  }
}
