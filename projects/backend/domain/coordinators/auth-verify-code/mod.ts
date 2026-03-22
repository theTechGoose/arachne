import { AuthHmac } from "@domain/business/auth-hmac/mod.ts";

const authHmac = new AuthHmac();
import type { RedisCodeBlacklistAdapter } from "@domain/data/redis-code-blacklist/mod.ts";

export class InvalidAuthCodeError extends Error {
  statusCode = 401;
  constructor(message: string) {
    super(message);
    this.name = "InvalidAuthCodeError";
  }
}

export async function verifyAuthCode(
  blacklist: RedisCodeBlacklistAdapter,
  email: string,
  code: string,
): Promise<void> {
  const isBlacklisted = await blacklist.isBlacklisted(email, code);
  if (isBlacklisted) {
    throw new InvalidAuthCodeError("Authentication code has been revoked");
  }

  const isValid = authHmac.verify(email, code);
  if (!isValid) {
    throw new InvalidAuthCodeError("Invalid authentication code");
  }
}
