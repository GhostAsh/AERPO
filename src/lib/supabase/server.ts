import "server-only";

type SupabaseMethod = "GET" | "PATCH" | "POST";

type SupabaseRequestOptions = {
  body?: unknown;
  method?: SupabaseMethod;
  prefer?: string;
};

const allowedResources: Record<SupabaseMethod, ReadonlySet<string>> = {
  GET: new Set([
    "agent_telemetry",
    "erp_ledger",
    "ledger_agent_prompt_events",
    "ledger_correction_proposal_edits",
    "ledger_correction_proposals",
  ]),
  PATCH: new Set(["erp_ledger", "ledger_agent_prompt_events"]),
  POST: new Set([
    "agent_telemetry",
    "ledger_agent_prompt_events",
    "rpc/apply_ledger_correction",
    "rpc/create_ledger_idempotently",
    "rpc/edit_ledger_correction_proposal",
    "rpc/review_ledger_correction",
  ]),
};

export function assertSupabaseOperationAllowed(
  method: string,
  path: string,
) {
  if (!(method in allowedResources)) {
    throw new Error(`Database protocol blocked HTTP method ${method}.`);
  }

  if (!path.startsWith("/rest/v1/")) {
    throw new Error("Database protocol blocked a non-REST Supabase path.");
  }

  const resource = path.slice("/rest/v1/".length).split("?", 1)[0];
  const resources = allowedResources[method as SupabaseMethod];

  if (!resources.has(resource)) {
    throw new Error(
      `Database protocol blocked ${method} access to ${resource || "an empty resource"}.`,
    );
  }
}

export async function supabaseServerRequest<T>(
  path: string,
  options: SupabaseRequestOptions = {},
) {
  const method = options.method ?? "GET";
  assertSupabaseOperationAllowed(method, path);

  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error(
      "SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is not configured.",
    );
  }

  if (!secretKey) {
    throw new Error(
      "SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required for server-side database access.",
    );
  }

  const headers: Record<string, string> = {
    apikey: secretKey,
    "Content-Type": "application/json",
    ...(options.prefer ? { Prefer: options.prefer } : {}),
  };

  if (!secretKey.startsWith("sb_secret_")) {
    headers.Authorization = `Bearer ${secretKey}`;
  }

  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}${path}`, {
    body:
      options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
    headers,
    method,
  });
  const responseText = await response.text();
  const data = responseText ? (JSON.parse(responseText) as unknown) : null;

  if (!response.ok) {
    const details =
      typeof data === "object" && data && "message" in data
        ? String(data.message)
        : responseText;
    throw new Error(`Supabase REST error ${response.status}: ${details}`);
  }

  return data as T;
}
