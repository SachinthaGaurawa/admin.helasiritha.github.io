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
/* Confirmed against Gemini's own live ListModels API (GET ?probe=models on
   this same file) after TWO rounds of guessing a specific version number
   went wrong: "gemini-3.8-pro" flat-out never existed (every request was
   silently eating a 404 on it before ever reaching a real model), and
   "gemini-3.8-flash" -- Google's own error text once named it the correct
   replacement for retired gemini-2.0-flash -- is a genuinely new, heavily
   hyped release that Google's shared pool keeps rate-limiting (503) under
   ordinary load, not a broken config.

   Both problems share one real fix: stop pinning a specific dated version
   at all. "-latest" is Google's own alias for "whatever the current best
   model actually is" -- it never 404s when Google ships a new version
   under the hood, which is the exact failure this file has now hit twice.
   Tried first (pro, for the higher accuracy the admin's Pro-tier account
   gives; then flash). The 2.5-generation models are the fallback after
   that: not brand new, not what everyone is currently hammering, so they
   are the candidates most likely to have spare capacity on a day the
   newest release is overloaded. Falls through to the next candidate on a
   404 (name genuinely gone) or once a model's own retries (see
   RETRYABLE_STATUS below) are exhausted -- never on an unrelated failure
   (bad key, safety-filter block), since those fail identically everywhere
   and retrying would just multiply wasted calls. */
const GEMINI_MODEL_CANDIDATES = ["gemini-pro-latest", "gemini-flash-latest", "gemini-2.5-pro", "gemini-2.5-flash"];
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

/* AUDIT MODE ─────────────────────────────────────────────────────────────
   Everything above generates a translation once, at the moment an admin
   clicks a button. It never re-checks a field again after that -- if the
   admin hand-edits just the English version of a paragraph six weeks later
   (a completely normal thing to do), the Sinhala/Tamil versions silently
   drift out of sync with no mechanism that would ever notice or say so.
   This mode is that missing check: given the THREE already-saved values
   for one field, ask whether they still actually say the same thing, and
   report the specific mismatch if they don't -- a proofreading pass over
   existing content, not a translation of new content. */
function buildAuditPrompt(langValues, fieldContext) {
  const lines = Object.keys(langValues)
    .filter((l) => langValues[l])
    .map((l) => LANG_NAMES[l] + ": " + langValues[l])
    .join("\n");
  return (
    "You are proofreading the three language versions of ONE field of a formal wedding " +
    "invitation, checking whether they are still faithful equivalents of each other.\n" +
    "Context for this field: " + (fieldContext || "a wedding invitation field") + "\n\n" +
    lines + "\n\n" +
    "Check specifically for: (1) a difference in MEANING or factual content between the " +
    "versions (a name, date, number, place, or relationship -- e.g. \"father\" vs \"parents\" -- " +
    "that doesn't match across all versions present); (2) a version that is missing content the " +
    "others have; (3) a proper noun (a person or place name) that is not phonetically the same " +
    "across versions. Do NOT flag natural differences in sentence structure, word order, or " +
    "formality register between languages -- those are expected and correct, not mistakes.\n\n" +
    "Respond with ONLY this exact JSON shape, no other text, no markdown fences:\n" +
    '{"consistent":true|false,"severity":"none|low|medium|high","issue":"...","suggestion":"..."}\n' +
    "consistent=true and severity=\"none\" with empty issue/suggestion if the versions genuinely " +
    "match; otherwise describe the SPECIFIC mismatch in \"issue\" (one sentence) and propose a " +
    "concrete fix in \"suggestion\" (one sentence)."
  );
}

function parseAuditJson(raw) {
  const cleaned = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const j = JSON.parse(cleaned);
  const severity = ["none", "low", "medium", "high"].includes(j.severity) ? j.severity : (j.consistent ? "none" : "medium");
  return {
    consistent: j.consistent === true,
    severity,
    issue: typeof j.issue === "string" ? j.issue : "",
    suggestion: typeof j.suggestion === "string" ? j.suggestion : "",
  };
}

async function callGeminiOnce(model, promptText, apiKey) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model +
    ":generateContent?key=" + encodeURIComponent(apiKey);
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
    })
  });
  if (!r.ok) {
    const errBody = await r.text();
    const err = new Error("Gemini HTTP " + r.status + ": " + errBody.slice(0, 300));
    err.status = r.status;
    throw err;
  }
  const j = await r.json();
  const raw = j && j.candidates && j.candidates[0] && j.candidates[0].content &&
    j.candidates[0].content.parts && j.candidates[0].content.parts[0] && j.candidates[0].content.parts[0].text;
  if (!raw) throw new Error("Gemini returned no content (possibly blocked by safety filters)");
  return raw;
}

