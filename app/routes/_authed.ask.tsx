import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { generateAnswer } from "~/ai/answer.server";
import { requireAuth } from "~/auth/session.server";
import { formatDateOnly } from "~/components/format";
import { btnPrimary, card, errorBox, input } from "~/components/ui";
import type { AskSource } from "~/models/embedding.server";
import { semanticSearch, syncEmbeddings } from "~/models/embedding.server";

/**
 * Index status without embedding anything: syncEmbeddings with limit 0 only
 * runs the stale-row counts.
 */
const askStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireAuth();
  const status = await syncEmbeddings({ userId, limit: 0 });
  return { available: status.available, pending: status.pending };
});

const askFn = createServerFn({ method: "POST" })
  .inputValidator((data: { question: string }) => data)
  .handler(async ({ data }) => {
    const userId = await requireAuth();
    const question = data.question.trim().slice(0, 500);
    if (!question) return { error: "Ask a question first" };

    // Bring the index up to date before searching. Bounded so one request
    // never chews through an unbounded backlog: 4 × 32 sources covers a
    // typical full history on the first ask; anything left keeps healing on
    // subsequent asks.
    let sync = await syncEmbeddings({ userId, limit: 32 });
    for (let i = 0; i < 3 && sync.available && sync.pending > 0; i++) {
      sync = await syncEmbeddings({ userId, limit: 32 });
    }

    const sources = await semanticSearch({ userId, query: question, limit: 8 });
    const answer =
      sources.length > 0 ? await generateAnswer(question, sources) : null;
    return {
      answer,
      sources,
      semantic: sync.available,
      pending: sync.available ? sync.pending : 0,
    };
  });

export const Route = createFileRoute("/_authed/ask")({
  component: AskPage,
  loader: () => askStatusFn(),
});

const EXAMPLE_QUESTIONS = [
  "When was the last oil change?",
  "How much have we spent on tires?",
  "What brand of brake pads did we install?",
  "Is the registration current?",
];

/** Serialized-over-the-wire AskSource (dates arrive as ISO strings). */
type WireSource = Omit<AskSource, "date"> & { date: string | null };

function sourceHref(source: WireSource): {
  to: string;
  params: Record<string, string>;
} {
  return source.sourceType === "log"
    ? {
        to: "/vehicles/$vehicleId/logs/$logId",
        params: { vehicleId: source.vehicleId, logId: source.sourceId },
      }
    : {
        to: "/vehicles/$vehicleId/documents",
        params: { vehicleId: source.vehicleId },
      };
}

/** Render answer text with [n] citations turned into links to their source. */
function CitedAnswer({
  answer,
  sources,
}: {
  answer: string;
  sources: WireSource[];
}) {
  const parts = answer.split(/(\[\d+\])/g);
  return (
    <p className="whitespace-pre-wrap text-ink">
      {parts.map((part, i) => {
        const match = /^\[(\d+)\]$/.exec(part);
        const source = match ? sources[Number(match[1]) - 1] : undefined;
        if (!match || !source) {
          // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
          return <span key={i}>{part}</span>;
        }
        const { to, params } = sourceHref(source);
        return (
          <Link
            // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
            key={i}
            to={to}
            params={params}
            className="font-semibold text-accent hover:underline"
            title={source.title}
          >
            {part}
          </Link>
        );
      })}
    </p>
  );
}

type AskResult = {
  answer: string | null;
  sources: WireSource[];
  semantic: boolean;
  pending: number;
};

function AskPage() {
  const status = Route.useLoaderData();
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed || asking) return;
    setError(null);
    setAsking(true);
    try {
      const res = await askFn({ data: { question: trimmed } });
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      setResult(res as AskResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setAsking(false);
    }
  }

  return (
    <section className="mx-auto max-w-2xl space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-ink">Ask your Logbook</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Questions are answered from your own service logs and vehicle
          documents — every claim links back to its source.
        </p>
      </header>

      <form
        className={`${card} space-y-3 p-5`}
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <label className="block">
          <span className="sr-only">Your question</span>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="When did we last flush the coolant?"
            className={`${input} mt-0`}
            maxLength={500}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={asking} className={btnPrimary}>
            {asking ? "Searching your logbook…" : "Ask"}
          </button>
          {!status.available ? (
            <span className="text-xs text-ink-muted">
              AI backend unreachable — keyword search only.
            </span>
          ) : status.pending > 0 ? (
            <span className="text-xs text-ink-muted">
              {status.pending} entr{status.pending === 1 ? "y" : "ies"} not yet
              indexed — they'll be picked up when you ask.
            </span>
          ) : null}
        </div>
        {result == null && !asking ? (
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            {EXAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                className="rounded-full border border-line bg-sunken px-3 py-1.5 text-xs font-semibold text-ink-muted transition-colors hover:text-ink"
                onClick={() => {
                  setQuestion(q);
                  void ask(q);
                }}
              >
                {q}
              </button>
            ))}
          </div>
        ) : null}
      </form>

      {error ? <p className={errorBox}>{error}</p> : null}

      {result ? (
        <div className="space-y-4">
          {result.answer ? (
            <div className={`${card} p-5`}>
              <CitedAnswer answer={result.answer} sources={result.sources} />
            </div>
          ) : result.sources.length > 0 ? (
            <p className="text-sm text-ink-muted">
              {result.semantic
                ? "Couldn't generate an answer — here's what matched:"
                : "AI answer unavailable — here's what matched your keywords:"}
            </p>
          ) : (
            <p className="text-sm text-ink-muted">
              Nothing in the logbook matches that. Try different words
              {result.pending > 0
                ? ", or ask again — some entries are still being indexed"
                : ""}
              .
            </p>
          )}

          {result.sources.length > 0 ? (
            <div className={`${card} p-5`}>
              <h2 className="font-bold text-ink">Sources</h2>
              <ol className="mt-3 space-y-3">
                {result.sources.map((source, i) => {
                  const { to, params } = sourceHref(source);
                  return (
                    <li
                      key={`${source.sourceType}-${source.sourceId}`}
                      className="flex gap-3"
                    >
                      <span className="mt-0.5 shrink-0 text-sm font-bold tabular-nums text-ink-muted">
                        [{i + 1}]
                      </span>
                      <div className="min-w-0">
                        <Link
                          to={to}
                          params={params}
                          className="font-semibold text-accent hover:underline"
                        >
                          {source.title}
                        </Link>
                        <p className="text-xs text-ink-muted">
                          {source.sourceType === "log" ? "Log" : "Document"} ·{" "}
                          {source.vehicleName}
                          {source.date
                            ? ` · ${formatDateOnly(new Date(source.date))}`
                            : ""}
                        </p>
                        <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-ink-muted">
                          {source.snippet}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
