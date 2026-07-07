import {
  createFileRoute,
  getRouteApi,
  useRouter,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";

import { requireAuth } from "~/auth/session.server";
import { DocumentScanner } from "~/components/DocumentScanner";
import { formatDateOnly } from "~/components/format";
import { ImageCropper } from "~/components/ImageCropper";
import {
  btnPrimary,
  btnSecondary,
  card,
  errorBox,
  input,
  label as labelClass,
} from "~/components/ui";
import { flattenSupported } from "~/lib/document-scan";
import {
  addVehicleDocument,
  listVehicleDocuments,
  removeVehicleDocument,
  searchVehicleDocuments,
  updateVehicleDocument,
} from "~/models/document.server";
import { DOCUMENT_KINDS, documentKindLabel } from "~/models/document.shared";
import { updatePurchase } from "~/models/vehicle.server";

const parentApi = getRouteApi("/_authed/vehicles/$vehicleId");

const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;

const loadDocumentsFn = createServerFn({ method: "GET" })
  .inputValidator((data: { vehicleId: string; q: string }) => data)
  .handler(async ({ data }) => {
    const userId = await requireAuth();
    const documents = data.q.trim()
      ? await searchVehicleDocuments({
          vehicleId: data.vehicleId,
          userId,
          query: data.q,
        })
      : await listVehicleDocuments({ vehicleId: data.vehicleId, userId });
    return { documents, userId };
  });

const savePurchaseFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      vehicleId: string;
      purchasedAt: string;
      purchasePrice: string;
      purchaseOdometer: string;
      seller: string;
      purchaseNote: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const userId = await requireAuth();
    try {
      const purchasedAt = data.purchasedAt ? new Date(data.purchasedAt) : null;
      const price = Number.parseFloat(data.purchasePrice);
      const odometer = Number.parseFloat(data.purchaseOdometer);
      await updatePurchase({
        id: data.vehicleId,
        userId,
        purchasedAt:
          purchasedAt && !Number.isNaN(purchasedAt.getTime())
            ? purchasedAt
            : null,
        purchasePrice: Number.isFinite(price) ? price : null,
        purchaseOdometer: Number.isFinite(odometer) ? odometer : null,
        seller: data.seller || null,
        purchaseNote: data.purchaseNote || null,
      });
      return {};
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "Failed to save details",
      };
    }
  });

const uploadDocumentFn = createServerFn({ method: "POST" })
  .inputValidator((data: FormData) => data)
  .handler(async ({ data }) => {
    const userId = await requireAuth();
    const vehicleId = String(data.get("vehicleId") ?? "");
    if (!vehicleId) return { error: "Missing vehicle" };
    const kind = String(data.get("kind") ?? "other");
    const label = String(data.get("label") ?? "");

    const files = data
      .getAll("files")
      .filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) return { error: "No files selected" };
    for (const file of files) {
      if (file.size > MAX_DOCUMENT_BYTES) {
        return { error: `${file.name} is too large (12 MB max)` };
      }
      if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
        return { error: `${file.name}: only images and PDFs` };
      }
    }

    for (const file of files) {
      await addVehicleDocument({
        vehicleId,
        userId,
        body: new Uint8Array(await file.arrayBuffer()),
        contentType: file.type,
        originalName: file.name,
        kind,
        label,
      });
    }
    return { count: files.length };
  });

const retagDocumentFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { vehicleId: string; id: string; kind: string }) => data,
  )
  .handler(async ({ data }) => {
    const userId = await requireAuth();
    await updateVehicleDocument({
      id: data.id,
      vehicleId: data.vehicleId,
      userId,
      kind: data.kind,
    });
  });

const deleteDocumentFn = createServerFn({ method: "POST" })
  .inputValidator((data: { vehicleId: string; id: string }) => data)
  .handler(async ({ data }) => {
    const userId = await requireAuth();
    await removeVehicleDocument({
      id: data.id,
      vehicleId: data.vehicleId,
      userId,
    });
  });

export const Route = createFileRoute("/_authed/vehicles/$vehicleId/documents")({
  component: DocumentsPage,
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : "",
  }),
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: async ({ params, deps }) =>
    loadDocumentsFn({ data: { vehicleId: params.vehicleId, q: deps.q } }),
});

/** A Date or null as a YYYY-MM-DD value for <input type="date">. */
function dateInputValue(d: Date | null): string {
  return d ? new Date(d).toISOString().slice(0, 10) : "";
}

