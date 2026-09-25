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
/* Confirmed against real production runtime logs (Vercel -> this function's
   own console.error trail), not another guess: the failures are NOT about
   a wrong/dead model name. gemini-2.5-pro and gemini-2.5-flash looked like
   safe established fallbacks (ListModels lists both) but actually 404 with
   "no longer available to NEW USERS" -- this Google Cloud project is too
   recent to have grandfathered access to that generation at all, so they
   can never succeed and were pure wasted calls burning more of the same
   limited quota. Dropped entirely.

   Ordering below was corrected AGAIN after watching a live burst of admin
   clicks in these same logs: gemini-flash-latest (plain flash, not lite)
   failed on every single one of 11 back-to-back requests -- first 503
   "high demand", then, once its own per-minute bucket was hit, 429 "quota
   exceeded" -- while gemini-flash-lite-latest succeeded on every one of
   those same requests, no retry needed. That is the opposite of what an
   earlier version of this comment assumed ("flash has the most quota,
   pro the least"): in practice Google's free tier grants the LITE tier
   the most requests-per-minute of the three, since it is the cheapest to
   serve -- plain flash sits in the middle, and pro is the most
   quota-constrained. Putting flash-latest first meant EVERY admin click
   (translate button, "Translate All", the audit feature, the Security
   panel's real-Gemini-test button) paid a wasted 600ms-4s round trip
   against a model that was, in practice, already exhausted, before
   falling through to the one that actually answers. Reordered by that
   observed reliability, most-generous-quota first: flash-lite, then
   flash, then pro last (still the best QUALITY tier, but also the
   smallest quota, so now purely a fallback rather than something tried on
   every single request). Falls through to the next candidate on a 404
   (name genuinely gone/inaccessible to this account) or once a model's
   own retries (see RETRYABLE_STATUS below) are exhausted -- never on an
   unrelated failure (bad key, safety-filter block), since those fail
   identically everywhere and retrying would just multiply wasted calls.

   IMPORTANT, and outside what any model-list reorder can fix: if EVERY
   candidate here is still 429ing, that is the account's actual quota
   window (per-minute or per-day) being exhausted across all three tiers
   at once, and no amount of retrying inside one request changes that --
   see Google AI Studio's quota/billing page for this key; enabling
   pay-as-you-go billing raises these limits substantially over the free
   tier. */
const GEMINI_MODEL_CANDIDATES = ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-pro-latest"];
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

/* BRAND VOICE ─────────────────────────────────────────────────────────────
   Explicit, repeated instruction from the site owner: this is for
   "Helasiritha" -- a formal Sri Lankan wedding invitation whose entire
   identity rests on royal dignity, pride, gravitas, and being 100%
   culturally authentic. A technically-accurate but stiff, literal,
   word-for-word translation reads as machine-generated, not as something a
   fluent, culturally-fluent human would write for this occasion -- and
   that mismatch is treated as seriously as a factual mistake, not a mere
   style preference. Shared by both buildPrompt (new translations) and
   buildAuditPrompt (so a proposed correction inherits the same voice, not
   just the original translation). */
