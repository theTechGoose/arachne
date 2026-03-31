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
import { StepsController } from "@entrypoints/steps-controller.ts";
import { createBullBoard } from "#bull-board/api";
import { BullMQAdapter } from "#bull-board/bullmq";
import { HonoAdapter } from "#bull-board/hono";
import { Hono } from "#hono";
import { serveStatic } from "#hono/deno";
import { Queue } from "#bullmq";

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

// --- 5. Bull Board ---
const serverAdapter = new HonoAdapter(serveStatic);
serverAdapter.setBasePath("/ui");
createBullBoard({
  queues: [...targets.keys()].map((name) =>
    new BullMQAdapter(new Queue(name, { connection: redisConnection.getClient() as never }))
  ),
  serverAdapter,
});
// --- 6. Entrypoints ---
const healthController = new HealthController({
  check: () => healthCheck.check(),
});
const ingestController = new IngestController({
  ingest: (req) => ingestCoordinator.ingest(req),
});
const stepsController = new StepsController({ targets });

// --- 7. HTTP server ---
const SWAGGER_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Arachne API</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css">
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
<script>
SwaggerUIBundle({
  spec: {
    openapi: "3.0.0",
    info: { title: "Arachne", version: "1.0.0", description: "Job orchestration API" },
    paths: {
      "/health": {
        get: {
          summary: "Health check",
          responses: {
            "200": { description: "Healthy", content: { "application/json": { schema: { type: "object", properties: { status: { type: "string", enum: ["ok", "degraded"] }, redis: { type: "boolean" }, workers: { type: "number" } } } } } },
            "503": { description: "Degraded" }
          }
        }
      },
      "/steps": {
        get: {
          summary: "List loaded targets",
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { steps: { type: "array", items: { type: "string" } } } } } } }
          }
        }
      },
      "/ingest": {
        post: {
          summary: "Create a flow",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["steps"],
                  properties: {
                    steps: { type: "array", items: { type: "string" }, description: "Ordered list of target names" },
                    payload: { type: "object", description: "Override fields merged into step 0", properties: { route: { type: "array", items: { type: "string" } }, method: { type: "string", enum: ["GET","POST","PUT","PATCH","DELETE"] }, headers: { type: "object" }, query: { type: "object" }, body: {} } },
                    nonce: { type: "string", description: "Bypass dedup" },
                    matureAt: { type: "string", format: "date-time", description: "Delay execution until this time" }
                  }
                },
                example: { steps: ["sample"], payload: { query: { foo: "bar" } } }
              }
            }
          },
          responses: {
            "200": { description: "Flow created", content: { "application/json": { schema: { type: "object", properties: { flowId: { type: "string" }, jobs: { type: "array", items: { type: "object", properties: { id: { type: "string" }, step: { type: "string" }, queue: { type: "string" } } } }, duplicate: { type: "boolean" } } } } } },
            "400": { description: "Invalid steps or empty steps" },
            "422": { description: "Invalid payload or date" },
            "500": { description: "Flow creation failed" },
            "503": { description: "Redis unavailable" }
          }
        }
      }
    }
  },
  dom_id: "#swagger-ui",
  presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
  layout: "BaseLayout"
});
</script>
</body>
</html>`;

const app = new Hono();
app.get("/health", (c) => healthController.handle(c.req.raw));
app.get("/steps", (c) => stepsController.handle(c.req.raw));
app.post("/ingest", (c) => ingestController.handle(c.req.raw));
app.get("/", (c) => c.html(SWAGGER_HTML));
app.get("/docs", (c) => c.html(SWAGGER_HTML));
app.get("/ui/", (c) => c.redirect("/ui"));
app.route("/ui", serverAdapter.registerPlugin());

const server = Deno.serve({ port: PORT }, app.fetch);
console.log(`Arachne backend listening on port ${PORT}`);

// --- 8. Graceful shutdown ---
Deno.addSignalListener("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down...");
  await server.shutdown();
  await workerManager.closeAll();
  await flowProducer.close();
  await redisConnection.close();
  console.log("Shutdown complete.");
  Deno.exit(0);
});
