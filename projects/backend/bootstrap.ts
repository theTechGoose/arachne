import { RedisConnection } from "@domain/data/redis-connection/mod.ts";
import { TargetLoader } from "@domain/data/target-loader/mod.ts";
import { FlowProducerAdapter } from "@domain/data/flow-producer/mod.ts";
import { WorkerManager } from "@domain/data/worker-manager/mod.ts";
import { JobIdGenerator } from "@domain/business/job-id-generator/mod.ts";
import { FlowBuilder } from "@domain/business/flow-builder/mod.ts";
import { MergeRules } from "@domain/business/merge-rules/mod.ts";
import { ResponseClassifier } from "@domain/business/response-classifier/mod.ts";
import { StartupCoordinator, StartupError } from "@domain/coordinators/startup/mod.ts";
import { WorkerProcessor } from "@domain/coordinators/worker-processor/mod.ts";
import { IngestCoordinator } from "@domain/coordinators/ingest/mod.ts";
import { HealthCheck } from "@domain/coordinators/health-check/mod.ts";
import { HealthController } from "@entrypoints/health-controller.ts";
import { IngestController } from "@entrypoints/ingest-controller.ts";

// --- Configuration ---
const TARGETS_DIR = Deno.env.get("TARGETS_DIR") ?? "/usr/local/var/arachne/targets";
const PORT = Number(Deno.env.get("BACKEND_PORT") ?? "3000");

// --- 1. Data layer ---
const redisConnection = new RedisConnection();
const targetLoader = new TargetLoader({ targetsDir: TARGETS_DIR });

// --- 2. Startup: load targets, connect & verify Redis ---
const startup = new StartupCoordinator({
  targetLoader,
  redisConnection,
  onReady: (targets) => {
    console.log(`Loaded ${targets.size} target(s)`);
  },
});

let targets;
try {
  targets = await startup.start();
} catch (e) {
  if (e instanceof StartupError) {
    console.error(e.message);
    Deno.exit(1);
  }
  throw e;
}

// --- 3. Business logic ---
const jobIdGenerator = new JobIdGenerator();
const mergeRules = new MergeRules();
const responseClassifier = new ResponseClassifier();
const flowBuilder = new FlowBuilder({
  generateId: jobIdGenerator.generate.bind(jobIdGenerator),
  mergeRules,
});

// --- 4. Coordinators ---
const workerProcessor = new WorkerProcessor({
  mergeRules,
  responseClassifier,
  targets,
});

const workerManager = new WorkerManager({
  redisConnection,
  processor: (job, _target) => workerProcessor.process(job),
});

workerManager.createWorkers(targets);

const flowProducer = new FlowProducerAdapter({ redisConnection });
const ingestCoordinator = new IngestCoordinator({
  targets,
  flowBuilder,
  flowProducer,
});
const healthCheck = new HealthCheck({
  ping: () => redisConnection.ping(),
  workerCount: () => workerManager.getWorkerCount(),
});

// --- 5. Entrypoints ---
const healthController = new HealthController({
  check: () => healthCheck.check(),
});
const ingestController = new IngestController({
  ingest: (req) => ingestCoordinator.ingest(req),
});

// --- 6. HTTP server ---
const handler = (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname === "/health") {
    return healthController.handle(req);
  }
  if (req.method === "POST" && url.pathname === "/ingest") {
    return ingestController.handle(req);
  }
  return Promise.resolve(new Response("Not Found", { status: 404 }));
};

const server = Deno.serve({ port: PORT }, handler);
console.log(`Arachne backend listening on port ${PORT}`);

// --- 7. Graceful shutdown ---
Deno.addSignalListener("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down...");
  await server.shutdown();
  await workerManager.closeAll();
  await flowProducer.close();
  await redisConnection.close();
  console.log("Shutdown complete.");
  Deno.exit(0);
});
