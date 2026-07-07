import { and, eq } from "drizzle-orm";

import { type DrizzleClient, getDb } from "~/db/client";
import type {
  GoogleConnection,
  Log,
  LogAttachment,
  Vehicle,
  VehicleDocument,
} from "~/db/schema";
import {
  driveSyncedFiles,
  googleConnections,
  logAttachments,
  logs,
  vehicleDocuments,
  vehicles,
} from "~/db/schema";
import { decryptSecret, encryptSecret } from "~/google/crypto.server";
import {
  createFolder,
  fileExists,
  updateFileContent,
  uploadFile,
} from "~/google/drive.server";
import {
  type GoogleTokens,
  isGoogleDriveConfigured,
  refreshAccessToken,
  revokeToken,
} from "~/google/oauth.server";
import { buildUserExport } from "~/models/export.server";
import { getStorage } from "~/storage.server";

/** What changed in a single sync run, surfaced to the user. */
export type DriveSyncSummary = {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: string[];
};

/** Connection state for the profile UI. */
export type DriveConnectionStatus = {
  /** Server has Google OAuth credentials configured. */
  configured: boolean;
  connected: boolean;
  googleEmail: string | null;
  lastSyncedAt: Date | null;
};

const ROOT_FOLDER_NAME = "Logbook";
const EXPORT_FILE_NAME = "logbook-export.json";
/** Refresh the access token a minute before it actually expires. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export async function getConnection(
  userId: string,
): Promise<GoogleConnection | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(googleConnections)
    .where(eq(googleConnections.userId, userId));
  return row ?? null;
}

export async function getDriveConnectionStatus(
  userId: string,
): Promise<DriveConnectionStatus> {
  const connection = await getConnection(userId);
  return {
    configured: isGoogleDriveConfigured(),
    connected: Boolean(connection),
    googleEmail: connection?.googleEmail ?? null,
    lastSyncedAt: connection?.lastSyncedAt ?? null,
  };
}

/**
 * Persist a freshly-authorized connection. Google only returns a refresh token
 * on the first consent of a grant; on reconnect we keep the existing one if a
 * new one isn't supplied (we force `prompt=consent` so this is belt-and-braces).
 */
export async function saveConnectionFromTokens({
  userId,
  tokens,
}: {
  userId: string;
  tokens: GoogleTokens;
}): Promise<void> {
  const db = await getDb();
  const existing = await getConnection(userId);
  const refreshToken =
    tokens.refreshToken ??
    (existing ? await decryptSecret(existing.refreshTokenEnc) : null);
  if (!refreshToken) {
    throw new Error(
      "Google did not return a refresh token. Remove Logbook from your Google account's third-party access and reconnect.",
    );
  }

  const refreshTokenEnc = await encryptSecret(refreshToken);
  const accessTokenExpiresAt = new Date(
    Date.now() + tokens.expiresInSeconds * 1000,
  );
  const values = {
    userId,
    googleEmail: tokens.email ?? existing?.googleEmail ?? null,
    refreshTokenEnc,
    accessToken: tokens.accessToken,
    accessTokenExpiresAt,
    scope: tokens.scope,
  };
  await db
    .insert(googleConnections)
    .values(values)
    .onConflictDoUpdate({
      target: googleConnections.userId,
      set: {
        googleEmail: values.googleEmail,
        refreshTokenEnc,
        accessToken: tokens.accessToken,
        accessTokenExpiresAt,
        scope: tokens.scope,
      },
    });
}

/**
 * Disconnect: revoke the grant at Google (best-effort) and drop the local
 * connection plus its file mappings. Re-syncing after a reconnect rebuilds the
 * mappings (it will re-upload, since the prior Drive files are now orphaned).
 */
export async function disconnectDrive(userId: string): Promise<void> {
  const db = await getDb();
  const connection = await getConnection(userId);
  if (connection) {
    try {
      await revokeToken(await decryptSecret(connection.refreshTokenEnc));
    } catch {
      // The local rows go regardless; a failed remote revoke is harmless.
    }
  }
  await db
    .delete(googleConnections)
    .where(eq(googleConnections.userId, userId));
  await db.delete(driveSyncedFiles).where(eq(driveSyncedFiles.userId, userId));
}

