import { LIMITS, type PlanRequest, type PlanResponse } from "../../../lib/contract.ts";
import { HttpError, errorResponse, isRecord, optionalCount, readJsonBody, requireString, requireStringArray } from "../../../lib/server/http.ts";
import { createStructuredGenerator, getOpenAIConfig } from "../../../lib/server/openai.ts";
import { planCleanup } from "../../../lib/server/planner.ts";
import { getSigningSecret, signScript } from "../../../lib/server/signing.ts";

const MAX_BODY_BYTES = 512 * 1024;

function parsePlanRequest(body: unknown): PlanRequest {
  if (!isRecord(body)) throw new HttpError(400, "A profiled CSV is required.");
  const headers = requireStringArray(body.headers, "headers", LIMITS.maxColumns).map((header) => header.slice(0, LIMITS.maxHeaderChars));
  if (!Array.isArray(body.sampleRows) || body.sampleRows.length === 0) throw new HttpError(400, "A profiled CSV is required.");
  const sampleRows = body.sampleRows.slice(0, LIMITS.sampleRows).map((row) => {
    if (!Array.isArray(row) || !row.every((cell) => typeof cell === "string")) throw new HttpError(400, "`sampleRows` must contain rows of strings.");
    return headers.map((_, index) => (row[index] ?? "").slice(0, LIMITS.maxSampleCellChars));
  });
  const profile = isRecord(body.profile) ? body.profile : {};
  return {
    fileName: requireString(body.fileName, "fileName", LIMITS.maxFileNameChars),
    goal: requireString(body.goal ?? "", "goal", LIMITS.maxGoalChars, { allowEmpty: true }),
    headers,
    sampleRows,
    profile: {
      rows: optionalCount(profile.rows),
      duplicateRows: optionalCount(profile.duplicateRows),
      missingCells: optionalCount(profile.missingCells),
      inconsistentColumns: Array.isArray(profile.inconsistentColumns)
        ? profile.inconsistentColumns.filter((column): column is string => typeof column === "string" && headers.includes(column))
        : [],
    },
  };
}

export async function POST(request: Request) {
  try {
    const config = getOpenAIConfig();
    const secret = getSigningSecret();
    if (!config || !secret) throw new HttpError(503, "AI planning is not configured.");

    const planRequest = parsePlanRequest(await readJsonBody(request, MAX_BODY_BYTES));
    const plan = await planCleanup(createStructuredGenerator(config), planRequest);
    const response: PlanResponse = { plan, model: config.model, scriptToken: await signScript(plan.python_code, secret) };
    return Response.json(response);
  } catch (error) {
    return errorResponse(error);
  }
}
