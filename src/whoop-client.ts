import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));
const tokensPath = fileURLToPath(new URL("../tokens.json", import.meta.url));
const tokensTmpPath = tokensPath + ".tmp";

const TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const API_BASE = "https://api.prod.whoop.com/developer/v2";
const REFRESH_MARGIN_MS = 60_000;

dotenv.config({ path: envPath, quiet: true });

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope?: string;
}

function readTokens(): Tokens {
  let parsed: Partial<Tokens>;
  try {
    parsed = JSON.parse(fs.readFileSync(tokensPath, "utf8"));
  } catch {
    throw new Error(`Could not read tokens.json. Run "npm run auth" first.`);
  }
  if (!parsed.access_token || !parsed.refresh_token || typeof parsed.expires_at !== "number") {
    throw new Error(`tokens.json is incomplete. Run "npm run auth" again.`);
  }
  return parsed as Tokens;
}

function saveTokens(tokens: Tokens): void {
  fs.writeFileSync(tokensTmpPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  fs.renameSync(tokensTmpPath, tokensPath);
}

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    return data?.error_description || data?.error || data?.message || text || res.statusText;
  } catch {
    return text || res.statusText;
  }
}

let refreshInFlight: Promise<Tokens> | null = null;

function refreshTokens(): Promise<Tokens> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefresh(): Promise<Tokens> {
  const clientId = process.env.WHOOP_CLIENT_ID?.trim();
  const clientSecret = process.env.WHOOP_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET must be set in .env");
  }

  const current = readTokens();
  console.error("Refreshing Whoop access token...");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: current.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
      scope: "offline",
    }).toString(),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed (HTTP ${res.status}): ${await errorMessage(res)}`);
  }

  const data: any = await res.json().catch(() => undefined);
  if (!data?.access_token || !data?.refresh_token || typeof data.expires_in !== "number") {
    throw new Error(`Token refresh failed (HTTP ${res.status}): unexpected response`);
  }

  const updated: Tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    scope: data.scope ?? current.scope,
  };
  // Save immediately: the old refresh token is now invalid.
  saveTokens(updated);
  console.error("Whoop access token refreshed.");
  return updated;
}

export async function getAccessToken(): Promise<string> {
  const tokens = readTokens();
  if (tokens.expires_at - Date.now() < REFRESH_MARGIN_MS) {
    return (await refreshTokens()).access_token;
  }
  return tokens.access_token;
}

// Refresh after a 401, unless another call already replaced the rejected token.
async function refreshAfter401(rejectedToken: string): Promise<string> {
  if (!refreshInFlight) {
    const latest = readTokens();
    if (latest.access_token !== rejectedToken) return latest.access_token;
  }
  return (await refreshTokens()).access_token;
}

export async function whoopGet(
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<unknown> {
  const url = new URL(API_BASE + path);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const request = (token: string) =>
    fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  let token = await getAccessToken();
  let res = await request(token);

  if (res.status === 401) {
    token = await refreshAfter401(token);
    res = await request(token);
  }

  if (!res.ok) {
    throw new Error(`Whoop API error (HTTP ${res.status}): ${await errorMessage(res)}`);
  }
  return res.json();
}
