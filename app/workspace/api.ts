import type { ApiErrorBody, ExecuteRequest, ExecuteSuccess, PlanRequest, PlanResponse } from "../../lib/contract.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;

  constructor(status: number, message: string, body: ApiErrorBody | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function postJson<T>(path: string, payload: unknown, fallbackMessage: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new ApiError(0, "Network error. Check your connection and try again.", null);
  }
  const body = (await response.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!response.ok || !body) {
    throw new ApiError(response.status, body?.error || fallbackMessage, body as ApiErrorBody | null);
  }
  return body;
}

export const requestPlan = (request: PlanRequest) =>
  postJson<PlanResponse>("/api/plan", request, "DataFix could not prepare a workflow.");

export const requestExecution = (request: ExecuteRequest) =>
  postJson<ExecuteSuccess>("/api/execute", request, "CreateOS could not execute the workflow.");
