import { assertEquals, assertRejects } from "jsr:@std/assert";
import { WorkerProcessor } from "./mod.ts";
import { MergeRules } from "@domain/business/merge-rules/mod.ts";
import { ResponseClassifier } from "@domain/business/response-classifier/mod.ts";
import type { Target } from "@dto/target.ts";

const MOCK_TARGET: Target = {
  host: "https://api.example.com",
  route: ["v1", "data"],
  method: "POST",
  headers: { "Content-Type": "application/json" },
  query: {},
  concurrency: 2,
  timeoutMs: 30000,
  retries: 3,
};

function createTargets(overrides?: Partial<Target>): Map<string, Target> {
  const targets = new Map<string, Target>();
  targets.set("test-target", { ...MOCK_TARGET, ...overrides });
  return targets;
}

Deno.test("WorkerProcessor — 2xx response returns parsed JSON body", async () => {
  const responseBody = { id: 1, name: "test" };

  const processor = new WorkerProcessor({
    mergeRules: new MergeRules(),
    responseClassifier: new ResponseClassifier(),
    targets: createTargets(),
    fetchFn: () =>
      Promise.resolve(
        new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
  });

  const result = await processor.process({
    name: "test-target",
    data: { route: ["v1", "data"], method: "POST", headers: { "Content-Type": "application/json" }, query: {}, body: { key: "value" } },
  });

  assertEquals(result, responseBody);
});

Deno.test("WorkerProcessor — 2xx non-JSON response returns string", async () => {
  const processor = new WorkerProcessor({
    mergeRules: new MergeRules(),
    responseClassifier: new ResponseClassifier(),
    targets: createTargets(),
    fetchFn: () =>
      Promise.resolve(
        new Response("plain text response", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
  });

  const result = await processor.process({
    name: "test-target",
    data: { route: ["v1", "data"], method: "POST", headers: {}, query: {} },
  });

  assertEquals(result, "plain text response");
});

Deno.test("WorkerProcessor — non-2xx with retryable header throws Error (not UnrecoverableError)", async () => {
  const { UnrecoverableError } = await import("#bullmq");

  const processor = new WorkerProcessor({
    mergeRules: new MergeRules(),
    responseClassifier: new ResponseClassifier(),
    targets: createTargets(),
    fetchFn: () =>
      Promise.resolve(
        new Response("service unavailable", {
          status: 503,
          headers: { "x-arachne-retryable": "true" },
        }),
      ),
  });

  const err = await assertRejects(
    () =>
      processor.process({
        name: "test-target",
        data: { route: ["v1", "data"], method: "POST", headers: {}, query: {} },
      }),
    Error,
  );

  assertEquals(err instanceof UnrecoverableError, false);
});

Deno.test("WorkerProcessor — non-2xx without retryable header throws UnrecoverableError and logs", async () => {
  const { UnrecoverableError } = await import("#bullmq");
  const errorLogs: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { errorLogs.push(args.join(" ")); };

  try {
    const processor = new WorkerProcessor({
      mergeRules: new MergeRules(),
      responseClassifier: new ResponseClassifier(),
      targets: createTargets(),
      fetchFn: () =>
        Promise.resolve(
          new Response("bad request body", {
            status: 400,
          }),
        ),
    });

    await assertRejects(
      () =>
        processor.process({
          name: "test-target",
          data: { route: ["v1", "data"], method: "POST", headers: {}, query: {} },
        }),
      UnrecoverableError,
    );

    assertEquals(errorLogs.length, 1);
    assertEquals(errorLogs[0].includes("test-target"), true);
    assertEquals(errorLogs[0].includes("400"), true);
    assertEquals(errorLogs[0].includes("bad request body"), true);
  } finally {
    console.error = originalError;
  }
});

Deno.test("WorkerProcessor — network error throws Error (not UnrecoverableError)", async () => {
  const { UnrecoverableError } = await import("#bullmq");

  const processor = new WorkerProcessor({
    mergeRules: new MergeRules(),
    responseClassifier: new ResponseClassifier(),
    targets: createTargets(),
    fetchFn: () => Promise.reject(new TypeError("Failed to fetch")),
  });

  const err = await assertRejects(
    () =>
      processor.process({
        name: "test-target",
        data: { route: ["v1", "data"], method: "POST", headers: {}, query: {} },
      }),
    TypeError,
  );

  assertEquals(err instanceof UnrecoverableError, false);
});

Deno.test("WorkerProcessor — step 1+ with getChildrenValues merges previous response as body for POST", async () => {
  const previousResponse = { userId: 42, action: "completed" };
  let capturedBody: string | undefined;

  const processor = new WorkerProcessor({
    mergeRules: new MergeRules(),
    responseClassifier: new ResponseClassifier(),
    targets: createTargets({ method: "POST" }),
    fetchFn: (_url, init) => {
      capturedBody = init?.body as string | undefined;
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    },
  });

  await processor.process({
    name: "test-target",
    data: {},
    getChildrenValues: () => Promise.resolve({ "bull:child-queue:child-id": previousResponse }),
  });

  assertEquals(JSON.parse(capturedBody!), previousResponse);
});

Deno.test("WorkerProcessor — step 1+ with getChildrenValues merges previous response as query for GET", async () => {
  const previousResponse = { userId: "42", status: "active" };
  let capturedUrl = "";

  const processor = new WorkerProcessor({
    mergeRules: new MergeRules(),
    responseClassifier: new ResponseClassifier(),
    targets: createTargets({ method: "GET" }),
    fetchFn: (url, _init) => {
      capturedUrl = url as string;
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    },
  });

  await processor.process({
    name: "test-target",
    data: {},
    getChildrenValues: () => Promise.resolve({ "bull:child-queue:child-id": previousResponse }),
  });

  assertEquals(capturedUrl.includes("userId=42"), true);
  assertEquals(capturedUrl.includes("status=active"), true);
});

Deno.test("WorkerProcessor — step 1+ where mergeStepData returns Error throws UnrecoverableError", async () => {
  const { UnrecoverableError } = await import("#bullmq");

  const processor = new WorkerProcessor({
    mergeRules: new MergeRules(),
    responseClassifier: new ResponseClassifier(),
    targets: createTargets({ method: "GET" }),
    fetchFn: () => Promise.resolve(new Response("", { status: 200 })),
  });

  // A non-flat value (string) cannot be spread into query params for GET
  await assertRejects(
    () =>
      processor.process({
        name: "test-target",
        data: {},
        getChildrenValues: () => Promise.resolve({ "bull:child-queue:child-id": "just a string" }),
      }),
    UnrecoverableError,
  );
});
