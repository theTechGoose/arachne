import { assertEquals, assertExists } from "jsr:@std/assert";
import { FlowProducerAdapter } from "./mod.ts";

Deno.test("FlowProducerAdapter can be instantiated", () => {
  const adapter = new FlowProducerAdapter({
    redisConnection: { getClient: () => null },
  });
  assertExists(adapter);
});

Deno.test("FlowProducerAdapter has required methods", () => {
  const adapter = new FlowProducerAdapter({
    redisConnection: { getClient: () => null },
  });
  assertEquals(typeof adapter.add, "function");
  assertEquals(typeof adapter.close, "function");
});
