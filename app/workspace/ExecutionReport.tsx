import type { ExecuteSuccess } from "../../lib/contract.ts";

type Props = { result: ExecuteSuccess; onDownload: () => void };

export function ExecutionReport({ result, onDownload }: Props) {
  const { verification, attempts } = result;
  const unresolved = verification.unresolvedCells;
  const finalAttempt = attempts[attempts.length - 1];
  const runSummary = `${attempts.length} attempt${attempts.length === 1 ? "" : "s"} · ${result.execMs ? `${Math.round(result.execMs)} ms final run` : result.runtime}`;

  return (
    <section className="execution-result" id="execution-result" aria-live="polite">
      <div className="result-heading">
        <div><p className="section-label">Steps 03–04 · Execute & verify</p><h2>Cleanup completed and verified.</h2></div>
        <span className="sandbox-badge">CreateOS Sandbox · success</span>
      </div>
      {result.repaired && (
        <div className="self-repair-notice">
          <b>Automatic code repair succeeded</b>
          <span>An earlier attempt failed. DataFix analyzed the error, rewrote the Python, and passed on attempt {finalAttempt.number}.</span>
        </div>
      )}
      <div className="result-metrics">
        <article><span>Input rows</span><strong>{verification.inputRows.toLocaleString()}</strong></article>
        <article><span>Output rows</span><strong>{verification.outputRows.toLocaleString()}</strong></article>
        <article><span>Duplicates removed</span><strong>{Math.max(0, verification.duplicatesBefore - verification.duplicatesAfter).toLocaleString()}</strong></article>
        <article><span>Unresolved cells</span><strong>{unresolved.toLocaleString()}</strong></article>
      </div>
      {unresolved > 0 && (
        <div className="review-notice">
          <b>{unresolved.toLocaleString()} value{unresolved === 1 ? " was" : "s were"} intentionally left unchanged.</b>
          <span>DataFix fixed safe issues such as extra spaces and duplicates, but it will not guess missing or ambiguous information. The modified CSV is ready; these cells still need human review.</span>
        </div>
      )}
      <div className="result-grid">
        <details className="run-log">
          <summary className="panel-title"><span>CreateOS run details</span><small>{runSummary}</small></summary>
          <div className="attempt-list">
            {attempts.map((attempt) => (
              <article key={attempt.number}>
                <div><b>Attempt {attempt.number}</b><em className={attempt.status}>{attempt.status}</em></div>
                {attempt.diagnosis && <p><strong>AI diagnosis:</strong> {attempt.diagnosis}</p>}
                {attempt.failure && <p><strong>Failure:</strong> {attempt.failure}</p>}
                <pre>{attempt.logs || "Script completed with no console output."}</pre>
              </article>
            ))}
          </div>
        </details>
        <div className="validation-card">
          <span>Independent validation</span>
          <strong>{verification.passed ? "Passed" : "Review required"}</strong>
          <ul>
            {verification.checks.map((check) => (
              <li key={check.id} className={check.passed ? "" : check.blocking ? "check-failed" : "check-advisory"}>
                {check.passed ? "✓" : check.blocking ? "×" : "!"} {check.name}{!check.passed && check.detail ? ` — ${check.detail}` : ""}
              </li>
            ))}
            {(result.report?.notes ?? []).map((note, index) => <li key={`note-${index}`}>{note}</li>)}
          </ul>
          <button type="button" onClick={onDownload}>Download modified CSV ↓</button>
        </div>
      </div>
    </section>
  );
}
