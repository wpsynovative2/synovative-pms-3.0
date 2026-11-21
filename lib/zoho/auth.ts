import "server-only";

/**
 * Signing in to Zoho, shared by CRM (quotes) and Books (invoices).
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
 * instance simply asks again. Keyed by refresh token, because Books may be
 * signed in with a token of its own.
 */
const cached = new Map<string, { token: string; expiresAt: number }>();

export async function accessToken(config: ZohoConfig): Promise<string> {
  const hit = cached.get(config.refreshToken);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;

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
  cached.set(config.refreshToken, {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  });
  return body.access_token;
}
