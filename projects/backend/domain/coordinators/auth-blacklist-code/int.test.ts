import { assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { blacklistAuthCode, InvalidCodeError } from "./mod.ts";

Deno.test("blacklistAuthCode throws InvalidCodeError for invalid code", async () => {
  const mockBlacklist = { blacklist: async () => {} } as any;
  await assertRejects(() => blacklistAuthCode(mockBlacklist, "test@test.com", "BADCODE123"), InvalidCodeError);
});
