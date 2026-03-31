import type { User, UserStatus, Permission } from "@dto/user.ts";

type RedisClient = {
  hset(key: string, ...args: string[]): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string> | null>;
  del(key: string): Promise<unknown>;
  sadd(key: string, ...members: string[]): Promise<unknown>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  sismember(key: string, member: string): Promise<number>;
};

type UserStoreClient = {
  getClient(): RedisClient | null;
};

export class UserStore {
  #conn: UserStoreClient;
  static readonly SET_KEY = "usernames";

  constructor(conn: UserStoreClient) {
    this.#conn = conn;
  }

  #client(): RedisClient {
    const c = this.#conn.getClient();
    if (!c) throw new Error("Redis client not available");
    return c as RedisClient;
  }

  async create(user: User): Promise<void> {
    const client = this.#client();
    await client.hset(
      `user:${user.username}`,
      "passwordHash",
      user.passwordHash,
      "permissions",
      JSON.stringify(user.permissions),
      "status",
      user.status,
    );
    await client.sadd(UserStore.SET_KEY, user.username);
  }

  async get(username: string): Promise<User | null> {
    const raw = await this.#client().hgetall(`user:${username}`);
    if (!raw || !raw.passwordHash) return null;
    return {
      username,
      passwordHash: raw.passwordHash,
      permissions: JSON.parse(raw.permissions ?? "[]") as Permission[],
      status: (raw.status ?? "inactive") as UserStatus,
    };
  }

  async update(
    username: string,
    fields: Partial<Pick<User, "passwordHash" | "permissions" | "status">>,
  ): Promise<boolean> {
    const exists = await this.#client().sismember(UserStore.SET_KEY, username);
    if (!exists) return false;
    const args: string[] = [];
    if (fields.passwordHash !== undefined) {
      args.push("passwordHash", fields.passwordHash);
    }
    if (fields.permissions !== undefined) {
      args.push("permissions", JSON.stringify(fields.permissions));
    }
    if (fields.status !== undefined) {
      args.push("status", fields.status);
    }
    if (args.length > 0) {
      await this.#client().hset(`user:${username}`, ...args);
    }
    return true;
  }

  async delete(username: string): Promise<boolean> {
    const removed = await this.#client().srem(UserStore.SET_KEY, username);
    if (removed === 0) return false;
    await this.#client().del(`user:${username}`);
    return true;
  }

  async list(): Promise<User[]> {
    const usernames = await this.#client().smembers(UserStore.SET_KEY);
    const users = await Promise.all(usernames.map((u) => this.get(u)));
    return users.filter((u): u is User => u !== null);
  }

  async count(): Promise<number> {
    const usernames = await this.#client().smembers(UserStore.SET_KEY);
    return usernames.length;
  }
}
