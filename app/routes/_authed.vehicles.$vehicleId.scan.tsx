import {
  createFileRoute,
  getRouteApi,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";

import { requireAuth } from "~/auth/session.server";
import { DocumentScanner } from "~/components/DocumentScanner";
import { ImageCropper } from "~/components/ImageCropper";
import {
  btnPrimary,
  btnSecondary,
  card,
  chip,
  errorBox,
  input,
  label,
  textarea,
} from "~/components/ui";
import { flattenSupported } from "~/lib/document-scan";
import { downscaleImage } from "~/lib/image";
import { requireVehicleAccess } from "~/models/member.server";
import { extractReceiptScan } from "~/scan/extract.server";
import { createLogWithScan } from "~/scan/import.server";
import {
  type ExtractedReceipt,
  isValidVinCheckDigit,
  receiptToNotes,
} from "~/scan/receipt";

const TYPES = ["Minor", "Major", "Modify", "Check"] as const;

/** Server-side cap; the client downscales first, so this is just headroom. */
const MAX_SCAN_BYTES = 8 * 1024 * 1024;

function scanFileFrom(data: FormData): { error: string } | { file: File } {
  const file = data.get("scan");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "No photo attached" };
  }
  if (!file.type.startsWith("image/")) {
    return { error: "That file isn't an image" };
  }
  if (file.size > MAX_SCAN_BYTES) {
    return { error: "Photo is too large (8 MB max)" };
  }
  return { file };
}

const extractScanFn = createServerFn({ method: "POST" })
  .inputValidator((data: FormData) => data)
  .handler(async ({ data }) => {
    const userId = await requireAuth();
    const vehicleId = String(data.get("vehicleId") ?? "");
    if (!vehicleId) return { error: "Missing vehicle" };
    await requireVehicleAccess({ vehicleId, userId });

    const checked = scanFileFrom(data);
    if ("error" in checked) return { error: checked.error };

    try {
      const bytes = new Uint8Array(await checked.file.arrayBuffer());
      const receipt = await extractReceiptScan(bytes, checked.file.type);
      return { receipt };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "Extraction failed",
      };
    }
  });

const saveScanFn = createServerFn({ method: "POST" })
  .inputValidator((data: FormData) => data)
  .handler(async ({ data }) => {
    const userId = await requireAuth();

    const vehicleId = String(data.get("vehicleId") ?? "");
    const title = String(data.get("title") ?? "").trim();
    if (!title || !vehicleId) return { error: "Title is required" };

    const checked = scanFileFrom(data);
    if ("error" in checked) return { error: checked.error };

    const notes = String(data.get("notes") ?? "").trim() || null;
    const type = String(data.get("type") ?? "").trim() || null;
    const shopName = String(data.get("shopName") ?? "").trim();
    const shopLocation = String(data.get("shopLocation") ?? "").trim() || null;
    const reminderNotes =
      String(data.get("reminderNotes") ?? "").trim() || null;
    const draftReminder = data.get("draftReminder") === "on" && reminderNotes;

    // Trust nothing from the client: junk numbers/dates become null/now.
    const cost = Number.parseFloat(String(data.get("cost") ?? ""));
    const odometer = Number.parseFloat(String(data.get("odometer") ?? ""));
    const servicedAt = new Date(String(data.get("servicedAt") ?? ""));
    const startedAt = new Date(String(data.get("serviceStartedAt") ?? ""));

    const saveVin =
      data.get("saveVin") === "on"
        ? String(data.get("vin") ?? "").trim()
        : null;

    const { log } = await createLogWithScan({
      userId,
      vehicleId,
      log: {
        title,
        notes,
        type,
        cost: Number.isFinite(cost) ? cost : null,
        odometer: Number.isFinite(odometer) ? odometer : null,
        serviceStartedAt: Number.isNaN(startedAt.getTime()) ? null : startedAt,
        servicedAt: Number.isNaN(servicedAt.getTime())
          ? new Date()
          : servicedAt,
        selfService: data.get("selfService") === "on",
      },
      vendor: shopName ? { name: shopName, location: shopLocation } : null,
      vehicleVin: saveVin,
      scan: {
        body: new Uint8Array(await checked.file.arrayBuffer()),
        contentType: checked.file.type,
        originalName: checked.file.name || "scan.jpg",
      },
      reminder: draftReminder
        ? { title: `Follow-up: ${title}`, notes: reminderNotes }
        : null,
    });

    return { vehicleId, logId: log.id };
  });

export const Route = createFileRoute("/_authed/vehicles/$vehicleId/scan")({
  component: ScanReceipt,
});

type Step = "capture" | "reading" | "review";

const vehicleApi = getRouteApi("/_authed/vehicles/$vehicleId");

