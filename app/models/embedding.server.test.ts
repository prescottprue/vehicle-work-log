import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { EmbeddingBackend } from "~/ai/embeddings.server";
import { EMBEDDING_DIMENSIONS } from "~/ai/embeddings.server";
import { createDb } from "~/db/client";
import { embeddings, users, vehicleDocuments } from "~/db/schema";
import {
  type AskSource,
  rrfMerge,
  semanticSearch,
  syncEmbeddings,
} from "~/models/embedding.server";
import { createLog } from "~/models/log.server";
import { createVehicle } from "~/models/vehicle.server";

// Integration test — requires DATABASE_URL pointing at a running local
// Postgres with migrations applied (pgvector).

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL is required for embedding.server.test.ts");

const { db, close } = createDb(url);

/**
 * Deterministic embedder: each known keyword maps to a basis dimension, so
 * cosine similarity is exact keyword overlap — no model required.
 */
const AXES = ["brake", "oil", "tire", "coolant", "registration"];
function fakeBackend(model = "fake:v1"): EmbeddingBackend {
  return {
    model,
    async embed(texts) {
      return texts.map((text) => {
        const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
        const lower = text.toLowerCase();
        let hit = false;
        AXES.forEach((word, i) => {
          if (lower.includes(word)) {
            v[i] = 1;
            hit = true;
          }
        });
        if (!hit) v[EMBEDDING_DIMENSIONS - 1] = 1;
        return v;
      });
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let userId: string;
let vehicleId: string;

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({ email: `ask-test-${Date.now()}@example.com` })
    .returning();
  if (!user) throw new Error("user insert failed");
  userId = user.id;

  const vehicle = await createVehicle({
    userId,
    make: "Jeep",
    model: "Wrangler",
    year: 2024,
  });
  vehicleId = vehicle.id;
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, userId));
  await close();
});

describe("syncEmbeddings", () => {
  it("indexes missing logs and documents, then reports a clean index", async () => {
    const backend = fakeBackend();
    await createLog({
      userId,
      vehicleId,
      title: "Oil change",
      notes: "Synthetic 5W-30, filter too",
    });
    await db.insert(vehicleDocuments).values({
      vehicleId,
      path: `test/${Date.now()}-registration.jpg`,
      contentType: "image/jpeg",
      originalName: "registration.jpg",
      kind: "registration",
      extractedText: "Registration valid through 2027",
      uploadedById: userId,
    });

    const first = await syncEmbeddings({ userId, backend });
    expect(first.available).toBe(true);
    expect(first.indexed).toBeGreaterThanOrEqual(2);
    expect(first.pending).toBe(0);

    const second = await syncEmbeddings({ userId, backend });
    expect(second.indexed).toBe(0);
    expect(second.pending).toBe(0);
  });

  it("re-embeds a log after it is updated", async () => {
    const backend = fakeBackend();
    const log = await createLog({
      userId,
      vehicleId,
      title: "Tire rotation",
      notes: null,
    });
    await syncEmbeddings({ userId, backend });

    // updatedAt has ms precision — make sure the edit lands strictly later.
    await sleep(10);
    const { logs } = await import("~/db/schema");
    await db
      .update(logs)
      .set({ notes: "Rotated and balanced all four tires" })
      .where(eq(logs.id, log.id));

    const sync = await syncEmbeddings({ userId, backend });
    expect(sync.indexed).toBeGreaterThanOrEqual(1);
    const [row] = await db
      .select()
      .from(embeddings)
      .where(eq(embeddings.logId, log.id));
    expect(row?.content).toContain("balanced all four");
  });

  it("re-embeds everything when the backend model changes", async () => {
    await syncEmbeddings({ userId, backend: fakeBackend("fake:v1") });
    const sync = await syncEmbeddings({
      userId,
      backend: fakeBackend("fake:v2"),
    });
    expect(sync.indexed).toBeGreaterThanOrEqual(1);
    expect(sync.pending).toBe(0);
  });

  it("counts pending without embedding when limit is 0", async () => {
    await createLog({ userId, vehicleId, title: "Coolant flush" });
    const status = await syncEmbeddings({
      userId,
      limit: 0,
      backend: fakeBackend("fake:v3"),
    });
    expect(status.indexed).toBe(0);
    expect(status.pending).toBeGreaterThanOrEqual(1);
    // Clean up for later tests: bring the index current on v1 again.
    await syncEmbeddings({ userId, backend: fakeBackend() });
  });

  it("reports unavailable with a null backend", async () => {
    const status = await syncEmbeddings({ userId, backend: null });
    expect(status).toEqual({ available: false, indexed: 0, pending: 0 });
  });
});

describe("semanticSearch", () => {
  it("ranks vector matches for the query's meaning first", async () => {
    const backend = fakeBackend();
    await syncEmbeddings({ userId, backend });
    const results = await semanticSearch({ userId, query: "oil", backend });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.title).toBe("Oil change");
  });

  it("finds documents too", async () => {
    const backend = fakeBackend();
    await syncEmbeddings({ userId, backend });
    const results = await semanticSearch({
      userId,
      query: "registration",
      backend,
    });
    expect(
      results.some(
        (r) => r.sourceType === "document" && r.title === "registration.jpg",
      ),
    ).toBe(true);
  });

  it("degrades to keyword search without a backend", async () => {
    const results = await semanticSearch({
      userId,
      query: "synthetic",
      backend: null,
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("Oil change");
    expect(results[0]?.sourceType).toBe("log");
  });

  it("returns nothing for blank queries", async () => {
    expect(
      await semanticSearch({ userId, query: "  ", backend: null }),
    ).toEqual([]);
  });

  it("never returns another user's vehicles", async () => {
    const [other] = await db
      .insert(users)
      .values({ email: `ask-other-${Date.now()}@example.com` })
      .returning();
    if (!other) throw new Error("other user insert failed");
    try {
      const otherVehicle = await createVehicle({
        userId: other.id,
        make: "Ford",
        model: "Bronco",
        year: 2023,
      });
      await createLog({
        userId: other.id,
        vehicleId: otherVehicle.id,
        title: "Secret coolant flush",
        notes: "coolant everywhere",
      });
      const backend = fakeBackend();
      // Index runs as the *other* user (their own vehicles)…
      await syncEmbeddings({ userId: other.id, backend });
      // …but searching as our user must not see them, on any leg.
      const results = await semanticSearch({
        userId,
        query: "Secret coolant flush",
        backend,
      });
      expect(results.every((r) => r.vehicleId === vehicleId)).toBe(true);
      expect(results.some((r) => r.title.includes("Secret"))).toBe(false);
    } finally {
      await db.delete(users).where(eq(users.id, other.id));
    }
  });
});

describe("rrfMerge", () => {
  const src = (id: string): AskSource => ({
    sourceType: "log",
    sourceId: id,
    vehicleId: "v",
    vehicleName: "Jeep",
    title: id,
    date: null,
    snippet: "",
  });

  it("ranks items found by multiple legs above single-leg items", () => {
    const merged = rrfMerge(
      [
        [src("a"), src("b"), src("c")],
        [src("c"), src("d")],
      ],
      10,
    );
    expect(merged.map((s) => s.sourceId)[0]).toBe("c");
    expect(merged).toHaveLength(4);
  });

  it("deduplicates and respects the limit", () => {
    const merged = rrfMerge([[src("a"), src("b")], [src("a")]], 1);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.sourceId).toBe("a");
  });
});
