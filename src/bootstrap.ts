import { Module, DanetApplication, TokenInjector } from "@danet/core";
import Redis from "#ioredis";
import { REDIS_INJECTION_TOKEN } from "@design";
import { QueueOrchestrator } from "@domain/business/queue-orchestrator/mod.ts";
import { createRedisCodeBlacklist } from "@domain/data/redis-code-blacklist/mod.ts";
import { ConsumerController } from "@entrypoints/consumer-controller.ts";
import { JobController, ConsumerJobsController } from "@entrypoints/job-controller.ts";
import { ReportingController } from "@entrypoints/reporting-controller.ts";
import { AuthController } from "@entrypoints/auth-controller.ts";
import { BasicAuthGuard } from "@entrypoints/auth-guard.ts";

async function bootstrap() {
  // deno-lint-ignore no-explicit-any
  const RedisConstructor = Redis as any;
  const redis = new RedisConstructor({
    host: Deno.env.get("REDIS_HOST") || "localhost",
    port: parseInt(Deno.env.get("REDIS_PORT") || "6379"),
    maxRetriesPerRequest: null,
    retryStrategy: (times: number) => {
      if (times > 3) return null;
      return Math.min(times * 50, 2000);
    },
  });

  redis.on("connect", () => console.log("Redis connected"));
  redis.on("error", (err: Error) => console.error("Redis error:", err));

  const orchestrator = new QueueOrchestrator(redis);
  const blacklist = createRedisCodeBlacklist(redis);

  await orchestrator.onAppBootstrap();

  // deno-lint-ignore no-explicit-any
  const TI = TokenInjector as any;

  @Module({
    controllers: [
      ConsumerController,
      JobController,
      ConsumerJobsController,
      ReportingController,
      AuthController,
    ],
    injectables: [
      BasicAuthGuard,
      new TI(redis, REDIS_INJECTION_TOKEN),
      new TI(orchestrator, "ConsumerService"),
      new TI(orchestrator, "JobService"),
      new TI(blacklist, "RedisCodeBlacklist"),
    ],
  })
  class AppModule {}

  const app = new DanetApplication();
  await app.init(AppModule);

  const port = parseInt(Deno.env.get("BACKEND_PORT") || "3000");
  await app.listen(port);

  console.log(`Arachne backend running on port ${port}`);
}

bootstrap();
