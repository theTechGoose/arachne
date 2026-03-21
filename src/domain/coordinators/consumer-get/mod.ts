import type { ConsumerService, JobConsumer } from "@design";

export async function getConsumer(
  consumerService: ConsumerService,
  name: string,
): Promise<JobConsumer | null> {
  if (!name || name.trim().length === 0) {
    throw new Error("Consumer name is required");
  }
  return await consumerService.get(name);
}
