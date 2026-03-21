import type { ConsumerService, JobConsumer } from "@design";

export async function updateConsumer(
  consumerService: ConsumerService,
  name: string,
  updates: Partial<JobConsumer>,
): Promise<void> {
  if (!name || name.trim().length === 0) {
    throw new Error("Consumer name is required");
  }

  const existing = await consumerService.get(name);
  if (!existing) {
    const error = new Error(`Consumer '${name}' not found`);
    (error as any).statusCode = 404;
    throw error;
  }

  if ("name" in updates && updates.name !== name) {
    const error = new Error("Consumer name cannot be changed");
    (error as any).statusCode = 400;
    throw error;
  }

  const updated = { ...existing, ...updates, name };
  await consumerService.update(updated);
}
