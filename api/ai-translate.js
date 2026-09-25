/* ════════════════════════════════════════════════════════════════════════════
   හෙළ සිරිත · ADMIN REPOSITORY FILE  →  /api/ai-translate.js
   Vercel Node Serverless Function (no framework, no build step required).

   WHY THIS EXISTS
   ───────────────
   /api/transliterate.js handles NAMES (a person/place name respelled across
   scripts, same word, same sound -- phonetic transliteration is the correct
   and sufficient operation). It is deliberately NOT used for the details
   panel's sentence/phrase fields (the pre-line describing the bride/groom's
   parents, the ceremony-time phrase, every sannasa invitation-scroll line):
   those need real MEANING-based translation into different words per
   language, which a phonetic engine cannot do -- running one on a sentence
   produces nonsense, not a translation.

   This endpoint is that real translation, via the Gemini API, with a
   deliberate self-critique step in the SAME request: the model is asked to
   both translate AND assess its own translation's confidence, so an
   uncertain result can be flagged to the admin rather than silently
   presented as equally trustworthy as a confident one. This measurably
   reduces (does not, and cannot, eliminate) silent translation errors --
   see the admin-facing "AI පරිවර්තනයයි — පරීක්ෂා කරන්න" badge in app.js,
   which is the actual safety net: every AI-generated field stays fully
   editable, and low/medium-confidence results are visibly marked as
   needing a human's review before saving, exactly like every other
   auto-generated field in this admin panel already works.

   HONEST ACCURACY NOTE: no translation system -- free or paid, AI or
   human -- can guarantee zero mistakes for creative/formal language across
   three scripts. This endpoint's self-critique step is a real, standard
   technique that improves reliability; it is not, and cannot honestly be
   sold as, a 100%-accuracy guarantee.

   Auth-gated exactly like sign-upload.js/reset-visits.js/transliterate.js: a
   verified Firebase ID token belonging to the single administrator.

   REQUIRED ENVIRONMENT VARIABLES (Vercel → Settings → Environment Variables)
   ───────────────────────────────────────────────────────────────────────────
     FIREBASE_WEB_API_KEY      already required by every other /api/*.js file
                                 here -- reused to verify the caller's ID token.
     Gemini_API_Helasiritha    a Google AI Studio (Gemini) API key. Has a free
                                 tier with rate limits -- fine for a wedding
                                 site's traffic, but Google's own free-tier
                                 terms/limits are Google's to set, not this
                                 repo's to guarantee.
   ════════════════════════════════════════════════════════════════════════════ */

const ADMIN_EMAIL = "gaurawasachintha@gmail.com";
const GEMINI_MODEL = "gemini-2.0-flash";
const LANG_NAMES = { si: "Sinhala", en: "English", ta: "Tamil" };

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

/* One request asks Gemini to translate AND self-critique in the same call
   -- cheaper than two round-trips, and keeps the critique grounded in the
   exact translation it just produced rather than re-judging it cold. */
function buildPrompt(text, fromLang, toLang, fieldContext) {
  return (
    "You are translating one short piece of formal wedding-invitation text from " +
    LANG_NAMES[fromLang] + " to " + LANG_NAMES[toLang] + ".\n" +
    "Context for this specific text: " + (fieldContext || "a wedding invitation field") + "\n" +
    "Source text:\n" + text + "\n\n" +
    "Produce a translation that reads naturally and formally in " + LANG_NAMES[toLang] +
    " for a wedding invitation, preserving the ceremonial/honorific register of the original " +
    "(do not translate literally word-for-word if that would sound unnatural).\n\n" +
    "Then rate your OWN confidence in this translation as exactly one of: high, medium, low. " +
    "Use \"low\" if the source text is ambiguous, unusually idiomatic, or you are genuinely " +
    "unsure of a natural formal phrasing. Add a short note (one sentence, or empty string if " +
    "confidence is high) explaining what specifically you are unsure about.\n\n" +
    "Respond with ONLY this exact JSON shape, no other text, no markdown fences:\n" +
    '{"translation":"...","confidence":"high|medium|low","note":"..."}'
  );
}

function parseGeminiJson(raw) {
  /* Models occasionally wrap JSON in ```json fences despite instructions --
     strip those before parsing rather than failing outright. */
  const cleaned = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const j = JSON.parse(cleaned);
  if (typeof j.translation !== "string") throw new Error("missing translation field");
  const confidence = ["high", "medium", "low"].includes(j.confidence) ? j.confidence : "medium";
  return { translation: j.translation, confidence, note: typeof j.note === "string" ? j.note : "" };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const FBKEY = process.env.FIREBASE_WEB_API_KEY;
  const GEMINI_KEY = process.env.Gemini_API_Helasiritha;

  if (req.method === "GET") {
    res.status(200).json({ configured: { firebaseKey: !!FBKEY, geminiKey: !!GEMINI_KEY }, ready: !!(FBKEY && GEMINI_KEY) });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!FBKEY) { res.status(500).json({ error: "Server is not configured (FIREBASE_WEB_API_KEY missing)" }); return; }
  if (!GEMINI_KEY) { res.status(500).json({ error: "Server is not configured (Gemini_API_Helasiritha missing)" }); return; }

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
  const text = String(body.text || "").trim().slice(0, 2000);
  const fromLang = String(body.fromLang || "");
  const toLang = String(body.toLang || "");
  const fieldContext = String(body.fieldContext || "").slice(0, 300);
  if (!text) { res.status(200).json({ ok: true, translation: "", confidence: "high", note: "" }); return; }
  if (!LANG_NAMES[fromLang] || !LANG_NAMES[toLang] || fromLang === toLang) {
    res.status(400).json({ error: "fromLang/toLang must be distinct values from si/en/ta" });
    return;
  }

  try {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL +
      ":generateContent?key=" + encodeURIComponent(GEMINI_KEY);
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(text, fromLang, toLang, fieldContext) }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
      })
    });
    if (!r.ok) {
      const errBody = await r.text();
      throw new Error("Gemini HTTP " + r.status + ": " + errBody.slice(0, 300));
    }
    const j = await r.json();
    const raw = j && j.candidates && j.candidates[0] && j.candidates[0].content &&
      j.candidates[0].content.parts && j.candidates[0].content.parts[0] && j.candidates[0].content.parts[0].text;
    if (!raw) throw new Error("Gemini returned no content (possibly blocked by safety filters)");
    const parsed = parseGeminiJson(raw);
    res.status(200).json({ ok: true, translation: parsed.translation, confidence: parsed.confidence, note: parsed.note });
  } catch (e) {
    /* Logged server-side (visible in Vercel's runtime logs), not just
       returned in the response -- the FIRST reported failure of this
       endpoint showed only a generic "අසාර්ථකයි" in the admin UI with no
       way to tell what actually went wrong (bad model name, a restricted
       API key, a safety-filter block, etc. all look identical from the
       client's side otherwise). */
    console.error("ai-translate failed:", e && e.stack ? e.stack : e);
    res.status(502).json({ error: "Translation service unreachable or failed: " + (e && e.message ? e.message : String(e)) });
  }
};
