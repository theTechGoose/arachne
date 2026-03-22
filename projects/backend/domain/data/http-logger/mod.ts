import type { LoggingFn } from "@design";

export const httpLogger: LoggingFn = async (LogDto: string) => {
  try {
    await fetch("https://logger-ingress.aimonsters.net", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: LogDto,
    });
  } catch (_error) {
    // Fire-and-forget: logging should not disrupt application flow
  }
};
