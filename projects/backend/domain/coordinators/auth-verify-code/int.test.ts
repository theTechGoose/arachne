import { assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifyAuthCode, InvalidAuthCodeError } from "./mod.ts";

Deno.test("verifyAuthCode throws InvalidAuthCodeError for wrong code", async () => {
  const mockBlacklist = { isBlacklisted: async () => false } as any;
  await assertRejects(() => verifyAuthCode(mockBlacklist, "test@test.com", "WRONGCODE1"), InvalidAuthCodeError);
});
