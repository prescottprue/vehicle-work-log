/**
 * Ask your Logbook — grounded answer generation.
 *
 * Takes the question plus the retrieved sources (from
 * ~/models/embedding.server semanticSearch) and asks a text model to answer
 * using ONLY those sources, citing them as [1], [2], … so the UI can link
 * each citation back to the log or document it came from.
 *
 * Runtime seam matches the rest of the AI stack: Workers AI on Cloudflare
 * (default llama-4-scout, the model already exercised by Scan Bay), local
 * Ollama on Node self-host / dev. `ASK_MODEL` overrides either side. A
 * missing backend returns null and the ask page shows sources without a
 * synthesized answer.
 */

import {
  getWorkersAi,
  isDevRuntime,
  workersAiText,
} from "~/ai/workers-ai.server";

const DEFAULT_WORKERS_ASK_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
const DEFAULT_OLLAMA_ASK_MODEL = "qwen3-vl:8b";

/** The slice of an AskSource the model needs to ground its answer. */
export type AnswerSource = {
  sourceType: "log" | "document";
  title: string;
  vehicleName: string;
  date: Date | null;
  snippet: string;
};

/** Exported for tests. */
export function buildAnswerPrompt(
  question: string,
  sources: AnswerSource[],
  today: Date = new Date(),
): string {
  const numbered = sources
    .map((s, i) => {
      const date = s.date ? s.date.toISOString().slice(0, 10) : "undated";
      const kind = s.sourceType === "log" ? "Service log" : "Document";
      return `[${i + 1}] ${kind} — ${s.vehicleName} — ${date} — ${s.title}\n${s.snippet}`;
    })
    .join("\n\n");
  return (
    `You are the assistant for Logbook, a vehicle maintenance record app. ` +
    `Answer the user's question using ONLY the numbered sources below, which ` +
    `come from their own service logs and vehicle documents. Cite every fact ` +
    `with its source number in square brackets, like [1] or [2][3]. If the ` +
    `sources don't contain the answer, say so plainly — do not guess. Keep ` +
    `the answer to a few sentences. Today's date is ` +
    `${today.toISOString().slice(0, 10)}.\n\n` +
    `Sources:\n\n${numbered}\n\nQuestion: ${question}`
  );
}

// Workers AI error 5016: Meta-licensed models need a one-time, per-account
// license acceptance (submitting the literal prompt "agree"). Same check as
// ~/scan/extract.server, kept local so the ask stack doesn't import the scan
// module graph.
function isLicenseAgreementError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /\b5016\b|prompt 'agree'|submit(?:ting)? 'agree'/i.test(message);
}

async function answerWithOllama(prompt: string): Promise<string | null> {
  const host = process.env.OLLAMA_HOST ?? "http://localhost:11434";
  const model = process.env.ASK_MODEL ?? DEFAULT_OLLAMA_ASK_MODEL;
  const res = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [{ role: "user", content: prompt }],
      options: { temperature: 0.2 },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Ollama ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`,
    );
  }
  const data = (await res.json()) as {
    message?: { content?: string };
    error?: string;
  };
  if (data.error) throw new Error(`Ollama error: ${data.error}`);
  const text = data.message?.content?.trim();
  return text ? text : null;
}

/**
 * Generate a cited answer, or null when no text-generation backend is
 * reachable (the caller still shows the retrieved sources). Never throws.
 */
export async function generateAnswer(
  question: string,
  sources: AnswerSource[],
): Promise<string | null> {
  if (sources.length === 0) return null;
  const prompt = buildAnswerPrompt(question, sources);

  const workersAi = await getWorkersAi();
  if (workersAi) {
    const model = workersAi.envVar("ASK_MODEL") ?? DEFAULT_WORKERS_ASK_MODEL;
    const run = () =>
      workersAi.ai.run(model, {
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 1024,
      });
    try {
      const text = workersAiText(await run());
      if (text?.trim()) return text.trim();
    } catch (err) {
      if (isLicenseAgreementError(err)) {
        try {
          await workersAi.ai.run(model, { prompt: "agree" });
          const text = workersAiText(await run());
          if (text?.trim()) return text.trim();
        } catch {
          // fall through to the Ollama attempt / null
        }
      }
    }
    // On deployed Workers there is no localhost Ollama to try.
    if (!isDevRuntime()) return null;
  }

  try {
    return await answerWithOllama(prompt);
  } catch {
    return null;
  }
}
