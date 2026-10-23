import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
const tokensPath = fileURLToPath(new URL("../tokens.json", import.meta.url));

dotenv.config({ path: envPath, quiet: true });

const clientId = process.env.WHOOP_CLIENT_ID?.trim();
const clientSecret = process.env.WHOOP_CLIENT_SECRET?.trim();
const redirectUri = process.env.WHOOP_REDIRECT_URI?.trim();

const missing = [
  ["WHOOP_CLIENT_ID", clientId],
  ["WHOOP_CLIENT_SECRET", clientSecret],
  ["WHOOP_REDIRECT_URI", redirectUri],
]
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (missing.length > 0 || !clientId || !clientSecret || !redirectUri) {
  console.error(`Missing required value(s) in ${envPath}: ${missing.join(", ")}`);
  process.exit(1);
}

const redirect = new URL(redirectUri);
const port = Number(redirect.port) || (redirect.protocol === "https:" ? 443 : 80);
const callbackPath = redirect.pathname;

const state = crypto.randomBytes(16).toString("hex");
const scope =
  "offline read:profile read:recovery read:sleep read:cycles read:workout read:body_measurement";

const loginUrl = new URL("https://api.prod.whoop.com/oauth/oauth2/auth");
loginUrl.search = new URLSearchParams({
  response_type: "code",
  client_id: clientId,
  redirect_uri: redirectUri,
  state,
  scope,
}).toString();

console.error("Open this URL in your browser to log in:");
console.error(loginUrl.toString());

async function exchangeCode(code: string): Promise<void> {
  const res = await fetch("https://api.prod.whoop.com/oauth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri!,
      client_id: clientId!,
      client_secret: clientSecret!,
    }).toString(),
  });

  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = undefined;
  }

  if (!res.ok) {
    const msg = data?.error_description || data?.error || data?.message || res.statusText;
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }

  if (!data?.access_token || typeof data.expires_in !== "number") {
    throw new Error(`HTTP ${res.status}: unexpected token response`);
  }

  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    scope: data.scope,
  };
  fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname !== callbackPath) {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }

  if (url.searchParams.get("state") !== state) {
    res.writeHead(400, { "content-type": "text/plain" }).end("Invalid state");
    console.error("Rejected callback: state mismatch.");
    return;
  }

  const oauthError = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  if (oauthError || !code) {
    const msg = url.searchParams.get("error_description") || oauthError || "missing code";
    res.writeHead(400, { "content-type": "text/plain" }).end("Login failed");
    console.error(`Login failed: ${msg}`);
    server.close();
    process.exit(1);
  }

  try {
    await exchangeCode(code);
    res
      .writeHead(200, { "content-type": "text/html" })
      .end("<h1>Login successful, you can close this tab</h1>");
    console.error(`Login successful. Tokens saved to ${tokensPath}`);
    server.close();
    process.exit(0);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain" }).end("Login failed");
    console.error(`Login failed: ${err instanceof Error ? err.message : "unknown error"}`);
    server.close();
    process.exit(1);
  }
});

server.listen(port, () => {
  console.error(`Waiting for callback on port ${port}...`);
});
