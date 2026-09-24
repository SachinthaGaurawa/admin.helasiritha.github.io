/* ════════════════════════════════════════════════════════════════════════════
   හෙළ සිරිත · ADMIN REPOSITORY FILE  →  /api/reset-visits.js
   Vercel Node Serverless Function (no framework, no build step required —
   same philosophy as api/sign-upload.js, deliberately not pulling in the
   full firebase-admin SDK for one endpoint).

   WHY THIS EXISTS
   ───────────────
   firestore.rules sets `allow update, delete: if false` on /visits,
   unconditionally — including for the signed-in admin. That's intentional
   (an append-only, tamper-evident log), but it also means the "ගණන් ශුන්‍ය
   කිරීම" (reset visit counts) button in the admin panel could never
   actually work from the client SDK, no matter who was signed in or how
   many times they retried.

   Firestore Security Rules only govern access through the Firebase client
   SDKs (web/iOS/Android) and the Firebase-authenticated REST surface. A
   request authenticated as a Google Cloud service account IAM identity
   instead — via the plain Firestore REST API, with an OAuth2 access token
   obtained by signing a JWT with that service account's own private key —
   bypasses Security Rules entirely, the same way the Firebase Admin SDK
   does server-side. That's the actual mechanism this endpoint relies on;
   it is re-implemented here by hand (self-signed JWT → token exchange →
   plain REST calls) with Node's built-in `crypto` and `fetch`, rather than
   adding `firebase-admin` as a dependency, so this repository keeps its
   existing no-build-step, no-package.json architecture.

   It is locked down exactly like sign-upload.js: the caller must present a
   valid Firebase ID token belonging to the single administrator, verified
   against Google's identity service on every request.

   REQUIRED ENVIRONMENT VARIABLES (Vercel → Settings → Environment Variables)
   ───────────────────────────────────────────────────────────────────────────
     FIREBASE_WEB_API_KEY          already required by sign-upload.js — reused
                                    here to verify the caller's ID token.
     FIREBASE_SERVICE_ACCOUNT_JSON the ENTIRE JSON key file's contents, as one
                                    string. Generate it yourself, once, from:
                                      Firebase Console → helasiritha-official
                                      → Project settings (gear icon) → Service
                                      accounts tab → "Generate new private key"
                                    That downloads a .json file — paste its
                                    whole contents as this one environment
                                    variable's value in Vercel (multi-line
                                    values are fine). This key grants full
                                    read/write over the project's Firestore —
                                    treat it exactly like a database password:
                                    it only ever belongs in Vercel's env var
                                    store, never in a repo, a chat message, or
                                    anywhere client-side.
   ════════════════════════════════════════════════════════════════════════════ */

const crypto = require("crypto");

const ADMIN_EMAIL = "gaurawasachintha@gmail.com";
const VISIT_KINDS = ["qr", "web", "direct"];
const DATASTORE_SCOPE = "https://www.googleapis.com/auth/datastore";

/* Verify a Firebase ID token with Google and return the account behind it.
   Identical to sign-upload.js's own copy — kept duplicated rather than
   shared, since this project has no build step to import a shared module
   from, and the function is short enough that duplicating it is cheaper
   than the alternative (a bundler, or an HTTP round-trip to share it). */
async function verifyIdToken(idToken, apiKey) {
  const r = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(apiKey),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) }
  );
  if (!r.ok) return null;
  const j = await r.json();
  const u = j && Array.isArray(j.users) && j.users[0];
  return u || null;
}

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* Self-signed JWT for a Google service account (RFC 7523) -- exactly what
   google-auth-library/firebase-admin do internally, written out by hand so
   this endpoint needs no dependency beyond Node's built-in `crypto`. */
function signServiceAccountJWT(sa, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = { iss: sa.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 };
  const unsigned = base64url(JSON.stringify(header)) + "." + base64url(JSON.stringify(claim));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  return unsigned + "." + base64url(signer.sign(sa.private_key));
}

async function getAccessToken(sa, scope) {
  const jwt = signServiceAccountJWT(sa, scope);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + encodeURIComponent(jwt)
  });
  if (!r.ok) throw new Error("token exchange failed: " + r.status + " " + (await r.text()).slice(0, 300));
  const j = await r.json();
  return j.access_token;
}

