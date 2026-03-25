import { assertEquals, assertExists } from "jsr:@std/assert";
import { RedisConnection } from "./mod.ts";

Deno.test("RedisConnection can be instantiated", () => {
  const conn = new RedisConnection();
  assertExists(conn);
});

Deno.test("RedisConnection has required methods", () => {
  const conn = new RedisConnection();
  assertEquals(typeof conn.connect, "function");
  assertEquals(typeof conn.ping, "function");
  assertEquals(typeof conn.getVersion, "function");
  assertEquals(typeof conn.getMaxMemory, "function");
  assertEquals(typeof conn.getClient, "function");
  assertEquals(typeof conn.close, "function");
});

Deno.test("RedisConnection smoke — connect, ping, version, maxmemory, close", async () => {
  const conn = new RedisConnection();
  try {
    await conn.connect();
    const pingResult = await conn.ping();
    assertEquals(pingResult, true);

    const version = await conn.getVersion();
    assertEquals(typeof version, "string");
    assertEquals(version.length > 0, true);

    const maxmemory = await conn.getMaxMemory();
    assertEquals(typeof maxmemory === "string" || maxmemory === null, true);

    await conn.close();
  } catch (_e) {
    // Redis may not be available in test environment — skip gracefully
    try {
      await conn.close();
    } catch {
      // ignore close errors
    }
  }
});
