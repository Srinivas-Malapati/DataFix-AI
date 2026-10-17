import type { CsvProfile, CsvTable } from "../../lib/csv.ts";
import type { PlanState } from "./state.ts";

const PREVIEW_ROWS = 5;

type Props = {
  fileName: string;
  table: CsvTable;
  profile: CsvProfile;
  plan: PlanState;
  onPrepare: () => void;
};

export function InspectionReport({ fileName, table, profile, plan, onPrepare }: Props) {
  const signals = profile.duplicateRows + profile.missingCells + profile.inconsistentColumns.length;
  const previewLabel = profile.rowCount <= PREVIEW_ROWS
    ? `Showing all ${profile.rowCount} rows`
    : `Showing first ${PREVIEW_ROWS} of ${profile.rowCount.toLocaleString()} rows`;
  const buttonLabel = plan.status === "loading" ? "Preparing workflow…" : plan.status === "ready" ? "Rebuild workflow ↻" : "Prepare cleanup workflow →";

  return (
    <section className="analysis" id="inspection-results" aria-live="polite">
      <div className="analysis-heading">
        <div><p className="section-label">Inspection complete</p><h2>We found what needs attention.</h2></div>
        <span className="verified-badge">Profiled locally</span>
      </div>
      <div className="metrics-grid">
        <article><span>Rows</span><strong>{profile.rowCount.toLocaleString()}</strong><small>input records</small></article>
        <article><span>Duplicates</span><strong>{profile.duplicateRows.toLocaleString()}</strong><small>exact row matches</small></article>
        <article><span>Missing</span><strong>{profile.missingCells.toLocaleString()}</strong><small>empty cells</small></article>
      </div>
      <div className="analysis-grid">
        <div className="preview-table-wrap">
          <div className="panel-title">
            <span>Dataset preview</span>
            <div className="panel-meta"><small>{fileName}</small><small>{previewLabel} · all rows inspected</small></div>
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr>{table.headers.map((header, index) => <th key={index}>{header}</th>)}</tr></thead>
              <tbody>
                {table.rows.slice(0, PREVIEW_ROWS).map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, columnIndex) => <td key={columnIndex} className={cell.trim() ? "" : "empty-cell"}>{cell || "—"}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="issues-panel">
          <div className="panel-title"><span>Quality signals</span><small>{signals.toLocaleString()} signals</small></div>
          <ul>
            <Signal label="Exact duplicate rows" count={profile.duplicateRows} />
            <Signal label="Missing values" count={profile.missingCells} />
            <Signal label="Case variants" count={profile.inconsistentColumns.length} />
          </ul>
          <div className="next-step">
            <span>Step 02 · AI workflow</span>
            <p>Ask DataFix AI to design transformations and write an execution script for this dataset.</p>
            <button type="button" onClick={onPrepare} disabled={plan.status === "loading"}>{buttonLabel}</button>
            {plan.status === "error" && <small className="action-error" role="alert">{plan.message}</small>}
          </div>
        </div>
      </div>
    </section>
  );
}

function Signal({ label, count }: { label: string; count: number }) {
  return <li><b>{count ? "Review" : "Clear"}</b><span>{label}</span><em>{count.toLocaleString()}</em></li>;
}
