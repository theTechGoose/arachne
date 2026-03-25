import { z } from "#zod";

// --- connectivity.json shape ---
export type ConnectivityConfig = {
  tcp: string;
  http: string;
};

// --- users.json shape ---
export type UsersConfig = {
  credentials: string[];
};

// --- Target (re-exported from backend for CLI deploy-time validation) ---
const HttpMethod = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export const TargetSchema = z.object({
  host: z.string().url(),
  route: z.array(z.string()),
  method: HttpMethod,
  headers: z.record(z.string(), z.string()),
  query: z.record(z.string(), z.string()),
  concurrency: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  retries: z.number().int().min(0),
});

export type Target = z.infer<typeof TargetSchema>;