const BRAND_VOICE = (
  "VOICE (apply this to whichever language you are writing in): this text is for " +
  "\"Helasiritha\", a formal Sri Lankan wedding invitation whose whole identity is " +
  "royal dignity, warmth, and 100% authentic cultural tradition. Every version must " +
  "read as if written by a fluent native speaker deeply versed in THAT language's " +
  "own classical, ceremonial wedding-invitation literary tradition -- never as a " +
  "mechanical, literal, word-for-word rendering that merely swaps vocabulary while " +
  "keeping the source language's sentence structure. Specifically:\n" +
  "- Sinhala: the traditional ceremonial register used in formal Sinhala wedding " +
  "invitations and sannasa scrolls (e.g. සුභ මංගල්‍යය, පාණිග්‍රහණය, ආචාර්ය මාන්‍ය, " +
  "ආදරණීය, මහත්මාණෝ/මහත්මිය වැනි සාම්ප්‍රදායික ගෞරව වචන) -- not casual spoken Sinhala, " +
  "and not a stiff calque of the source language's grammar.\n" +
  "- Tamil: the classical, elegant register used in formal Tamil wedding invitations " +
  "(e.g. சுப மங்களம், திருமண வைபவம், அன்புடன் அழைக்கிறோம் போன்ற பாரம்பரிய சொற்றொடர்கள்) -- " +
  "not a literal transliteration-style rendering of the source language's structure.\n" +
  "- English: the elegant, dignified formal register of traditional South Asian " +
  "wedding invitations (e.g. \"cordially invite\", \"request the honour/pleasure of " +
  "your company\", \"the beloved daughter/son of\") -- not a stiff calque of the " +
  "Sinhala/Tamil source's grammar.\n" +
  "A technically-correct but unnatural, machine-sounding sentence is exactly the " +
  "kind of mistake this whole effort exists to catch -- if a literal rendering " +
  "would sound robotic or mechanical, rephrase freely while preserving the exact " +
  "meaning, warmth, and ceremonial gravitas of the original."
);

/* CONFIDENCE CALIBRATION ────────────────────────────────────────────────
   Explicit, repeated request: the confidence signal itself must become a
   genuinely reliable predictor of "does this need a human to check it",
   not just a vibe the model attaches after the fact. Two changes make
   that real, together:

   1. The model no longer picks "high/medium/low" as a single holistic
      judgement call -- it must first answer four SPECIFIC true/false
      questions about the translation (see buildPrompt/buildAuditPrompt),
      then derive confidence FROM those answers by an explicit rule this
      prompt states outright. Forcing the reasoning to go through named,
      checkable criteria before a label is a standard, real technique for
      improving an LLM's self-assessment calibration -- a free-form "how
      confident are you?" is measurably less reliable than "did you flag
      ambiguity? idiom? register risk? a name you're unsure of?".
   2. This server never simply trusts whatever confidence label the model
      typed, even after that. deriveConfidence() below recomputes an
      independent confidence FROM the same risk-factor answers and takes
      the MORE CONSERVATIVE (lower) of the two -- so a model that flags
      two real risk factors but still types "high" (a genuine miscalibration,
      not hypothetical -- self-generated content is well known to bias an
      LLM's own judgement of it favorably) gets overridden down to what
      its own stated risk factors actually support. The reported label can
      never be rounded UP by this, only held to what it already claimed to
      have checked for. */
const CONF_RANK = { low: 0, medium: 1, high: 2 };
function deriveConfidence(reportedConfidence, riskFactors) {
  const trueCount = Object.values(riskFactors || {}).filter(Boolean).length;
  const computed = trueCount === 0 ? "high" : trueCount === 1 ? "medium" : "low";
  const reported = CONF_RANK.hasOwnProperty(reportedConfidence) ? reportedConfidence : "medium";
  return CONF_RANK[computed] <= CONF_RANK[reported] ? computed : reported;
}

/* One request asks Gemini to translate AND self-critique in the same call
   -- cheaper than two round-trips, and keeps the critique grounded in the
   exact translation it just produced rather than re-judging it cold. */
