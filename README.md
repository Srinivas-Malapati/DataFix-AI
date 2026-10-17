# DataFix AI

DataFix AI is an autonomous CSV repair agent for the CreateOS × Stripe Projects hackathon. The finished product will inspect a dataset, write dataset-specific Python, execute that code inside an isolated CreateOS sandbox, independently validate the result, and return a cleaned CSV plus a reproducible audit trail.

## Current milestone: Step 1 — Inspect

The first vertical slice is working:

- Select or drag-and-drop a CSV (10 MB local demo limit)
- Parse quoted CSV fields without uploading the file
- Show a five-row data preview
- Count rows, columns, exact duplicate rows, missing cells, and whitespace defects
- Detect case variants within columns
- Reject malformed or single-column inputs with a clear message
- Load three synthetic sales, customer, and transaction samples for demonstrations
- Download those samples directly from the public app

This stage stays in the browser on purpose. Generated code must not execute in the browser or on the application server.

## Why we are building in this order

1. **Inspect:** A trustworthy repair agent needs an accurate, deterministic description of its input.
2. **Plan and generate:** An LLM will receive the profile, user goal, and strict output contract, then return a repair plan and Python script.
3. **Execute:** The script and CSV will be uploaded to a disposable CreateOS sandbox and run with bounded resources.
4. **Verify:** Application-owned checks will compare the original and output; the model is not allowed to grade itself.
5. **Deliver:** The UI will expose generated code, real sandbox logs, before/after metrics, the cleaned CSV, and an audit report.

## Intended execution architecture

```text
Browser
  └─ CSV upload + local profile
       └─ server repair route
            ├─ LLM: structured plan + Python
            ├─ CreateOS: file upload + isolated execution
            └─ Validator: schema, row-count, duplicate, null, and change-budget checks
```

CreateOS integration will use the official `@nodeops-createos/sandbox` SDK. The server will upload `/workspace/input.csv` and `/workspace/repair.py`, run Python, download the output and audit artifacts, and always destroy the sandbox in a `finally` block.

## Local development

```bash
npm install
npm run dev
```

Open the local URL printed by the development server. Choose **Use sample**, then **Inspect dataset** to exercise the current milestone.

## Required production configuration (next milestone)

```bash
CREATEOS_SANDBOX_API_KEY=
CREATEOS_SANDBOX_BASE_URL=https://api.sb.createos.sh
OPENAI_API_KEY=
OPENAI_MODEL=
```

Do not commit `.env` files or paste secrets into issues, chat, screenshots, or demo recordings.

## Hackathon compliance checklist

- [x] New project created during the hackathon
- [x] Real-world CSV repair workflow
- [x] Functional input profiling
- [ ] Agent writes dataset-specific executable code
- [ ] Generated code runs in CreateOS Sandbox
- [ ] Independent validation and bounded repair retry
- [ ] Stripe Projects initialized and used for the project stack
- [ ] Public GitHub repository and complete run instructions
- [ ] Deployed app URL
- [ ] Two-to-three-minute demo recording with a team member on camera
- [ ] Public build post and submission form

## Demo rule

Never present local preview behavior as a sandbox run. The final UI must label the executor and expose the actual CreateOS sandbox logs. If the integration is unavailable, the product should fail clearly rather than fabricate a successful execution trace.