function ScanReceipt() {
  const navigate = useNavigate();
  const { vehicleId } = useParams({
    from: "/_authed/vehicles/$vehicleId/scan",
  });
  const vehicle = vehicleApi.useLoaderData();

  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("capture");
  // A picked photo flows: scanning (flatten) → optional cropping → the
  // downscale + read pipeline. Either step can hand off to the next.
  const [scanning, setScanning] = useState<File | null>(null);
  const [cropping, setCropping] = useState<File | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Editable fields, prefilled by extraction when it succeeds.
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [cost, setCost] = useState("");
  const [odometer, setOdometer] = useState("");
  const [servicedAt, setServicedAt] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [type, setType] = useState("");
  const [shopName, setShopName] = useState("");
  const [shopLocation, setShopLocation] = useState("");
  const [recommendedWork, setRecommendedWork] = useState<string | null>(null);
  const [extractedVin, setExtractedVin] = useState<string | null>(null);

  function applyReceipt(receipt: ExtractedReceipt) {
    setTitle(receipt.suggestedTitle);
    setNotes(receiptToNotes(receipt));
    setCost(receipt.totalCost != null ? String(receipt.totalCost) : "");
    setOdometer(receipt.odometer != null ? String(receipt.odometer) : "");
    setServicedAt(receipt.serviceDate ?? "");
    setStartedAt(receipt.serviceStartDate ?? "");
    setShopName(receipt.shopName ?? "");
    setShopLocation(receipt.shopLocation ?? "");
    setRecommendedWork(receipt.recommendedWork);
    setExtractedVin(receipt.vin);
  }

  async function onPhotoPicked(picked: File | undefined) {
    if (!picked) return;
    setExtractError(null);
    const upload = await downscaleImage(picked, {
      maxDim: 1600,
      quality: 0.85,
    });
    setFile(upload);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(upload);
    });

    // Read it right away — the form appears as soon as the model answers,
    // or empty (with the photo still attached) if it can't.
    setStep("reading");
    const formData = new FormData();
    formData.set("vehicleId", vehicleId);
    formData.set("scan", upload);
    try {
      const result = await extractScanFn({ data: formData });
      if ("receipt" in result && result.receipt) {
        applyReceipt(result.receipt);
      } else if ("error" in result) {
        setExtractError(result.error ?? "Extraction failed");
      }
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setStep("review");
    }
  }

  async function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return;
    setSaveError(null);
    setPending(true);
    const formData = new FormData(e.currentTarget);
    formData.set("vehicleId", vehicleId);
    formData.set("scan", file);
    formData.set("title", title);
    formData.set("type", type);
    formData.set("notes", notes);
    formData.set("shopName", shopName);
    formData.set("shopLocation", shopLocation);
    try {
      const result = await saveScanFn({ data: formData });
      if (result && "error" in result && result.error) {
        setSaveError(result.error);
      } else if (result && "logId" in result && result.logId) {
        navigate({
          to: "/vehicles/$vehicleId/logs/$logId",
          params: { vehicleId, logId: result.logId },
        });
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mx-auto max-w-lg">
      <h2 className="text-xl font-bold text-ink">Scan a receipt</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Snap the shop invoice — the AI reads it into a work log and the photo
        stays attached for the record.
      </p>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-label="Take a photo of the receipt"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.currentTarget.value = "";
          // iOS gets the plain cropper — flattening is unreliable there.
          if (picked) {
            if (flattenSupported()) setScanning(picked);
            else setCropping(picked);
          }
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="Choose a receipt photo"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.currentTarget.value = "";
          if (picked) {
            if (flattenSupported()) setScanning(picked);
            else setCropping(picked);
          }
        }}
      />

      {scanning ? (
        <DocumentScanner
          file={scanning}
          onCancel={() => setScanning(null)}
          onConfirm={(flattened) => {
            setScanning(null);
            onPhotoPicked(flattened);
          }}
          onCropInstead={(original) => {
            setScanning(null);
            setCropping(original);
          }}
        />
      ) : null}

      {cropping ? (
        <ImageCropper
          file={cropping}
          onCancel={() => setCropping(null)}
          onConfirm={(cropped) => {
            setCropping(null);
            onPhotoPicked(cropped);
          }}
        />
      ) : null}

      {step === "capture" ? (
        <div className="mt-6 space-y-3">
          <button
            type="button"
            className={`${btnPrimary} w-full py-4 text-lg`}
            onClick={() => cameraRef.current?.click()}
          >
            📷 Snap the receipt
          </button>
          <button
            type="button"
            className={`${btnSecondary} w-full`}
            onClick={() => galleryRef.current?.click()}
          >
            Choose a photo instead
          </button>
        </div>
      ) : null}

      {preview && step !== "capture" ? (
        <div className={`${card} mt-4 overflow-hidden`}>
          <img
            src={preview}
            alt="Receipt scan preview"
            className="max-h-72 w-full object-contain"
          />
          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-xs text-ink-muted">
              {step === "reading"
                ? "Reading the receipt…"
                : "Attached to the log when you save"}
            </span>
            <button
              type="button"
              className="text-sm font-semibold text-accent hover:underline"
              onClick={() => {
                setStep("capture");
                setFile(null);
                setExtractError(null);
              }}
            >
              Retake
            </button>
          </div>
        </div>
      ) : null}

      {step === "reading" ? (
        <div className={`${card} mt-4 flex items-center gap-3 p-4`}>
          <span
            aria-hidden
            className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-accent"
          />
          <p className="text-sm text-ink">
            Reading the receipt — a few seconds…
          </p>
        </div>
      ) : null}

      {step === "review" ? (
        <form onSubmit={onSave} className="mt-4 space-y-5">
          {extractError ? (
            <p className={errorBox}>
              Couldn't read it automatically ({extractError}). Fill it in below
              — the photo still gets attached.
            </p>
          ) : null}
          {saveError ? <p className={errorBox}>{saveError}</p> : null}

          <label className={label}>
            What was done?
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="Major service + brakes"
              className={`${input} text-lg font-semibold`}
            />
          </label>

          <div className={`${card} p-4`}>
            <div className="grid grid-cols-2 gap-3">
              <label className={label}>
                Odometer (mi)
                <input
                  name="odometer"
                  type="number"
                  step="1"
                  inputMode="numeric"
                  value={odometer}
                  onChange={(e) => setOdometer(e.target.value)}
                  className={`${input} text-lg font-semibold tabular-nums`}
                />
              </label>
              <label className={label}>
                Cost (USD)
                <input
                  name="cost"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  className={`${input} text-lg font-semibold tabular-nums`}
                />
              </label>
            </div>
          </div>

          <div>
            <span className={label}>Job size</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={chip(type === t)}
                  onClick={() => setType(type === t ? "" : t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <label className={label}>
            Notes — line items land here
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={6}
              className={textarea}
            />
          </label>

          <label className={label}>
            Shop — filter your history by vendor later
            <input
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              placeholder="Desert 4x4 Service Center"
              className={input}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className={label}>
              Started (optional)
              <input
                name="serviceStartedAt"
                type="date"
                value={startedAt}
                onChange={(e) => setStartedAt(e.target.value)}
                className={input}
              />
            </label>
            <label className={label}>
              Completed
              <input
                name="servicedAt"
                type="date"
                value={servicedAt}
                onChange={(e) => setServicedAt(e.target.value)}
                className={input}
              />
            </label>
          </div>

          <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-ink">
            <input
              type="checkbox"
              name="selfService"
              className="h-6 w-6 rounded accent-(--app-accent)"
            />
            We did it ourselves
          </label>

          {extractedVin && !vehicle.vin ? (
            <label
              className={`${card} flex items-start gap-3 p-4 text-sm text-ink`}
            >
              <input
                type="checkbox"
                name="saveVin"
                defaultChecked={isValidVinCheckDigit(extractedVin)}
                className="mt-0.5 h-6 w-6 shrink-0 rounded accent-(--app-accent)"
              />
              <span>
                <span className="font-semibold">Save the VIN</span> from this
                receipt to the vehicle:{" "}
                <span className="font-mono text-xs">{extractedVin}</span>
                {!isValidVinCheckDigit(extractedVin) ? (
                  <span className="mt-1 block text-xs text-warn">
                    Checksum doesn't verify — compare against the receipt before
                    saving (the camera may have misread a character).
                  </span>
                ) : null}
                <input type="hidden" name="vin" value={extractedVin} />
              </span>
            </label>
          ) : null}

          {recommendedWork ? (
            <label
              className={`${card} flex items-start gap-3 p-4 text-sm text-ink`}
            >
              <input
                type="checkbox"
                name="draftReminder"
                defaultChecked
                className="mt-0.5 h-6 w-6 shrink-0 rounded accent-(--app-accent)"
              />
              <span>
                <span className="font-semibold">Draft a reminder</span> from the
                tech's note: “{recommendedWork}”
                <input
                  type="hidden"
                  name="reminderNotes"
                  value={recommendedWork}
                />
              </span>
            </label>
          ) : null}

          <button
            type="submit"
            disabled={pending || !file}
            className={`${btnPrimary} w-full py-4 text-lg`}
          >
            {pending ? "Saving…" : "Save log + photo ✓"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
