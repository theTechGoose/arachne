import { assertEquals, assertExists } from "jsr:@std/assert";
import { WorkerManager } from "./mod.ts";
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

function createFakeWorker() {
  return { close: () => Promise.resolve() };
}

Deno.test("WorkerManager can be instantiated", () => {
  const manager = new WorkerManager({
    redisConnection: { getClient: () => null },
    processor: () => Promise.resolve(),
  });
  assertExists(manager);
});

Deno.test("WorkerManager has required methods", () => {
  const manager = new WorkerManager({
    redisConnection: { getClient: () => null },
    processor: () => Promise.resolve(),
  });
  assertEquals(typeof manager.createWorkers, "function");
  assertEquals(typeof manager.getWorkerCount, "function");
  assertEquals(typeof manager.closeAll, "function");
});

Deno.test("WorkerManager getWorkerCount returns 0 before createWorkers", () => {
  const manager = new WorkerManager({
    redisConnection: { getClient: () => null },
    processor: () => Promise.resolve(),
  });
  assertEquals(manager.getWorkerCount(), 0);
});

Deno.test("WorkerManager createWorkers creates one worker per target", () => {
  const createdWorkers: unknown[] = [];
  const manager = new WorkerManager({
    redisConnection: { getClient: () => ({ duplicate: () => ({}) }) },
    processor: () => Promise.resolve(),
    workerFactory: (_name, _processorFn, _opts) => {
      const worker = createFakeWorker();
      createdWorkers.push(worker);
      return worker;
    },
  });

  const targets = new Map<string, Target>();
  targets.set("fetch-audio", MOCK_TARGET);
  targets.set("send-email", { ...MOCK_TARGET, host: "https://mail.example.com" });

  manager.createWorkers(targets);

  assertEquals(manager.getWorkerCount(), 2);
  assertEquals(createdWorkers.length, 2);
});

Deno.test("WorkerManager closeAll closes all workers", async () => {
  let closeCalls = 0;
  const manager = new WorkerManager({
    redisConnection: { getClient: () => ({ duplicate: () => ({}) }) },
    processor: () => Promise.resolve(),
    workerFactory: (_name, _processorFn, _opts) => ({
      close: () => {
        closeCalls++;
        return Promise.resolve();
      },
    }),
  });

  const targets = new Map<string, Target>();
  targets.set("fetch-audio", MOCK_TARGET);
  targets.set("send-email", { ...MOCK_TARGET, host: "https://mail.example.com" });

  manager.createWorkers(targets);
  assertEquals(manager.getWorkerCount(), 2);

  await manager.closeAll();
  assertEquals(closeCalls, 2);
  assertEquals(manager.getWorkerCount(), 0);
});

Deno.test("WorkerManager createWorkers passes correct concurrency to factory", () => {
  const capturedOpts: unknown[] = [];
  const manager = new WorkerManager({
    redisConnection: { getClient: () => ({ duplicate: () => ({}) }) },
    processor: () => Promise.resolve(),
    workerFactory: (_name, _processorFn, opts) => {
      capturedOpts.push(opts);
      return createFakeWorker();
    },
  });

  const targets = new Map<string, Target>();
  targets.set("fetch-audio", { ...MOCK_TARGET, concurrency: 5 });

  manager.createWorkers(targets);

  assertEquals((capturedOpts[0] as Record<string, unknown>).concurrency, 5);
});

Deno.test("WorkerManager createWorkers wraps processor with target config", async () => {
  let capturedTarget: Target | null = null;
  const manager = new WorkerManager({
    redisConnection: { getClient: () => ({ duplicate: () => ({}) }) },
    processor: (_job, target) => {
      capturedTarget = target;
      return Promise.resolve();
    },
    workerFactory: (_name, processorFn, _opts) => {
      // Call the processor to verify the target is passed
      processorFn({ name: "fetch-audio" } as never);
      return createFakeWorker();
    },
  });

  const targets = new Map<string, Target>();
  targets.set("fetch-audio", MOCK_TARGET);

  manager.createWorkers(targets);

  assertEquals(capturedTarget, MOCK_TARGET);
});
