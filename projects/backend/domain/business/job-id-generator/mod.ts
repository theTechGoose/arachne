import jsonCanon from "#json-canonicalize";

const { canonicalize } = jsonCanon;

export class JobIdGenerator {
  async generate(
    body: unknown,
    nonce: string,
    stepName: string,
  ): Promise<string> {
    const canonical = canonicalize(body);
    const input = canonical + "\0" + nonce + "\0" + stepName;
    const encoded = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest("SHA-256", encoded);
    const bytes = new Uint8Array(digest);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
}
