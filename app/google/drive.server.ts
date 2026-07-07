/**
 * Minimal Google Drive v3 REST client — just the calls the one-way sync needs:
 * create a folder, upload a new file, replace a file's contents, and check a
 * file still exists. Plain `fetch` with a bearer access token, so it runs on
 * both Cloudflare Workers and Node.
 *
 * Everything here is scoped by the `drive.file` grant: these calls only ever
 * see or touch files Logbook itself created.
 */

const FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Create a folder (optionally inside `parentId`); returns its Drive file id. */
export async function createFolder({
  accessToken,
  name,
  parentId,
}: {
  accessToken: string;
  name: string;
  parentId?: string;
}): Promise<string> {
  const res = await fetch(`${FILES_ENDPOINT}?fields=id`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`Drive folder create failed: ${await res.text()}`);
  }
  const { id } = (await res.json()) as { id: string };
  return id;
}

/**
 * Upload a brand-new file via a single multipart/related request (metadata +
 * bytes in one round trip). Returns the new Drive file id.
 */
export async function uploadFile({
  accessToken,
  name,
  mimeType,
  body,
  parentId,
}: {
  accessToken: string;
  name: string;
  mimeType: string;
  body: Uint8Array;
  parentId?: string;
}): Promise<string> {
  const boundary = `logbook-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({
    name,
    ...(parentId ? { parents: [parentId] } : {}),
  });

  const preamble =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`;
  const epilogue = `\r\n--${boundary}--`;
  const requestBody = concatBytes(
    new TextEncoder().encode(preamble),
    body,
    new TextEncoder().encode(epilogue),
  );

  const res = await fetch(`${UPLOAD_ENDPOINT}?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": `multipart/related; boundary=${boundary}`,
    },
    body: requestBody as BodyInit,
  });
  if (!res.ok) {
    throw new Error(`Drive upload failed: ${await res.text()}`);
  }
  const { id } = (await res.json()) as { id: string };
  return id;
}

/** Replace the contents of an existing Drive file (used for the JSON export). */
export async function updateFileContent({
  accessToken,
  fileId,
  mimeType,
  body,
}: {
  accessToken: string;
  fileId: string;
  mimeType: string;
  body: Uint8Array;
}): Promise<void> {
  const res = await fetch(
    `${UPLOAD_ENDPOINT}/${encodeURIComponent(fileId)}?uploadType=media`,
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": mimeType,
      },
      body: body as BodyInit,
    },
  );
  if (!res.ok) {
    throw new Error(`Drive update failed: ${await res.text()}`);
  }
}

/**
 * Whether a tracked file/folder still exists (not deleted/trashed in Drive).
 * Lets the sync recover when a user manually removed something we mapped.
 */
export async function fileExists({
  accessToken,
  fileId,
}: {
  accessToken: string;
  fileId: string;
}): Promise<boolean> {
  const res = await fetch(
    `${FILES_ENDPOINT}/${encodeURIComponent(fileId)}?fields=id,trashed`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (res.status === 404) return false;
  if (!res.ok) {
    throw new Error(`Drive lookup failed: ${await res.text()}`);
  }
  const { trashed } = (await res.json()) as { trashed?: boolean };
  return !trashed;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
