import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createConsumer } from "./mod.ts";

// deno-lint-ignore no-explicit-any
const mockConsumer: any = { name: "test", targetUrls: ["http://localhost"], concurrency: 1, health: "healthy", paused: false, defaultJobDetails: {}, schedule: null, pipeline: null, pipelineStepFailures: null, tags: [], stats: { completed: 0, failed: 0, waiting: 0, active: 0, stalled: 0, delayed: 0, removed: 0 } };

Deno.test("createConsumer throws on empty name", async () => {
  const svc = { get: async () => null, add: async () => {} } as any;
  await assertRejects(() => createConsumer(svc, { ...mockConsumer, name: "" }), Error, "name is required");
});

Deno.test("createConsumer throws 409 on duplicate", async () => {
  const svc = { get: async () => mockConsumer, add: async () => {} } as any;
  try { await createConsumer(svc, mockConsumer); } catch (e: any) { assertEquals(e.statusCode, 409); }
});

Deno.test("createConsumer calls add on service", async () => {
  let added = false;
  const svc = { get: async () => null, add: async () => { added = true; } } as any;
  await createConsumer(svc, mockConsumer);
  assertEquals(added, true);
});
