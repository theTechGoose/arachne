import { assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sendAuthCode, UnauthorizedEmailError } from "./mod.ts";

Deno.test("sendAuthCode throws UnauthorizedEmailError for disallowed email", async () => {
  await assertRejects(() => sendAuthCode("hacker@evil.com"), UnauthorizedEmailError);
});
