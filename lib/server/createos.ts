import { HttpError } from "./http.ts";

export type CreateOsConfig = {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
};

type Env = Record<string, string | undefined>;

export const SANDBOX_API_URL = "https://api.sb.createos.sh";

/**
 * Prefers the Stripe Projects-provisioned key, then the legacy name.
 *
 * The base URL deliberately ignores `CREATEOS_PROJECT_API_URL`: Stripe sets it
 * to the CreateOS *platform* API, which does not serve `/v1/sandboxes`. The
 * same key authenticates against the Sandbox API below.
 */
export function getCreateOsConfig(env: Env = process.env): CreateOsConfig | null {
  const apiKey = env.CREATEOS_PROJECT_API_KEY || env.CREATEOS_SANDBOX_API_KEY;
  if (!apiKey) return null;
  const baseUrl = env.CREATEOS_SANDBOX_BASE_URL || SANDBOX_API_URL;
  return { apiKey, baseUrl: baseUrl.replace(/\/+$/, "") };
}

export type ExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  execMs: number | null;
};

export interface Sandbox {
  upload(path: string, contents: string): Promise<void>;
  /** Returns `null` when the file does not exist. */
  download(path: string): Promise<string | null>;
  exec(cmd: string, args: string[]): Promise<ExecResult>;
}

export interface SandboxProvider {
  /** Runs `task` in a fresh sandbox that is always destroyed afterwards. */
  withSandbox<T>(task: (sandbox: Sandbox) => Promise<T>): Promise<T>;
}

/** Sandbox shape: no ingress, egress pinned to an unroutable host, short idle pause. */
const SANDBOX_SPEC = {
  shape: "s-1vcpu-1gb",
  rootfs: "devbox:1",
  ingress_enabled: false,
  auto_pause_after_seconds: 300,
  egress: ["blocked.invalid:443"],
} as const;

export function createOsProvider(config: CreateOsConfig, fetchImpl: typeof fetch = fetch): SandboxProvider {
  async function call(path: string, init: RequestInit = {}, { allowNotFound = false } = {}): Promise<Response | null> {
    let response: Response;
    try {
      response = await fetchImpl(`${config.baseUrl}${path}`, {
        ...init,
        headers: { "X-Api-Key": config.apiKey, ...init.headers },
        signal: AbortSignal.timeout(config.timeoutMs ?? 180_000),
      });
    } catch (error) {
      console.error("[datafix] CreateOS request failed", path, error);
      throw new HttpError(504, "The CreateOS sandbox did not respond in time.");
    }
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("[datafix] CreateOS error", response.status, path, detail.slice(0, 500));
      if (response.status === 429) {
        throw new HttpError(503, "The CreateOS sandbox quota for this account has been reached. Please try again later.");
      }
      throw new HttpError(502, `The CreateOS sandbox request failed (${response.status}).`);
    }
    return response;
  }

  const filePath = (id: string, path: string) => `/v1/sandboxes/${id}/files?path=${encodeURIComponent(path)}`;

  function bind(id: string): Sandbox {
    return {
      async upload(path, contents) {
        await call(filePath(id, path), {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: contents,
        });
      },
      async download(path) {
        const response = await call(filePath(id, path), {}, { allowNotFound: true });
        return response ? response.text() : null;
      },
      async exec(cmd, args) {
        const response = await call(`/v1/sandboxes/${id}/exec`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cmd, args }),
        });
        const payload = (await response!.json()) as {
          data?: { result?: { stdout?: string; stderr?: string; exit_code?: number }; exec_ms?: number };
        };
        const result = payload.data?.result;
        return {
          exitCode: typeof result?.exit_code === "number" ? result.exit_code : -1,
          stdout: result?.stdout ?? "",
          stderr: result?.stderr ?? "",
          execMs: payload.data?.exec_ms ?? null,
        };
      },
    };
  }

  return {
    async withSandbox(task) {
      const created = await call("/v1/sandboxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // CreateOS caps sandbox names at 22 characters.
        body: JSON.stringify({ ...SANDBOX_SPEC, name: `datafix-${crypto.randomUUID().slice(0, 12)}` }),
      });
      const id = ((await created!.json()) as { data?: { id?: string } }).data?.id;
      if (!id) throw new HttpError(502, "CreateOS did not return a sandbox ID.");
      try {
        return await task(bind(id));
      } finally {
        await call(`/v1/sandboxes/${id}`, { method: "DELETE" }).catch((error) => {
          console.error("[datafix] sandbox cleanup failed", id, error);
        });
      }
    },
  };
}
