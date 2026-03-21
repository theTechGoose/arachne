import type { ConsumerService, JobConsumer } from "@design";

export async function listConsumers(
  consumerService: ConsumerService,
): Promise<JobConsumer[]> {
  return await consumerService.getAll();
}