/* List every /visits document name, optionally filtered to one kind.
   structuredQuery has no offset-based pagination worth using here (a
   wedding site's total visit count is realistically in the thousands, not
   millions) -- runQuery streams its results as one JSON array, each entry
   either a real match or a bare heartbeat ({readTime} with no document). */
async function listVisitNames(projectId, token, kind) {
  const body = {
    structuredQuery: {
      from: [{ collectionId: "visits" }],
      select: { fields: [{ fieldPath: "__name__" }] },
      ...(kind ? { where: { fieldFilter: { field: { fieldPath: "kind" }, op: "EQUAL", value: { stringValue: kind } } } } : {})
    }
  };
  const r = await fetch(
    "https://firestore.googleapis.com/v1/projects/" + projectId + "/databases/(default)/documents:runQuery",
    { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) }
  );
  if (!r.ok) throw new Error("runQuery failed: " + r.status + " " + (await r.text()).slice(0, 300));
  const rows = await r.json();
  return rows.filter(x => x && x.document && x.document.name).map(x => x.document.name);
}

/* Firestore's :commit accepts at most 500 writes per request -- same limit
   the old client-side batch delete respected, for the same reason. */
async function deleteInChunks(projectId, token, names) {
  let deleted = 0;
  for (let i = 0; i < names.length; i += 500) {
    const chunk = names.slice(i, i + 500);
    const r = await fetch(
      "https://firestore.googleapis.com/v1/projects/" + projectId + "/databases/(default)/documents:commit",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ writes: chunk.map(name => ({ delete: name })) })
      }
    );
    if (!r.ok) throw new Error("commit failed: " + r.status + " " + (await r.text()).slice(0, 300));
    deleted += chunk.length;
  }
  return deleted;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const FBKEY = process.env.FIREBASE_WEB_API_KEY;
  const SA_RAW = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  /* Same "tell the admin UI exactly what's missing" diagnostic pattern as
     sign-upload.js's own GET branch -- never reveals a value, only whether
     each one is present, so the button can say "set this up first" instead
     of failing with an opaque 500 the first time anyone tries it. */
  if (req.method === "GET") {
    let saValid = false;
    try { const sa = JSON.parse(SA_RAW || "null"); saValid = !!(sa && sa.client_email && sa.private_key && sa.project_id); } catch (_) {}
    res.status(200).json({
      configured: { firebaseKey: !!FBKEY, serviceAccount: saValid },
      ready: !!(FBKEY && saValid)
    });
    return;
  }

  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!FBKEY) { res.status(500).json({ error: "Server is not configured (FIREBASE_WEB_API_KEY missing)" }); return; }

  let sa;
  try { sa = JSON.parse(SA_RAW || ""); if (!sa || !sa.client_email || !sa.private_key || !sa.project_id) throw new Error("incomplete"); }
  catch (_) { res.status(500).json({ error: "Server is not configured (FIREBASE_SERVICE_ACCOUNT_JSON missing or invalid)" }); return; }

  /* ── 1. authenticate: single administrator only ───────────────────────── */
  const auth = String(req.headers.authorization || "");
  const idToken = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!idToken) { res.status(401).json({ error: "Missing token" }); return; }

  let user;
  try { user = await verifyIdToken(idToken, FBKEY); }
  catch (_) { res.status(401).json({ error: "Token verification failed" }); return; }

  const email = user && String(user.email || "").toLowerCase();
  const verified = !!(user && (user.emailVerified === true || user.emailVerified === "true"));
  if (!user || email !== ADMIN_EMAIL || !verified) { res.status(403).json({ error: "Forbidden" }); return; }

  /* ── 2. validate the one parameter this endpoint accepts ──────────────── */
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  body = body || {};
  const kind = body.kind == null || body.kind === "" ? null : String(body.kind);
  if (kind !== null && !VISIT_KINDS.includes(kind)) { res.status(400).json({ error: "Invalid kind" }); return; }

  /* ── 3. mint a service-account access token, then do the actual delete ── */
  try {
    const token = await getAccessToken(sa, DATASTORE_SCOPE);
    const names = await listVisitNames(sa.project_id, token, kind);
    if (!names.length) { res.status(200).json({ ok: true, deleted: 0 }); return; }
    const deleted = await deleteInChunks(sa.project_id, token, names);
    res.status(200).json({ ok: true, deleted });
  } catch (e) {
    res.status(500).json({ error: "Reset failed: " + (e && e.message ? e.message : String(e)) });
  }
};
