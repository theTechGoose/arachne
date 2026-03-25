export type HealthResponse = {
  status: "ok" | "degraded";
  redis: boolean;
  workers: number;
};
