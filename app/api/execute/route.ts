import { LIMITS, type ExecuteRequest, type ExecuteSuccess } from "../../../lib/contract.ts";
import { CsvParseError, parseCsv } from "../../../lib/csv.ts";
import { runCleanupAgent } from "../../../lib/server/agent.ts";
import { createOsProvider, getCreateOsConfig } from "../../../lib/server/createos.ts";
import { HttpError, errorResponse, isRecord, readJsonBody, requireString } from "../../../lib/server/http.ts";
import { createStructuredGenerator, getOpenAIConfig } from "../../../lib/server/openai.ts";
import { createRepairer } from "../../../lib/server/planner.ts";
import { getSigningSecret, verifyScriptToken } from "../../../lib/server/signing.ts";

// JSON escaping can roughly double a CSV's size; leave headroom above the CSV limit.
const MAX_BODY_BYTES = LIMITS.maxCsvBytes * 2 + LIMITS.maxScriptChars * 2 + 64 * 1024;

function parseExecuteRequest(body: unknown): ExecuteRequest {
  if (!isRecord(body)) throw new HttpError(400, "CSV data and an approved script are required.");
  const csvText = requireString(body.csvText, "csvText", LIMITS.maxCsvBytes);
  if (new TextEncoder().encode(csvText).byteLength > LIMITS.maxCsvBytes) throw new HttpError(413, "The dataset exceeds the 10 MB limit.");
  try {
    const rows = parseCsv(csvText);
    if (rows.length < 2 || rows[0].length < 2) throw new HttpError(400, "The CSV needs a header row, two columns, and at least one data row.");
  } catch (error) {
    if (error instanceof CsvParseError) throw new HttpError(400, error.message);
    throw error;
  }
  return {
    fileName: typeof body.fileName === "string" && body.fileName ? body.fileName.slice(0, LIMITS.maxFileNameChars) : "input.csv",
    csvText,
    pythonCode: requireString(body.pythonCode, "pythonCode", LIMITS.maxScriptChars),
    scriptToken: requireString(body.scriptToken, "scriptToken", 256),
  };
}

export async function POST(request: Request) {
  try {
    const createOs = getCreateOsConfig();
    if (!createOs) throw new HttpError(503, "CreateOS execution is not configured.");
    const openai = getOpenAIConfig();
    const secret = getSigningSecret();
    if (!openai || !secret) throw new HttpError(503, "Automatic code repair is not configured.");

    const body = parseExecuteRequest(await readJsonBody(request, MAX_BODY_BYTES));
    if (!(await verifyScriptToken(body.pythonCode, body.scriptToken, secret))) {
      throw new HttpError(403, "This script was not issued by DataFix or has expired. Rebuild the workflow.");
    }

    const outcome = await runCleanupAgent({
      sandboxes: createOsProvider(createOs),
      repair: createRepairer(createStructuredGenerator(openai)),
      fileName: body.fileName,
      csvText: body.csvText,
      code: body.pythonCode,
    });

    if (outcome.status === "failed") {
      throw new HttpError(
        422,
        `DataFix could not produce a verified result after ${outcome.attempts.length} attempt${outcome.attempts.length === 1 ? "" : "s"}. ${outcome.lastFailure}`,
        { attempts: outcome.attempts, ...(outcome.verification ? { verification: outcome.verification } : {}) },
      );
    }

    const response: ExecuteSuccess = {
      status: "succeeded",
      outputCsv: outcome.outputCsv,
      report: outcome.report,
      verification: outcome.verification,
      logs: outcome.logs,
      execMs: outcome.execMs,
      runtime: "CreateOS Sandbox",
      sourceFile: body.fileName,
      repaired: outcome.attempts.length > 1,
      attempts: outcome.attempts,
      finalPythonCode: outcome.finalCode,
    };
    return Response.json(response);
  } catch (error) {
    return errorResponse(error);
  }
}
