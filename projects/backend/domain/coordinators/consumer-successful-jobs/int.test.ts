import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getConsumerSuccessfulJobs } from "./mod.ts";

Deno.test("getConsumerSuccessfulJobs throws on empty name", async () => {
  const svc = { get: async () => null, getSuccessfulJobs: async () => [] } as any;
  await assertRejects(() => getConsumerSuccessfulJobs(svc, ""), Error, "name is required");
});

Deno.test("getConsumerSuccessfulJobs throws 404 when not found", async () => {
  const svc = { get: async () => null, getSuccessfulJobs: async () => [] } as any;
  try { await getConsumerSuccessfulJobs(svc, "missing"); } catch (e: any) { assertEquals(e.statusCode, 404); }
});
