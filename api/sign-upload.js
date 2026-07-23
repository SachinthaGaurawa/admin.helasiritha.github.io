/* ════════════════════════════════════════════════════════════════════════════
   හෙළ සිරිත · ADMIN REPOSITORY FILE  →  /api/sign-upload.js
   Vercel Node Serverless Function (no framework, no build step required).

   WHY THIS EXISTS
   ───────────────
   A static page can never hold a secret: anything shipped to the browser can be
   read from DevTools. This endpoint keeps CLOUDINARY_API_SECRET on the server
   and hands back only a short-lived signature, so the Cloudinary account cannot
   be abused even if someone reads every byte of admin.js.

   It is itself locked down: the caller must present a valid Firebase ID token
   belonging to the single administrator, verified against Google's identity
   service on every request. No token → no signature.

   REQUIRED ENVIRONMENT VARIABLES (Vercel → Settings → Environment Variables)
   ───────────────────────────────────────────────────────────────────────────
     CLOUDINARY_CLOUD_NAME   e.g. dzrfpc9be
     CLOUDINARY_API_KEY      from the Cloudinary console
     CLOUDINARY_API_SECRET   from the Cloudinary console  (NEVER prefix NEXT_PUBLIC_)
     FIREBASE_WEB_API_KEY    the Firebase Web API key (public value, used to verify tokens)
   ════════════════════════════════════════════════════════════════════════════ */

const crypto = require("crypto");

const ADMIN_EMAIL = "gaurawasachintha@gmail.com";
const ALLOWED_FOLDERS = ["helasiritha"];

/* Verify a Firebase ID token with Google and return the account behind it. */
async function verifyIdToken(idToken, apiKey) {
  const r = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(apiKey),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken })
    }
  );
  if (!r.ok) return null;
  const j = await r.json();
  const u = j && Array.isArray(j.users) && j.users[0];
  return u || null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const CLOUD  = process.env.CLOUDINARY_CLOUD_NAME;
  const KEY    = process.env.CLOUDINARY_API_KEY;
  const SECRET = process.env.CLOUDINARY_API_SECRET;
  const FBKEY  = process.env.FIREBASE_WEB_API_KEY;

  if (!CLOUD || !KEY || !SECRET || !FBKEY) {
    res.status(500).json({ error: "Server is not configured" });
    return;
  }

  /* ── 1. authenticate: single administrator only ───────────────────────── */
  const auth = String(req.headers.authorization || "");
  const idToken = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!idToken) { res.status(401).json({ error: "Missing token" }); return; }

  let user;
  try { user = await verifyIdToken(idToken, FBKEY); }
  catch (_) { res.status(401).json({ error: "Token verification failed" }); return; }

  const email = user && String(user.email || "").toLowerCase();
  const verified = !!(user && (user.emailVerified === true || user.emailVerified === "true"));
  if (!user || email !== ADMIN_EMAIL || !verified) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  /* ── 2. validate the parameters we are willing to sign ────────────────── */
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  body = body || {};

  const now = Math.floor(Date.now() / 1000);
  const timestamp = Number(body.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 120) {
    res.status(400).json({ error: "Bad timestamp" });
    return;
  }
  const folder = String(body.folder || "helasiritha");
  if (!ALLOWED_FOLDERS.includes(folder)) {
    res.status(400).json({ error: "Folder not allowed" });
    return;
  }

  /* ── 3. sign exactly those parameters (alphabetical, per Cloudinary spec) ─ */
  const toSign = "folder=" + folder + "&timestamp=" + timestamp;
  const signature = crypto.createHash("sha1").update(toSign + SECRET).digest("hex");

  res.status(200).json({ signature, apiKey: KEY, cloudName: CLOUD, timestamp, folder });
};
