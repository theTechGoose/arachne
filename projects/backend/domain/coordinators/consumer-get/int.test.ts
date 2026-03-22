import { assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getConsumer } from "./mod.ts";

Deno.test("getConsumer throws on empty name", async () => {
  const svc = { get: async () => null } as any;
  await assertRejects(() => getConsumer(svc, ""), Error, "name is required");
});
