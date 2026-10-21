import "server-only";

import { getSupabaseServerCredentials } from "@/lib/supabase/server";

type UploadStorageObject = {
  bucket: "ledger-documents";
  bytes: ArrayBuffer;
  contentType: string;
  path: string;
};

type StorageObjectLocation = Pick<UploadStorageObject, "bucket" | "path">;

function storageHeaders(secretKey: string) {
  const headers: Record<string, string> = { apikey: secretKey };

  if (!secretKey.startsWith("sb_secret_")) {
    headers.Authorization = `Bearer ${secretKey}`;
  }

  return headers;
}

function encodedStoragePath(path: string) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export async function uploadSupabaseStorageObject({
  bucket,
  bytes,
  contentType,
  path,
}: UploadStorageObject) {
  const { secretKey, supabaseUrl } = getSupabaseServerCredentials();
  const headers: Record<string, string> = {
    ...storageHeaders(secretKey),
    "Content-Type": contentType,
    "x-upsert": "false",
  };

  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/${bucket}/${encodedStoragePath(path)}`,
    {
      body: bytes,
      cache: "no-store",
      headers,
      method: "POST",
    },
  );
  const responseText = await response.text();

  if (!response.ok) {
    let details = responseText;

    try {
      const data = JSON.parse(responseText) as { message?: unknown };
      if (typeof data.message === "string") {
        details = data.message;
      }
    } catch {
      // Preserve the storage response text when it is not JSON.
    }

    throw new Error(`Supabase Storage error ${response.status}: ${details}`);
  }
}

export async function downloadSupabaseStorageObject({
  bucket,
  path,
}: StorageObjectLocation) {
  const { secretKey, supabaseUrl } = getSupabaseServerCredentials();
  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/${bucket}/${encodedStoragePath(path)}`,
    {
      cache: "no-store",
      headers: storageHeaders(secretKey),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Supabase Storage download failed with status ${response.status}.`,
    );
  }

  return response.arrayBuffer();
}
