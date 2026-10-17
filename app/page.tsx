import { DataFixWorkspace } from "./DataFixWorkspace";

export default function Home() {
  return (
    <main>
      <nav className="nav-shell" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="DataFix AI home">
          <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
          <span>DataFix <em>AI</em></span>
        </a>
        <div className="nav-actions">
          <span className="system-status"><i /> Profiler ready</span>
          <a className="text-link" href="#how-it-works">How it works</a>
          <a className="button button-dark" href="#workspace">Open workspace</a>
        </div>
      </nav>

      <section className="hero" id="top">
        <div className="eyebrow"><span>✦</span> Autonomous data repair agent</div>
        <h1>Messy data in.<br /><span>Trusted data out.</span></h1>
        <p className="hero-copy">DataFix writes dataset-specific Python, runs it inside an isolated sandbox, and validates every change before you download the result.</p>
        <div className="trust-row" aria-label="Product capabilities">
          <span><b>01</b> Inspects</span><span><b>02</b> Writes code</span>
          <span><b>03</b> Executes</span><span><b>04</b> Validates</span>
        </div>
      </section>

      <DataFixWorkspace />

      <section className="process" id="how-it-works">
        <div><div><p className="section-label">Built for verifiable automation</p><h2>Not another black-box cleaner.</h2></div></div>
        <div className="process-grid">
          <article><b>01</b><h3>Profile</h3><p>Detect missing values, duplicates, type drift, and inconsistent formats.</p></article>
          <article><b>02</b><h3>Generate</h3><p>Write a repair script tailored to the uploaded schema and your goal.</p></article>
          <article><b>03</b><h3>Execute</h3><p>Run generated Python in an isolated CreateOS sandbox with real logs.</p></article>
          <article><b>04</b><h3>Verify</h3><p>Independently check row counts, schema changes, and unresolved risks.</p></article>
        </div>
      </section>
      <footer><span>DataFix AI</span><span>Powered by CreateOS Sandbox + Stripe Projects</span></footer>
    </main>
  );
}
