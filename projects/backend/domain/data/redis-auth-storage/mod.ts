import type { Redis } from "#ioredis";

export class RedisAuthStorage {
  constructor(private readonly redis: Redis) {}

  async saveAuthCode(email: string, code: string, ttlSeconds: number = 900): Promise<void> {
    const key = `auth/${email}`;
    await this.redis.set(key, code, "EX", ttlSeconds);
  }

  async getAuthCode(email: string): Promise<string | null> {
    const key = `auth/${email}`;
    return await this.redis.get(key);
  }

  async deleteAuthCode(email: string): Promise<void> {
    const key = `auth/${email}`;
    await this.redis.del(key);
  }

  async hasAuthCode(email: string): Promise<boolean> {
    const key = `auth/${email}`;
    const exists = await this.redis.exists(key);
    return exists === 1;
  }
}
