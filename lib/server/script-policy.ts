import { ALLOWED_MODULES, LIMITS } from "../contract.ts";

/**
 * Static checks on AI-generated Python before it reaches the sandbox.
 *
 * This is defense in depth, not the security boundary: the CreateOS sandbox
 * (no ingress, blocked egress, disposable VM) is. The policy's job is to catch
 * scripts that break the contract early and cheaply, so the agent can repair
 * them before spending a sandbox run. Imports use an allowlist because
 * blocklists of "dangerous" modules are trivially bypassed.
 */

export type PolicyResult = { allowed: boolean; violations: string[] };

const allowed = new Set<string>(ALLOWED_MODULES);

// The lookbehind keeps legitimate methods such as `re.compile(...)` allowed.
const BANNED_CALLS = /(?<![.\w])(eval|exec|compile|__import__|breakpoint|input|globals|locals|vars)\s*\(/g;
const BANNED_DUNDERS = /\.?__(builtins|subclasses|globals|class|bases|mro|code|closure|dict|getattribute|loader|spec|import)__\b/g;
const PATH_LITERAL = /(["'])(\/[A-Za-z_][^"'\n]*)\1/g;

function importedRoots(line: string): string[] {
  const fromMatch = /^\s*from\s+(\S+)\s+import\b/.exec(line);
  if (fromMatch) return [fromMatch[1].startsWith(".") ? fromMatch[1] : fromMatch[1].split(".")[0]];
  const importMatch = /^\s*import\s+(.+)$/.exec(line);
  if (!importMatch) return [];
  return importMatch[1]
    .split("#")[0]
    .split(",")
    .map((part) => part.trim().split(/\s+as\s+/)[0].split(".")[0].trim())
    .filter(Boolean);
}

export function checkScript(code: string): PolicyResult {
  const violations = new Set<string>();
  if (!code.trim()) violations.add("The script is empty.");
  if (code.length > LIMITS.maxScriptChars) violations.add(`The script exceeds ${LIMITS.maxScriptChars} characters.`);

  for (const line of code.split("\n")) {
    for (const root of importedRoots(line)) {
      if (!allowed.has(root)) violations.add(`Import of \`${root}\` is not allowed.`);
    }
  }
  for (const match of code.matchAll(BANNED_CALLS)) violations.add(`Call to \`${match[1]}()\` is not allowed.`);
  for (const match of code.matchAll(BANNED_DUNDERS)) violations.add(`Access to \`__${match[1]}__\` is not allowed.`);
  for (const match of code.matchAll(PATH_LITERAL)) {
    const path = match[2];
    if (path !== "/workspace" && !path.startsWith("/workspace/")) violations.add(`Path \`${path}\` is outside /workspace.`);
  }

  return { allowed: violations.size === 0, violations: [...violations] };
}