function PurchasePanel({
  vehicleId,
  isOwner,
}: {
  vehicleId: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const v = parentApi.useLoaderData();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const hasDetails =
    v.purchasedAt != null ||
    v.purchasePrice != null ||
    v.purchaseOdometer != null ||
    v.seller != null ||
    v.purchaseNote != null;

  async function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const fd = new FormData(e.currentTarget);
    try {
      const result = await savePurchaseFn({
        data: {
          vehicleId,
          purchasedAt: String(fd.get("purchasedAt") ?? ""),
          purchasePrice: String(fd.get("purchasePrice") ?? ""),
          purchaseOdometer: String(fd.get("purchaseOdometer") ?? ""),
          seller: String(fd.get("seller") ?? "").trim(),
          purchaseNote: String(fd.get("purchaseNote") ?? "").trim(),
        },
      });
      if (result && "error" in result && result.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
      await router.invalidate();
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={`${card} p-5`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-bold text-ink">Purchase details</h2>
        {isOwner && !editing ? (
          <button
            type="button"
            className="text-sm font-semibold text-accent hover:underline"
            onClick={() => setEditing(true)}
          >
            {hasDetails ? "Edit" : "Add"}
          </button>
        ) : null}
      </div>

      {editing ? (
        <form onSubmit={onSave} className="mt-3 space-y-3">
          {error ? <p className={errorBox}>{error}</p> : null}
          <div className="grid grid-cols-2 gap-3">
            <label className={labelClass}>
              Purchase date
              <input
                type="date"
                name="purchasedAt"
                defaultValue={dateInputValue(v.purchasedAt)}
                className={input}
              />
            </label>
            <label className={labelClass}>
              Price ($)
              <input
                type="number"
                name="purchasePrice"
                step="0.01"
                min="0"
                inputMode="decimal"
                defaultValue={v.purchasePrice ?? ""}
                className={`${input} tabular-nums`}
              />
            </label>
            <label className={labelClass}>
              Odometer at purchase
              <input
                type="number"
                name="purchaseOdometer"
                step="1"
                min="0"
                inputMode="numeric"
                defaultValue={v.purchaseOdometer ?? ""}
                className={`${input} tabular-nums`}
              />
            </label>
            <label className={labelClass}>
              Seller
              <input
                name="seller"
                defaultValue={v.seller ?? ""}
                placeholder="Dealer or private party"
                className={input}
              />
            </label>
          </div>
          <label className={labelClass}>
            Note (optional)
            <input
              name="purchaseNote"
              defaultValue={v.purchaseNote ?? ""}
              placeholder="Out-the-door price included new tires"
              className={input}
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={btnPrimary}>
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className={btnSecondary}
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : hasDetails ? (
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          {v.purchasedAt != null ? (
            <div>
              <dt className="text-ink-muted">Purchased</dt>
              <dd className="font-semibold text-ink">
                {formatDateOnly(v.purchasedAt)}
              </dd>
            </div>
          ) : null}
          {v.purchasePrice != null ? (
            <div>
              <dt className="text-ink-muted">Price</dt>
              <dd className="font-semibold tabular-nums text-ink">
                ${v.purchasePrice.toLocaleString()}
              </dd>
            </div>
          ) : null}
          {v.purchaseOdometer != null ? (
            <div>
              <dt className="text-ink-muted">Odometer at purchase</dt>
              <dd className="font-semibold tabular-nums text-ink">
                {Math.round(v.purchaseOdometer).toLocaleString()} mi
              </dd>
            </div>
          ) : null}
          {v.seller != null ? (
            <div>
              <dt className="text-ink-muted">Seller</dt>
              <dd className="font-semibold text-ink">{v.seller}</dd>
            </div>
          ) : null}
          {v.purchaseNote != null ? (
            <div className="col-span-2">
              <dt className="text-ink-muted">Note</dt>
              <dd className="text-ink">{v.purchaseNote}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">
          {isOwner
            ? "Record when and where you bought this vehicle, the price, and the odometer at purchase."
            : "No purchase details recorded yet."}
        </p>
      )}
    </section>
  );
}

function DocumentsPage() {
  const router = useRouter();
  const v = parentApi.useLoaderData();
  const { documents, userId } = Route.useLoaderData();
  const { q } = Route.useSearch();
  const navigate = Route.useNavigate();
  const isOwner = v.role === "owner";

  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<string>("purchase");
  const [docLabel, setDocLabel] = useState("");
  const [selected, setSelected] = useState<File[]>([]);
  const [cropIndex, setCropIndex] = useState<number | null>(null);
  const [scanIndex, setScanIndex] = useState<number | null>(null);
  // Post-hydration so SSR and first client render agree (no navigator on SSR).
  const [canFlatten, setCanFlatten] = useState(false);
  useEffect(() => setCanFlatten(flattenSupported()), []);

  function replaceSelected(index: number, next: File) {
    setSelected((prev) => prev.map((f, j) => (j === index ? next : f)));
  }
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(q);

  async function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (selected.length === 0) {
      setError("Choose a file to upload");
      return;
    }
    setError(null);
    setUploading(true);
    const fd = new FormData();
    fd.set("vehicleId", v.id);
    fd.set("kind", kind);
    fd.set("label", docLabel.trim());
    for (const file of selected) fd.append("files", file);
    try {
      const result = await uploadDocumentFn({ data: fd });
      if ("error" in result && result.error) {
        setError(result.error);
        return;
      }
      setDocLabel("");
      setSelected([]);
      if (fileRef.current) fileRef.current.value = "";
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function onSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    navigate({ search: { q: search.trim() } });
  }

  return (
    <section className="mx-auto max-w-2xl space-y-4">
      <PurchasePanel vehicleId={v.id} isOwner={isOwner} />

      <form onSubmit={onUpload} className={`${card} space-y-3 p-5`}>
        <h2 className="font-bold text-ink">Add a document</h2>
        <p className="text-sm text-ink-muted">
          Contracts, title, registration, insurance — images and PDFs. Photos
          are scanned so you can search the words inside them.
        </p>
        {error ? <p className={errorBox}>{error}</p> : null}
        <div className="grid grid-cols-2 gap-3">
          <label className={labelClass}>
            Type
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className={input}
            >
              {DOCUMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {documentKindLabel(k)}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Label (optional)
            <input
              value={docLabel}
              onChange={(e) => setDocLabel(e.target.value)}
              placeholder="2024 registration"
              className={input}
            />
          </label>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          onChange={(e) => {
            setSelected(Array.from(e.target.files ?? []));
            setError(null);
          }}
          className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-xl file:border-0 file:bg-sunken file:px-4 file:py-2 file:font-semibold file:text-ink"
        />
        {selected.length > 0 ? (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {selected.map((f, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: selection is a positional list, no stable id
                key={`${f.name}-${i}`}
                className="flex items-center gap-3 px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate text-ink">
                  {f.name}
                </span>
                {f.type.startsWith("image/") ? (
                  <>
                    {canFlatten ? (
                      <button
                        type="button"
                        className="shrink-0 font-semibold text-accent hover:underline"
                        onClick={() => setScanIndex(i)}
                      >
                        Scan
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="shrink-0 font-semibold text-accent hover:underline"
                      onClick={() => setCropIndex(i)}
                    >
                      Crop
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="shrink-0 font-semibold text-danger hover:underline"
                  onClick={() =>
                    setSelected((prev) => prev.filter((_, j) => j !== i))
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <button type="submit" disabled={uploading} className={btnPrimary}>
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </form>

      {scanIndex != null && selected[scanIndex] ? (
        <DocumentScanner
          file={selected[scanIndex]}
          onCancel={() => setScanIndex(null)}
          onConfirm={(flattened) => {
            replaceSelected(scanIndex, flattened);
            setScanIndex(null);
          }}
          onCropInstead={() => {
            setCropIndex(scanIndex);
            setScanIndex(null);
          }}
        />
      ) : null}

      {cropIndex != null && selected[cropIndex] ? (
        <ImageCropper
          file={selected[cropIndex]}
          onCancel={() => setCropIndex(null)}
          onConfirm={(cropped) => {
            replaceSelected(cropIndex, cropped);
            setCropIndex(null);
          }}
        />
      ) : null}

      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-bold text-ink">Documents</h2>
          <form onSubmit={onSearch} className="flex gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search words in scans…"
              aria-label="Search documents"
              className={`${input} mt-0 w-44 sm:w-56`}
            />
            <button type="submit" className={btnSecondary}>
              Search
            </button>
          </form>
        </div>

        {q ? (
          <p className="mt-2 text-xs text-ink-muted">
            {documents.length} result{documents.length === 1 ? "" : "s"} for “
            {q}”.{" "}
            <button
              type="button"
              className="font-semibold text-accent hover:underline"
              onClick={() => {
                setSearch("");
                navigate({ search: { q: "" } });
              }}
            >
              Clear
            </button>
          </p>
        ) : null}

        {documents.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">
            {q ? "No documents match that search." : "No documents yet."}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {documents.map((doc) => {
              const canDelete = isOwner || doc.uploadedById === userId;
              return (
                <li key={doc.id} className="flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <a
                      href={`/files/${doc.path}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-accent hover:underline"
                    >
                      {doc.label || doc.originalName || "Document"}
                    </a>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {formatDateOnly(doc.createdAt)}
                      {doc.uploaderName ? ` · ${doc.uploaderName}` : ""}
                      {doc.extractedText ? " · searchable" : ""}
                    </p>
                  </div>
                  {isOwner ? (
                    <select
                      value={doc.kind}
                      aria-label="Document type"
                      onChange={async (e) => {
                        await retagDocumentFn({
                          data: {
                            vehicleId: v.id,
                            id: doc.id,
                            kind: e.target.value,
                          },
                        });
                        await router.invalidate();
                      }}
                      className={`${input} mt-0 w-auto shrink-0 text-xs`}
                    >
                      {DOCUMENT_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {documentKindLabel(k)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="shrink-0 rounded-full bg-sunken px-3 py-1 text-xs font-semibold text-ink-muted">
                      {documentKindLabel(doc.kind)}
                    </span>
                  )}
                  {canDelete ? (
                    <button
                      type="button"
                      className="min-h-11 shrink-0 px-2 text-xs font-semibold text-danger hover:underline"
                      onClick={async () => {
                        if (!window.confirm("Delete this document?")) return;
                        await deleteDocumentFn({
                          data: { vehicleId: v.id, id: doc.id },
                        });
                        await router.invalidate();
                      }}
                    >
                      Delete
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
