"use client";

import { useState } from "react";
import type { CleanupPlan } from "../../lib/contract.ts";
import type { ExecutionState } from "./state.ts";

type Props = {
  fileName: string;
  columnCount: number;
  plan: CleanupPlan;
  execution: ExecutionState;
  onExecute: () => void;
};

export function WorkflowReview({ fileName, columnCount, plan, execution, onExecute }: Props) {
  const [copied, setCopied] = useState(false);
  const running = execution.status === "running";

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(plan.python_code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be denied; the code remains selectable on screen.
    }
  }

  return (
    <section className="repair-plan" id="repair-plan" aria-live="polite">
      <div className="plan-heading">
        <div>
          <p className="section-label">Step 02 · AI workflow</p>
          <h2>Review what DataFix will change.</h2>
          <p className="plan-summary">{plan.summary}</p>
          <p className="dataset-specific-note">Built for <b>{fileName}</b> from its {columnCount} columns, representative rows, detected quality signals, and your instructions.</p>
        </div>
        <span className="review-badge">Human approval required</span>
      </div>
      <div className="plan-grid">
        <div className="plan-actions">
          <div className="panel-title"><span>Recommended transformations</span><small>{fileName} · {plan.transformations.length} actions</small></div>
          <ol>
            {plan.transformations.map((action, index) => (
              <li key={`${action.title}-${index}`}>
                <b>{String(index + 1).padStart(2, "0")}</b>
                <span>
                  <strong>{action.title}</strong>
                  <small>{action.rationale}</small>
                  <em>{action.risk === "safe" ? "Safe change" : "Review advised"}{action.affected_columns.length ? ` · ${action.affected_columns.join(", ")}` : ""}</em>
                </span>
              </li>
            ))}
          </ol>
          <div className="plan-safety"><b>Validation checks</b><ul>{plan.validation_checks.map((check, index) => <li key={index}>✓ {check}</li>)}</ul></div>
        </div>
        <div className="code-review">
          <div className="panel-title"><span>Execution script</span><button type="button" onClick={copyCode}>{copied ? "Copied ✓" : "Copy code"}</button></div>
          <pre><code>{plan.python_code}</code></pre>
        </div>
      </div>
      <div className="approval-bar">
        <div>
          <b>Workflow ready for approval</b>
          <span>DataFix will upload the CSV and execute this exact script in a temporary CreateOS sandbox. If it fails, DataFix diagnoses and repairs it automatically.</span>
          {execution.status === "error" && <small className="action-error" role="alert">{execution.message}</small>}
        </div>
        <button type="button" onClick={onExecute} disabled={running}>
          {running ? "Running in CreateOS…" : "Review and execute"}<span>{running ? "•••" : "→"}</span>
        </button>
      </div>
    </section>
  );
}
