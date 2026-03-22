import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getConsumerFailedJobs } from "./mod.ts";

Deno.test("getConsumerFailedJobs throws on empty name", async () => {
  const svc = { get: async () => null, getFailedJobs: async () => [] } as any;
  await assertRejects(() => getConsumerFailedJobs(svc, ""), Error, "name is required");
});

Deno.test("getConsumerFailedJobs throws 404 when not found", async () => {
  const svc = { get: async () => null, getFailedJobs: async () => [] } as any;
  try { await getConsumerFailedJobs(svc, "missing"); } catch (e: any) { assertEquals(e.statusCode, 404); }
});