/** A valid access token, refreshing (and caching) via the stored refresh token. */
async function getValidAccessToken(
  connection: GoogleConnection,
): Promise<string> {
  if (
    connection.accessToken &&
    connection.accessTokenExpiresAt &&
    connection.accessTokenExpiresAt.getTime() - TOKEN_REFRESH_MARGIN_MS >
      Date.now()
  ) {
    return connection.accessToken;
  }

  const refreshToken = await decryptSecret(connection.refreshTokenEnc);
  const { accessToken, expiresInSeconds } =
    await refreshAccessToken(refreshToken);
  const db = await getDb();
  await db
    .update(googleConnections)
    .set({
      accessToken,
      accessTokenExpiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    })
    .where(eq(googleConnections.userId, connection.userId));
  return accessToken;
}

type SyncContext = {
  db: DrizzleClient;
  userId: string;
  accessToken: string;
  summary: DriveSyncSummary;
};

/**
 * Push the user's documents, scan/photo attachments, and a JSON data export
 * into a "Logbook" folder in their Google Drive. One-way (app → Drive) and
 * idempotent: immutable blobs already mapped in `drive_synced_files` are
 * skipped, folders are reused, and the export is updated in place.
 *
 * Note: this runs synchronously within the request. For a very large backlog
 * it could approach Workers' wall-clock limit — but the mapping table makes a
 * re-run resume where it left off, so a partial sync is safe to repeat.
 */
export async function syncToDrive(userId: string): Promise<DriveSyncSummary> {
  const db = await getDb();
  const connection = await getConnection(userId);
  if (!connection) throw new Error("Google Drive is not connected");

  const accessToken = await getValidAccessToken(connection);
  const summary: DriveSyncSummary = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };
  const ctx: SyncContext = { db, userId, accessToken, summary };

  const rootId = await ensureFolder(ctx, "root", ROOT_FOLDER_NAME);
  if (connection.rootFolderId !== rootId) {
    await db
      .update(googleConnections)
      .set({ rootFolderId: rootId })
      .where(eq(googleConnections.userId, userId));
  }

  // Owned vehicles only — matches the "your data" export's ownership scope, so
  // we never copy a shared vehicle's records into someone else's Drive.
  const ownedVehicles = await db
    .select()
    .from(vehicles)
    .where(eq(vehicles.userId, userId));

  for (const vehicle of ownedVehicles) {
    const vehicleFolderId = await ensureFolder(
      ctx,
      `vehicle:${vehicle.id}`,
      vehicleFolderName(vehicle),
      rootId,
    );

    const docs = await db
      .select()
      .from(vehicleDocuments)
      .where(eq(vehicleDocuments.vehicleId, vehicle.id));
    if (docs.length > 0) {
      const docsFolder = await ensureFolder(
        ctx,
        `vehicle:${vehicle.id}:documents`,
        "Documents",
        vehicleFolderId,
      );
      for (const doc of docs) {
        await syncBlob(
          ctx,
          "vehicle_document",
          doc.id,
          docsFolder,
          documentFileName(doc),
          doc.path,
        );
      }
    }

    const attachmentRows = await db
      .select({ att: logAttachments, log: logs })
      .from(logAttachments)
      .innerJoin(logs, eq(logs.id, logAttachments.logId))
      .where(eq(logs.vehicleId, vehicle.id));
    if (attachmentRows.length > 0) {
      const serviceFolder = await ensureFolder(
        ctx,
        `vehicle:${vehicle.id}:service`,
        "Service Records",
        vehicleFolderId,
      );
      for (const { att, log } of attachmentRows) {
        await syncBlob(
          ctx,
          "log_attachment",
          att.id,
          serviceFolder,
          attachmentFileName(log, att),
          att.path,
        );
      }
    }
  }

  await syncExport(ctx, rootId);

  await db
    .update(googleConnections)
    .set({ lastSyncedAt: new Date() })
    .where(eq(googleConnections.userId, userId));
  return summary;
}

/** Create-or-reuse a Drive folder, recovering if a mapped folder was deleted. */
async function ensureFolder(
  ctx: SyncContext,
  sourceKey: string,
  name: string,
  parentId?: string,
): Promise<string> {
  const existing = await getMapping(ctx, "folder", sourceKey);
  if (existing) {
    // If the existence check itself fails (transient), assume it's there
    // rather than risk creating a duplicate folder.
    const stillThere = await fileExists({
      accessToken: ctx.accessToken,
      fileId: existing,
    }).catch(() => true);
    if (stillThere) return existing;
  }
  const id = await createFolder({
    accessToken: ctx.accessToken,
    name,
    parentId,
  });
  await recordMapping(ctx, "folder", sourceKey, id);
  return id;
}

