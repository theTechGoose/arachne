import Redis from "#ioredis";

export class RedisConnection {
  #client: Redis | null = null;
  #host: string;
  #port: number;

  constructor() {
    this.#host = Deno.env.get("REDIS_HOST") ?? "localhost";
    this.#port = Number(Deno.env.get("REDIS_PORT") ?? "6379");
  }

  async connect(): Promise<void> {
    this.#client = new Redis({
      host: this.#host,
      port: this.#port,
      lazyConnect: true,
      maxRetriesPerRequest: null,
    });
    await this.#client.connect();
  }

  async ping(): Promise<boolean> {
    if (!this.#client) return false;
    const result = await this.#client.ping();
    return result === "PONG";
  }

  async getVersion(): Promise<string> {
    if (!this.#client) throw new Error("Not connected");
    const info = await this.#client.info("server");
    const match = info.match(/redis_version:(\S+)/);
    if (!match) throw new Error("Could not parse redis_version");
    return match[1];
  }

  async getMaxMemory(): Promise<string | null> {
    if (!this.#client) throw new Error("Not connected");
    const result = await this.#client.config("GET", "maxmemory");
    if (Array.isArray(result) && result.length >= 2) {
      const value = result[1];
      return value === "0" ? null : value;
    }
    return null;
  }

  getClient(): Redis | null {
    return this.#client;
  }

  async close(): Promise<void> {
    if (this.#client) {
      await this.#client.quit();
      this.#client = null;
    }
  }
}
