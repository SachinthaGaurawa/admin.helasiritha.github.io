/* ════════════════════════════════════════════════════════════════════════════
   හෙළ සිරිත · ADMIN REPOSITORY FILE  →  /api/transliterate.js
   Vercel Node Serverless Function (no framework, no build step required).

   WHY THIS EXISTS
   ───────────────
   A guest's name is stored in whichever ONE script the admin happened to type
   it in (English, Sinhala or Tamil) -- but the public RSVP search box is used
   by guests typing in any of the three languages. A name typed in only one
   script is invisible to a search typed in another, which is exactly the bug
   reported: a Sinhala-speaking guest whose name was entered in English (or a
   Tamil-speaking guest whose name was entered in Sinhala/English) could not
   find themselves.

   The fix (see app.js's guest-add form) stores THREE linked variants of the
   same name -- Sinhala, English, Tamil -- generated automatically as the
   admin types in any one of them, remaining fully editable before saving.
   This endpoint is the EN → Sinhala/Tamil half of that: it proxies Google's
   public, unauthenticated, no-API-key "Input Tools" transliteration service
   (the same phonetic-transliteration engine behind Google's own Sinhala/
   Tamil web keyboards, and the one most "type English, get Sinhala Unicode"
   web tools already rely on) so the browser doesn't need to call a
   third-party host directly (avoiding any CORS uncertainty, and giving this
   one file a single place to fix if that endpoint's shape ever changes).

   The REVERSE direction -- Sinhala/Tamil script typed first, generating an
   English romanization -- has no equivalent free, accurate API (transliterating
   FROM a native script TO Latin is far less standardized than the other way
   around: multiple romanizations of the same name are all "correct"). That
   direction is instead handled locally, in the browser, by a small rule-based
   phonetic mapping table in app.js -- see siToEn()/taToEn() there for why.

   HONEST ACCURACY NOTE: no free (or paid) service gets personal-name
   transliteration perfect every time -- names are proper nouns, not words
   with a "correct" translation, and the same name legitimately has multiple
   valid spellings across scripts even among native speakers. This endpoint
   gives a strong first guess; the admin form always leaves every generated
   field editable before saving, which is the same safety net every real
   transliteration system relies on.

   Auth-gated exactly like sign-upload.js/reset-visits.js: a verified Firebase
   ID token belonging to the single administrator. Nothing secret is proxied
   here (Google's endpoint needs no API key), but gating it stops this
   repo's Vercel function from being usable as an open, anonymous proxy for
   an unrelated third party's traffic.

   REQUIRED ENVIRONMENT VARIABLES (Vercel → Settings → Environment Variables)
   ───────────────────────────────────────────────────────────────────────────
     FIREBASE_WEB_API_KEY   already required by sign-upload.js/reset-visits.js
                             -- reused here to verify the caller's ID token.
   ════════════════════════════════════════════════════════════════════════════ */

const ADMIN_EMAIL = "gaurawasachintha@gmail.com";
/* Google's own language/input-tool codes for phonetic (Latin → native)
   transliteration -- "t-i0-und" is their standard suffix for a phonetic
   (not dictionary) transliteration input method. */
const ITC = { si: "si-t-i0-und", ta: "ta-t-i0-und" };

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

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const FBKEY = process.env.FIREBASE_WEB_API_KEY;

  if (req.method === "GET") {
    res.status(200).json({ configured: { firebaseKey: !!FBKEY }, ready: !!FBKEY });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!FBKEY) { res.status(500).json({ error: "Server is not configured (FIREBASE_WEB_API_KEY missing)" }); return; }

  const auth = String(req.headers.authorization || "");
  const idToken = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!idToken) { res.status(401).json({ error: "Missing token" }); return; }

  let user;
  try { user = await verifyIdToken(idToken, FBKEY); }
  catch (_) { res.status(401).json({ error: "Token verification failed" }); return; }

  const email = user && String(user.email || "").toLowerCase();
  const verified = !!(user && (user.emailVerified === true || user.emailVerified === "true"));
  if (!user || email !== ADMIN_EMAIL || !verified) { res.status(403).json({ error: "Forbidden" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  body = body || {};
  const text = String(body.text || "").trim().slice(0, 200);
  const lang = String(body.lang || "");
  if (!text) { res.status(200).json({ ok: true, result: "" }); return; }
  if (!ITC[lang]) { res.status(400).json({ error: "lang must be 'si' or 'ta'" }); return; }

  try {
    const url = "https://inputtools.google.com/request?text=" + encodeURIComponent(text) +
      "&itc=" + ITC[lang] + "&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8";
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) throw new Error("upstream HTTP " + r.status);
    const j = await r.json();
    /* Response shape: ["SUCCESS", [[ "<input echoed back>", ["<candidate1>", "<candidate2>", ...], ... ]]]
       -- take the first (best-ranked) candidate for the first (only) word group. */
    const candidates = j && j[0] === "SUCCESS" && j[1] && j[1][0] && j[1][0][1];
    const result = (candidates && candidates[0]) || text;
    res.status(200).json({ ok: true, result });
  } catch (e) {
    res.status(502).json({ error: "Transliteration service unreachable: " + (e && e.message ? e.message : String(e)) });
  }
};
