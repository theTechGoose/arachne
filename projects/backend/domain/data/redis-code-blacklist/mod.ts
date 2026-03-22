import type { Redis } from "#ioredis";

export class RedisCodeBlacklistAdapter {
  constructor(private readonly redis: Redis) {}

  async blacklist(email: string, code: string): Promise<void> {
    const key = `blacklist/${email}:${code}`;
    await this.redis.set(key, "1");
  }

  async isBlacklisted(email: string, code: string): Promise<boolean> {
    const key = `blacklist/${email}:${code}`;
    const result = await this.redis.get(key);
    return result !== null;
  }
}
