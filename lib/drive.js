/* ════════════════════════════════════════════════════════════════════════
 *  හෙළ සිරිත · SERVER-SIDE DRIVE HELPERS  ·  lib/drive.js   (ADMIN · Vercel)
 *  ────────────────────────────────────────────────────────────────────────
 *  Runs ONLY on the Vercel server (never shipped to the browser). Zero npm
 *  dependencies — uses Node's built-in `crypto` + the global `fetch`.
 *
 *  Provides:
 *   • getAccessToken() — mints a Google service-account OAuth token (RS256 JWT
 *     grant) for the Drive scope, using GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY.
 *   • verifyAdmin(req) — verifies the caller's Firebase ID token (RS256 against
 *     Google's public certs) AND that the email is the admin. Throws if not.
 *   • applyCors(req,res) — strict origin allowlist for the two known sites.
 *
 *  REQUIRED Vercel env vars (Project → Settings → Environment Variables):
 *     GOOGLE_CLIENT_EMAIL      firebase-adminsdk-…@helasiritha-official.iam.gserviceaccount.com
 *     GOOGLE_PRIVATE_KEY       the PEM key (with literal \n line breaks)
 *     GOOGLE_DRIVE_FOLDER_ID   1GESo8qSscb9aKYr-3U2dcvBjh8ToYotg
 *     (optional) FIREBASE_PROJECT_ID  helasiritha-official   ·   ADMIN_EMAIL  gaurawasachintha@gmail.com
 * ════════════════════════════════════════════════════════════════════════ */

const crypto = require("node:crypto");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlJson(obj) { return b64url(Buffer.from(JSON.stringify(obj), "utf8")); }
function b64urlDecode(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

/* ── service-account access token (cached across warm invocations) ── */
let _tok = null, _tokExp = 0;
async function getAccessToken() {
  if (_tok && Date.now() < _tokExp - 60000) return _tok;
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  let key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("server-misconfigured");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = { iss: email, scope: DRIVE_SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(claim)}`;
  const sig = crypto.createSign("RSA-SHA256").update(signingInput).sign(key);
  const jwt = `${signingInput}.${b64url(sig)}`;
  const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt });
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
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

module.exports = { getAccessToken, verifyAdmin, applyCors };
