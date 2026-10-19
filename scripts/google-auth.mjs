#!/usr/bin/env node
/**
 * Connects the agency's Google account (the one that owns "3D Operation Work"
 * and its storage) so project media can be uploaded as it. Run once:
 *
 *   npm run google-auth
 *
 * Needs GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env.local, from
 * a Google Cloud OAuth client of type "Desktop app". Opens a sign-in link, waits
 * for Google to send the browser back here, then writes
 * GOOGLE_OAUTH_REFRESH_TOKEN into .env.local and prints it for Vercel.
 *
 * Sign in as the account that owns the 3D folder, and keep the OAuth consent
 * screen "In production": in "Testing", Google expires the token after 7 days.
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";

const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}`;
const SCOPE = "https://www.googleapis.com/auth/drive";

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to .env.local first.");
  process.exit(1);
}

const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT,
  response_type: "code",
  scope: SCOPE,
  access_type: "offline",
  // Always ask, so Google always returns a refresh token.
  prompt: "consent",
})}`;

/** Sets KEY=value in .env.local, replacing the line if it is already there. */
function saveEnv(key, value) {
  let text = readFileSync(".env.local", "utf8");
  const line = `${key}=${value}`;
  text = new RegExp(`^${key}=.*$`, "m").test(text)
    ? text.replace(new RegExp(`^${key}=.*$`, "m"), line)
    : `${text.replace(/\s*$/, "")}\n${line}\n`;
  writeFileSync(".env.local", text);
}

const server = createServer(async (req, res) => {
  const params = new URL(req.url ?? "/", REDIRECT).searchParams;
  const code = params.get("code");
  if (!code) {
    res.writeHead(400).end(params.get("error") ?? "No code in the reply.");
    return;
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok || !tokens.refresh_token) {
    res.writeHead(500).end("Google didn't return a refresh token. See the terminal.");
    console.error("Token exchange failed:", tokens.error_description ?? tokens.error ?? tokens);
    server.close();
    process.exitCode = 1;
    return;
  }

  const about = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  }).then((r) => r.json());

  saveEnv("GOOGLE_OAUTH_REFRESH_TOKEN", tokens.refresh_token);
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("Connected. You can close this tab and go back to the terminal.");

  console.log(`\nConnected as ${about.user?.emailAddress ?? "an unknown account"}.`);
  console.log("GOOGLE_OAUTH_REFRESH_TOKEN is saved in .env.local.");
  console.log("Add the same value to Vercel's environment variables:\n");
  console.log(tokens.refresh_token);
  server.close();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Open this link, sign in as the account that owns 3D Operation Work, and allow access:\n");
  console.log(url);
});
