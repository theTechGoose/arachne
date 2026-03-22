import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { ConsumerPersistenceAdapter } from "./mod.ts";

Deno.test("ConsumerPersistenceAdapter exposes saveConsumer", () => { assertEquals(typeof ConsumerPersistenceAdapter.prototype.saveConsumer, "function"); });
Deno.test("ConsumerPersistenceAdapter exposes loadConsumer", () => { assertEquals(typeof ConsumerPersistenceAdapter.prototype.loadConsumer, "function"); });
Deno.test("ConsumerPersistenceAdapter exposes loadAllConsumers", () => { assertEquals(typeof ConsumerPersistenceAdapter.prototype.loadAllConsumers, "function"); });
Deno.test("ConsumerPersistenceAdapter exposes deleteConsumer", () => { assertEquals(typeof ConsumerPersistenceAdapter.prototype.deleteConsumer, "function"); });
Deno.test("ConsumerPersistenceAdapter exposes consumerExists", () => { assertEquals(typeof ConsumerPersistenceAdapter.prototype.consumerExists, "function"); });
