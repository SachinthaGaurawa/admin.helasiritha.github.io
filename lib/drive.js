/* ════════════════════════════════════════════════════════════════════════
 *  හෙළ සිරිත · SERVER-SIDE DRIVE HELPERS  ·  lib/drive.js   (ADMIN · Vercel)
 *  (Fixed for Free Gmail Accounts using OAuth Refresh Token)
 * ════════════════════════════════════════════════════════════════════════ */

const crypto = require("node:crypto");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

function b64urlDecode(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

/* ── Diagnostic tool compatibility ── */
function loadServiceAccount() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
  if (b64 && b64.trim()) {
    const sa = JSON.parse(Buffer.from(b64.trim(), "base64").toString("utf8"));
    return { email: sa.client_email, key: sa.private_key, src: "b64" };
  }
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (raw && raw.trim()) {
    const sa = JSON.parse(raw);
    return { email: sa.client_email, key: sa.private_key, src: "json" };
  }
  return { email: "admin@gmail.com", key: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----", src: "oauth" };
}

/* ── OAuth2 Refresh Token (Acts via your 15GB Gmail Quota) ── */
let _tok = null, _tokExp = 0;
async function getAccessToken() {
  if (_tok && Date.now() < _tokExp - 60000) return _tok;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("server-misconfigured: Missing OAuth variables");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error("token-failed:" + (j.error || r.status));

  _tok = j.access_token;
  _tokExp = Date.now() + (Number(j.expires_in || 3600) * 1000);
  return _tok;
}

/* ── Firebase ID-token verification + admin lock ── */
let _certs = null, _certsExp = 0;
async function googleCerts() {
  if (_certs && Date.now() < _certsExp) return _certs;
  const r = await fetch(CERTS_URL);
  const j = await r.json();
  const cc = r.headers.get("cache-control") || "";
  const m = cc.match(/max-age=(\d+)/);
  _certsExp = Date.now() + ((m ? Number(m[1]) : 3600) * 1000);
  _certs = j;
  return j;
}

async function verifyAdmin(req) {
  const authz = req.headers["authorization"] || req.headers["Authorization"] || "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
  if (!token) throw new Error("no-token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("bad-token");
  const header = JSON.parse(b64urlDecode(parts[0]).toString("utf8"));
  const payload = JSON.parse(b64urlDecode(parts[1]).toString("utf8"));
  const projectId = process.env.FIREBASE_PROJECT_ID || "helasiritha-official";
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) throw new Error("bad-aud");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error("bad-iss");
  if (!payload.exp || payload.exp < now) throw new Error("expired");
  if (!payload.sub) throw new Error("no-sub");
  const certs = await googleCerts();
  const pem = certs[header.kid];
  if (!pem) throw new Error("no-cert");
  const ok = crypto.createVerify("RSA-SHA256").update(parts[0] + "." + parts[1]).verify(pem, b64urlDecode(parts[2]));
  if (!ok) throw new Error("bad-sig");
  const adminEmail = (process.env.ADMIN_EMAIL || "gaurawasachintha@gmail.com").toLowerCase();
  if (String(payload.email || "").toLowerCase() !== adminEmail) throw new Error("not-admin");
  return payload;
}

/* ── strict CORS allowlist ── */
const ALLOWED = [
  "https://admin-helasiritha.vercel.app",
  "https://helasiritha.vercel.app",
  "https://sachinthagaurawa.github.io",
];
function applyCors(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

module.exports = { getAccessToken, verifyAdmin, applyCors, loadServiceAccount };
