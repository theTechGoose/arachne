import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { BullMqJobAdapter } from "./mod.ts";

Deno.test("BullMqJobAdapter exposes getAll", () => { assertEquals(typeof BullMqJobAdapter.prototype.getAll, "function"); });
Deno.test("BullMqJobAdapter exposes init", () => { assertEquals(typeof BullMqJobAdapter.prototype.init, "function"); });
