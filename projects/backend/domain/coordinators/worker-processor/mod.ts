import { UnrecoverableError } from "#bullmq";
import type { MergeRules } from "@domain/business/merge-rules/mod.ts";
import type { ResponseClassifier } from "@domain/business/response-classifier/mod.ts";
import type { Target } from "@dto/target.ts";

type Job = {
  name: string;
  data: Record<string, unknown>;
  getChildrenValues?: () => Promise<Record<string, unknown>>;
};

type WorkerProcessorDeps = {
  mergeRules: MergeRules;
  responseClassifier: ResponseClassifier;
  targets: Map<string, Target>;
  fetchFn?: typeof globalThis.fetch;
};

export class WorkerProcessor {
  #mergeRules: MergeRules;
  #responseClassifier: ResponseClassifier;
  #targets: Map<string, Target>;
  #fetch: typeof globalThis.fetch;

  constructor(deps: WorkerProcessorDeps) {
    this.#mergeRules = deps.mergeRules;
    this.#responseClassifier = deps.responseClassifier;
    this.#targets = deps.targets;
    this.#fetch = deps.fetchFn ?? globalThis.fetch;
  }

  async process(job: Job): Promise<unknown> {
    const target = this.#targets.get(job.name);
    if (!target) {
      throw new UnrecoverableError(`Unknown target: ${job.name}`);
    }

    let method: string;
    let headers: Record<string, string>;
    let query: Record<string, string>;
    let body: unknown;
    let route: string[];

    if (Object.keys(job.data).length === 0) {
      // Step 1+: get previous step's response from children values
      const childrenValues = await job.getChildrenValues();
      const previousResponse = Object.values(childrenValues)[0];

      const mergeResult = this.#mergeRules.mergeStepData(previousResponse, target.method);
      if (mergeResult instanceof Error) {
        throw new UnrecoverableError(mergeResult.message);
      }

      method = target.method;
      headers = { ...target.headers };
      query = { ...target.query, ...(mergeResult.query ?? {}) };
      body = mergeResult.body;
      route = target.route;
    } else {
      // Step 0: use job.data directly (already merged at flow creation time)
      const merged = job.data as { route: string[]; method: string; headers: Record<string, string>; query: Record<string, string>; body?: unknown };
      method = merged.method;
      headers = merged.headers;
      query = merged.query;
      body = merged.body;
      route = merged.route;
    }

    const queryString = new URLSearchParams(query).toString();
    const url = target.host + "/" + route.join("/") + (queryString ? "?" + queryString : "");

    const bodyMethods = ["POST", "PUT", "PATCH"];
    const fetchBody = bodyMethods.includes(method) ? JSON.stringify(body) : undefined;
    const fetchHeaders = fetchBody !== undefined
      ? { "content-type": "application/json", ...headers }
      : headers;

    const response = await this.#fetch(url, {
      method,
      headers: fetchHeaders,
      body: fetchBody,
      signal: AbortSignal.timeout(target.timeoutMs),
    });

    const classification = this.#responseClassifier.classify(response.status, response.headers);

    if (classification.action === "pass") {
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    if (classification.action === "retry") {
      throw new Error(`Retryable error: HTTP ${response.status}`);
    }

    // classification.action === "fail"
    const text = await response.text();
    const truncated = text.slice(0, 500);
    console.error(`[${job.name}] Permanent failure: HTTP ${classification.status} — ${truncated}`);
    throw new UnrecoverableError(`Permanent failure: HTTP ${classification.status}`);
  }
}
