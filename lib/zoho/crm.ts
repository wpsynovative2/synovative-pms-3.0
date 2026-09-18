import "server-only";

/**
 * Reading quotes out of Zoho CRM, so the OBC carries what was actually sold
 * instead of what someone re-typed.
 *
 * Zoho's data centres each have their own domains, which is why both are
 * configurable — .in for India, .com for the US, and so on.
 */

export interface ZohoConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accountsDomain: string;
  apiDomain: string;
}

export function zohoConfig(): ZohoConfig | null {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return {
    clientId,
    clientSecret,
    refreshToken,
    accountsDomain: process.env.ZOHO_ACCOUNTS_DOMAIN ?? "https://accounts.zoho.in",
    apiDomain: process.env.ZOHO_API_DOMAIN ?? "https://www.zohoapis.in",
  };
}

/**
 * Access tokens last an hour. Caching one in module scope saves a round trip
 * on every fetch without needing anywhere to store it; a cold serverless
 * instance simply asks again.
 */
let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(config: ZohoConfig): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const res = await fetch(`${config.accountsDomain}/oauth/v2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
    }),
  });
  const body = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new Error(body.error ? `Zoho: ${body.error}` : "Zoho refused the refresh token.");
  }
  cached = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return cached.token;
}

async function call<T>(config: ZohoConfig, path: string): Promise<T | null> {
  const token = await accessToken(config);
  const res = await fetch(`${config.apiDomain}${path}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
    cache: "no-store",
  });
  // Zoho answers a search with no hits as 204 with an empty body.
  if (res.status === 204) return null;
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message || `Zoho returned ${res.status}.`);
  }
  return (await res.json()) as T;
}

export interface QuoteSummary {
  id: string;
  number: string;
  subject: string;
  total: number;
  stage: string;
  createdAt: string;
}

/**
 * One quoted line as the delivery team needs it: what was sold, how much of
 * it, and the two descriptions Zoho keeps against the line. Pricing stays in
 * Zoho, which is the system of record for it.
 */
export interface QuoteLine {
  service: string;
  quantity: number;
  /** Zoho's line-level "Description". */
  description: string;
  /** Zoho's line-level "Brief Description". */
  briefDescription: string;
}

interface ZohoQuote {
  id: string;
  Quote_Number?: string;
  Subject?: string;
  Grand_Total?: number;
  Quote_Stage?: string;
  Created_Time?: string;
  Quoted_Items?: {
    Product_Name?: { name?: string } | string;
    Quantity?: number;
    Description?: string;
    Brief_Description?: string;
  }[];
}

const summarise = (q: ZohoQuote): QuoteSummary => ({
  id: q.id,
  number: q.Quote_Number ?? "",
  subject: q.Subject ?? "Untitled quote",
  total: Number(q.Grand_Total ?? 0),
  stage: q.Quote_Stage ?? "",
  createdAt: q.Created_Time ?? "",
});

const readLines = (q: ZohoQuote): QuoteLine[] =>
  (q.Quoted_Items ?? []).map((item) => {
    const name =
      typeof item.Product_Name === "string"
        ? item.Product_Name
        : (item.Product_Name?.name ?? "Service");
    return {
      service: name,
      quantity: Number(item.Quantity ?? 1),
      description: item.Description ?? "",
      briefDescription: item.Brief_Description ?? "",
    };
  });

/**
 * A quote and its lines, found by whichever number the user has to hand.
 *
 * The number printed on a quote in the CRM ("Quote Number") is *not* the record
 * id the API addresses — they differ by a few digits — so a value that is not a
 * record id is looked up as a quote number instead. The second hop matters:
 * Zoho's search endpoint omits subform data, so the line items only arrive from
 * a detail read by record id.
 */
export async function fetchQuote(
  config: ZohoConfig,
  reference: string,
): Promise<{ quote: QuoteSummary; lines: QuoteLine[] } | null> {
  const value = reference.trim();
  if (!value) return null;

  const direct = await call<{ data?: ZohoQuote[] }>(
    config,
    `/crm/v6/Quotes/${encodeURIComponent(value)}`,
  );
  const byId = direct?.data?.[0];
  if (byId) return { quote: summarise(byId), lines: readLines(byId) };

  const found = await call<{ data?: ZohoQuote[] }>(
    config,
    `/crm/v6/Quotes/search?criteria=${encodeURIComponent(`(Quote_Number:equals:${value})`)}`,
  );
  const match = found?.data?.[0];
  if (!match) return null;

  // Re-read by record id: the search result has no Quoted_Items.
  const full = await call<{ data?: ZohoQuote[] }>(
    config,
    `/crm/v6/Quotes/${encodeURIComponent(match.id)}`,
  );
  const record = full?.data?.[0] ?? match;
  return { quote: summarise(record), lines: readLines(record) };
}