/* Status codes worth retrying: Gemini's own free/shared capacity pool
   returns 503 "currently experiencing high demand" fairly routinely at
   busy times -- Google's own error text literally says "try again later",
   so failing outright on the very first 503 and making the admin manually
   re-click is leaving an easy, honest recovery on the table. 429 (rate
   limit) and 500/502/504 (transient upstream trouble) get the same
   treatment. 400/401/403 do NOT retry -- a malformed request or a bad/
   restricted key fails identically every time, so retrying just delays
   the real, actionable error for no benefit. One retry per model, not
   several: with four candidates now (see GEMINI_MODEL_CANDIDATES above),
   trying a genuinely DIFFERENT model is a more effective use of time than
   hammering the same overloaded one repeatedly, and keeps the worst-case
   total (every candidate, every retry) well under a typical serverless
   function's timeout budget for a request the admin is actively waiting
   on inline. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [600];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callGeminiWithFallback(promptText, apiKey) {
  let lastErr;
  for (const model of GEMINI_MODEL_CANDIDATES) {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const raw = await callGeminiOnce(model, promptText, apiKey);
        return { raw, model };
      } catch (e) {
        lastErr = e;
        if (e.status !== 404 && !RETRYABLE_STATUS.has(e.status)) throw e;
        const isLastAttempt = attempt === RETRY_DELAYS_MS.length;
        if (e.status === 404 || isLastAttempt) {
          console.error("ai-translate: " + model + " " +
            (e.status === 404 ? "unavailable (404)" : "still failing after retries (" + e.status + ")") +
            " -- trying next candidate");
          break;
        }
        console.error("ai-translate: " + model + " returned " + e.status + " (attempt " + (attempt + 1) +
          "/" + (RETRY_DELAYS_MS.length + 1) + "), retrying in " + RETRY_DELAYS_MS[attempt] + "ms");
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }
  throw lastErr;
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
    /* ?probe=models -- lists the model IDs Gemini_API_Helasiritha can
       actually see RIGHT NOW, straight from Google's own ListModels API,
       instead of this file continuing to guess model names from an error
       message and hope. The key's VALUE is never in the response, only
       model names (public information, same as Google's own docs list) --
       safe to leave unauthenticated like the rest of this GET handler,
       and this is exactly the diagnostic needed after GEMINI_MODEL_CANDIDATES
       guessed wrong (or right but momentarily overloaded) and nobody could
       tell which from outside. */
    const q = (req.query && req.query.probe) || (req.url && req.url.includes("probe=models") ? "models" : "");
    if (q === "models" && GEMINI_KEY) {
      try {
        const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?key=" + encodeURIComponent(GEMINI_KEY) + "&pageSize=200");
        const j = await r.json();
        if (!r.ok) { res.status(200).json({ error: "ListModels HTTP " + r.status, detail: j }); return; }
        const models = (Array.isArray(j.models) ? j.models : [])
          .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
          .map((m) => ({ name: String(m.name || "").replace(/^models\//, ""), displayName: m.displayName || "" }));
        res.status(200).json({ models, candidatesConfigured: GEMINI_MODEL_CANDIDATES, candidatesStillListed: GEMINI_MODEL_CANDIDATES.filter((c) => models.some((m) => m.name === c)) });
      } catch (e) {
        res.status(200).json({ error: (e && e.message) || String(e) });
      }
      return;
    }
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
  const fieldContext = String(body.fieldContext || "").slice(0, 300);

  if (body.mode === "audit") {
    const langValues = {
      si: String(body.si || "").trim().slice(0, 2000),
      en: String(body.en || "").trim().slice(0, 2000),
      ta: String(body.ta || "").trim().slice(0, 2000),
    };
    const filled = Object.keys(langValues).filter((l) => langValues[l]);
    if (filled.length < 2) {
      res.status(200).json({ ok: true, consistent: true, severity: "none", issue: "", suggestion: "" });
      return;
    }
    try {
      const { raw, model } = await callGeminiWithFallback(buildAuditPrompt(langValues, fieldContext), GEMINI_KEY);
      const parsed = parseAuditJson(raw);
      res.status(200).json({ ok: true, consistent: parsed.consistent, severity: parsed.severity, issue: parsed.issue, suggestion: parsed.suggestion, model });
    } catch (e) {
      console.error("ai-translate audit failed:", e && e.stack ? e.stack : e);
      res.status(502).json({ error: "Translation service unreachable or failed: " + (e && e.message ? e.message : String(e)) });
    }
    return;
  }

  const text = String(body.text || "").trim().slice(0, 2000);
  const fromLang = String(body.fromLang || "");
  const toLang = String(body.toLang || "");
  if (!text) { res.status(200).json({ ok: true, translation: "", confidence: "high", note: "" }); return; }
  if (!LANG_NAMES[fromLang] || !LANG_NAMES[toLang] || fromLang === toLang) {
    res.status(400).json({ error: "fromLang/toLang must be distinct values from si/en/ta" });
    return;
  }

  try {
    const { raw, model } = await callGeminiWithFallback(buildPrompt(text, fromLang, toLang, fieldContext), GEMINI_KEY);
    const parsed = parseGeminiJson(raw);
    res.status(200).json({ ok: true, translation: parsed.translation, confidence: parsed.confidence, note: parsed.note, model });
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
