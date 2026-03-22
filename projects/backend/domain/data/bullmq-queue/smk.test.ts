import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { BullMqQueueAdapter } from "./mod.ts";

Deno.test("BullMqQueueAdapter exposes create", () => { assertEquals(typeof BullMqQueueAdapter.prototype.create, "function"); });
Deno.test("BullMqQueueAdapter exposes getAll", () => { assertEquals(typeof BullMqQueueAdapter.prototype.getAll, "function"); });
Deno.test("BullMqQueueAdapter exposes get", () => { assertEquals(typeof BullMqQueueAdapter.prototype.get, "function"); });
