import "server-only";

import { accessToken, type ZohoConfig } from "./auth";

/**
 * Reading invoices out of Zoho Books (0009). Read only: nothing here writes
 * to Books.
 *
 * Books needs an organisation id on every call, and a token carrying the
 * ZohoBooks.invoices.READ scope. One refresh token minted with both the CRM
 * and the Books scopes serves both; ZOHO_BOOKS_REFRESH_TOKEN, when set, is used
 * for Books instead.
 */

export interface BooksConfig extends ZohoConfig {
  organizationId: string;
}

/*
 * A refresh token only works with the client that minted it, so a separate
 * Books connection names its own client too: ZOHO_BOOKS_CLIENT_ID /
 * _CLIENT_SECRET / _REFRESH_TOKEN, each falling back to the shared ZOHO_* one.
 */
export function booksConfig(): BooksConfig | null {
  const env = (name: string) => process.env[name]?.trim() || undefined;
  const clientId = env("ZOHO_BOOKS_CLIENT_ID") ?? env("ZOHO_CLIENT_ID");
  const clientSecret = env("ZOHO_BOOKS_CLIENT_SECRET") ?? env("ZOHO_CLIENT_SECRET");
  const refreshToken = env("ZOHO_BOOKS_REFRESH_TOKEN") ?? env("ZOHO_REFRESH_TOKEN");
  const organizationId = env("ZOHO_BOOKS_ORGANIZATION_ID");
  if (!clientId || !clientSecret || !refreshToken || !organizationId) return null;
  return {
    clientId,
    clientSecret,
    refreshToken,
    organizationId,
    accountsDomain: env("ZOHO_ACCOUNTS_DOMAIN") ?? "https://accounts.zoho.in",
    apiDomain: env("ZOHO_API_DOMAIN") ?? "https://www.zohoapis.in",
  };
}

export const BOOKS_NOT_CONNECTED =
  "Zoho Books isn't connected yet. Add ZOHO_BOOKS_ORGANIZATION_ID to the environment, with a refresh token that carries the ZohoBooks.invoices.READ scope.";

/** Books answers every call with `code` 0 on success, and a message otherwise. */
interface BooksEnvelope {
  code?: number;
  message?: string;
}

export class BooksError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message);
  }
}

async function request(
  config: BooksConfig,
  path: string,
  params: Record<string, string> = {},
): Promise<Response> {
  const token = await accessToken(config);
  const query = new URLSearchParams({ organization_id: config.organizationId, ...params });
  return fetch(`${config.apiDomain}/books/v3${path}?${query}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
    cache: "no-store",
  });
}

async function call<T extends BooksEnvelope>(
  config: BooksConfig,
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  const res = await request(config, path, params);
  const body = (await res.json().catch(() => null)) as T | null;
  if (!res.ok || !body || (body.code !== undefined && body.code !== 0)) {
    if (res.status === 429) {
      throw new BooksError("Zoho Books is rate-limiting us. Wait a minute and try again.", 429);
    }
    // The token works, but its Zoho user is not in this organisation.
    if (body?.code === 6041) {
      throw new BooksError(
        `The Zoho user behind the Books refresh token isn't a member of Books organization ${config.organizationId}. Check ZOHO_BOOKS_ORGANIZATION_ID, or create the token while signed in as a user of that organization.`,
        res.status,
        body.code,
      );
    }
    throw new BooksError(body?.message || `Zoho Books returned ${res.status}.`, res.status, body?.code);
  }
  return body;
}

/** An invoice as the list endpoint gives it: enough to know it exists. */
export interface BooksInvoiceSummary {
  invoice_id: string;
  invoice_number?: string;
  customer_name?: string;
  status?: string;
}

interface ListPage extends BooksEnvelope {
  invoices?: BooksInvoiceSummary[];
  page_context?: { has_more_page?: boolean };
}

/** Books caps a page at 200; this many pages is 10,000 invoices, far past one view's worth. */
const MAX_PAGES = 50;

/** Every invoice in one list view, page by page. */
export async function listInvoices(
  config: BooksConfig,
  params: Record<string, string>,
): Promise<BooksInvoiceSummary[]> {
  const out: BooksInvoiceSummary[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await call<ListPage>(config, "/invoices", {
      ...params,
      page: String(page),
      per_page: "200",
    });
    out.push(...(body.invoices ?? []));
    if (!body.page_context?.has_more_page) break;
  }
  return out;
}

/** One invoice in full — line items, taxes, addresses, payments — by Books' record id. */
export async function getInvoice(
  config: BooksConfig,
  invoiceId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const body = await call<BooksEnvelope & { invoice?: Record<string, unknown> }>(
      config,
      `/invoices/${encodeURIComponent(invoiceId)}`,
    );
    return body.invoice ?? null;
  } catch (err) {
    // An id Books has never issued (or one since deleted) comes back as a
    // 404, or as a 400 saying the resource does not exist.
    if (err instanceof BooksError && (err.status === 404 || /not exist|invalid.*id/i.test(err.message))) {
      return null;
    }
    throw err;
  }
}

/**
 * An invoice by whichever number the user has to hand, as the OBC quote fetch
 * works: Books' record id (the long number in the invoice's URL) or the
 * printed invoice number, INV-002372. The list search returns no line items,
 * so a number found there is read again by id.
 */
export async function findInvoice(
  config: BooksConfig,
  reference: string,
): Promise<Record<string, unknown> | null> {
  const value = reference.trim();
  if (!value) return null;

  if (/^\d{8,}$/.test(value)) {
    const byId = await getInvoice(config, value);
    if (byId) return byId;
  }

  const found = await call<ListPage>(config, "/invoices", { invoice_number: value });
  const match =
    (found.invoices ?? []).find(
      (i) => (i.invoice_number ?? "").toLowerCase() === value.toLowerCase(),
    ) ?? (found.invoices?.length === 1 ? found.invoices[0] : undefined);
  return match ? getInvoice(config, match.invoice_id) : null;
}

/** The invoice's PDF, as Books renders it with the organisation's template. */
export async function invoicePdf(config: BooksConfig, invoiceId: string): Promise<Response> {
  const res = await request(config, `/invoices/${encodeURIComponent(invoiceId)}`, {
    accept: "pdf",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as BooksEnvelope | null;
    throw new BooksError(body?.message || `Zoho Books returned ${res.status}.`, res.status);
  }
  return res;
}
