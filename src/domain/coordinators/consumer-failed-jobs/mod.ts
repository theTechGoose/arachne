import type { ConsumerService, FailedJob } from "@design";

export async function getConsumerFailedJobs(
  consumerService: ConsumerService,
  name: string,
): Promise<FailedJob[]> {
  if (!name || name.trim().length === 0) {
    throw new Error("Consumer name is required");
  }

  const existing = await consumerService.get(name);
  if (!existing) {
    const error = new Error(`Consumer '${name}' not found`);
    (error as any).statusCode = 404;
    throw error;
  }

  return await consumerService.getFailedJobs(name);
}
