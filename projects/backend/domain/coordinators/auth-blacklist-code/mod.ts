import { AuthHmac } from "@domain/business/auth-hmac/mod.ts";

const authHmac = new AuthHmac();
import type { RedisCodeBlacklistAdapter } from "@domain/data/redis-code-blacklist/mod.ts";

export class InvalidCodeError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "InvalidCodeError";
  }
}

export async function blacklistAuthCode(
  blacklist: RedisCodeBlacklistAdapter,
  email: string,
  code: string,
): Promise<void> {
  const isValid = authHmac.verify(email, code);
  if (!isValid) {
    throw new InvalidCodeError("Cannot blacklist invalid code");
  }
  await blacklist.blacklist(email, code);
}