/** Upload one immutable blob if it hasn't been synced before; else skip. */
async function syncBlob(
  ctx: SyncContext,
  sourceType: "vehicle_document" | "log_attachment",
  sourceKey: string,
  folderId: string,
  name: string,
  storagePath: string,
): Promise<void> {
  if (await getMapping(ctx, sourceType, sourceKey)) {
    ctx.summary.skipped++;
    return;
  }
  const file = await getStorage().read(storagePath);
  if (!file) {
    ctx.summary.failed++;
    ctx.summary.errors.push(`Missing stored file for "${name}"`);
    return;
  }
  try {
    const id = await uploadFile({
      accessToken: ctx.accessToken,
      name,
      mimeType: file.contentType,
      body: file.body,
      parentId: folderId,
    });
    await recordMapping(ctx, sourceType, sourceKey, id);
    ctx.summary.created++;
  } catch (err) {
    ctx.summary.failed++;
    ctx.summary.errors.push(`${name}: ${errorMessage(err)}`);
  }
}

/** Write (or refresh) the JSON data export at the Logbook root. */
async function syncExport(ctx: SyncContext, rootId: string): Promise<void> {
  const data = await buildUserExport(ctx.userId);
  if (!data) return;
  const body = new TextEncoder().encode(JSON.stringify(data, null, 2));
  const existing = await getMapping(ctx, "export", "export");

  if (existing) {
    try {
      await updateFileContent({
        accessToken: ctx.accessToken,
        fileId: existing,
        mimeType: "application/json",
        body,
      });
      ctx.summary.updated++;
      return;
    } catch {
      // The export file was likely deleted in Drive — fall through and
      // recreate it, replacing the stale mapping below.
    }
  }

  try {
    const id = await uploadFile({
      accessToken: ctx.accessToken,
      name: EXPORT_FILE_NAME,
      mimeType: "application/json",
      body,
      parentId: rootId,
    });
    await recordMapping(ctx, "export", "export", id);
    ctx.summary.created++;
  } catch (err) {
    ctx.summary.failed++;
    ctx.summary.errors.push(`${EXPORT_FILE_NAME}: ${errorMessage(err)}`);
  }
}

async function getMapping(
  ctx: SyncContext,
  sourceType: string,
  sourceKey: string,
): Promise<string | null> {
  const [row] = await ctx.db
    .select({ driveFileId: driveSyncedFiles.driveFileId })
    .from(driveSyncedFiles)
    .where(
      and(
        eq(driveSyncedFiles.userId, ctx.userId),
        eq(driveSyncedFiles.sourceType, sourceType),
        eq(driveSyncedFiles.sourceKey, sourceKey),
      ),
    );
  return row?.driveFileId ?? null;
}

async function recordMapping(
  ctx: SyncContext,
  sourceType: string,
  sourceKey: string,
  driveFileId: string,
): Promise<void> {
  await ctx.db
    .insert(driveSyncedFiles)
    .values({ userId: ctx.userId, sourceType, sourceKey, driveFileId })
    .onConflictDoUpdate({
      target: [
        driveSyncedFiles.userId,
        driveSyncedFiles.sourceType,
        driveSyncedFiles.sourceKey,
      ],
      set: { driveFileId, syncedAt: new Date() },
    });
}

function vehicleFolderName(vehicle: Vehicle): string {
  const base = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
    .filter(Boolean)
    .join(" ");
  const named = vehicle.name?.trim()
    ? `${vehicle.name.trim()} (${base})`
    : base;
  return named.trim() || "Vehicle";
}

function documentFileName(doc: VehicleDocument): string {
  if (doc.originalName) return doc.originalName;
  const base = doc.label?.trim() || doc.kind || "document";
  return `${base}${extensionFor(doc.contentType)}`;
}

function attachmentFileName(log: Log, att: LogAttachment): string {
  const date = log.servicedAt ? log.servicedAt.toISOString().slice(0, 10) : "";
  const label = [date, log.title].filter(Boolean).join(" ").trim();
  if (att.originalName) {
    return label ? `${label} - ${att.originalName}` : att.originalName;
  }
  return `${label || "scan"}${extensionFor(att.contentType)}`;
}

function extensionFor(contentType: string): string {
  if (contentType === "image/jpeg") return ".jpg";
  if (contentType === "image/png") return ".png";
  if (contentType === "image/webp") return ".webp";
  if (contentType === "application/pdf") return ".pdf";
  return "";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
