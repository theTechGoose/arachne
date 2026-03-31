import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { Auth } from "./mod.ts";

const auth = new Auth();

Deno.test("hashPassword returns hex string", async () => {
  const hash = await auth.hashPassword("hunter2");
  assertEquals(typeof hash, "string");
  assertEquals(hash.length, 64);
  assertEquals(/^[0-9a-f]+$/.test(hash), true);
});

Deno.test("hashPassword is deterministic", async () => {
  const a = await auth.hashPassword("same");
  const b = await auth.hashPassword("same");
  assertEquals(a, b);
});

Deno.test("hashPassword differs for different inputs", async () => {
  const a = await auth.hashPassword("foo");
  const b = await auth.hashPassword("bar");
  assertNotEquals(a, b);
});

Deno.test("verifyPassword returns true for matching password", async () => {
  const hash = await auth.hashPassword("correct");
  assertEquals(await auth.verifyPassword("correct", hash), true);
});

Deno.test("verifyPassword returns false for wrong password", async () => {
  const hash = await auth.hashPassword("correct");
  assertEquals(await auth.verifyPassword("wrong", hash), false);
});

Deno.test("parseBasicAuth decodes valid header", () => {
  const encoded = btoa("alice:secret");
  const result = auth.parseBasicAuth(`Basic ${encoded}`);
  assertEquals(result, { username: "alice", password: "secret" });
});

Deno.test("parseBasicAuth allows colon in password", () => {
  const encoded = btoa("alice:pass:with:colons");
  const result = auth.parseBasicAuth(`Basic ${encoded}`);
  assertEquals(result, { username: "alice", password: "pass:with:colons" });
});

Deno.test("parseBasicAuth returns null for non-Basic scheme", () => {
  assertEquals(auth.parseBasicAuth("Bearer token123"), null);
});

Deno.test("parseBasicAuth returns null for malformed base64", () => {
  assertEquals(auth.parseBasicAuth("Basic !!!not-base64!!!"), null);
});

Deno.test("parseBasicAuth returns null for missing colon", () => {
  const encoded = btoa("nocolon");
  assertEquals(auth.parseBasicAuth(`Basic ${encoded}`), null);
});
