import type { Target } from "@dto/target.ts";

export class StartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StartupError";
  }
}

type StartupDeps = {
  targetLoader: { load(): Promise<Map<string, Target>> };
  redisConnection: {
    connect(): Promise<void>;
    ping(): Promise<boolean>;
    getVersion(): Promise<string>;
    getMaxMemory(): Promise<string | null>;
  };
  onReady: (targets: Map<string, Target>) => void;
};

export class StartupCoordinator {
  #targetLoader: StartupDeps["targetLoader"];
  #redisConnection: StartupDeps["redisConnection"];
  #onReady: StartupDeps["onReady"];

  constructor(deps: StartupDeps) {
    this.#targetLoader = deps.targetLoader;
    this.#redisConnection = deps.redisConnection;
    this.#onReady = deps.onReady;
  }

  async start(): Promise<Map<string, Target>> {
    // Step 1: Load and validate target files
    let targets: Map<string, Target>;
    try {
      targets = await this.#targetLoader.load();
    } catch (err) {
      throw new StartupError(
        `Failed to load targets: ${(err as Error).message}`,
      );
    }

    // Step 2: Connect to Redis
    try {
      await this.#redisConnection.connect();
    } catch (err) {
      throw new StartupError(
        `Failed to connect to Redis: ${(err as Error).message}`,
      );
    }

    // Step 3: Ping Redis
    const pong = await this.#redisConnection.ping();
    if (!pong) {
      throw new StartupError("Redis ping failed — server unreachable");
    }

    // Step 4: Check Redis version
    const version = await this.#redisConnection.getVersion();
    const major = parseInt(version.split(".")[0], 10);
    if (major < 5) {
      throw new StartupError(
        `BullMQ requires Redis >= 5.0, found ${version}`,
      );
    }

    // Step 5: Check maxmemory
    const maxmemory = await this.#redisConnection.getMaxMemory();
    if (maxmemory === null) {
      console.warn(
        "Redis maxmemory is not configured — risk of OOM under load",
      );
    }

    // Step 6: Notify ready
    this.#onReady(targets);

    return targets;
  }
}
