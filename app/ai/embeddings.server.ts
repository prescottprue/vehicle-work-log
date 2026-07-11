/**
 * Ask your Logbook — embedding backend seam.
 *
 * On Cloudflare Workers the `AI` binding runs bge-base-en-v1.5 (Workers AI
 * free allocation); on Node self-host / local dev we fall back to a local
 * Ollama embedding model (default nomic-embed-text). Both emit 768-dim
 * vectors, matching the `vector(768)` column in the embeddings table.
 * Deliberately NOT a paid API — same $0 policy as Scan Bay.
 *
 * `model` (a `<runtime>:<model-id>` string) is stored on every embeddings
 * row: query vectors are only comparable to document vectors from the same
 * model, so rows written by a different backend are treated as stale and
 * re-embedded lazily (see ~/models/embedding.server).
 */

import { getWorkersAi, isDevRuntime } from "~/ai/workers-ai.server";

export const EMBEDDING_DIMENSIONS = 768;

const DEFAULT_WORKERS_EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
const DEFAULT_OLLAMA_EMBEDDING_MODEL = "nomic-embed-text";

export type EmbeddingBackend = {
  /** Namespaced id stored on embeddings rows, e.g. "workers-ai:@cf/baai/…". */
  model: string;
  /** Embed a batch of texts; one vector per input, in order. Throws on transport errors. */
  embed(texts: string[]): Promise<number[][]>;
};

function assertVectors(vectors: unknown, count: number): number[][] {
  if (!Array.isArray(vectors) || vectors.length !== count) {
    throw new Error(
      `Embedding backend returned ${Array.isArray(vectors) ? vectors.length : "no"} vectors for ${count} texts`,
    );
  }
  for (const v of vectors) {
    if (!Array.isArray(v) || v.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding backend returned a ${Array.isArray(v) ? v.length : "?"}-dim vector (expected ${EMBEDDING_DIMENSIONS})`,
      );
    }
  }
  return vectors as number[][];
}

async function workersAiBackend(): Promise<EmbeddingBackend | null> {
  const workersAi = await getWorkersAi();
  if (!workersAi) return null;
  const model =
    workersAi.envVar("EMBEDDING_MODEL") ?? DEFAULT_WORKERS_EMBEDDING_MODEL;
  return {
    model: `workers-ai:${model}`,
    async embed(texts) {
      const result = (await workersAi.ai.run(model, { text: texts })) as {
        data?: unknown;
      };
      return assertVectors(result?.data, texts.length);
    },
  };
}

function ollamaBackend(): EmbeddingBackend {
  const host = process.env.OLLAMA_HOST ?? "http://localhost:11434";
  const model = process.env.EMBEDDING_MODEL ?? DEFAULT_OLLAMA_EMBEDDING_MODEL;
  return {
    model: `ollama:${model}`,
    async embed(texts) {
      const res = await fetch(`${host}/api/embed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, input: texts }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(
          `Ollama ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`,
        );
      }
      const data = (await res.json()) as {
        embeddings?: unknown;
        error?: string;
      };
      if (data.error) throw new Error(`Ollama error: ${data.error}`);
      return assertVectors(data.embeddings, texts.length);
    },
  };
}

// Probing a backend costs one tiny embed call, so a working backend is cached
// per isolate. A failed probe is NOT cached: on Node self-host, Ollama may
// come up after the app, and the next request should find it.
let cachedBackend: EmbeddingBackend | null = null;

/**
 * The first reachable embedding backend (verified with a probe embed so a
 * misconfigured model or wrong dimensionality is caught here, not at insert
 * time), or null when none is available — callers degrade to keyword-only
 * search.
 */
export async function getEmbeddingBackend(): Promise<EmbeddingBackend | null> {
  if (cachedBackend) return cachedBackend;

  const workersAi = await workersAiBackend();
  const candidates: EmbeddingBackend[] = [];
  if (workersAi) candidates.push(workersAi);
  // Same reasoning as the scan extractor: localhost Ollama only exists on
  // Node self-host (no binding) or local dev (binding present but remote
  // bindings may be off). On deployed Workers, skip it.
  if (!workersAi || isDevRuntime()) candidates.push(ollamaBackend());

  for (const candidate of candidates) {
    try {
      await candidate.embed(["logbook embedding probe"]);
      cachedBackend = candidate;
      return candidate;
    } catch {
      // try the next candidate; a null return is a soft degrade, not an error
    }
  }
  return null;
}
