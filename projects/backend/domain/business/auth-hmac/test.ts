import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { AuthHmac } from "./mod.ts";

const hmac = new AuthHmac();

Deno.test("mint returns a 10-character string", () => {
  const code = hmac.mint("test@example.com");
  assertEquals(code.length, 10);
});

Deno.test("verify accepts a freshly minted code", () => {
  const code = hmac.mint("test@example.com");
  assertEquals(hmac.verify("test@example.com", code), true);
});

Deno.test("verify rejects wrong email", () => {
  const code = hmac.mint("test@example.com");
  assertEquals(hmac.verify("other@example.com", code), false);
});

Deno.test("verify rejects wrong code", () => {
  assertEquals(hmac.verify("test@example.com", "XXXXXXXXXX"), false);
});

Deno.test("verify rejects wrong length", () => {
  assertEquals(hmac.verify("test@example.com", "short"), false);
});

Deno.test("verify rejects non-string input", () => {
  // deno-lint-ignore no-explicit-any
  assertEquals(hmac.verify("test@example.com", 12345 as any), false);
});
