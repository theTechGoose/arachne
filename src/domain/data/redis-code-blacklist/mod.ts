import type { Redis } from "#ioredis";

export interface RedisCodeBlacklist {
  blacklist(email: string, code: string): Promise<void>;
  isBlacklisted(email: string, code: string): Promise<boolean>;
}

export function createRedisCodeBlacklist(redis: Redis): RedisCodeBlacklist {
  return {
    async blacklist(email: string, code: string): Promise<void> {
      const key = `blacklist/${email}:${code}`;
      await redis.set(key, "1");
    },

    async isBlacklisted(email: string, code: string): Promise<boolean> {
      const key = `blacklist/${email}:${code}`;
      const result = await redis.get(key);
      return result !== null;
    },
  };
}
