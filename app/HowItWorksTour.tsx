"use client";

import { useEffect, useState } from "react";

const TOUR_STEPS = [
  { number: "01", name: "Profile", kicker: "Reading sales_messy.csv", title: "Quality signals detected", detail: "1 duplicate · 1 missing value · 2 cells to trim", visual: "profile" },
  { number: "02", name: "Generate", kicker: "Writing repair_sales.py", title: "A dataset-specific plan", detail: "Normalize currency · standardize casing · preserve IDs", visual: "code" },
  { number: "03", name: "Execute", kicker: "CreateOS sandbox", title: "Code runs in isolation", detail: "5 rows processed · original retained · logs captured", visual: "execute" },
  { number: "04", name: "Verify", kicker: "Independent checks", title: "Clean data, proven safe", detail: "Schema unchanged · duplicates removed · review items flagged", visual: "verify" },
] as const;

export function HowItWorksTour() {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);
  const step = TOUR_STEPS[active];

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setActive((current) => (current + 1) % TOUR_STEPS.length), 3000);
    return () => window.clearInterval(timer);
  }, [playing]);

  return (
    <div className="tour" aria-label="Animated DataFix workflow walkthrough">
      <div className="tour-screen">
        <div className="tour-bar"><span>DATAFIX / LIVE TOUR</span><button type="button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pause walkthrough" : "Play walkthrough"}>{playing ? "Pause Ⅱ" : "Play ▶"}</button></div>
        <div className="tour-stage" key={step.name}>
          <div className="tour-copy"><span>{step.kicker}</span><h3>{step.title}</h3><p>{step.detail}</p></div>
          <div className={`tour-visual ${step.visual}`} aria-hidden="true">
            {step.visual === "profile" && <><i /><i /><i /><i /><strong>4 signals</strong></>}
            {step.visual === "code" && <><code>def repair(df):</code><code>  df = trim_text(df)</code><code>  return validate(df)</code></>}
            {step.visual === "execute" && <><em>RUN</em><code>✓ sandbox ready</code><code>✓ 5 rows processed</code><code>✓ output saved</code></>}
            {step.visual === "verify" && <><strong>100%</strong><span>validation passed</span><i /></>}
          </div>
        </div>
        <div className={`tour-progress ${playing ? "playing" : ""}`} key={`${active}-${playing}`}><span /></div>
      </div>
      <div className="tour-steps" role="tablist" aria-label="Walkthrough steps">
        {TOUR_STEPS.map((item, index) => (
          <button className={index === active ? "active" : ""} key={item.name} type="button" role="tab" aria-selected={index === active} onClick={() => { setActive(index); setPlaying(false); }}>
            <b>{item.number}</b><span>{item.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
