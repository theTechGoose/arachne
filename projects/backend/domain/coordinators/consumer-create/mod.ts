import type { ConsumerService, JobConsumer } from "@design";

export async function createConsumer(
  consumerService: ConsumerService,
  consumer: JobConsumer,
): Promise<void> {
  if (!consumer.name || consumer.name.trim().length === 0) {
    throw new Error("Consumer name is required");
  }

  const existing = await consumerService.get(consumer.name);
  if (existing) {
    const error = new Error(`Consumer '${consumer.name}' already exists`);
    (error as any).statusCode = 409;
    throw error;
  }

  const consumerWithDefaults: JobConsumer = {
    ...consumer,
    concurrency: consumer.concurrency ?? 1,
    stats: consumer.stats ?? {
      completed: 0, failed: 0, waiting: 0,
      active: 0, stalled: 0, delayed: 0, removed: 0,
    },
    schedule: consumer.schedule ?? null,
    pipeline: consumer.pipeline ?? null,
  };

  await consumerService.add(consumerWithDefaults);
}
