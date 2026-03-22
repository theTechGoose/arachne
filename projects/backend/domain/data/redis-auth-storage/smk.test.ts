import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { RedisAuthStorage } from "./mod.ts";

Deno.test("RedisAuthStorage exposes saveAuthCode", () => { assertEquals(typeof RedisAuthStorage.prototype.saveAuthCode, "function"); });
Deno.test("RedisAuthStorage exposes getAuthCode", () => { assertEquals(typeof RedisAuthStorage.prototype.getAuthCode, "function"); });
Deno.test("RedisAuthStorage exposes deleteAuthCode", () => { assertEquals(typeof RedisAuthStorage.prototype.deleteAuthCode, "function"); });
Deno.test("RedisAuthStorage exposes hasAuthCode", () => { assertEquals(typeof RedisAuthStorage.prototype.hasAuthCode, "function"); });
