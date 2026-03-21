import { verify } from "@domain/business/auth-hmac/mod.ts";
import type { RedisCodeBlacklist } from "@domain/data/redis-code-blacklist/mod.ts";

export class InvalidCodeError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "InvalidCodeError";
  }
}

export async function blacklistAuthCode(
  blacklist: RedisCodeBlacklist,
  email: string,
  code: string,
): Promise<void> {
  const isValid = verify(email, code);
  if (!isValid) {
    throw new InvalidCodeError("Cannot blacklist invalid code");
  }
  await blacklist.blacklist(email, code);
}
