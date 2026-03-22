import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { RedisCodeBlacklistAdapter } from "./mod.ts";

Deno.test("RedisCodeBlacklistAdapter exposes blacklist", () => {
  assertEquals(typeof RedisCodeBlacklistAdapter.prototype.blacklist, "function");
});

Deno.test("RedisCodeBlacklistAdapter exposes isBlacklisted", () => {
  assertEquals(typeof RedisCodeBlacklistAdapter.prototype.isBlacklisted, "function");
});
