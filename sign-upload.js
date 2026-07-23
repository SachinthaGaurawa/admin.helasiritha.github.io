/* ════════════════════════════════════════════════════════════════════════════
   හෙළ සිරිත · ADMIN REPOSITORY FILE  →  /api/sign-upload.js
   Vercel Node Serverless Function — zero-config, no framework, no build step.

   WHAT IT DOES
   ────────────
   A static page can never hold a secret: anything shipped to the browser can be
   read from DevTools. This endpoint keeps CLOUDINARY_API_SECRET on the server and
   returns only a short-lived signature, so the Cloudinary account stays safe even
   if someone reads every byte of app.js. Signed uploads also need NO upload
   preset at all — that whole class of "Upload preset not found" simply disappears.

   It is itself locked down: the caller must present a valid Firebase ID token
   belonging to the single administrator, verified against Google on every call.

   ENVIRONMENT VARIABLES (Vercel → Settings → Environment Variables)
   ─────────────────────────────────────────────────────────────────
   Either the three explicit values …
     CLOUDINARY_CLOUD_NAME     e.g. dzrfpc9be
     CLOUDINARY_API_KEY        from the Cloudinary console
     CLOUDINARY_API_SECRET     from the Cloudinary console   ← never NEXT_PUBLIC_*
   … or just the single connection string, which contains all three:
     CLOUDINARY_URL            cloudinary://API_KEY:API_SECRET@CLOUD_NAME

   FIREBASE_WEB_API_KEY is OPTIONAL. It is a public value (it already ships inside
   app.js), so a built-in fallback is used when it is absent. Security comes from
   verifying the token and matching the e-mail — never from hiding this key.

   SELF-TEST
   ─────────
   GET /api/sign-upload  →  { ok, configured:{…} }
   Booleans only, never values. The admin panel's "ආරක්ෂාව" module calls this so
   a misconfiguration is visible immediately instead of failing silently.
   ════════════════════════════════════════════════════════════════════════════ */

const crypto = require("crypto");

const ADMIN_EMAIL = "gaurawasachintha@gmail.com";
const ALLOWED_FOLDERS = ["helasiritha"];
/* Public Firebase Web API key — identical to the one in app.js. Used ONLY to ask
   Google "who does this ID token belong to?". Safe to embed. */
const FIREBASE_WEB_API_KEY_FALLBACK = "AIzaSyCC18zyof_ORDkKwxAMJK4G3Atu2AkWodM";

/* Accept either the three explicit vars or the single CLOUDINARY_URL. */
function cloudinaryConfig() {
  let cloudName = process.env.CLOUDINARY_CLOUD_NAME || "";
  let apiKey    = process.env.CLOUDINARY_API_KEY || "";
  let apiSecret = process.env.CLOUDINARY_API_SECRET || "";

  const url = process.env.CLOUDINARY_URL || "";
  if (url && (!cloudName || !apiKey || !apiSecret)) {
    // cloudinary://<api_key>:<api_secret>@<cloud_name>
    const m = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(url.trim());
    if (m) {
      apiKey    = apiKey    || m[1];
      apiSecret = apiSecret || m[2];
      cloudName = cloudName || m[3];
    }
  }
  return { cloudName: cloudName.trim(), apiKey: apiKey.trim(), apiSecret: apiSecret.trim() };
}

/* Verify a Firebase ID token with Google and return the account behind it. */
async function verifyIdToken(idToken, apiKey) {
  const r = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(apiKey),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) }
  );
  if (!r.ok) return null;
  const j = await r.json();
  return (j && Array.isArray(j.users) && j.users[0]) || null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const cfg = cloudinaryConfig();
  const fbKey = process.env.FIREBASE_WEB_API_KEY || FIREBASE_WEB_API_KEY_FALLBACK;

  /* ── self-test: presence only, never values ───────────────────────────── */
  if (req.method === "GET") {
    res.status(200).json({
      ok: true,
      endpoint: "sign-upload",
      configured: {
        cloudName: !!cfg.cloudName,
        apiKey: !!cfg.apiKey,
        apiSecret: !!cfg.apiSecret,
        firebaseKey: !!fbKey,
        via: process.env.CLOUDINARY_URL ? "CLOUDINARY_URL or explicit vars" : "explicit vars"
      },
      ready: !!(cfg.cloudName && cfg.apiKey && cfg.apiSecret && fbKey)
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed", message: "Use POST." });
    return;
  }

  if (!cfg.cloudName || !cfg.apiKey || !cfg.apiSecret) {
    const missing = [];
    if (!cfg.cloudName) missing.push("CLOUDINARY_CLOUD_NAME");
    if (!cfg.apiKey)    missing.push("CLOUDINARY_API_KEY");
    if (!cfg.apiSecret) missing.push("CLOUDINARY_API_SECRET");
    res.status(500).json({
      error: "missing_config",
      message: "Missing environment variable(s): " + missing.join(", ") +
               " — add them in Vercel (or set CLOUDINARY_URL) and redeploy."
    });
    return;
  }

  /* ── authenticate: the single administrator only ──────────────────────── */
  const auth = String(req.headers.authorization || "");
  const idToken = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!idToken) {
    res.status(401).json({ error: "no_token", message: "Sign in to the admin panel first." });
    return;
  }

  let user = null;
  try { user = await verifyIdToken(idToken, fbKey); }
  catch (_) {
    res.status(401).json({ error: "verify_failed", message: "Could not verify the ID token with Google." });
    return;
  }
  const email = user && String(user.email || "").toLowerCase();
  const verified = !!(user && (user.emailVerified === true || user.emailVerified === "true"));
  if (!user)                     { res.status(401).json({ error: "bad_token",  message: "ID token rejected." }); return; }
  if (email !== ADMIN_EMAIL)     { res.status(403).json({ error: "forbidden",  message: "Only the root administrator may upload." }); return; }
  if (!verified)                 { res.status(403).json({ error: "unverified", message: "The account e-mail is not verified." }); return; }

  /* ── sign ─────────────────────────────────────────────────────────────── */
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  body = body || {};

  const folder = ALLOWED_FOLDERS.includes(String(body.folder || "")) ? String(body.folder) : ALLOWED_FOLDERS[0];

  /* The SERVER owns the timestamp. A phone with a drifting clock previously made
     every signature invalid; the client now echoes back whatever we signed. */
  const now = Math.floor(Date.now() / 1000);
  const asked = Number(body.timestamp);
  const timestamp = (Number.isFinite(asked) && Math.abs(now - asked) <= 120) ? Math.floor(asked) : now;

  /* Cloudinary spec: sign the parameters alphabetically as key=value&key=value,
     append the api_secret, then SHA-1. `file`, `api_key` and `resource_type`
     are excluded from the signature. */
  const toSign = "folder=" + folder + "&timestamp=" + timestamp;
  const signature = crypto.createHash("sha1").update(toSign + cfg.apiSecret).digest("hex");

  res.status(200).json({
    signature, timestamp, folder,
    apiKey: cfg.apiKey,
    cloudName: cfg.cloudName
  });
};