function buildPrompt(text, fromLang, toLang, fieldContext) {
  return (
    "You are translating one short piece of formal wedding-invitation text from " +
    LANG_NAMES[fromLang] + " to " + LANG_NAMES[toLang] + ".\n" +
    "Context for this specific text: " + (fieldContext || "a wedding invitation field") + "\n" +
    BRAND_VOICE + "\n\n" +
    "Source text:\n" + text + "\n\n" +
    "Produce a translation that reads naturally, warmly, and formally in " + LANG_NAMES[toLang] +
    " for a wedding invitation, preserving the ceremonial/honorific register of the original " +
    "(do not translate literally word-for-word if that would sound unnatural or robotic).\n\n" +
    "Before rating confidence, check EACH of these four specific risk factors for THIS " +
    "translation and answer true/false honestly for each -- do not skip this step:\n" +
    "- ambiguousSource: could the source text's meaning genuinely be read more than one way?\n" +
    "- idiomatic: does the source rely on an idiom, wordplay, or culturally-specific phrase " +
    "with no exact equivalent in " + LANG_NAMES[toLang] + "?\n" +
    "- registerRisk: is there real doubt about whether your translation's formality/honorific " +
    "level exactly matches what a formal wedding invitation calls for?\n" +
    "- properNounRisk: does the text contain a person or place name whose correct spelling/" +
    "transliteration in the target script you are not fully certain of?\n" +
    "Then set confidence to \"high\" ONLY if all four are false, \"medium\" if exactly one is " +
    "true, and \"low\" if two or more are true -- never report \"high\" while also flagging any " +
    "risk factor as true. Add a short note (one sentence, empty string only if confidence is " +
    "high) naming which risk factor(s) you flagged and why.\n\n" +
    "Respond with ONLY this exact JSON shape, no other text, no markdown fences:\n" +
    '{"translation":"...","confidence":"high|medium|low","note":"...","riskFactors":' +
    '{"ambiguousSource":true|false,"idiomatic":true|false,"registerRisk":true|false,"properNounRisk":true|false}}'
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
   existing content, not a translation of new content.

   Deepened after an explicit request to push this as far as it can honestly
   go: beyond the original three checks (meaning/fact mismatch, missing
   content, name-spelling drift), this now also checks EACH language
   version's own internal correctness (grammar/natural phrasing can be
   wrong even when all three versions technically "agree" with each
   other), formal-register/honorific consistency appropriate for a wedding
   invitation, and numeral/date/time VALUE consistency (not just that a
   number is present, but that "9.00 a.m." and its Sinhala/Tamil versions
   name the SAME time). It also now asks the model to propose the actual
   corrected text per language (not just describe the problem in prose),
   so the admin can apply a fix in one click instead of retyping it by
   hand -- see the "corrections" field below, and the #auditReport "මෙය AI
   මගින් නිවැරදි කරන්න" button in app.js that applies it.

   Confidence here goes through the same deriveConfidence() calibration as
   translate mode (see its own comment, above buildPrompt) -- the model
   self-reports three specific uncertainty factors instead of a holistic
   label, and the handler below adds a FOURTH, objectively computed one
   (partialCoverage: fewer than all three languages were even present to
   cross-check against) that the model is never asked to self-report,
   since it's a plain fact the server already knows for certain and has no
   reason to trust an LLM's word for. */
function buildAuditPrompt(langValues, fieldContext) {
  const lines = Object.keys(langValues)
    .filter((l) => langValues[l])
    .map((l) => LANG_NAMES[l] + ": " + langValues[l])
    .join("\n");
  const presentLangs = Object.keys(langValues).filter((l) => langValues[l]);
  return (
    "You are a meticulous professional proofreader and translator reviewing the language " +
    "versions of ONE field of a formal Sri Lankan wedding invitation, checking whether they " +
    "are faithful, natural, and internally correct equivalents of each other.\n" +
    "Context for this field: " + (fieldContext || "a wedding invitation field") + "\n" +
    BRAND_VOICE + "\n\n" +
    lines + "\n\n" +
    "Check thoroughly for ALL of the following, in order of importance:\n" +
    "1. MEANING/FACTUAL mismatch: a name, date, number, place, or relationship (e.g. \"father\" " +
    "vs \"parents\") that doesn't match across all versions present.\n" +
    "2. MISSING CONTENT: a version that omits content the others have.\n" +
    "3. NUMERAL/DATE/TIME VALUE mismatch: e.g. one version says a different clock time, date, " +
    "or count than the others, even if the wording otherwise looks similar.\n" +
    "4. PROPER-NOUN phonetic drift: a person or place name that is not phonetically the same " +
    "across versions.\n" +
    "5. INTERNAL correctness: does EACH version, read on its own, use grammatically correct, " +
    "natural, formal phrasing in ITS language -- independent of whether it happens to agree " +
    "with the others? (A version can be internally broken even if it technically matches the " +
    "others in meaning.)\n" +
    "6. REGISTER/HONORIFIC consistency: is the level of formality and any honorifics " +
    "(Mr./Mrs., ආදරණීය, திரு/திருமதி etc.) consistent with a formal wedding invitation across " +
    "all versions present?\n" +
    "7. VOICE: does EACH version read as natural, warm, traditional ceremonial language a " +
    "culturally-fluent native speaker would write for this occasion -- or does it sound stiff, " +
    "literal, or mechanically translated (a calque of another version's sentence structure, or " +
    "generic/robotic phrasing that lacks the dignity and warmth this invitation calls for)? " +
    "Flag this even when the meaning is technically correct -- an unnatural, machine-sounding " +
    "version is treated as seriously as a factual mistake here.\n" +
    "Do NOT flag natural differences in sentence structure or word order between languages -- " +
    "those are expected and correct, not mistakes.\n\n" +
    "Before rating your confidence in this audit's finding (or clean bill of health), check " +
    "EACH of these three specific uncertainty factors and answer true/false honestly for each " +
    "-- do not skip this step:\n" +
    "- ambiguousFinding: even if you flagged (or didn't flag) something, could a reasonable " +
    "person disagree about whether it's actually a mistake versus an intentional/acceptable " +
    "stylistic choice?\n" +
    "- vagueContext: is the \"Context for this field\" given above too generic or vague for you " +
    "to be fully sure what tone, format, or content this specific field actually requires?\n" +
    "- properNounUncertainty: does this field contain a person or place name whose correct " +
    "spelling/transliteration across these scripts you are not fully certain of?\n" +
    "Then set confidence to \"high\" ONLY if all three are false, \"medium\" if exactly one is " +
    "true, and \"low\" if two or more are true -- never report \"high\" while also flagging any " +
    "uncertainty factor as true.\n\n" +
    "Respond with ONLY this exact JSON shape, no other text, no markdown fences:\n" +
    '{"consistent":true|false,"severity":"none|low|medium|high","confidence":"high|medium|low",' +
    '"issue":"...","suggestion":"...","riskFactors":{"ambiguousFinding":true|false,' +
    '"vagueContext":true|false,"properNounUncertainty":true|false},"corrections":{' +
    presentLangs.map((l) => '"' + l + '":"..."').join(",") +
    "}}\n" +
    "consistent=true, severity=\"none\", confidence=\"high\" with empty issue/suggestion and every " +
    "corrections value set to an empty string \"\" if every version genuinely matches, is " +
    "internally correct, AND reads naturally per the VOICE check above. Otherwise describe the " +
    "SPECIFIC problem in \"issue\" (one sentence), a " +
    "human-readable fix in \"suggestion\" (one sentence), and in \"corrections\" give the FULL " +
    "corrected text (not a diff, not a description -- the complete replacement text ready to " +
    "paste in) for EVERY language you listed above that needs a change to fix this specific " +
    "problem. For a meaning/fact/content/numeral/name problem (checks 1-4), use the language(s) " +
    "you judge correct as the source of truth for the one(s) that are wrong. For an internal-" +
    "correctness or VOICE problem (checks 5 and 7), rewrite ONLY that language into natural, " +
    "traditional, dignified phrasing per the VOICE guidance above, preserving its exact meaning " +
    "-- do not change a different language just because one sounds robotic. Leave any language " +
    "that is already correct AND already natural as an empty string \"\" in corrections (do not " +
    "rewrite text that isn't wrong)."
  );
}

function parseAuditJson(raw, presentLangs) {
  const cleaned = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const j = JSON.parse(cleaned);
  const severity = ["none", "low", "medium", "high"].includes(j.severity) ? j.severity : (j.consistent ? "none" : "medium");
  const rawRisk = (j.riskFactors && typeof j.riskFactors === "object") ? j.riskFactors : {};
  const riskFactors = {
    ambiguousFinding: rawRisk.ambiguousFinding === true,
    vagueContext: rawRisk.vagueContext === true,
    properNounUncertainty: rawRisk.properNounUncertainty === true,
    /* Objectively known to the server, never the model's to self-report --
       see this function's own comment, above buildAuditPrompt. */
    partialCoverage: (presentLangs || []).length < 3,
  };
  const confidence = deriveConfidence(j.confidence, riskFactors);
  const rawCorrections = (j.corrections && typeof j.corrections === "object") ? j.corrections : {};
  const corrections = {};
  for (const l of presentLangs || []) {
    const c = rawCorrections[l];
    corrections[l] = typeof c === "string" ? c.trim().slice(0, 2000) : "";
  }
  return {
    consistent: j.consistent === true,
    severity,
    confidence,
    riskFactors,
    issue: typeof j.issue === "string" ? j.issue : "",
    suggestion: typeof j.suggestion === "string" ? j.suggestion : "",
    corrections,
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
   several: with three candidates now (see GEMINI_MODEL_CANDIDATES above),
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

/* Surfaces quota exhaustion as its own distinct, unmistakable reason
   instead of a generic "translation failed" -- this exact failure mode
   was hard to diagnose from the admin UI alone (identical-looking to a
   dead model name or a bad key) until someone went and read Vercel's raw
   runtime logs by hand. quotaExceeded lets the client show a genuinely
   different message ("wait a bit / check billing", not "retry now",
   since retrying inside this same request already happened and did not
   help). */
function describeGeminiError(e) {
  const message = (e && e.message) || String(e);
  const status = e && e.status;
  const quotaExceeded = status === 429 || /exceeded your current quota|rate.?limit/i.test(message);
  return { message, quotaExceeded };
}

function parseGeminiJson(raw) {
  /* Models occasionally wrap JSON in ```json fences despite instructions --
     strip those before parsing rather than failing outright. */
  const cleaned = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const j = JSON.parse(cleaned);
  if (typeof j.translation !== "string") throw new Error("missing translation field");
  const rawRisk = (j.riskFactors && typeof j.riskFactors === "object") ? j.riskFactors : {};
  const riskFactors = {
    ambiguousSource: rawRisk.ambiguousSource === true,
    idiomatic: rawRisk.idiomatic === true,
    registerRisk: rawRisk.registerRisk === true,
    properNounRisk: rawRisk.properNounRisk === true,
  };
  const confidence = deriveConfidence(j.confidence, riskFactors);
  return { translation: j.translation, confidence, riskFactors, note: typeof j.note === "string" ? j.note : "" };
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
      res.status(200).json({ ok: true, consistent: true, severity: "none", confidence: "high", riskFactors: {}, issue: "", suggestion: "", corrections: {} });
      return;
    }
    try {
      const { raw, model } = await callGeminiWithFallback(buildAuditPrompt(langValues, fieldContext), GEMINI_KEY);
      const parsed = parseAuditJson(raw, filled);
      res.status(200).json({
        ok: true, consistent: parsed.consistent, severity: parsed.severity, confidence: parsed.confidence,
        riskFactors: parsed.riskFactors, issue: parsed.issue, suggestion: parsed.suggestion,
        corrections: parsed.corrections, model,
      });
    } catch (e) {
      console.error("ai-translate audit failed:", e && e.stack ? e.stack : e);
      const { message, quotaExceeded } = describeGeminiError(e);
      res.status(502).json({ error: "Translation service unreachable or failed: " + message, quotaExceeded });
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
    res.status(200).json({
      ok: true, translation: parsed.translation, confidence: parsed.confidence,
      riskFactors: parsed.riskFactors, note: parsed.note, model,
    });
  } catch (e) {
    /* Logged server-side (visible in Vercel's runtime logs), not just
       returned in the response -- the FIRST reported failure of this
       endpoint showed only a generic "අසාර්ථකයි" in the admin UI with no
       way to tell what actually went wrong (bad model name, a restricted
       API key, a safety-filter block, etc. all look identical from the
       client's side otherwise). */
    console.error("ai-translate failed:", e && e.stack ? e.stack : e);
    const { message, quotaExceeded } = describeGeminiError(e);
    res.status(502).json({ error: "Translation service unreachable or failed: " + message, quotaExceeded });
  }
};
