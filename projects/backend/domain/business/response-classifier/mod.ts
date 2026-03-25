export type ResponseClassification =
  | { action: "pass" }
  | { action: "retry" }
  | { action: "fail"; status: number };

export class ResponseClassifier {
  classify(status: number, headers: Headers): ResponseClassification {
    if (status >= 200 && status <= 299) {
      return { action: "pass" };
    }

    if (headers.get("x-arachne-retryable") === "true") {
      return { action: "retry" };
    }

    return { action: "fail", status };
  }
}
