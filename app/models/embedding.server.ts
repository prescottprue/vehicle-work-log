/**
 * Ask your Logbook — lazy semantic index + hybrid retrieval.
 *
 * There are no write-path hooks: the index maintains itself on read.
 * `syncEmbeddings` finds logs/documents that are missing an embedding, were
 * updated after their embedding, or were embedded by a different model than
 * the active backend, and (re-)embeds a batch of them. Called before every
 * search, so the index heals after edits, imports, and backend/model swaps
 * without any coupling in the write paths.
 *
 * `semanticSearch` fuses the vector leg (pgvector cosine over the embeddings
 * table) with the existing FTS legs (logs + vehicle documents tsvector
 * indexes) via reciprocal-rank fusion. With no embedding backend reachable it
 * degrades to keyword-only — the ask page still works, just without recall on
 * paraphrased questions.
 *
 * Access control: every leg joins vehicle_members on the requesting userId,
 * same as the rest of the model layer.
 */

import { and, cosineDistance, desc, eq, lt, ne, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import type { EmbeddingBackend } from "~/ai/embeddings.server";
import { getEmbeddingBackend } from "~/ai/embeddings.server";
import { getDb } from "~/db/client";
import type { Log, VehicleDocument } from "~/db/schema";
import {
  embeddings,
  logs,
  mechanics,
  vehicleDocuments,
  vehicleMembers,
  vehicles,
} from "~/db/schema";
import { documentKindLabel } from "~/models/document.shared";

/** bge-base / nomic-embed truncate around 512 tokens; don't waste the window. */
const EMBED_MAX_CHARS = 2000;
const SNIPPET_MAX_CHARS = 400;

/** Vehicle display name matching the UI convention (name or "year make model"). */
const vehicleDisplayName = sql<string>`coalesce(${vehicles.name}, ${vehicles.year} || ' ' || ${vehicles.make} || ' ' || ${vehicles.model})`;

export type AskSource = {
  sourceType: "log" | "document";
  sourceId: string;
  vehicleId: string;
  vehicleName: string;
  title: string;
  date: Date | null;
  snippet: string;
};

/** The text embedded for a log. Exported for tests. */
export function logEmbeddingText(
  log: Pick<
    Log,
    | "title"
    | "notes"
    | "type"
    | "servicedAt"
    | "cost"
    | "odometer"
    | "selfService"
  >,
  vehicleName: string,
  mechanicName: string | null,
): string {
  const facts = [
    log.servicedAt ? log.servicedAt.toISOString().slice(0, 10) : null,
    log.type,
    log.cost != null ? `$${log.cost}` : null,
    log.odometer != null ? `${Math.round(log.odometer)} mi` : null,
    log.selfService
      ? "self service"
      : mechanicName
        ? `shop: ${mechanicName}`
        : null,
  ].filter(Boolean);
  const text = `${vehicleName} — ${log.title}\n${facts.join(" · ")}\n${log.notes ?? ""}`;
  return text.trim().slice(0, EMBED_MAX_CHARS);
}

/** The text embedded for a vehicle document. Exported for tests. */
export function documentEmbeddingText(
  doc: Pick<
    VehicleDocument,
    "label" | "originalName" | "kind" | "extractedText"
  >,
  vehicleName: string,
): string {
  const title = doc.label || doc.originalName || "Document";
  const text = `${vehicleName} — ${title} (${documentKindLabel(doc.kind)})\n${doc.extractedText ?? ""}`;
  return text.trim().slice(0, EMBED_MAX_CHARS);
}

export type SyncResult = {
  /** False when no embedding backend is reachable (keyword-only mode). */
  available: boolean;
  model?: string;
  /** Rows (re-)embedded by this call. */
  indexed: number;
  /** Stale/missing rows remaining after this call. */
  pending: number;
};

/** Stale = no embedding, source updated after embedding, or other model. */
function staleAgainst(model: string, sourceUpdatedAt: AnyPgColumn) {
  return or(
    sql`${embeddings.id} is null`,
    lt(embeddings.updatedAt, sourceUpdatedAt),
    ne(embeddings.model, model),
  );
}

/**
 * Bring the semantic index up to date for every vehicle `userId` can access,
 * embedding at most `limit` sources per call. Callers loop while `pending`
 * is positive (and they have time budget left).
 */
export async function syncEmbeddings({
  userId,
  limit = 32,
  backend,
}: {
  userId: string;
  limit?: number;
  /** Override the embedding backend (tests). */
  backend?: EmbeddingBackend | null;
}): Promise<SyncResult> {
  const resolved =
    backend !== undefined ? backend : await getEmbeddingBackend();
  if (!resolved) return { available: false, indexed: 0, pending: 0 };
  const db = await getDb();

  const memberJoin = (vehicleId: AnyPgColumn) =>
    and(
      eq(vehicleMembers.vehicleId, vehicleId),
      eq(vehicleMembers.userId, userId),
    );

  const staleLogRows = await db
    .select({
      log: logs,
      vehicleName: vehicleDisplayName,
      mechanicName: mechanics.name,
    })
    .from(logs)
    .innerJoin(vehicleMembers, memberJoin(logs.vehicleId))
    .innerJoin(vehicles, eq(vehicles.id, logs.vehicleId))
    .leftJoin(mechanics, eq(mechanics.id, logs.mechanicId))
    .leftJoin(embeddings, eq(embeddings.logId, logs.id))
    .where(staleAgainst(resolved.model, logs.updatedAt))
    .limit(limit);

  const docBudget = limit - staleLogRows.length;
  const staleDocRows =
    docBudget > 0
      ? await db
          .select({ doc: vehicleDocuments, vehicleName: vehicleDisplayName })
          .from(vehicleDocuments)
          .innerJoin(vehicleMembers, memberJoin(vehicleDocuments.vehicleId))
          .innerJoin(vehicles, eq(vehicles.id, vehicleDocuments.vehicleId))
          .leftJoin(embeddings, eq(embeddings.documentId, vehicleDocuments.id))
          .where(staleAgainst(resolved.model, vehicleDocuments.updatedAt))
          .limit(docBudget)
      : [];

  const logTexts = staleLogRows.map((r) =>
    logEmbeddingText(r.log, r.vehicleName, r.mechanicName),
  );
  const docTexts = staleDocRows.map((r) =>
    documentEmbeddingText(r.doc, r.vehicleName),
  );
  const texts = [...logTexts, ...docTexts];

  if (texts.length > 0) {
    const vectors = await resolved.embed(texts);
    const now = new Date();
    const logValues = staleLogRows.map((r, i) => ({
      vehicleId: r.log.vehicleId,
      logId: r.log.id,
      content: logTexts[i] as string,
      model: resolved.model,
      embedding: vectors[i] as number[],
    }));
    const docValues = staleDocRows.map((r, i) => ({
      vehicleId: r.doc.vehicleId,
      documentId: r.doc.id,
      content: docTexts[i] as string,
      model: resolved.model,
      embedding: vectors[staleLogRows.length + i] as number[],
    }));
    if (logValues.length > 0) {
      await db
        .insert(embeddings)
        .values(logValues)
        .onConflictDoUpdate({
          target: embeddings.logId,
          set: {
            content: sql`excluded.content`,
            model: sql`excluded.model`,
            embedding: sql`excluded.embedding`,
            updatedAt: now,
          },
        });
    }
    if (docValues.length > 0) {
      await db
        .insert(embeddings)
        .values(docValues)
        .onConflictDoUpdate({
          target: embeddings.documentId,
          set: {
            content: sql`excluded.content`,
            model: sql`excluded.model`,
            embedding: sql`excluded.embedding`,
            updatedAt: now,
          },
        });
    }
  }

  const [logPending] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(logs)
    .innerJoin(vehicleMembers, memberJoin(logs.vehicleId))
    .leftJoin(embeddings, eq(embeddings.logId, logs.id))
    .where(staleAgainst(resolved.model, logs.updatedAt));
  const [docPending] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(vehicleDocuments)
    .innerJoin(vehicleMembers, memberJoin(vehicleDocuments.vehicleId))
    .leftJoin(embeddings, eq(embeddings.documentId, vehicleDocuments.id))
    .where(staleAgainst(resolved.model, vehicleDocuments.updatedAt));

  return {
    available: true,
    model: resolved.model,
    indexed: texts.length,
    pending: (logPending?.count ?? 0) + (docPending?.count ?? 0),
  };
}

function sourceKey(s: AskSource): string {
  return `${s.sourceType}:${s.sourceId}`;
}

/**
 * Reciprocal-rank fusion over ranked result lists (k=60, the standard
 * constant). Pure; exported for tests.
 */
export function rrfMerge(
  lists: AskSource[][],
  limit: number,
  k = 60,
): AskSource[] {
  const scores = new Map<string, { source: AskSource; score: number }>();
  for (const list of lists) {
    list.forEach((source, rank) => {
      const key = sourceKey(source);
      const entry = scores.get(key) ?? { source, score: 0 };
      entry.score += 1 / (k + rank + 1);
      scores.set(key, entry);
    });
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((e) => e.source);
}

function toSnippet(content: string): string {
  return content.length > SNIPPET_MAX_CHARS
    ? `${content.slice(0, SNIPPET_MAX_CHARS)}…`
    : content;
}

/**
 * Hybrid search over every log and vehicle document the user can access.
 * Vector leg (when a backend is reachable) + FTS legs, fused with RRF.
 */
export async function semanticSearch({
  userId,
  query,
  limit = 8,
  backend,
}: {
  userId: string;
  query: string;
  limit?: number;
  /** Override the embedding backend (tests). */
  backend?: EmbeddingBackend | null;
}): Promise<AskSource[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const db = await getDb();
  const perLeg = Math.max(limit, 10);

  const legs: AskSource[][] = [];

  const resolved =
    backend !== undefined ? backend : await getEmbeddingBackend();
  if (resolved) {
    try {
      const [queryVector] = await resolved.embed([trimmed]);
      if (queryVector) {
        const rows = await db
          .select({
            e: embeddings,
            vehicleName: vehicleDisplayName,
            logTitle: logs.title,
            logDate: logs.servicedAt,
            docLabel: vehicleDocuments.label,
            docName: vehicleDocuments.originalName,
            docDate: vehicleDocuments.createdAt,
          })
          .from(embeddings)
          .innerJoin(
            vehicleMembers,
            and(
              eq(vehicleMembers.vehicleId, embeddings.vehicleId),
              eq(vehicleMembers.userId, userId),
            ),
          )
          .innerJoin(vehicles, eq(vehicles.id, embeddings.vehicleId))
          .leftJoin(logs, eq(logs.id, embeddings.logId))
          .leftJoin(
            vehicleDocuments,
            eq(vehicleDocuments.id, embeddings.documentId),
          )
          .where(eq(embeddings.model, resolved.model))
          .orderBy(cosineDistance(embeddings.embedding, queryVector))
          .limit(perLeg);
        legs.push(
          rows.map((r) => ({
            sourceType: r.e.logId ? ("log" as const) : ("document" as const),
            sourceId: (r.e.logId ?? r.e.documentId) as string,
            vehicleId: r.e.vehicleId,
            vehicleName: r.vehicleName,
            title: r.logTitle ?? r.docLabel ?? r.docName ?? "Document",
            date: r.logDate ?? r.docDate ?? null,
            snippet: toSnippet(r.e.content),
          })),
        );
      }
    } catch {
      // Backend died between probe and query — keyword legs still run.
    }
  }

  const ftsLogs = await db
    .select({ log: logs, vehicleName: vehicleDisplayName })
    .from(logs)
    .innerJoin(
      vehicleMembers,
      and(
        eq(vehicleMembers.vehicleId, logs.vehicleId),
        eq(vehicleMembers.userId, userId),
      ),
    )
    .innerJoin(vehicles, eq(vehicles.id, logs.vehicleId))
    .where(
      sql`${logs.searchTsv} @@ websearch_to_tsquery('english', ${trimmed})`,
    )
    .orderBy(desc(logs.servicedAt))
    .limit(perLeg);
  legs.push(
    ftsLogs.map((r) => ({
      sourceType: "log" as const,
      sourceId: r.log.id,
      vehicleId: r.log.vehicleId,
      vehicleName: r.vehicleName,
      title: r.log.title,
      date: r.log.servicedAt,
      snippet: toSnippet(`${r.log.title}\n${r.log.notes ?? ""}`.trim()),
    })),
  );

  const ftsDocs = await db
    .select({ doc: vehicleDocuments, vehicleName: vehicleDisplayName })
    .from(vehicleDocuments)
    .innerJoin(
      vehicleMembers,
      and(
        eq(vehicleMembers.vehicleId, vehicleDocuments.vehicleId),
        eq(vehicleMembers.userId, userId),
      ),
    )
    .innerJoin(vehicles, eq(vehicles.id, vehicleDocuments.vehicleId))
    .where(
      sql`${vehicleDocuments.searchTsv} @@ websearch_to_tsquery('english', ${trimmed})`,
    )
    .orderBy(desc(vehicleDocuments.createdAt))
    .limit(perLeg);
  legs.push(
    ftsDocs.map((r) => ({
      sourceType: "document" as const,
      sourceId: r.doc.id,
      vehicleId: r.doc.vehicleId,
      vehicleName: r.vehicleName,
      title: r.doc.label || r.doc.originalName || "Document",
      date: r.doc.createdAt,
      snippet: toSnippet(
        `${r.doc.label || r.doc.originalName || "Document"}\n${r.doc.extractedText ?? ""}`.trim(),
      ),
    })),
  );

  return rrfMerge(legs, limit);
}
