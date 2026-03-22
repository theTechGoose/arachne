import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getConsumerWaitingJobs } from "./mod.ts";

Deno.test("getConsumerWaitingJobs throws on empty name", async () => {
  const svc = { get: async () => null, getWaitingJobs: async () => [] } as any;
  await assertRejects(() => getConsumerWaitingJobs(svc, ""), Error, "name is required");
});

Deno.test("getConsumerWaitingJobs throws 404 when not found", async () => {
  const svc = { get: async () => null, getWaitingJobs: async () => [] } as any;
  try { await getConsumerWaitingJobs(svc, "missing"); } catch (e: any) { assertEquals(e.statusCode, 404); }
});
