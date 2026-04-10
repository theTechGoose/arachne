import { TargetSchema, type Target } from "@dto/target.ts";

type RedisClient = {
  set(key: string, value: string): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
  sadd(key: string, ...members: string[]): Promise<unknown>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  sismember(key: string, member: string): Promise<number>;
};

type TargetStoreClient = {
  getClient(): RedisClient | null;
};

export class TargetStore {
  #conn: TargetStoreClient;
  static readonly SET_KEY = "targetnames";

  constructor(conn: TargetStoreClient) {
    this.#conn = conn;
  }

  #client(): RedisClient {
    const c = this.#conn.getClient();
    if (!c) throw new Error("Redis client not available");
    return c as RedisClient;
  }

  async create(name: string, target: Target): Promise<void> {
    const client = this.#client();
    await client.set(`target:${name}`, JSON.stringify(target));
    await client.sadd(TargetStore.SET_KEY, name);
  }

  async get(name: string): Promise<Target | null> {
    const raw = await this.#client().get(`target:${name}`);
    if (!raw) return null;
    return TargetSchema.parse(JSON.parse(raw));
  }

  async update(name: string, target: Target): Promise<boolean> {
    const exists = await this.#client().sismember(TargetStore.SET_KEY, name);
    if (!exists) return false;
    await this.#client().set(`target:${name}`, JSON.stringify(target));
    return true;
  }

  async delete(name: string): Promise<boolean> {
    const removed = await this.#client().srem(TargetStore.SET_KEY, name);
    if (removed === 0) return false;
    await this.#client().del(`target:${name}`);
    return true;
  }

  async load(): Promise<Map<string, Target>> {
    const names = await this.#client().smembers(TargetStore.SET_KEY);
    const entries = await Promise.all(
      names.map(async (name) => {
        const target = await this.get(name);
        return target ? ([name, target] as const) : null;
      }),
    );
    return new Map(entries.filter((e): e is [string, Target] => e !== null));
  }

  async count(): Promise<number> {
    const names = await this.#client().smembers(TargetStore.SET_KEY);
    return names.length;
  }
}
