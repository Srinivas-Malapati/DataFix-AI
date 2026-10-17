# DataFix AI

DataFix AI is an autonomous CSV repair agent for the CreateOS × Stripe Projects hackathon. The finished product will inspect a dataset, write dataset-specific Python, execute that code inside an isolated CreateOS sandbox, independently validate the result, and return a cleaned CSV plus a reproducible audit trail.

## Current milestone: end-to-end agent pipeline

The working flow includes:

- Select or drag-and-drop a CSV (10 MB local demo limit)
- Parse quoted CSV fields without uploading the file
- Show a five-row data preview
- Count rows, columns, exact duplicate rows, missing cells, and whitespace defects
- Detect case variants within columns
- Reject malformed or single-column inputs with a clear message
- Load three synthetic sales, customer, and transaction samples for demonstrations
- Download those samples directly from the public app
- Ask the OpenAI Responses API for a strict, dataset-specific workflow
- Review the recommended transformations, validation checks, and generated Python
- Approve execution in a disposable CreateOS sandbox
- Upload input and code, run Python, capture real logs, and download the output
- Display execution metrics and a downloadable cleaned CSV

Profiling stays in the browser. Generated code executes only inside a disposable CreateOS sandbox, never in the browser or application server.

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

CreateOS integration uses the official Sandbox REST API. The server uploads `/workspace/input.csv` and `/workspace/repair.py`, runs Python, downloads the output and audit artifacts, and always destroys the sandbox in a `finally` block.

## Local development

```bash
npm install
npm run dev
```

Open the local URL printed by the development server. Load a sample, inspect it, prepare the AI cleanup workflow, approve execution, and download the verified result.

## Required production configuration

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
- [x] Agent writes dataset-specific executable code
- [x] Generated code runs in CreateOS Sandbox
- [x] Execution logs and script-authored validation report
- [ ] Independent application-owned validation and bounded repair retry
- [ ] Stripe Projects initialized and used for the project stack
- [ ] Public GitHub repository and complete run instructions
- [ ] Deployed app URL
- [ ] Two-to-three-minute demo recording with a team member on camera
- [ ] Public build post and submission form

## Demo rule

Never present local preview behavior as a sandbox run. The final UI must label the executor and expose the actual CreateOS sandbox logs. If the integration is unavailable, the product should fail clearly rather than fabricate a successful execution trace.
