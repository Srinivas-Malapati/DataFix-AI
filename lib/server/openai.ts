import { HttpError, isRecord } from "./http.ts";

export type OpenAIConfig = {
  apiKey: string;
  model: string;
  timeoutMs?: number;
};

type Env = Record<string, string | undefined>;

export const DEFAULT_MODEL = "gpt-5.4-mini";

export function getOpenAIConfig(env: Env = process.env): OpenAIConfig | null {
  if (!env.OPENAI_API_KEY) return null;
  return { apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL || DEFAULT_MODEL };
}

export type StructuredRequest = {
  instructions: string;
  input: unknown;
  schemaName: string;
  schema: Record<string, unknown>;
};

export type StructuredGenerator = <T>(request: StructuredRequest) => Promise<T>;

/** Extracts the first `output_text` part from a Responses API payload. */
export function extractOutputText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (isRecord(part) && part.type === "output_text" && typeof part.text === "string") return part.text;
    }
  }
  return "";
}

/**
 * Calls the Responses API with a strict JSON schema and returns the parsed object.
 * Upstream error messages are logged, never returned, because they can echo
 * fragments of the API key or account details.
 */
export function createStructuredGenerator(config: OpenAIConfig, fetchImpl: typeof fetch = fetch): StructuredGenerator {
  return async <T>({ instructions, input, schemaName, schema }: StructuredRequest): Promise<T> => {
    let response: Response;
    try {
      response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          store: false,
          instructions,
          input: JSON.stringify(input),
          text: { format: { type: "json_schema", name: schemaName, strict: true, schema } },
        }),
        signal: AbortSignal.timeout(config.timeoutMs ?? 90_000),
      });
    } catch (error) {
      console.error("[datafix] OpenAI request failed", error);
      throw new HttpError(504, "The AI service did not respond in time. Please try again.");
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok || !isRecord(payload)) {
      const upstream = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
      console.error("[datafix] OpenAI error", response.status, upstream.type, upstream.code);
      if (response.status === 429) throw new HttpError(503, "The AI service is busy. Please try again in a moment.");
      throw new HttpError(502, "The AI service could not complete this request.");
    }
    if (payload.status === "incomplete") {
      throw new HttpError(502, "The AI response was cut short. Try a shorter cleanup instruction.");
    }

    const text = extractOutputText(payload);
    if (!text) throw new HttpError(502, "The AI declined or returned an empty response.");
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HttpError(502, "The AI returned a malformed response.");
    }
  };
}
