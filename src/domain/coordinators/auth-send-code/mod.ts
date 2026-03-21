import { mint } from "@domain/business/auth-hmac/mod.ts";

export class UnauthorizedEmailError extends Error {
  statusCode = 401;
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedEmailError";
  }
}

export class WebhookError extends Error {
  statusCode = 500;
  constructor(message: string) {
    super(message);
    this.name = "WebhookError";
  }
}

function isEmailAllowed(email: string): boolean {
  const usersEnv = Deno.env.get("USERS");
  if (!usersEnv) return false;
  const allowedEmails = usersEnv.split(",").map((e) => e.trim().toLowerCase());
  return allowedEmails.includes(email.toLowerCase());
}

async function sendToWebhook(email: string, code: string): Promise<void> {
  const webhookUrl = Deno.env.get("N8N_AUTH_WEBHOOK_URL");
  const webhookKey = Deno.env.get("N8N_AUTH_WEBHOOK_KEY");

  if (!webhookUrl || !webhookKey) {
    console.log(`\nAUTH CODE (Development Mode)\nEmail: ${email}\nCode: ${code}\n`);
    return;
  }

  try {
    const url = new URL(webhookUrl);
    url.searchParams.set("key", code);
    url.searchParams.set("email", email);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { authorization: webhookKey },
    });

    if (!response.ok) {
      throw new WebhookError(`Webhook request failed with status ${response.status}`);
    }
  } catch (error) {
    if (error instanceof WebhookError) throw error;
    throw new WebhookError(`Failed to send webhook: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

export async function sendAuthCode(email: string): Promise<void> {
  if (!isEmailAllowed(email)) {
    throw new UnauthorizedEmailError(`Email ${email} is not authorized`);
  }
  const code = mint(email);
  await sendToWebhook(email, code);
}
