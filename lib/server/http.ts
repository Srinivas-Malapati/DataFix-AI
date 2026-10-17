import type { ApiErrorBody } from "../contract.ts";

/** An error whose message is safe to show to API clients. */
export class HttpError extends Error {
  readonly status: number;
  readonly body: Omit<ApiErrorBody, "error">;

  constructor(status: number, publicMessage: string, body: Omit<ApiErrorBody, "error"> = {}) {
    super(publicMessage);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

/** Reads a JSON body, rejecting payloads above `maxBytes` before and after reading. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, "The request is too large.");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new HttpError(413, "The request is too large.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "The request body must be valid JSON.");
  }
}

/**
 * Converts any thrown value into a JSON response. Unexpected errors are logged
 * with a request ID and returned generically so upstream details never leak.
 */
export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message, ...error.body } satisfies ApiErrorBody, { status: error.status });
  }
  const requestId = crypto.randomUUID();
  console.error(`[datafix] unhandled error ${requestId}`, error);
  return Response.json(
    { error: "Something went wrong on our side. Please try again.", requestId } satisfies ApiErrorBody,
    { status: 500 },
  );
}

// Minimal structural validators: the two endpoints have small, flat payloads,
// so a schema library would add weight without adding safety.

export function requireString(value: unknown, field: string, maxChars: number, { allowEmpty = false } = {}): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new HttpError(400, `\`${field}\` is required.`);
  }
  if (value.length > maxChars) throw new HttpError(400, `\`${field}\` exceeds ${maxChars} characters.`);
  return value;
}

export function requireStringArray(value: unknown, field: string, maxItems: number): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string")) {
    throw new HttpError(400, `\`${field}\` must be a non-empty list of strings.`);
  }
  if (value.length > maxItems) throw new HttpError(400, `\`${field}\` exceeds ${maxItems} items.`);
  return value;
}

export function optionalCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
