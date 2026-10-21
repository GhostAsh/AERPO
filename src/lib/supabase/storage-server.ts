import "server-only";

import { getSupabaseServerCredentials } from "@/lib/supabase/server";

type UploadStorageObject = {
  bucket: "ledger-documents";
  bytes: ArrayBuffer;
  contentType: string;
  path: string;
};

export async function uploadSupabaseStorageObject({
  bucket,
  bytes,
  contentType,
  path,
}: UploadStorageObject) {
  const { secretKey, supabaseUrl } = getSupabaseServerCredentials();
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const headers: Record<string, string> = {
    apikey: secretKey,
    "Content-Type": contentType,
    "x-upsert": "false",
  };

  if (!secretKey.startsWith("sb_secret_")) {
    headers.Authorization = `Bearer ${secretKey}`;
  }

  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/${bucket}/${encodedPath}`,
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
