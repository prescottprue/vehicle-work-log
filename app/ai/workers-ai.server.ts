/**
 * Shared Workers AI binding resolver for the Ask feature. Mirrors the seam in
 * ~/scan/extract.server (which predates this module and keeps its own copy):
 * on Cloudflare the `AI` binding is available via `cloudflare:workers`; on
 * Node self-host the import fails and callers fall back to local Ollama.
 */

export type WorkersAi = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
};

/**
 * Resolve the Workers AI binding plus a Worker `vars` reader, or null when
 * not running on Workers.
 */
export async function getWorkersAi(): Promise<{
  ai: WorkersAi;
  envVar: (name: string) => string | undefined;
} | null> {
  const cfModuleId = "cloudflare" + ":workers";
  // biome-ignore lint/suspicious/noExplicitAny: cross-runtime env shape
  const cf: any = await import(/* @vite-ignore */ cfModuleId).catch(() => null);
  const ai = cf?.env?.AI as WorkersAi | undefined;
  if (!ai || typeof ai.run !== "function") return null;
  return {
    ai,
    envVar: (name) => {
      const value = cf.env[name];
      return typeof value === "string" && value.length > 0 ? value : undefined;
    },
  };
}

/**
 * The raw text payload of an `env.AI.run` chat result, or null if not
 * textual. Tolerates `{ response }`, OpenAI-style `choices`, and one level of
 * `{ content }` nesting — same shapes the scan extractor handles.
 */
export function workersAiText(result: unknown): string | null {
  const r = (result && typeof result === "object" ? result : {}) as Record<
    string,
    unknown
  >;
  let payload: unknown = r.response;
  if (payload == null && Array.isArray(r.choices)) {
    const first = r.choices[0] as
      | { message?: { content?: unknown } }
      | undefined;
    payload = first?.message?.content;
  }
  if (payload != null && typeof payload === "object") {
    const inner = (payload as Record<string, unknown>).content;
    if (typeof inner === "string") payload = inner;
  }
  return typeof payload === "string" ? payload : null;
}

/** True when running under `vite dev`, where local Ollama may be reachable. */
export function isDevRuntime(): boolean {
  return (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
}
