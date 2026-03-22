import type { JobConsumer } from "@design";
import type { Redis } from "#ioredis";

export class ConsumerPersistenceAdapter {
  private readonly CONSUMER_KEY_PREFIX = "arachne:consumers:";
  private readonly CONSUMER_LIST_KEY = "arachne:consumer:list";

  constructor(private readonly redis: Redis) {}

  async saveConsumer(consumer: JobConsumer): Promise<void> {
    const key = `${this.CONSUMER_KEY_PREFIX}${consumer.name}`;
    await this.redis.set(key, JSON.stringify({
      name: consumer.name,
      targetUrls: consumer.targetUrls,
      concurrency: consumer.concurrency,
      health: consumer.health,
      paused: consumer.paused,
      defaultJobDetails: consumer.defaultJobDetails,
      schedule: consumer.schedule,
      pipeline: consumer.pipeline,
      pipelineStepFailures: consumer.pipelineStepFailures,
      tags: consumer.tags || [],
    }));
    await this.redis.sadd(this.CONSUMER_LIST_KEY, consumer.name);
  }

  async loadConsumer(name: string): Promise<JobConsumer | null> {
    const key = `${this.CONSUMER_KEY_PREFIX}${name}`;
    const data = await this.redis.get(key);
    if (!data) return null;

    const parsed = JSON.parse(data);
    return {
      ...parsed,
      tags: parsed.tags || [],
      stats: {
        completed: 0, failed: 0, waiting: 0,
        active: 0, stalled: 0, delayed: 0, removed: 0,
      },
    };
  }

  async loadAllConsumers(): Promise<JobConsumer[]> {
    const consumerNames = await this.redis.smembers(this.CONSUMER_LIST_KEY);
    const consumers: JobConsumer[] = [];
    for (const name of consumerNames) {
      const consumer = await this.loadConsumer(name);
      if (consumer) consumers.push(consumer);
    }
    return consumers;
  }

  async deleteConsumer(name: string): Promise<void> {
    const key = `${this.CONSUMER_KEY_PREFIX}${name}`;
    await this.redis.del(key);
    await this.redis.srem(this.CONSUMER_LIST_KEY, name);
  }

  async consumerExists(name: string): Promise<boolean> {
    return await this.redis.sismember(this.CONSUMER_LIST_KEY, name) === 1;
  }
}
