/* ════════════════════════════════════════════════════════════════════════════
   හෙළ සිරිත · HELASIRITHA ADMIN  —  app.js   [ES module]
   ⚠ ADMIN REPOSITORY ONLY  ·  admin-helasiritha.vercel.app
   ⚠ DO NOT copy into the public wedding repo (it has its OWN app.js)

   Ultra-secure command centre for the public site (helasiritha.vercel.app).
   • HARD LOCK: Google OAuth, exactly ONE authorised email. Everything else is
     signed straight back out and the dashboard never renders.
   • Every write targets the EXACT field names the public site reads, so a save
     here reaches the live site through Firestore onSnapshot in real time.
   • Static: no bundler, no server. Firebase Web SDK v12.14.0 via CDN modules.
   ════════════════════════════════════════════════════════════════════════════ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import {
  getFirestore, doc, collection, onSnapshot, setDoc, addDoc, updateDoc, deleteDoc,
  writeBatch, serverTimestamp, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

/* ── configuration (public web config — safety comes from Auth + Rules) ───── */
/* ── AUTH DOMAIN ───────────────────────────────────────────────────────────────
   Firebase serves its OAuth handler from `authDomain`. When that domain differs
   from the domain the panel is served on, `signInWithRedirect` needs THIRD-PARTY
   storage access — which iOS Safari (ITP), Firefox (ETP) and Chrome with
   third-party cookies disabled all refuse. That is why redirect sign-in bounced
   straight back to the login screen. The panel therefore signs in with a POPUP
   on every device (Firebase's own recommendation for this exact situation).

   OPTIONAL, for absolute coverage (even inside embedded browsers): serve the
   handler from THIS domain and flip SAME_ORIGIN_AUTH to true.
     1. vercel.json already proxies  /__/auth/*  →  helasiritha-official.firebaseapp.com
     2. Firebase Console → Authentication → Settings → Authorized domains
          add:  admin-helasiritha.vercel.app
     3. Google Cloud Console → APIs & Services → Credentials → your OAuth client
          Authorized redirect URIs, add:
          https://admin-helasiritha.vercel.app/__/auth/handler
   Only then set SAME_ORIGIN_AUTH = true.                                      */
const FALLBACK_AUTH_DOMAIN = "helasiritha-official.firebaseapp.com";
function sameOriginAuthOn() {
  try { return localStorage.getItem("hs_same_origin_auth") === "1"; } catch (_) { return false; }
}
const SAME_ORIGIN_AUTH = sameOriginAuthOn();
const AUTH_DOMAIN = SAME_ORIGIN_AUTH ? window.location.host : FALLBACK_AUTH_DOMAIN;

const FB = {
  apiKey: "AIzaSyCC18zyof_ORDkKwxAMJK4G3Atu2AkWodM",
  authDomain: AUTH_DOMAIN,
  projectId: "helasiritha-official",
  storageBucket: "helasiritha-official.firebasestorage.app",
  messagingSenderId: "993883662089",
  appId: "1:993883662089:web:b583123218df07be9155d8",
  measurementId: "G-PBJWLXWVD9"
};
const ADMIN_EMAIL = "gaurawasachintha@gmail.com";
const CLOUD = { name: "dzrfpc9be", preset: "helasiritha_unsigned" };
const XLSX_CDN = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
const QR_CDN   = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js";
const PUBLIC_SITE = "https://helasiritha.vercel.app";
/* Serverless signing endpoint (Vercel). If it is absent (e.g. GitHub Pages) the
   uploader transparently falls back to the unsigned preset. */
const SIGN_ENDPOINT = "/api/sign-upload";
const IDLE_LOGOUT_MS = 20 * 60 * 1000;   // auto sign-out after 20 min idle
const VISIT_KINDS = ["qr", "web", "direct"];

const app  = initializeApp(FB);
const auth = getAuth(app);
const db   = getFirestore(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});

/* ── micro helpers ───────────────────────────────────────────────────────── */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (x) => String(x == null ? "" : x).replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(num(v, lo))));
let toastT;
function toast(msg, kind) {
  const t = $("#toast"); if (!t) return;
  t.textContent = msg; t.className = "show " + (kind || "");
  clearTimeout(toastT); toastT = setTimeout(() => { t.className = ""; }, 2800);
}
function confirmBox(message, opts = {}) {
  return new Promise((resolve) => {
    const m = $("#confirmModal"); const danger = opts.danger !== false;
    m.innerHTML =
      '<div class="modal-card">' +
        '<div class="modal-ic ' + (danger ? "bad" : "ask") + '">' + (danger ? "⌫" : "?") + '</div>' +
        '<h3>' + esc(opts.title || "තහවුරු කරන්න") + '</h3>' +
        '<p>' + esc(message) + '</p>' +
        '<div class="modal-acts">' +
          '<button class="btn ghost" id="mNo">' + esc(opts.cancel || "අවලංගු") + '</button>' +
          '<button class="btn ' + (danger ? "bad" : "primary") + '" id="mYes">' + esc(opts.ok || (danger ? "ඔව්, මකන්න" : "තහවුරුයි")) + '</button>' +
        '</div>' +
      '</div>';
    m.classList.add("show");
    const close = (v) => { m.classList.remove("show"); document.removeEventListener("keydown", key); resolve(v); };
    const key = (e) => { if (e.key === "Escape") close(false); if (e.key === "Enter") close(true); };
    $("#mYes", m).onclick = () => close(true);
    $("#mNo", m).onclick  = () => close(false);
    m.onclick = (e) => { if (e.target === m) close(false); };
    document.addEventListener("keydown", key);
    setTimeout(() => $("#mYes", m) && $("#mYes", m).focus(), 40);
  });
}

/* ════════════════════════════════════════════════════════════════════════════
   CONTRACT DEFAULTS — mirror the public site byte-for-byte so the editor always
   shows the real current text even before the first Firestore save exists.
   ════════════════════════════════════════════════════════════════════════════ */
const CONTENT_DEFAULT = {
  brideName: "කෞශානි", groomName: "ගෞරව",
  brideNameEn: "Kaushani", groomNameEn: "Gaurawa",
  brideNameTa: "கௌஷானி", groomNameTa: "கௌரவ",
  bridePreLine: "ශ්‍රීමත් හා ශ්‍රීමතී කුලසූරියගේ දම්පතියන්ගේ ආදරණීය දියණිය,",
  groomPreLine: "ශ්‍රීමත් හා ශ්‍රීමතී කප්පෙටිපොල වීරකෝන් මුදියන්සේලාගේ දම්පතියන්ගේ ආදරණීය පුත්‍රයා,",
  dateISO: "2028-01-12T09:15:00+05:30",
  venue: "The Epitome Hotel",
  venueCity: "කුරුණෑගල", venueCityEn: "Kurunegala", venueCityTa: "குருநாகல்",
  venueMapUrl: "https://www.google.com/maps/search/?api=1&query=The+Epitome+Hotel+Kurunegala",
  ceremonyTime: "පෙ.ව. 9.15 සිට", ceremonyTimeEn: "9.15 a.m. onwards", ceremonyTimeTa: "மு.ப. 9.15 மணி முதல்",
  poruwaTime: "පෙ.ව. 9.15",
  heroImageUrl: "",
  loveNote: "", loveSign: "කෞශානි & ගෞරව",
  phone: "", whatsapp: "", ambientAudioUrl: "",
  rsvpOpen: true,
  show: { countdown: true, agenda: true, gallery: true, lovenote: true, lamp: true, blessings: true, rsvp: true }
};
/* Invitation-scroll (සන්නස) overrides — the iframe reads live[key + Si|En|Ta] */
const SANNASA_KEYS = [
  ["brideParents", "මනාලියගේ දෙමාපිය පේළිය"],
  ["groomParents", "මනාලයාගේ දෙමාපිය පේළිය"],
  ["join",         "එක්වීමේ පේළිය"],
  ["sannasaBody",  "ආරාධනා ඡේදය"],
  ["poruwa",       "පෝරු මුහුර්ත පේළිය"]
];
const AGENDA_DEFAULT = [
  { icon: "welcome",   timeLabel: "9.15 AM",  titleSi: "ආගන්තුක පිළිගැනීම", descSi: "සිනා මුසු මුවින් ආරාධිතයන් සාදරයෙන් පිළිගැනීම.", titleEn: "Welcome", descEn: "Warmly receiving our guests.", titleTa: "வரவேற்பு", descTa: "விருந்தினர்களை அன்புடன் வரவேற்றல்." },
  { icon: "rings",     timeLabel: "9.15 AM",  titleSi: "මංගල උත්සවය", descSi: "අපගේ ජීවිත එක්වන සුවිශේෂී මොහොත.", titleEn: "The Ceremony", descEn: "The moment our lives become one.", titleTa: "திருமண வைபவம்", descTa: "எங்கள் வாழ்க்கை ஒன்றாகும் சிறப்பு தருணம்." },
  { icon: "dine",      timeLabel: "12.00 PM", titleSi: "දිවා භෝජනය", descSi: "රසවත් භෝජන සංග්‍රහයකින් ආරාධිතයන් සංග්‍රහ කිරීම.", titleEn: "Lunch", descEn: "A delicious feast for our guests.", titleTa: "மதிய விருந்து", descTa: "விருந்தினர்களுக்கு சுவையான விருந்து." },
  { icon: "celebrate", timeLabel: "3.30 PM",  titleSi: "සැමරුම් හා පිටත්වීම", descSi: "සතුට බෙදාගනිමින් දිනය නිමා කිරීම.", titleEn: "Celebration & Send-off", descEn: "Closing the day in shared joy.", titleTa: "கொண்டாட்டமும் வழியனுப்புதலும்", descTa: "பகிர்ந்த மகிழ்ச்சியுடன் நாளை நிறைவு செய்தல்." }
];
const ICON_OPTIONS = ["welcome", "rings", "dine", "celebrate", "poruwa", "lamp", "sesath", "mayura"];
const THEME_DEFAULT = { primary: "#E8C987", secondary: "#F2E5C6", accent: "#B08D4F", surface: "#0A0A0C", text: "#ECE6DA" };
const THEME_FIELDS = [
  ["primary",   "මූලික රන්වන් වර්ණය", "ශීර්ෂ, රන්වන් අවධාරණ"],
  ["secondary", "ද්විතීයික වර්ණය",    "මෘදු ආලෝක තලය"],
  ["accent",    "අවධාරක වර්ණය",       "රේඛා හා දෙවන අවධාරණ"],
  ["surface",   "පසුබිම් වර්ණය",      "පිටුවේ මූලික පසුබිම"],
  ["text",      "අකුරු වර්ණය",        "ප්‍රධාන පෙළෙහි වර්ණය"]
];
const THEME_PRESETS = {
  "Classic Gold": { primary: "#E8C987", secondary: "#F2E5C6", accent: "#B08D4F", surface: "#0A0A0C", text: "#ECE6DA" },
  "Blush":        { primary: "#E8B4B8", secondary: "#F7E1E3", accent: "#B87F86", surface: "#120C0E", text: "#F1E4E5" },
  "Sage":         { primary: "#A8C3A0", secondary: "#DDEBD6", accent: "#6E8A66", surface: "#0A0F0B", text: "#E6EDE3" },
  "Navy":         { primary: "#8FB4DE", secondary: "#D6E4F2", accent: "#4A6C93", surface: "#070B12", text: "#E2E9F2" },
  "Lavender":     { primary: "#C3AEDE", secondary: "#E7DCF3", accent: "#7E68A0", surface: "#0D0913", text: "#EAE2F2" }
};
const VIS_FIELDS = [
  ["rsvpOpen",  "RSVP විවෘතද?",        "පැමිණීම් පිළිතුරු භාරගැනීම (වසා දැමුවොත් පෝරමය අක්‍රීයයි)", true],
  ["countdown", "කාල ගණනය",           "මංගල දිනට ඉතිරි කාලය", false],
  ["agenda",    "වැඩසටහන",            "උත්සව කාලසටහන", false],
  ["gallery",   "ඡායාරූප එකතුව",       "Moments of Love ගැලරිය", false],
  ["lovenote",  "ආදර සටහන",           "පිටුව පහළ විශේෂ සටහන", false],
  ["lamp",      "මංගල පහන",           "තහවුරු වූ ආගන්තුක ගණන", false],
  ["blessings", "සුබ පැතුම් පුවරුව",   "අනුමත සුබ පැතුම්", false],
  ["rsvp",      "RSVP කොටස",          "පැමිණීම තහවුරු කිරීමේ කොටස", false]
];
const MONTH_SI = ["ජනවාරි","පෙබරවාරි","මාර්තු","අප්‍රේල්","මැයි","ජූනි","ජූලි","අගෝස්තු","සැප්තැම්බර්","ඔක්තෝබර්","නොවැම්බර්","දෙසැම්බර්"];
const MONTH_EN = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_TA = ["ஜனவரி","பிப்ரவரி","மார்ச்","ஏப்ரல்","மே","ஜூன்","ஜூலை","ஆகஸ்ட்","செப்டம்பர்","அக்டோபர்","நவம்பர்","டிசம்பர்"];
const DAY_SI = ["ඉරිදා","සඳුදා","අඟහරුවාදා","බදාදා","බ්‍රහස්පතින්දා","සිකුරාදා","සෙනසුරාදා"];
const DAY_EN = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const DAY_TA = ["ஞாயிற்றுக்கிழமை","திங்கட்கிழமை","செவ்வாய்க்கிழமை","புதன்கிழமை","வியாழக்கிழமை","வெள்ளிக்கிழமை","சனிக்கிழமை"];

/* ── live state ──────────────────────────────────────────────────────────── */
let content   = Object.assign({}, CONTENT_DEFAULT);
let agenda    = AGENDA_DEFAULT.slice();
let theme     = Object.assign({}, THEME_DEFAULT);
let gallery = [], guests = [], rsvps = [], blessings = [], visits = [], audit = [];
let visitsCapped = false, signMode = "unknown";
let sessionStart = Date.now(), lastActivity = Date.now();
let upTestReport = "";
let rsvpMap = {};
let current = "dashboard";
let subsStarted = false;
const renderers = {};

/* Effective guest list: the RSVP document (written by the visitor) is the truth;
   admin-set fields on the guest doc are the fallback. */
function effGuests() {
  return guests.map(g => {
    const r = rsvpMap[g.id];
    let status = g.status || "pending";
    if (r) status = (r.attending === true) ? "confirmed" : (r.attending === false ? "declined" : status);
    return {
      id: g.id,
      name: g.name || "",
      family: g.family || "",
      side: g.side === "bride" ? "bride" : "groom",
      count: Math.max(1, num(g.count, 1)),
      status,
      liquor: r ? !!r.liquor : !!g.liquor,
      dietary: (r && r.dietary) || g.dietary || "",
      party: r ? Math.max(0, num(r.party, 0)) : 0,
      tableNumber: g.tableNumber == null ? null : num(g.tableNumber, null),
      respondedAt: r && r.ts && r.ts.seconds ? r.ts.seconds : 0,
      hasRsvp: !!r
    };
  });
}
const headcount = () => rsvps.filter(r => r.attending).reduce((n, r) => n + Math.max(1, num(r.party, 1)), 0);

/* ════════════════════════ AUTH — single-account hard lock ═══════════════════ */
function authMsg(code) {
  return ({
    "auth/not-admin": "ප්‍රවේශය ප්‍රතික්ෂේප විය — මෙම පද්ධතියට පිවිසීමට අවසර ඇත්තේ තනි පරිපාලක ගිණුමට පමණි.",
    "auth/unverified": "ප්‍රවේශය ප්‍රතික්ෂේප විය — ගිණුමේ විද්‍යුත් තැපෑල තහවුරු කර නොමැත.",
    "auth/popup-blocked": "පිවිසුම් කවුළුව බ්‍රවුසරය අවහිර කළා. නැවත උත්සාහ කරමින්…",
    "auth/popup-closed-by-user": "පිවිසුම් කවුළුව වසා දමා ඇත.",
    "auth/cancelled-popup-request": "පිවිසුම් උත්සාහය අවලංගු විය.",
    "auth/network-request-failed": "අන්තර්ජාල සම්බන්ධතාවය පරීක්ෂා කරන්න.",
    "auth/too-many-requests": "උත්සාහයන් වැඩියි. මඳක් පසුව නැවත උත්සාහ කරන්න.",
    "auth/unauthorized-domain": "මෙම වසමට Firebase Auth අවසර දී නොමැත — Firebase Console → Authentication → Settings → Authorized domains වලට මෙම වසම එකතු කරන්න.",
    "auth/operation-not-supported-in-this-environment": "මෙම බ්‍රවුසරයේ මෙය සහාය නොදක්වයි.",
    "auth/web-storage-unsupported": "බ්‍රවුසරයේ ගබඩාව අවහිර කර ඇත. Private/Incognito මාදිලිය හෝ cookie අවහිර කිරීම ක්‍රියාවිරහිත කරන්න.",
    "auth/redirect-blocked": "බ්‍රවුසරය තෙවන පාර්ශව ගබඩාවට ඉඩ නොදෙන නිසා යොමු පිවිසුම සම්පූර්ණ නොවිය. පහත බොත්තමෙන් නැවත උත්සාහ කරන්න — දැන් පිවිසුම් කවුළුව (popup) භාවිතා වේ.",
    "auth/inapp-browser": "මෙම යෙදුම තුළ ඇති බ්‍රවුසරයේ Google පිවිසුමට ඉඩ නොදේ. කරුණාකර Safari හෝ Chrome වලින් විවෘත කරන්න.",
    "auth/popup-unsupported": "මෙම බ්‍රවුසරය පිවිසුම් කවුළුවට ඉඩ නොදේ. Safari හෝ Chrome වලින් විවෘත කරන්න.",
    /* ── these were previously unhandled and therefore failed silently ── */
    "auth/missing-initial-state": "යොමු පිවිසුම අසාර්ථකයි — බ්‍රවුසරය sessionStorage/තෙවන පාර්ශව ගබඩාව අවහිර කර ඇත. පිවිසුම් කවුළුව (popup) හෝ Same-origin මාදිලිය භාවිතා කරන්න.",
    "auth/operation-not-allowed": "Google පිවිසුම මෙම Firebase ව්‍යාපෘතියේ ක්‍රියාත්මක කර නොමැත — Firebase Console → Authentication → Sign-in method → Google → Enable කරන්න.",
    "auth/invalid-api-key": "Firebase API key වැරදියි. app.js හි වින්‍යාසය පරීක්ෂා කරන්න.",
    "auth/user-disabled": "මෙම ගිණුම අක්‍රීය කර ඇත.",
    "auth/admin-restricted-operation": "මෙම ක්‍රියාව පරිපාලක විසින් සීමා කර ඇත.",
    "auth/account-exists-with-different-credential": "මෙම විද්‍යුත් තැපෑල වෙනත් ක්‍රමයකින් දැනටමත් ලියාපදිංචියි.",
    "auth/invalid-oauth-client-id": "OAuth client ID වැරදියි — Google Cloud Console හි credentials පරීක්ෂා කරන්න.",
    "auth/redirect-cancelled-by-user": "යොමු පිවිසුම අවලංගු කරන ලදී.",
    "auth/no-auth-event": "පිවිසුම් ප්‍රතිචාරයක් නොලැබුණි. නැවත උත්සාහ කරන්න."
  })[code] || "පිවිසීම අසාර්ථකයි. නැවත උත්සාහ කරන්න.";
}
const isAdminEmail = (e) => !!e && String(e).trim().toLowerCase() === ADMIN_EMAIL;

/* ── environment detection ───────────────────────────────────────────────────
   Embedded in-app browsers (Facebook, Instagram, TikTok, WeChat, LinkedIn …)
   can never complete Google sign-in: Google itself rejects OAuth inside a
   webview ("disallowed_useragent") and popups are blocked as well. The only
   correct behaviour there is to send the person to a real browser.           */
const UA = (typeof navigator !== "undefined" && navigator.userAgent) || "";
const IS_INAPP = /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|WeChat|TikTok|Musical_?ly|Snapchat|Pinterest|LinkedInApp|OKApp|GSA\//i.test(UA);

function provider() {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ login_hint: ADMIN_EMAIL, prompt: "select_account" });
  return p;
}

/* ── login-screen UI state ─────────────────────────────────────────────────── */
let gsiHTML = null;
function setBusy(on, label) {
  const b = $("#googleBtn"); if (!b) return;
  if (gsiHTML === null) gsiHTML = b.innerHTML;
  b.disabled = !!on;
  if (on) b.textContent = label || "පිවිසෙමින්…"; else b.innerHTML = gsiHTML;
}
function loginError(msg) {
  const el = $("#loginErr"); if (!el) return;
  el.textContent = msg || ""; el.classList.remove("show");
  if (msg) { void el.offsetWidth; el.classList.add("show"); }
}
function loginHint(html) {
  let el = $("#loginHint");
  if (!el) {
    const err = $("#loginErr"); if (!err || !err.parentNode) return;
    el = document.createElement("div"); el.id = "loginHint"; el.className = "login-hint";
    err.parentNode.insertBefore(el, err.nextSibling);
  }
  el.innerHTML = html || ""; el.hidden = !html;
}
function offerRetry() {
  loginHint('<button class="btn sm primary" id="retryLogin" type="button">නැවත උත්සාහ කරන්න</button>');
  const r = $("#retryLogin"); if (r) r.onclick = doGoogleLogin;
}
/* ── storage pre-flight ─────────────────────────────────────────────────────
   Firebase Auth needs localStorage (session), sessionStorage (redirect state)
   and IndexedDB. Safari's "Block All Cookies" and hardened Private windows kill
   these, which is the single most common cause of a sign-in that "does nothing".
   We check up-front so the person is told BEFORE they waste an attempt.       */
function storageReport() {
  const r = { local: false, session: false, indexedDB: false, cookies: false };
  try { localStorage.setItem("__t", "1"); localStorage.removeItem("__t"); r.local = true; } catch (_) {}
  try { sessionStorage.setItem("__t", "1"); sessionStorage.removeItem("__t"); r.session = true; } catch (_) {}
  try { r.indexedDB = typeof indexedDB !== "undefined" && !!indexedDB; } catch (_) {}
  try { r.cookies = navigator.cookieEnabled === true; } catch (_) {}
  return r;
}
let lastAuthError = null;

function diagText() {
  const st = storageReport();
  const u = auth.currentUser;
  return [
    "── HELASIRITHA ADMIN · DIAGNOSTICS ──",
    "time        : " + new Date().toISOString(),
    "origin      : " + location.origin,
    "host        : " + location.host,
    "protocol    : " + location.protocol,
    "authDomain  : " + AUTH_DOMAIN,
    "sameOrigin  : " + (SAME_ORIGIN_AUTH ? "ON" : "OFF"),
    "signedIn    : " + (u ? (u.email + " verified=" + u.emailVerified) : "no"),
    "inAppBrowser: " + IS_INAPP,
    "storage     : local=" + st.local + " session=" + st.session +
                  " idb=" + st.indexedDB + " cookies=" + st.cookies,
    "lastError   : " + (lastAuthError ? (lastAuthError.code + " | " + lastAuthError.message) : "none"),
    "userAgent   : " + UA
  ].join("\n");
}
function paintDiag() { const el = $("#diagOut"); if (el) el.textContent = diagText(); }

/* The three console settings that actually matter, with the exact values. */
function setupChecklist() {
  const origin = location.origin;
  return '<ul class="setup-list">' +
    '<li><b>1 · Firebase → Authentication → Settings → Authorized domains</b><br>' +
      'මෙම වසම එකතු කර තිබේද?<code>' + esc(location.host) + '</code></li>' +
    '<li><b>2 · Firebase → Authentication → Sign-in method</b><br>' +
      '<b>Google</b> provider <b>Enable</b> කර තිබේද?</li>' +
    '<li><b>3 · Google Cloud Console → Credentials → OAuth client → Authorized redirect URIs</b><br>' +
      'මෙය තිබේද?<code>https://' + esc(AUTH_DOMAIN) + '/__/auth/handler</code>' +
      (SAME_ORIGIN_AUTH ? '' : '<br><span class="faint">(Same-origin මාදිලිය ON කළොත්: <code>' + esc(origin) + '/__/auth/handler</code>)</span>') +
    '</li></ul>';
}
function showFailure(code, err) {
  lastAuthError = { code: code || "unknown", message: (err && err.message) || "" };
  loginError(authMsg(code) + (code ? "  [" + code + "]" : ""));
  loginHint('<button class="btn sm primary" id="retryLogin" type="button">නැවත උත්සාහ කරන්න</button>' + setupChecklist());
  const r = $("#retryLogin"); if (r) r.onclick = doGoogleLogin;
  const d = $("#loginDiag"); if (d) d.open = true;
  paintDiag();
}
function showInAppWarning() {
  loginError(authMsg("auth/inapp-browser"));
  loginHint('<button class="btn sm ghost" id="copyUrl" type="button">සබැඳිය copy කරන්න</button>');
  const c = $("#copyUrl");
  if (c) c.onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); toast("සබැඳිය copy විය — Safari/Chrome වල අලවන්න ✓", "ok"); }
    catch (_) { toast("සබැඳිය අතින් copy කරන්න", "warn"); }
  };
}

/* Reject non-authorised accounts immediately, before any data is touched.
   Both the popup result and the auth listener can detect the same intruder, so
   the rejection is de-duplicated — one sign-out, one message. */
let rejecting = false, enteredAt = 0;
async function rejectIntruder(reason) {
  if (rejecting) return; rejecting = true;
  try { await signOut(auth); } catch (_) {}
  $("#app").hidden = true; $("#login").hidden = false;
  setBusy(false); loginHint("");
  loginError(authMsg(reason));
  setTimeout(() => { rejecting = false; }, 1500);
}

/* Single, idempotent entry point into the panel. Reachable from THREE
   independent signals — popup result, redirect result, auth listener — so no
   single browser quirk can leave the administrator stranded on the gate. */
function enterPanel(user) {
  if (!user) return;
  if (!isAdminEmail(user.email)) { rejectIntruder("auth/not-admin"); return; }
  if (user.emailVerified === false) { rejectIntruder("auth/unverified"); return; }
  setBusy(false); loginHint(""); loginError("");
  $("#login").hidden = true; $("#app").hidden = false;
  $("#whoEmail").textContent = user.email || "";
  enteredAt = Date.now();
  sessionStart = Date.now(); lastActivity = Date.now();
  if (!subsStarted) { subsStarted = true; startSubscriptions(); buildNav(); }
  go(current);
}

/* ── SIGN IN — popup on every device, redirect only as a genuine fallback ──── */
const REDIRECT_PENDING = "hs_auth_redirect_pending";
const POPUP_FALLBACK = [
  "auth/popup-blocked", "auth/operation-not-supported-in-this-environment",
  "auth/web-storage-unsupported", "auth/internal-error", "auth/timeout"
];
let redirectResolving = false;

async function startRedirect() {
  try { sessionStorage.setItem(REDIRECT_PENDING, "1"); } catch (_) {}
  try { await signInWithRedirect(auth, provider()); return true; }
  catch (e) {
    try { sessionStorage.removeItem(REDIRECT_PENDING); } catch (_) {}
    showFailure((e && e.code) || "", e); return false;
  }
}

async function doGoogleLogin() {
  loginError(""); loginHint("");
  if (IS_INAPP) { showInAppWarning(); return; }
  setBusy(true);
  try {
    /* The popup is opened inside this click, so no browser blocks it. */
    const res = await signInWithPopup(auth, provider());
    enterPanel(res && res.user);
    return;
  } catch (e) {
    const code = (e && e.code) || "";
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
      setBusy(false); showFailure(code, e); return;
    }
    if (POPUP_FALLBACK.includes(code)) {
      setBusy(true, "යොමු කරමින්…");
      loginHint("පිවිසුම් කවුළුව අවහිර විය — යොමු කිරීමෙන් උත්සාහ කරමින්…");
      if (await startRedirect()) return;   /* page navigates away */
    } else {
      showFailure(code, e);
    }
  }
  setBusy(false);
}

/* ── returning from a redirect ───────────────────────────────────────────────
   If the flag is set we came back from Google, so hold the "signing in" state
   instead of flashing the login card. A null result means the browser refused
   the cross-site storage the redirect flow needs — say so plainly and offer the
   popup, rather than silently dumping the person back at the start.          */
(function handleRedirectReturn() {
  let pending = false;
  try { pending = sessionStorage.getItem(REDIRECT_PENDING) === "1"; } catch (_) {}
  redirectResolving = pending;
  if (pending) setBusy(true, "පිවිසුම සම්පූර්ණ කරමින්…");

  getRedirectResult(auth).then((res) => {
    try { sessionStorage.removeItem(REDIRECT_PENDING); } catch (_) {}
    redirectResolving = false;
    if (res && res.user) { enterPanel(res.user); return; }
    if (pending) { setBusy(false); showFailure("auth/redirect-blocked", null); }
  }).catch((e) => {
    try { sessionStorage.removeItem(REDIRECT_PENDING); } catch (_) {}
    redirectResolving = false; setBusy(false);
    showFailure((e && e.code) || "", e);
  });
})();

if (IS_INAPP) showInAppWarning();

onAuthStateChanged(auth, (user) => {
  if (!user) {
    /* Firebase emits an initial "signed out" event on every load. If a popup or
       redirect result has just brought the administrator in, that event is stale
       and must NOT eject them — otherwise sign-in appears to bounce back to the
       gate. A real sign-out always arrives well after entry and is honoured. */
    if (enteredAt && Date.now() - enteredAt < 4000) return;
    enteredAt = 0;
    $("#app").hidden = true; $("#login").hidden = false;
    if (!redirectResolving) setBusy(false);
    return;
  }
  enterPanel(user);
});

/* ════════════════════════ REAL-TIME SUBSCRIPTIONS ══════════════════════════ */
function syncState(ok) {
  const p = $("#syncPill"), t = $("#syncTxt"); if (!p) return;
  p.classList.toggle("off", !ok); t.textContent = ok ? "සජීවී" : "විසන්ධි";
}
function startSubscriptions() {
  const warn = (label) => (err) => { console.warn(label, err); syncState(false); };

  onSnapshot(doc(db, "site", "content"), (s) => {
    const d = s.exists() ? s.data() : {};
    content = Object.assign({}, CONTENT_DEFAULT, d);
    content.show = Object.assign({}, CONTENT_DEFAULT.show, d.show || {});
    syncState(true); refresh("details"); refresh("visibility"); refresh("dashboard");
  }, warn("content"));

  onSnapshot(doc(db, "site", "agenda"), (s) => {
    const items = s.exists() && Array.isArray(s.data().items) ? s.data().items : null;
    agenda = (items && items.length) ? items : AGENDA_DEFAULT.slice();
    refresh("agenda"); refresh("dashboard");
  }, warn("agenda"));

  onSnapshot(doc(db, "site", "theme"), (s) => {
    theme = Object.assign({}, THEME_DEFAULT, s.exists() ? s.data() : {});
    refresh("theme");
  }, warn("theme"));

  onSnapshot(collection(db, "gallery"), (qs) => {
    const a = []; qs.forEach(d => a.push(Object.assign({ id: d.id }, d.data())));
    a.sort((x, y) => (num(x.order, 1e9) - num(y.order, 1e9))
      || (((x.ts && x.ts.seconds) || 0) - ((y.ts && y.ts.seconds) || 0)));
    gallery = a;
    if (!galBusy) refresh("gallery");          /* never redraw mid-reorder */
    refresh("dashboard");
  }, warn("gallery"));

  onSnapshot(collection(db, "guests"), (qs) => {
    const a = []; qs.forEach(d => a.push(Object.assign({ id: d.id }, d.data())));
    a.sort((x, y) => String(x.name || "").localeCompare(String(y.name || ""), "si"));
    guests = a;
    refresh("guests"); refresh("rsvp"); refresh("seating"); refresh("dashboard");
  }, warn("guests"));

  onSnapshot(collection(db, "rsvps"), (qs) => {
    const a = []; qs.forEach(d => a.push(Object.assign({ id: d.id }, d.data())));
    rsvps = a;
    rsvpMap = {}; a.forEach(r => { rsvpMap[r.guestId || r.id] = r; });
    pushStats();
    refresh("rsvp"); refresh("guests"); refresh("seating"); refresh("dashboard");
  }, warn("rsvps"));

  /* Visit telemetry written by the public site (QR / web / direct). */
  onSnapshot(query(collection(db, "visits"), orderBy("ts", "desc"), limit(5000)), (qs) => {
    const a = []; qs.forEach(d => a.push(Object.assign({ id: d.id }, d.data())));
    visits = a; visitsCapped = a.length >= 5000;
    refresh("analytics"); refresh("dashboard");
  }, warn("visits"));

  /* Append-only administrative audit trail. */
  onSnapshot(query(collection(db, "audit"), orderBy("ts", "desc"), limit(200)), (qs) => {
    const a = []; qs.forEach(d => a.push(Object.assign({ id: d.id }, d.data())));
    audit = a; refresh("security");
  }, warn("audit"));

  /* Blessings: the security rules restrict per-document reads, so an admin
     listen is permitted (isAdmin() is document-independent). */
  onSnapshot(collection(db, "blessings"), (qs) => {
    const a = []; qs.forEach(d => a.push(Object.assign({ id: d.id }, d.data())));
    a.sort((x, y) => (((y.ts && y.ts.seconds) || 0) - ((x.ts && x.ts.seconds) || 0)));
    blessings = a; refresh("blessings"); refresh("dashboard"); paintBadge();
  }, warn("blessings"));
}
/* Publish the confirmed head-count the public "මංගල පහන" counter reads. */
let statsT, lastStats = null;
function pushStats() {
  clearTimeout(statsT);
  statsT = setTimeout(async () => {
    const n = headcount();
    if (n === lastStats) return;
    lastStats = n;
    try { await setDoc(doc(db, "site", "stats"), { confirmedCount: n, updatedAt: Date.now() }, { merge: true }); }
    catch (e) { console.warn("stats write", e); }
  }, 900);
}
function paintBadge() {
  const pend = blessings.filter(b => !b.approved).length;
  const b = $('.nav-badge[data-badge="blessings"]');
  if (b) { b.textContent = String(pend); b.hidden = pend === 0; }
}
/* Never re-render underneath the cursor while the admin is typing. */
function refresh(panel) {
  if (current !== panel || !renderers[panel]) return;
  const a = document.activeElement;
  if (a && a.closest && a.closest("#main") && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.type !== "checkbox") return;
  renderers[panel]();
}

/* ════════════════════════ FIRESTORE WRITES ═════════════════════════════════ */
/* Tamper-evident audit trail: every administrative mutation is appended to the
   `audit` collection (append-only in the security rules — not even the admin can
   edit or delete an entry). Failures never block the underlying operation. */
function logAudit(action, target) {
  try {
    const u = auth.currentUser; if (!u) return;
    addDoc(collection(db, "audit"), {
      email: u.email || "", action: String(action).slice(0, 60),
      target: String(target == null ? "" : target).slice(0, 180), ts: serverTimestamp()
    }).catch(() => {});
  } catch (_) {}
}
const withAudit = (promise, action, target) =>
  promise.then((r) => { logAudit(action, target); return r; });

const saveContent = (patch) => withAudit(setDoc(doc(db, "site", "content"), Object.assign({}, patch, { updatedAt: Date.now() }), { merge: true }), "content.save", Object.keys(patch).slice(0, 6).join(","));
const saveAgenda  = (items) => withAudit(setDoc(doc(db, "site", "agenda"), { items, updatedAt: Date.now() }, { merge: true }), "agenda.save", items.length + " items");
const saveTheme   = (t)     => withAudit(setDoc(doc(db, "site", "theme"), Object.assign({}, t, { updatedAt: Date.now() }), { merge: true }), "theme.save", t.primary || "");
const addGuest    = (o)     => withAudit(addDoc(collection(db, "guests"), Object.assign({ ts: serverTimestamp() }, o)), "guest.add", o.name);
const updGuest    = (id, o) => updateDoc(doc(db, "guests", id), o);
const delGuest    = (id)    => withAudit(deleteDoc(doc(db, "guests", id)), "guest.delete", id);
const addGalleryItem = (o)  => addDoc(collection(db, "gallery"), Object.assign({ ts: serverTimestamp() }, o));
const updGallery  = (id, o) => updateDoc(doc(db, "gallery", id), o);
const delGallery  = (id)    => withAudit(deleteDoc(doc(db, "gallery", id)), "gallery.delete", id);
const updBlessing = (id, o) => withAudit(updateDoc(doc(db, "blessings", id), o), "blessing." + (o.approved ? "approve" : "hide"), id);
const delBlessing = (id)    => withAudit(deleteDoc(doc(db, "blessings", id)), "blessing.delete", id);
const delRsvp     = (id)    => deleteDoc(doc(db, "rsvps", id));
function setRsvp(g, patch) {
  return setDoc(doc(db, "rsvps", g.id), Object.assign({
    guestId: g.id, name: g.name || "", family: g.family || "", side: g.side || "",
    ts: serverTimestamp()
  }, patch), { merge: true });
}

/* ── Cloudinary unsigned upload (client-side downscale first) ─────────────── */
function downscale(file, max = 1800, q = 0.86) {
  return new Promise((res) => {
    if (!/^image\//.test(file.type || "")) return res(file);
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      if (Math.max(w, h) > max) { const r = max / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r); }
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob(b => res(b || file), "image/jpeg", q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); res(file); };
    img.src = url;
  });
}
function uploadImage(file, onProgress) {
  return new Promise(async (resolve, reject) => {
    const blob = await downscale(file);
    const fd = new FormData();
    fd.append("file", blob); fd.append("upload_preset", CLOUD.preset);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "https://api.cloudinary.com/v1_1/" + CLOUD.name + "/image/upload");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round(e.loaded / e.total * 100)); };
    xhr.onload = () => {
      try {
        const j = JSON.parse(xhr.responseText);
        j.secure_url ? resolve(j) : reject(new Error((j.error && j.error.message) || "උඩුගත කිරීම අසාර්ථකයි"));
      } catch (err) { reject(err); }
    };
    xhr.onerror = () => reject(new Error("ජාල දෝෂයකි"));
    xhr.send(fd);
  });
}

/* ════════════════════════ NAVIGATION ═══════════════════════════════════════ */
const ICONS = {
  grid:"M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  ring:"M12 7a5 5 0 100 10 5 5 0 000-10zM9 3l3 3 3-3",
  users:"M16 21v-2a4 4 0 00-8 0v2M12 11a4 4 0 100-8 4 4 0 000 8M22 21v-2a4 4 0 00-3-3.87",
  check:"M20 6L9 17l-5-5",
  list:"M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  image:"M3 5h18v14H3zM8 11l3 3 5-6 4 5",
  heart:"M12 21s-7-4.5-10-9a4 4 0 017-3 4 4 0 017 3c-3 4.5-10 9-10 9z",
  eye:"M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z",
  paint:"M12 3a9 9 0 000 18c1 0 1-1 1-2a2 2 0 012-2h2a3 3 0 003-3 7 7 0 00-11-11z",
  table:"M3 5h18v14H3zM3 10h18M9 5v14",
  chart:"M3 3v18h18M7 15l3-4 3 3 5-7",
  qr:"M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 20h1M17 20v1",
  shield:"M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"
};
const NAV = [
  { group: "මූලික",   items: [
    { key: "dashboard",  label: "දළ විශ්ලේෂණය",     icon: "grid" },
    { key: "details",    label: "මංගල තොරතුරු",     icon: "ring" }
  ]},
  { group: "ආගන්තුකයෝ", items: [
    { key: "guests",     label: "ආගන්තුක කළමනාකරණය", icon: "users" },
    { key: "rsvp",       label: "පිළිතුරු නාමාවලිය",  icon: "check" },
    { key: "seating",    label: "ආසන සැලසුම",       icon: "table" }
  ]},
  { group: "අන්තර්ගතය", items: [
    { key: "agenda",     label: "වැඩසටහන",          icon: "list" },
    { key: "gallery",    label: "ඡායාරූප එකතුව",     icon: "image" },
    { key: "blessings",  label: "සුබ පැතුම් අනුමැතිය", icon: "heart", badge: true }
  ]},
  { group: "විශ්ලේෂණ", items: [
    { key: "analytics",  label: "පැමිණීම් විශ්ලේෂණය",  icon: "chart" },
    { key: "qr",         label: "QR කේත මධ්‍යස්ථානය",  icon: "qr" }
  ]},
  { group: "පෙනුම",    items: [
    { key: "visibility", label: "කොටස් පෙන්වීම",     icon: "eye" },
    { key: "theme",      label: "වර්ණ සැකසුම්",      icon: "paint" }
  ]},
  { group: "ආරක්ෂාව",  items: [
    { key: "security",   label: "ආරක්ෂාව හා සටහන්",   icon: "shield" }
  ]}
];
const TITLES = {
  dashboard:  ["දළ විශ්ලේෂණය", "පද්ධතියේ වත්මන් සජීවී තත්ත්වය"],
  details:    ["මංගල තොරතුරු", "පොදු අඩවියේ අන්තර්ගතය සජීවීව සංස්කරණය"],
  guests:     ["ආගන්තුක කළමනාකරණය", "එක් කිරීම, සංස්කරණය, CSV/Excel ආයාත"],
  rsvp:       ["පිළිතුරු නාමාවලිය", "පෙරහන් සහිත සම්පූර්ණ පිළිතුරු ලේඛනය"],
  seating:    ["ආසන සැලසුම", "තහවුරු වූ ආගන්තුකයන්ට මේස පැවරීම"],
  agenda:     ["වැඩසටහන", "මංගල දිනයේ කාලසටහන"],
  gallery:    ["ඡායාරූප එකතුව", "Moments of Love · ඡායාරූප 9ක්"],
  blessings:  ["සුබ පැතුම් අනුමැතිය", "අනුමත කළ පසු පොදු අඩවියේ දිස් වේ"],
  visibility: ["කොටස් පෙන්වීම", "පොදු අඩවියේ කොටස් ක්ෂණිකව පාලනය"],
  theme:      ["වර්ණ සැකසුම්", "පොදු අඩවියේ වර්ණ තේමාව"],
  analytics:  ["පැමිණීම් විශ්ලේෂණය", "QR · වෙබ් · සෘජු පැමිණීම් සජීවීව"],
  qr:         ["QR කේත මධ්‍යස්ථානය", "ආරාධනා QR කේත සාදා බාගන්න"],
  security:   ["ආරක්ෂාව හා සටහන්", "පිවිසුම් තත්ත්වය සහ පරිපාලන ක්‍රියා සටහන"]
};
const svg = (k) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (ICONS[k] || ICONS.grid) + '"/></svg>';

function buildNav() {
  $("#nav").innerHTML = NAV.map(g =>
    '<div class="nav-group"><div class="nav-label">' + esc(g.group) + '</div>' +
    g.items.map(i =>
      '<button class="nav-item" type="button" data-go="' + i.key + '">' + svg(i.icon) +
      '<span>' + esc(i.label) + '</span>' +
      (i.badge ? '<i class="nav-badge" data-badge="' + i.key + '" hidden>0</i>' : '') +
      '</button>').join("") +
    '</div>').join("");
  $$('.nav-item[data-go]').forEach(b => b.onclick = () => { go(b.dataset.go); closeDrawer(); });
  paintBadge();
}
function go(panel) {
  if (!TITLES[panel]) panel = "dashboard";
  current = panel;
  $$('.nav-item[data-go]').forEach(b => b.classList.toggle("active", b.dataset.go === panel));
  $$('#main .mod').forEach(s => { s.hidden = s.dataset.panel !== panel; });
  $("#pageTitle").textContent = TITLES[panel][0];
  $("#pageSub").textContent  = TITLES[panel][1];
  if (renderers[panel]) renderers[panel]();
  const m = $("#main"); if (m) m.scrollTop = 0;
  window.scrollTo({ top: 0, behavior: "smooth" });
}
const openDrawer  = () => { $("#side").classList.add("open"); $("#scrim").classList.add("show"); };
const closeDrawer = () => { $("#side").classList.remove("open"); $("#scrim").classList.remove("show"); };

/* ── shared markup helpers ───────────────────────────────────────────────── */
function fld(label, id, val, type) {
  type = type || "text";
  if (type === "textarea")
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label><textarea class="inp" id="' + id + '" rows="3">' + esc(val) + '</textarea></div>';
  return '<div class="field"><label for="' + id + '">' + esc(label) + '</label><input class="inp" id="' + id + '" type="' + type + '" value="' + esc(val) + '"></div>';
}
const card = (inner, cls) => '<div class="card' + (cls ? " " + cls : "") + '">' + inner + '</div>';
const stat = (v, l, cls) => '<div class="stat' + (cls ? " " + cls : "") + '"><div class="v num">' + esc(String(v)) + '</div><div class="l">' + esc(l) + '</div></div>';
const swRow = (label, hint, id, on) =>
  '<div class="toggle"><div class="tl"><b>' + esc(label) + '</b><i>' + esc(hint) + '</i></div>' +
  '<button class="sw' + (on ? " on" : "") + '" id="' + id + '" type="button" role="switch" aria-checked="' + (!!on) + '" aria-label="' + esc(label) + '"></button></div>';
const statusPill = (s) => s === "confirmed" ? '<span class="pill yes">තහවුරු</span>'
  : s === "declined" ? '<span class="pill no">නොපැමිණේ</span>' : '<span class="pill pend">පොරොත්තු</span>';
const sideName = (s) => s === "bride" ? "කෞශානි" : "ගෞරව";
function toLocalInput(iso) { const m = String(iso || "").match(/(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/); return m ? m[1] + "T" + m[2] : ""; }
function fromLocalInput(v) { return v ? v + ":00+05:30" : CONTENT_DEFAULT.dateISO; }
function dateStrings(iso) {
  const m = String(iso || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = +m[1], mo = +m[2] - 1, d = +m[3];
  const wd = new Date(Date.UTC(y, mo, d)).getUTCDay();
  return {
    si: y + " " + MONTH_SI[mo] + " " + d + ", " + DAY_SI[wd],
    en: DAY_EN[wd] + ", " + d + " " + MONTH_EN[mo] + " " + y,
    ta: y + " " + MONTH_TA[mo] + " " + d + ", " + DAY_TA[wd]
  };
}

/* ════════════════════════════ 1 · DASHBOARD ════════════════════════════════ */
renderers.dashboard = function () {
  const G = effGuests();
  const bride = G.filter(g => g.side === "bride"), groom = G.filter(g => g.side === "groom");
  const by = (a, s) => a.filter(g => g.status === s).length;
  const people = (a) => a.reduce((n, g) => n + g.count, 0);
  const confirmed = G.filter(g => g.status === "confirmed");
  const liquor = confirmed.filter(g => g.liquor).length;
  const pendBless = blessings.filter(b => !b.approved).length;
  const seated = G.filter(g => g.status === "confirmed" && g.tableNumber).length;
  const pct = G.length ? Math.round(confirmed.length / G.length * 100) : 0;

  const sideCol = (title, arr) =>
    '<div class="split-col"><div class="split-name">' + esc(title) + '</div>' +
    '<div class="split-row"><span>මුළු ආරාධිත</span><b>' + arr.length + '</b></div>' +
    '<div class="split-row"><span>තහවුරු</span><b style="color:var(--ok)">' + by(arr, "confirmed") + '</b></div>' +
    '<div class="split-row"><span>පොරොත්තු</span><b style="color:var(--warn)">' + by(arr, "pending") + '</b></div>' +
    '<div class="split-row"><span>නොපැමිණේ</span><b style="color:var(--bad)">' + by(arr, "declined") + '</b></div>' +
    '<div class="split-row"><span>පුද්ගලයන්</span><b>' + people(arr) + '</b></div>' +
    '<div class="bar"><i style="width:' + (arr.length ? Math.round(by(arr, "confirmed") / arr.length * 100) : 0) + '%"></i></div></div>';

  const recent = G.filter(g => g.hasRsvp).sort((a, b) => b.respondedAt - a.respondedAt).slice(0, 8);

  $("#p-dashboard").innerHTML =
    '<div class="stats">' +
      stat(G.length, "මුළු ආරාධිත (පවුල්)", "gold") +
      stat(people(G), "මුළු පුද්ගලයන්") +
      stat(confirmed.length, "තහවුරු", "ok") +
      stat(headcount(), "තහවුරු පුද්ගලයන්", "ok") +
      stat(by(G, "pending"), "පොරොත්තුවෙන්", "warn") +
      stat(by(G, "declined"), "නොපැමිණෙන", "bad") +
      stat(liquor, "මත්පැන් අවශ්‍ය") +
      stat(pendBless, "අනුමැතියට සුබ පැතුම්", pendBless ? "warn" : "") +
    '</div>' +
    card('<h3>පිළිතුරු ප්‍රගතිය</h3><p class="hint">මුළු ආරාධිතයන්ගෙන් ' + pct + '% තහවුරු වී ඇත</p>' +
      '<div class="bar" style="height:11px"><i style="width:' + pct + '%"></i></div>' +
      '<div class="row" style="margin-top:14px">' +
        '<button class="btn sm" data-jump="rsvp">පිළිතුරු බලන්න</button>' +
        '<button class="btn sm ghost" data-jump="guests">ආගන්තුකයන්</button>' +
        '<button class="btn sm ghost" data-jump="seating">ආසන (' + seated + '/' + confirmed.length + ')</button>' +
        '<button class="btn sm ghost" id="reStats">පහන ගණන යළි ගණනය</button>' +
      '</div>') +
    card('<h3>පාර්ශව අනුව</h3><p class="hint">මනාලිය සහ මනාලයාගේ ආරාධිත බෙදීම</p>' +
      '<div class="split">' + sideCol("කෞශානි · මනාලිය", bride) + sideCol("ගෞරව · මනාලයා", groom) + '</div>') +
    card('<h3>නවතම පිළිතුරු</h3>' + (recent.length
      ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>නම</th><th>පාර්ශවය</th><th>තත්ත්වය</th><th>සංඛ්‍යාව</th><th>මත්පැන්</th></tr></thead><tbody>' +
        recent.map(g => '<tr><td>' + esc(g.name) + '</td><td>' + esc(sideName(g.side)) + '</td><td>' + statusPill(g.status) +
          '</td><td class="num">' + (g.party || "—") + '</td><td>' + (g.liquor ? "ඔව්" : "නැහැ") + '</td></tr>').join("") +
        '</tbody></table></div>'
      : '<div class="empty">තවම පිළිතුරු ලැබී නැත.</div>')) +
    card('<h3>අන්තර්ගත සාරාංශය</h3>' +
      '<div class="stats" style="margin:0">' +
        stat(gallery.length, "ඡායාරූප") + stat(agenda.length, "වැඩසටහන් අංග") +
        stat(blessings.filter(b => b.approved).length, "අනුමත සුබ පැතුම්") +
        stat(Object.values(content.show || {}).filter(Boolean).length + "/7", "දෘශ්‍ය කොටස්") +
      '</div>');

  $$("[data-jump]", $("#p-dashboard")).forEach(b => b.onclick = () => go(b.dataset.jump));
  $("#reStats").onclick = async () => { lastStats = null; pushStats(); toast("පහනේ ගණන යාවත්කාලීන විය", "ok"); };
};

/* ════════════════════════ 2 · WEDDING DETAILS ══════════════════════════════ */
renderers.details = function () {
  const c = content;
  const tri = (base, label, si, en, ta, type) =>
    '<div class="grid3">' + fld(label + " (සිංහල)", base + "Si_", si, type) +
      fld(label + " (English)", base + "En_", en, type) + fld(label + " (தமிழ்)", base + "Ta_", ta, type) + '</div>';

  $("#p-details").innerHTML =
    card('<h3>මනාල යුවළ</h3><p class="hint">මනාලිය මුලින් · තුන් භාෂාවෙන්ම (පොදු පිටුව + සන්නස දෙකටම යෙදේ)</p>' +
      tri("brideName", "මනාලියගේ නම", c.brideName, c.brideNameEn, c.brideNameTa) +
      tri("groomName", "මනාලයාගේ නම", c.groomName, c.groomNameEn, c.groomNameTa) +
      tri("brideParents", "මනාලියගේ දෙමාපිය පේළිය", c.bridePreLine, c.brideParentsEn || "", c.brideParentsTa || "", "textarea") +
      tri("groomParents", "මනාලයාගේ දෙමාපිය පේළිය", c.groomPreLine, c.groomParentsEn || "", c.groomParentsTa || "", "textarea")) +

    card('<h3>දිනය · වේලාව · ස්ථානය</h3><p class="hint">දිනය තෝරන විට සිංහල/English/தமிழ் දින පෙළ ස්වයංක්‍රීයව සැකසේ</p>' +
      '<div class="grid2">' + fld("මංගල දිනය හා වේලාව", "f_date", toLocalInput(c.dateISO), "datetime-local") +
        fld("පෝරු වේලාව", "f_poruwaTime", c.poruwaTime) + '</div>' +
      '<div class="field"><label>ස්වයංක්‍රීය දින පෙළ</label><input class="inp" id="f_datePrev" readonly></div>' +
      tri("ceremonyTime", "උත්සව වේලාව", c.ceremonyTime, c.ceremonyTimeEn, c.ceremonyTimeTa) +
      '<div class="grid2">' + fld("ස්ථානයේ නම", "f_venue", c.venue) + fld("Google Maps සබැඳිය", "f_venueMapUrl", c.venueMapUrl) + '</div>' +
      tri("venueCity", "නගරය", c.venueCity, c.venueCityEn, c.venueCityTa)) +

    card('<h3>ආරාධනා සන්නසේ පෙළ</h3><p class="hint">සන්නස (invitation scroll) සඳහා පමණක් · හිස්ව තැබුවොත් පෙරනිමි පෙළ යෙදේ</p>' +
      tri("join", "එක්වීමේ පේළිය", c.joinSi || "", c.joinEn || "", c.joinTa || "", "textarea") +
      tri("sannasaBody", "ආරාධනා ඡේදය", c.sannasaBodySi || "", c.sannasaBodyEn || "", c.sannasaBodyTa || "", "textarea") +
      tri("poruwa", "පෝරු මුහුර්ත පේළිය", c.poruwaSi || "", c.poruwaEn || "", c.poruwaTa || "", "textarea")) +

    card('<h3>ආදර සටහන හා සම්බන්ධතා</h3>' +
      fld("ආදර සටහන (Love Note)", "f_loveNote", c.loveNote, "textarea") +
      '<div class="grid2">' + fld("අත්සන", "f_loveSign", c.loveSign) + fld("දුරකථන අංකය", "f_phone", c.phone) + '</div>' +
      '<div class="grid2">' + fld("WhatsApp අංකය (94…)", "f_whatsapp", c.whatsapp) + fld("පසුබිම් සංගීත URL (mp3)", "f_ambientAudioUrl", c.ambientAudioUrl) + '</div>' +
      '<div class="row"><button class="btn primary" id="saveDetails" type="button">සියල්ල සුරකින්න</button>' +
      '<span class="saved" id="savedDetails">✓ සුරැකිණි · පොදු අඩවියට යෙදිණි</span></div>') +

    card('<h3>මුල් පිටුවේ යුවළ ඡායාරූපය</h3><p class="hint">හිස්ව තැබුවොත් සම්ප්‍රදායික චිත්‍රය දිස් වේ</p>' +
      (c.heroImageUrl ? '<img src="' + esc(c.heroImageUrl) + '" alt="" style="border-radius:16px;max-height:260px;object-fit:cover;width:100%;margin-bottom:12px">' : '') +
      '<label class="drop" id="heroDrop"><b>ඡායාරූපයක් තෝරන්න</b><i>JPG / PNG · ස්වයංක්‍රීයව optimise වේ</i>' +
      '<input type="file" id="heroFile" accept="image/*" hidden></label>' +
      '<div class="prog" id="heroProg" hidden><i></i></div>' +
      (c.heroImageUrl ? '<div class="row" style="margin-top:12px"><button class="btn sm ghost" id="heroClear" type="button">පෙරනිමි චිත්‍රයට හරවන්න</button></div>' : ''));

  const v = (id) => { const el = $("#" + id); return el ? el.value.trim() : ""; };
  const paintDate = () => {
    const d = dateStrings($("#f_date").value);
    $("#f_datePrev").value = d ? (d.si + "  ·  " + d.en + "  ·  " + d.ta) : "—";
  };
  $("#f_date").oninput = paintDate; paintDate();

  $("#saveDetails").onclick = async () => {
    const btn = $("#saveDetails"); btn.disabled = true; btn.textContent = "සුරකිමින්…";
    const iso = fromLocalInput($("#f_date").value);
    const ds = dateStrings(iso) || { si: "", en: "", ta: "" };
    const bSi = v("brideNameSi_"), gSi = v("groomNameSi_");
    const patch = {
      /* main page */
      brideName: bSi, groomName: gSi,
      brideNameEn: v("brideNameEn_"), groomNameEn: v("groomNameEn_"),
      brideNameTa: v("brideNameTa_"), groomNameTa: v("groomNameTa_"),
      bridePreLine: v("brideParentsSi_"), groomPreLine: v("groomParentsSi_"),
      dateISO: iso, poruwaTime: v("f_poruwaTime"),
      ceremonyTime: v("ceremonyTimeSi_"), ceremonyTimeEn: v("ceremonyTimeEn_"), ceremonyTimeTa: v("ceremonyTimeTa_"),
      venue: v("f_venue"), venueMapUrl: v("f_venueMapUrl"),
      venueCity: v("venueCitySi_"), venueCityEn: v("venueCityEn_"), venueCityTa: v("venueCityTa_"),
      loveNote: v("f_loveNote"), loveSign: v("f_loveSign") || (bSi + " & " + gSi),
      phone: v("f_phone"), whatsapp: v("f_whatsapp"), ambientAudioUrl: v("f_ambientAudioUrl"),
      /* invitation scroll (සන්නස) mirrors — keeps the decree in perfect sync */
      brideNameSi: bSi, groomNameSi: gSi,
      brideParentsSi: v("brideParentsSi_"), brideParentsEn: v("brideParentsEn_"), brideParentsTa: v("brideParentsTa_"),
      groomParentsSi: v("groomParentsSi_"), groomParentsEn: v("groomParentsEn_"), groomParentsTa: v("groomParentsTa_"),
      joinSi: v("joinSi_"), joinEn: v("joinEn_"), joinTa: v("joinTa_"),
      sannasaBodySi: v("sannasaBodySi_"), sannasaBodyEn: v("sannasaBodyEn_"), sannasaBodyTa: v("sannasaBodyTa_"),
      poruwaSi: v("poruwaSi_"), poruwaEn: v("poruwaEn_"), poruwaTa: v("poruwaTa_"),
      venueSi: v("f_venue"), venueEn: v("f_venue"), venueTa: v("f_venue"),
      citySi: v("venueCitySi_"), cityEn: v("venueCityEn_"), cityTa: v("venueCityTa_"),
      timeSi: v("ceremonyTimeSi_"), timeEn: v("ceremonyTimeEn_"), timeTa: v("ceremonyTimeTa_"),
      dateSi: ds.si, dateEn: ds.en, dateTa: ds.ta
    };
    try {
      await saveContent(patch);
      const s = $("#savedDetails"); s.classList.add("show"); setTimeout(() => s.classList.remove("show"), 2000);
      toast("මංගල තොරතුරු සුරැකිණි ✓", "ok");
    } catch (e) { toast("සුරැකීම අසාර්ථකයි: " + (e.message || e), "err"); }
    btn.disabled = false; btn.textContent = "සියල්ල සුරකින්න";
  };

  $("#heroFile").onchange = async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const p = $("#heroProg"), bar = $("i", p); p.hidden = false;
    try {
      const r = await uploadImage(f, (n) => bar.style.width = Math.max(6, n) + "%");
      await saveContent({ heroImageUrl: r.secure_url });
      toast("යුවළ ඡායාරූපය යාවත්කාලීන විය ✓", "ok");
    } catch (err) { toast(err.message || "උඩුගත කිරීම අසාර්ථකයි", "err"); }
    bar.style.width = "0%"; p.hidden = true; e.target.value = "";
  };
  if ($("#heroClear")) $("#heroClear").onclick = async () => {
    if (!await confirmBox("පෙරනිමි සම්ප්‍රදායික චිත්‍රයට හරවන්නද?", { danger: false, ok: "ඔව්" })) return;
    try { await saveContent({ heroImageUrl: "" }); toast("පෙරනිමි චිත්‍රයට හරවන ලදී", "ok"); }
    catch (e) { toast("දෝෂයකි", "err"); }
  };
};

/* ════════════════════════ 3 · GUEST MANAGEMENT ═════════════════════════════ */
let gFilter = { side: "all", q: "", page: 1 };
const PAGE = 25;
renderers.guests = function () {
  const G = effGuests();
  const bride = G.filter(g => g.side === "bride").length, groom = G.length - bride;
  let list = G.filter(g => gFilter.side === "all" || g.side === gFilter.side);
  if (gFilter.q) {
    const q = gFilter.q.toLowerCase();
    list = list.filter(g => (g.name + " " + g.family).toLowerCase().includes(q));
  }
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  gFilter.page = Math.min(gFilter.page, pages);
  const slice = list.slice((gFilter.page - 1) * PAGE, gFilter.page * PAGE);

  $("#p-guests").innerHTML =
    card('<h3>ආගන්තුකයෙකු එක් කරන්න</h3>' +
      '<div class="grid2">' + fld("නම", "g_name", "") + fld("පවුලේ නාමය (විකල්ප)", "g_family", "") + '</div>' +
      '<div class="grid3">' +
        '<div class="field"><label for="g_side">පාර්ශවය</label><select class="inp" id="g_side">' +
          '<option value="bride">කෞශානිගේ පාර්ශවය</option><option value="groom">ගෞරවගේ පාර්ශවය</option></select></div>' +
        fld("සාමාජික සංඛ්‍යාව", "g_count", "1", "number") +
        '<div class="field"><label for="g_diet">ආහාර අවශ්‍යතා (විකල්ප)</label><input class="inp" id="g_diet"></div>' +
      '</div>' +
      '<div class="row"><button class="btn primary" id="gAdd" type="button">එක් කරන්න</button></div>') +

    card('<h3>තොග ආයාතය · CSV / Excel</h3>' +
      '<p class="hint">තීරු අනුපිළිවෙළ: <code>නම, පවුලේ නාමය, ගණන</code> — ශීර්ෂ පේළියක් තිබීම කම් නැත</p>' +
      '<div class="grid2">' +
        '<div class="field"><label for="bk_side">පාර්ශවය</label><select class="inp" id="bk_side">' +
          '<option value="bride">කෞශානිගේ පාර්ශවය</option><option value="groom">ගෞරවගේ පාර්ශවය</option></select></div>' +
        '<div class="field"><label for="bk_file">.xlsx / .xls / .csv ගොනුව</label><input class="inp" id="bk_file" type="file" accept=".xlsx,.xls,.csv"></div>' +
      '</div>' +
      '<div class="field"><label for="bk_text">නැතහොත් කෙලින්ම අලවන්න</label>' +
      '<textarea class="inp" id="bk_text" rows="5" placeholder="සුනිල් පෙරේරා, පෙරේරා පවුල, 4&#10;නිමල් සිල්වා, සිල්වා පවුල, 2"></textarea></div>' +
      '<div class="row"><button class="btn primary" id="bkAdd" type="button">ලැයිස්තුව ආයාත කරන්න</button>' +
      '<button class="btn sm ghost" id="csvOut" type="button">CSV ලෙස බාගන්න</button></div>') +

    card('<div class="card-head"><h3>නාම ලේඛනය</h3>' +
      '<input class="inp" id="gSearch" placeholder="සොයන්න…" style="max-width:230px" value="' + esc(gFilter.q) + '"></div>' +
      '<div class="filters">' +
        chip("සියල්ල (" + G.length + ")", "all", gFilter.side) +
        chip("කෞශානි (" + bride + ")", "bride", gFilter.side) +
        chip("ගෞරව (" + groom + ")", "groom", gFilter.side) +
      '</div>' +
      (slice.length
        ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>නම</th><th>පවුල</th><th>පාර්ශවය</th><th>ගණන</th><th>තත්ත්වය</th><th>මත්පැන්</th><th>ආහාර</th><th>මේසය</th><th></th></tr></thead><tbody>' +
          slice.map(g =>
            '<tr>' +
            '<td><input class="mini k-name" data-id="' + g.id + '" value="' + esc(g.name) + '" style="min-width:118px"></td>' +
            '<td><input class="mini k-fam" data-id="' + g.id + '" value="' + esc(g.family) + '" style="min-width:104px"></td>' +
            '<td><select class="mini k-side" data-id="' + g.id + '"><option value="bride"' + (g.side === "bride" ? " selected" : "") + '>කෞශානි</option><option value="groom"' + (g.side === "groom" ? " selected" : "") + '>ගෞරව</option></select></td>' +
            '<td><input class="mini k-count num" data-id="' + g.id + '" type="number" min="1" max="40" value="' + g.count + '" style="width:62px"></td>' +
            '<td><select class="mini k-status" data-id="' + g.id + '"><option value="pending"' + (g.status === "pending" ? " selected" : "") + '>පොරොත්තු</option><option value="confirmed"' + (g.status === "confirmed" ? " selected" : "") + '>තහවුරු</option><option value="declined"' + (g.status === "declined" ? " selected" : "") + '>නොපැමිණේ</option></select></td>' +
            '<td style="text-align:center"><input type="checkbox" class="k-liq" data-id="' + g.id + '"' + (g.liquor ? " checked" : "") + '></td>' +
            '<td><input class="mini k-diet" data-id="' + g.id + '" value="' + esc(g.dietary) + '" style="min-width:96px"></td>' +
            '<td><input class="mini k-table num" data-id="' + g.id + '" type="number" min="1" max="99" value="' + (g.tableNumber || "") + '" style="width:56px" placeholder="—"></td>' +
            '<td><button class="btn xs bad k-del" data-id="' + g.id + '" type="button">මකන්න</button></td>' +
            '</tr>').join("") +
          '</tbody></table></div>' +
          '<div class="pager"><button class="btn xs ghost" id="pPrev" type="button"' + (gFilter.page <= 1 ? " disabled" : "") + '>← පෙර</button>' +
          '<span>පිටුව ' + gFilter.page + ' / ' + pages + ' · මුළු ' + list.length + '</span>' +
          '<button class="btn xs ghost" id="pNext" type="button"' + (gFilter.page >= pages ? " disabled" : "") + '>ඊළඟ →</button></div>'
        : '<div class="empty">ආගන්තුකයන් හමු නොවීය.</div>'));

  function chip(t, v, cur) { return '<button class="chip' + (cur === v ? " active" : "") + '" data-f="' + v + '" type="button">' + esc(t) + '</button>'; }

  $$("[data-f]", $("#p-guests")).forEach(c => c.onclick = () => { gFilter.side = c.dataset.f; gFilter.page = 1; renderers.guests(); });
  const sb = $("#gSearch");
  sb.oninput = () => { gFilter.q = sb.value.trim(); gFilter.page = 1; const p = sb.selectionStart; renderers.guests(); const n = $("#gSearch"); n.focus(); n.setSelectionRange(p, p); };
  if ($("#pPrev")) $("#pPrev").onclick = () => { gFilter.page--; renderers.guests(); };
  if ($("#pNext")) $("#pNext").onclick = () => { gFilter.page++; renderers.guests(); };

  $("#gAdd").onclick = async () => {
    const name = $("#g_name").value.trim();
    if (!name) { toast("නම ඇතුළත් කරන්න", "warn"); return; }
    try {
      await addGuest({
        name, family: $("#g_family").value.trim(), side: $("#g_side").value,
        count: clampInt($("#g_count").value, 1, 40), status: "pending",
        liquor: false, dietary: $("#g_diet").value.trim(), tableNumber: null
      });
      $("#g_name").value = ""; $("#g_family").value = ""; $("#g_count").value = "1"; $("#g_diet").value = "";
      toast("ආගන්තුකයා එක් විය ✓", "ok");
    } catch (e) { toast("එක් කිරීම අසාර්ථකයි", "err"); }
  };

  const bind = (sel, fn, ev) => $$(sel, $("#p-guests")).forEach(el => el[ev || "onchange"] = () => fn(el));
  bind(".k-name", el => updGuest(el.dataset.id, { name: el.value.trim() }).then(() => toast("නම යාවත්කාලීනයි", "ok")));
  bind(".k-fam",  el => updGuest(el.dataset.id, { family: el.value.trim() }).then(() => toast("පවුල යාවත්කාලීනයි", "ok")));
  bind(".k-side", el => updGuest(el.dataset.id, { side: el.value }).then(() => toast("පාර්ශවය යාවත්කාලීනයි", "ok")));
  bind(".k-count", el => updGuest(el.dataset.id, { count: clampInt(el.value, 1, 40) }).then(() => toast("ගණන යාවත්කාලීනයි", "ok")));
  bind(".k-diet", el => updGuest(el.dataset.id, { dietary: el.value.trim() }).then(() => toast("යාවත්කාලීනයි", "ok")));
  bind(".k-table", el => { const v = el.value ? clampInt(el.value, 1, 99) : null; updGuest(el.dataset.id, { tableNumber: v }).then(() => toast(v ? "මේස " + v + " පවරන ලදී" : "මේසය ඉවත් කෙරිණි", "ok")); });
  bind(".k-status", async el => {
    const g = effGuests().find(x => x.id === el.dataset.id); if (!g) return;
    const st = el.value;
    try {
      await updGuest(g.id, { status: st });
      if (g.hasRsvp || st !== "pending") await setRsvp(g, { attending: st === "confirmed", party: st === "confirmed" ? Math.max(1, g.party || g.count) : 0, count: st === "confirmed" ? Math.max(1, g.party || g.count) : 0, liquor: !!g.liquor, dietary: g.dietary || "" });
      toast("තත්ත්වය යාවත්කාලීනයි ✓", "ok");
    } catch (e) { toast("දෝෂයකි", "err"); }
  });
  bind(".k-liq", async el => {
    const g = effGuests().find(x => x.id === el.dataset.id); if (!g) return;
    try {
      await updGuest(g.id, { liquor: el.checked });
      if (g.hasRsvp) await setRsvp(g, { liquor: el.checked });
      toast("යාවත්කාලීනයි", "ok");
    } catch (e) { toast("දෝෂයකි", "err"); }
  });
  $$(".k-del", $("#p-guests")).forEach(b => b.onclick = async () => {
    if (!await confirmBox("මෙම ආගන්තුකයා සහ ඔහුගේ පිළිතුර මකන්නද?")) return;
    try { await delGuest(b.dataset.id); await delRsvp(b.dataset.id).catch(() => {}); toast("මකා දැමිණි", "ok"); }
    catch (e) { toast("දෝෂයකි", "err"); }
  });

  /* ── bulk import ── */
  const rowsFrom = (matrix) => {
    if (!matrix || !matrix.length) return [];
    let start = 0;
    const head = (matrix[0] || []).map(x => String(x == null ? "" : x).trim().toLowerCase());
    if (head.some(h => /නම|name|පවුල|family|ගණන|count|පාර්ශ|side/.test(h))) start = 1;
    const out = [];
    for (let i = start; i < matrix.length; i++) {
      const r = matrix[i] || [];
      const name = String(r[0] == null ? "" : r[0]).trim();
      if (!name) continue;
      out.push({ name, family: String(r[1] == null ? "" : r[1]).trim(), count: clampInt(r[2], 1, 40) });
    }
    return out;
  };
  const importRows = async (rows) => {
    const side = $("#bk_side").value;
    const clean = (rows || []).filter(r => r && r.name);
    if (!clean.length) { toast("දත්ත හමු නොවීය", "warn"); return; }
    const btn = $("#bkAdd"); btn.disabled = true; btn.textContent = "ආයාත කරමින්…";
    try {
      let n = 0;
      for (let i = 0; i < clean.length; i += 400) {
        const batch = writeBatch(db);
        clean.slice(i, i + 400).forEach(r => {
          batch.set(doc(collection(db, "guests")), {
            name: r.name, family: r.family || "", side, count: r.count,
            status: "pending", liquor: false, dietary: "", tableNumber: null, ts: serverTimestamp()
          });
          n++;
        });
        await batch.commit();
      }
      $("#bk_text").value = ""; $("#bk_file").value = "";
      toast("ආගන්තුකයෝ " + n + " දෙනෙක් ආයාත විය ✓", "ok");
    } catch (e) { toast("ආයාතය අසාර්ථකයි: " + (e.message || e), "err"); }
    btn.disabled = false; btn.textContent = "ලැයිස්තුව ආයාත කරන්න";
  };
  $("#bkAdd").onclick = () => importRows(rowsFrom(
    $("#bk_text").value.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => l.split(/[,\t;]/).map(s => s.trim()))
  ));
  $("#bk_file").onchange = async () => {
    const f = $("#bk_file").files && $("#bk_file").files[0]; if (!f) return;
    try {
      let matrix;
      if (/\.csv$/i.test(f.name)) {
        matrix = (await f.text()).split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => l.split(/[,\t;]/).map(s => s.replace(/^"|"$/g, "").trim()));
      } else {
        const X = await loadXLSX();
        const wb = X.read(await f.arrayBuffer(), { type: "array" });
        matrix = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      }
      await importRows(rowsFrom(matrix));
    } catch (e) { toast("ගොනුව කියවීම අසාර්ථකයි: " + (e.message || e), "err"); }
  };
  $("#csvOut").onclick = () => {
    const G = effGuests();
    const rows = [["නම", "පවුල", "පාර්ශවය", "ගණන", "තත්ත්වය", "මත්පැන්", "ආහාර", "මේසය"]].concat(
      G.map(g => [g.name, g.family, sideName(g.side), g.count,
        g.status === "confirmed" ? "තහවුරු" : g.status === "declined" ? "නොපැමිණේ" : "පොරොත්තු",
        g.liquor ? "ඔව්" : "නැහැ", g.dietary, g.tableNumber || ""]));
    downloadCsv(rows, "helasiritha-guests.csv");
  };
};
let xlsxP = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxP) return xlsxP;
  xlsxP = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = XLSX_CDN; s.async = true;
    s.onload = () => window.XLSX ? res(window.XLSX) : rej(new Error("xlsx load"));
    s.onerror = () => rej(new Error("xlsx load"));
    document.head.appendChild(s);
  });
  return xlsxP;
}
function downloadCsv(rows, filename) {
  const csv = "\uFEFF" + rows.map(r => r.map(c => '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"').join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast("CSV බාගත විය ✓", "ok");
}

/* ════════════════════════ 4 · RSVP DIRECTORY ═══════════════════════════════ */
let rFilter = { k: "all", q: "", page: 1 };
renderers.rsvp = function () {
  const G = effGuests();
  const counts = {
    all: G.length,
    confirmed: G.filter(g => g.status === "confirmed").length,
    pending: G.filter(g => g.status === "pending").length,
    declined: G.filter(g => g.status === "declined").length,
    liquor: G.filter(g => g.status === "confirmed" && g.liquor).length
  };
  let list = G.filter(g =>
    rFilter.k === "all" ? true :
    rFilter.k === "liquor" ? (g.status === "confirmed" && g.liquor) : g.status === rFilter.k);
  if (rFilter.q) { const q = rFilter.q.toLowerCase(); list = list.filter(g => (g.name + " " + g.family).toLowerCase().includes(q)); }
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  rFilter.page = Math.min(rFilter.page, pages);
  const slice = list.slice((rFilter.page - 1) * PAGE, rFilter.page * PAGE);
  const ch = (t, v) => '<button class="chip' + (rFilter.k === v ? " active" : "") + '" data-r="' + v + '" type="button">' + esc(t) + '</button>';

  $("#p-rsvp").innerHTML =
    '<div class="stats">' +
      stat(counts.confirmed, "තහවුරු", "ok") + stat(headcount(), "තහවුරු පුද්ගලයන්", "ok") +
      stat(counts.pending, "පොරොත්තු", "warn") + stat(counts.declined, "නොපැමිණේ", "bad") +
      stat(counts.liquor, "මත්පැන් අවශ්‍ය") +
    '</div>' +
    card('<div class="card-head"><h3>පිළිතුරු නාමාවලිය</h3>' +
      '<input class="inp" id="rSearch" placeholder="සොයන්න…" style="max-width:230px" value="' + esc(rFilter.q) + '"></div>' +
      '<div class="filters">' + ch("සියල්ල (" + counts.all + ")", "all") + ch("තහවුරු (" + counts.confirmed + ")", "confirmed") +
        ch("පොරොත්තු (" + counts.pending + ")", "pending") + ch("නොපැමිණේ (" + counts.declined + ")", "declined") +
        ch("මත්පැන් (" + counts.liquor + ")", "liquor") +
        '<button class="btn sm ghost" id="rCsv" type="button" style="margin-inline-start:auto">CSV බාගන්න</button></div>' +
      (slice.length
        ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>නම</th><th>පවුල</th><th>පාර්ශවය</th><th>තත්ත්වය</th><th>සංඛ්‍යාව</th><th>මත්පැන්</th><th>ආහාර</th><th>ක්‍රියා</th></tr></thead><tbody>' +
          slice.map(g =>
            '<tr><td>' + esc(g.name) + '</td><td>' + esc(g.family) + '</td>' +
            '<td><span class="pill side">' + esc(sideName(g.side)) + '</span></td>' +
            '<td>' + statusPill(g.status) + '</td>' +
            '<td class="num">' + (g.party || g.count) + '</td>' +
            '<td>' + (g.liquor ? '<span class="pill pend">ඔව්</span>' : "නැහැ") + '</td>' +
            '<td>' + (esc(g.dietary) || "—") + '</td>' +
            '<td><button class="btn xs ok r-yes" data-id="' + g.id + '" type="button">තහවුරු</button> ' +
            '<button class="btn xs bad r-no" data-id="' + g.id + '" type="button">නොපැමිණේ</button>' +
            (g.hasRsvp ? ' <button class="btn xs ghost r-clr" data-id="' + g.id + '" type="button">හිස් කරන්න</button>' : '') +
            '</td></tr>').join("") +
          '</tbody></table></div>' +
          '<div class="pager"><button class="btn xs ghost" id="rPrev" type="button"' + (rFilter.page <= 1 ? " disabled" : "") + '>← පෙර</button>' +
          '<span>පිටුව ' + rFilter.page + ' / ' + pages + ' · මුළු ' + list.length + '</span>' +
          '<button class="btn xs ghost" id="rNext" type="button"' + (rFilter.page >= pages ? " disabled" : "") + '>ඊළඟ →</button></div>'
        : '<div class="empty">මෙම පෙරහනට ගැළපෙන පිළිතුරු නැත.</div>'));

  $$("[data-r]", $("#p-rsvp")).forEach(c => c.onclick = () => { rFilter.k = c.dataset.r; rFilter.page = 1; renderers.rsvp(); });
  const sb = $("#rSearch");
  sb.oninput = () => { rFilter.q = sb.value.trim(); rFilter.page = 1; const p = sb.selectionStart; renderers.rsvp(); const n = $("#rSearch"); n.focus(); n.setSelectionRange(p, p); };
  if ($("#rPrev")) $("#rPrev").onclick = () => { rFilter.page--; renderers.rsvp(); };
  if ($("#rNext")) $("#rNext").onclick = () => { rFilter.page++; renderers.rsvp(); };
  const act = (sel, fn) => $$(sel, $("#p-rsvp")).forEach(b => b.onclick = async () => {
    const g = effGuests().find(x => x.id === b.dataset.id); if (!g) return;
    try { await fn(g); toast("යාවත්කාලීන විය ✓", "ok"); } catch (e) { toast("දෝෂයකි", "err"); }
  });
  act(".r-yes", async g => { const p = Math.max(1, g.party || g.count); await setRsvp(g, { attending: true, party: p, count: p, liquor: !!g.liquor, dietary: g.dietary || "" }); await updGuest(g.id, { status: "confirmed" }); });
  act(".r-no",  async g => { await setRsvp(g, { attending: false, party: 0, count: 0, liquor: false, dietary: g.dietary || "" }); await updGuest(g.id, { status: "declined" }); });
  act(".r-clr", async g => { await delRsvp(g.id); await updGuest(g.id, { status: "pending" }); });
  $("#rCsv").onclick = () => {
    const rows = [["නම", "පවුල", "පාර්ශවය", "තත්ත්වය", "සංඛ්‍යාව", "මත්පැන්", "ආහාර"]].concat(
      effGuests().map(g => [g.name, g.family, sideName(g.side),
        g.status === "confirmed" ? "තහවුරු" : g.status === "declined" ? "නොපැමිණේ" : "පොරොත්තු",
        g.party || g.count, g.liquor ? "ඔව්" : "නැහැ", g.dietary]));
    downloadCsv(rows, "helasiritha-rsvp.csv");
  };
};

/* ════════════════════════ 5 · AGENDA BUILDER ═══════════════════════════════ */
renderers.agenda = function () {
  $("#p-agenda").innerHTML =
    card('<div class="card-head"><h3>මංගල දිනයේ වැඩසටහන</h3>' +
      '<div class="row"><button class="btn sm ghost" id="agAdd" type="button">+ නව අංගයක්</button>' +
      '<button class="btn primary sm" id="agSave" type="button">සුරකින්න</button>' +
      '<span class="saved" id="agSaved">✓ සුරැකිණි</span></div></div>' +
      '<p class="hint">අංග අනුපිළිවෙළ ↑↓ මගින් වෙනස් කරන්න · තුන් භාෂාවෙන්ම පෙළ ඇතුළත් කරන්න</p>' +
      '<div class="list" id="agList"></div>');
  drawAgenda();
  $("#agAdd").onclick = () => { readAgenda(); agenda.push({ icon: "lamp", timeLabel: "", titleSi: "", descSi: "", titleEn: "", descEn: "", titleTa: "", descTa: "" }); drawAgenda(); };
  $("#agSave").onclick = async () => {
    readAgenda();
    const clean = agenda.filter(a => (a.titleSi || "").trim() || (a.titleEn || "").trim() || (a.titleTa || "").trim());
    if (!clean.length) { toast("අවම වශයෙන් එක් අංගයක මාතෘකාවක් අවශ්‍යයි", "warn"); return; }
    const b = $("#agSave"); b.disabled = true; b.textContent = "සුරකිමින්…";
    try {
      await saveAgenda(clean);
      const s = $("#agSaved"); s.classList.add("show"); setTimeout(() => s.classList.remove("show"), 1900);
      toast("වැඩසටහන සුරැකිණි ✓", "ok");
    } catch (e) { toast("සුරැකීම අසාර්ථකයි", "err"); }
    b.disabled = false; b.textContent = "සුරකින්න";
  };
};
function drawAgenda() {
  $("#agList").innerHTML = agenda.length ? agenda.map((it, i) =>
    '<div class="item" style="flex-direction:column;align-items:stretch;gap:9px">' +
      '<div class="row">' +
        '<select class="inp k-ic" data-i="' + i + '" style="max-width:132px">' +
          ICON_OPTIONS.map(o => '<option value="' + o + '"' + (it.icon === o ? " selected" : "") + '>' + o + '</option>').join("") + '</select>' +
        '<input class="inp k-time" data-i="' + i + '" value="' + esc(it.timeLabel || "") + '" placeholder="වේලාව (9.15 AM)" style="max-width:158px">' +
        '<span class="sp" style="flex:1"></span>' +
        '<button class="btn xs ghost k-up" data-i="' + i + '" type="button" aria-label="ඉහළට">↑</button>' +
        '<button class="btn xs ghost k-dn" data-i="' + i + '" type="button" aria-label="පහළට">↓</button>' +
        '<button class="btn xs bad k-rm" data-i="' + i + '" type="button">මකන්න</button>' +
      '</div>' +
      '<div class="grid3">' +
        '<input class="inp k-tsi" data-i="' + i + '" value="' + esc(it.titleSi || "") + '" placeholder="මාතෘකාව (සිංහල)">' +
        '<input class="inp k-ten" data-i="' + i + '" value="' + esc(it.titleEn || "") + '" placeholder="Title (English)">' +
        '<input class="inp k-tta" data-i="' + i + '" value="' + esc(it.titleTa || "") + '" placeholder="தலைப்பு (தமிழ்)">' +
      '</div>' +
      '<div class="grid3">' +
        '<textarea class="inp k-dsi" data-i="' + i + '" rows="2" placeholder="විස්තරය (සිංහල)">' + esc(it.descSi || "") + '</textarea>' +
        '<textarea class="inp k-den" data-i="' + i + '" rows="2" placeholder="Description (English)">' + esc(it.descEn || "") + '</textarea>' +
        '<textarea class="inp k-dta" data-i="' + i + '" rows="2" placeholder="விவரம் (தமிழ்)">' + esc(it.descTa || "") + '</textarea>' +
      '</div>' +
    '</div>').join("") : '<div class="empty">තවම අංග නැත.</div>';
  $$(".k-rm", $("#agList")).forEach(b => b.onclick = () => { readAgenda(); agenda.splice(+b.dataset.i, 1); drawAgenda(); });
  const move = (i, j) => { if (j < 0 || j >= agenda.length) return; readAgenda(); const t = agenda[i]; agenda[i] = agenda[j]; agenda[j] = t; drawAgenda(); };
  $$(".k-up", $("#agList")).forEach(b => b.onclick = () => move(+b.dataset.i, +b.dataset.i - 1));
  $$(".k-dn", $("#agList")).forEach(b => b.onclick = () => move(+b.dataset.i, +b.dataset.i + 1));
}
function readAgenda() {
  const map = { "k-ic": "icon", "k-time": "timeLabel", "k-tsi": "titleSi", "k-ten": "titleEn", "k-tta": "titleTa", "k-dsi": "descSi", "k-den": "descEn", "k-dta": "descTa" };
  Object.keys(map).forEach(cls => $$("." + cls, $("#agList")).forEach(el => {
    const i = +el.dataset.i; if (agenda[i]) agenda[i][map[cls]] = el.value;
  }));
}

/* ════════════════════════ 6 · GALLERY MANAGER (custom sort) ════════════════
   Ordering is authoritative: the number written to `order` is exactly the slot
   the photo takes on the public site (its app.js sorts by `order` ascending).

   THREE ways to reorder, because HTML5 drag-and-drop never fires from a touch
   screen — on a phone the previous build could not be reordered at all:
     • ← →  buttons          — always work, on every device
     • position number box   — send a photo straight to any slot
     • press-and-drag handle — Pointer Events, so mouse AND touch both work
   ═══════════════════════════════════════════════════════════════════════════ */
let galBusy = false;

/* Persist positions. Chunked so a large gallery can never breach Firestore's
   500-writes-per-batch limit. */
function commitOrder(ids) {
  let p = Promise.resolve();
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400), base = i;
    p = p.then(() => {
      const batch = writeBatch(db);
      chunk.forEach((id, k) => batch.update(doc(db, "gallery", id), { order: base + k }));
      return batch.commit();
    });
  }
  return p;
}
async function applyOrder(ids) {
  if (galBusy) return;
  galBusy = true;
  const map = {}; gallery.forEach(g => { map[g.id] = g; });
  const prev = gallery;
  gallery = ids.map((id, i) => Object.assign({}, map[id], { order: i })).filter(Boolean);
  renderers.gallery();                                   /* optimistic, instant */
  try {
    await commitOrder(ids);
    logAudit("gallery.reorder", ids.length + " photos");
    toast("අනුපිළිවෙළ සුරැකිණි ✓ — පොදු අඩවියට යෙදිණි", "ok");
  } catch (e) {
    gallery = prev; renderers.gallery();
    toast("අනුපිළිවෙළ සුරැකීම අසාර්ථකයි", "err");
  }
  galBusy = false;
}
function moveTo(id, to) {
  const ids = gallery.map(g => g.id);
  const from = ids.indexOf(id);
  if (from < 0) return;
  to = Math.max(0, Math.min(ids.length - 1, to));
  if (to === from) return;
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  applyOrder(ids);
}

renderers.gallery = function () {
  const n = gallery.length;
  const slot = n === 9 ? '<p class="slot-note ok">✓ Moments of Love සඳහා ඡායාරූප 9ම සම්පූර්ණයි.</p>'
    : n < 9 ? '<p class="slot-note warn">තව ' + (9 - n) + 'ක් එක් කළොත් Moments of Love සම්පූර්ණ වේ (දැන් ' + n + '/9).</p>'
    : '<p class="slot-note warn">ඡායාරූප ' + n + 'ක් ඇත — <b>මුල් 9</b> Moments of Love ලෙස දිස් වේ.</p>';

  $("#p-gallery").innerHTML =
    card('<h3>ඡායාරූප එක් කරන්න</h3><p class="hint">ගොනු මෙතැනට ඇද දමන්න හෝ click කරන්න · කිහිපයක් එකවර</p>' +
      '<label class="drop" id="galDrop"><b>ඡායාරූප තෝරන්න හෝ මෙතැනට ඇද දමන්න</b>' +
      '<i>JPG / PNG / WEBP · ස්වයංක්‍රීයව optimise වී Cloudinary වෙත යයි</i>' +
      '<input type="file" id="galFile" accept="image/*" multiple hidden></label>' +
      '<div class="prog" id="galProg" hidden><i></i></div>' + slot) +
    card('<div class="card-head"><h3>අනුපිළිවෙළ (' + n + ')</h3>' +
      '<span class="faint" style="font-size:.78rem">මෙහි අනුපිළිවෙළම පොදු අඩවියේ දිස් වේ</span></div>' +
      '<p class="hint">⇕ අල්ලාගෙන ඇදගෙන යන්න · <b>←&nbsp;→</b> එකින් එක ගෙනයන්න · අංකය වෙනස් කර ඕනෑම තැනකට යවන්න</p>' +
      (n ? '<div class="gal" id="galGrid">' + gallery.map((g, i) =>
        '<div class="gcell' + (i === 8 && n > 9 ? " cut" : "") + '" data-id="' + esc(g.id) + '" data-i="' + i + '">' +
          '<span class="gnum">' + (i + 1) + '</span>' +
          '<button class="gx" data-del="' + esc(g.id) + '" type="button" title="මකන්න" aria-label="මකන්න">✕</button>' +
          '<span class="g-handle" data-h="' + esc(g.id) + '" title="ඇදගෙන යන්න">⇕</span>' +
          '<img src="' + esc(thumb(g.url)) + '" alt="' + esc(g.caption || "") + '" loading="lazy" decoding="async" draggable="false">' +
          '<div class="gmove">' +
            '<button class="gbtn g-mv" data-id="' + esc(g.id) + '" data-dir="l" type="button"' + (i === 0 ? " disabled" : "") + ' aria-label="වමට">←</button>' +
            '<input class="g-pos num" type="number" min="1" max="' + n + '" value="' + (i + 1) + '" data-id="' + esc(g.id) + '" aria-label="ස්ථානය">' +
            '<button class="gbtn g-mv" data-id="' + esc(g.id) + '" data-dir="r" type="button"' + (i === n - 1 ? " disabled" : "") + ' aria-label="දකුණට">→</button>' +
          '</div>' +
          '<div class="gbar"><input class="mini cap" data-cap="' + esc(g.id) + '" value="' + esc(g.caption || "") + '" placeholder="සිරැසිය"></div>' +
        '</div>').join("") + '</div>'
        : '<div class="empty">තවම ඡායාරූප නැත.</div>'));

  /* ── upload ── */
  const drop = $("#galDrop"), file = $("#galFile"), prog = $("#galProg"), bar = $("i", prog);
  const upload = async (files) => {
    const arr = Array.from(files || []).filter(f => /^image\//.test(f.type || ""));
    if (!arr.length) { toast("ඡායාරූප ගොනු තෝරන්න", "warn"); return; }
    prog.hidden = false; let ok = 0;
    for (let i = 0; i < arr.length; i++) {
      try {
        bar.style.width = "6%";
        const r = await uploadImage(arr[i], (p) => bar.style.width = Math.max(6, p) + "%");
        await addGalleryItem({ url: r.secure_url, publicId: r.public_id || "", caption: "", order: gallery.length + ok });
        ok++; toast("උඩුගත විය (" + ok + "/" + arr.length + ") ✓", "ok");
      } catch (e) { toast("උඩුගත වීම අසාර්ථකයි: " + (e.message || e), "err"); }
    }
    bar.style.width = "0%"; prog.hidden = true; file.value = "";
  };
  file.onchange = (e) => upload(e.target.files);
  ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove("over")));
  drop.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files) upload(e.dataTransfer.files); });

  /* ── delete / caption ── */
  $$("[data-del]", $("#p-gallery")).forEach(b => b.onclick = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!await confirmBox("මෙම ඡායාරූපය එකතුවෙන් මකන්නද?")) return;
    try {
      await delGallery(b.dataset.del);
      const ids = gallery.map(g => g.id).filter(id => id !== b.dataset.del);
      if (ids.length) commitOrder(ids).catch(() => {});     /* keep positions 1..n tidy */
      toast("මකා දැමිණි", "ok");
    } catch (_) { toast("දෝෂයකි", "err"); }
  });
  $$("[data-cap]", $("#p-gallery")).forEach(inp => {
    inp.onpointerdown = (e) => e.stopPropagation();
    inp.onchange = () => updGallery(inp.dataset.cap, { caption: inp.value.trim() })
      .then(() => toast("සිරැසිය සුරැකිණි", "ok")).catch(() => toast("දෝෂයකි", "err"));
  });

  /* ── ← → buttons ── */
  $$(".g-mv", $("#p-gallery")).forEach(b => b.onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    const ids = gallery.map(g => g.id);
    moveTo(b.dataset.id, ids.indexOf(b.dataset.id) + (b.dataset.dir === "l" ? -1 : 1));
  });

  /* ── exact position box ── */
  $$(".g-pos", $("#p-gallery")).forEach(inp => {
    inp.onpointerdown = (e) => e.stopPropagation();
    inp.onchange = () => moveTo(inp.dataset.id, clampInt(inp.value, 1, gallery.length) - 1);
  });

  /* ── press-and-drag (Pointer Events → mouse AND touch) ── */
  const grid = $("#galGrid");
  if (grid) $$(".g-handle", grid).forEach(handle => {
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const cell = handle.closest(".gcell"); if (!cell) return;
      const srcId = cell.dataset.id;
      cell.classList.add("drag");
      /* Listen on WINDOW, not on the handle: the pointer leaves the handle almost
         immediately, and relying on pointer capture is unreliable across engines.
         `touch-action:none` on the handle stops the browser stealing the gesture. */
      /* Clamp into the viewport: elementFromPoint returns null for any point
         outside it, which silently killed drops near the edges. */
      const cellAt = (x, y) => {
        const vw = window.innerWidth, vh = window.innerHeight;
        const cx = Math.max(1, Math.min(vw - 2, x));
        const cy = Math.max(1, Math.min(vh - 2, y));
        const el = document.elementFromPoint(cx, cy);
        return (el && el.closest) ? el.closest(".gcell") : null;
      };
      const clear = () => $$(".gcell", grid).forEach(c => c.classList.remove("dragover"));
      let lastX = e.clientX, lastY = e.clientY;
      /* Auto-scroll while dragging near an edge, so photos can be moved across a
         gallery taller than the screen — essential on a phone. */
      const EDGE = 72;
      let scrollTimer = setInterval(() => {
        const vh = window.innerHeight;
        if (lastY < EDGE) window.scrollBy(0, -18);
        else if (lastY > vh - EDGE) window.scrollBy(0, 18);
      }, 60);
      const move = (ev) => {
        if (ev.cancelable) ev.preventDefault();
        lastX = ev.clientX; lastY = ev.clientY;
        const over = cellAt(lastX, lastY);
        clear();
        if (over && over !== cell) over.classList.add("dragover");
      };
      const up = (ev) => {
        clearInterval(scrollTimer);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        cell.classList.remove("drag"); clear();
        const x = (ev && ev.clientX != null) ? ev.clientX : lastX;
        const y = (ev && ev.clientY != null) ? ev.clientY : lastY;
        const over = cellAt(x, y);
        if (over && over !== cell) moveTo(srcId, gallery.map(g => g.id).indexOf(over.dataset.id));
      };
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    });
  });
};
const thumb = (url) => (url && url.includes("/upload/")) ? url.replace("/upload/", "/upload/w_420,f_auto,q_auto/") : (url || "");

/* ════════════════════════ 7 · BLESSINGS MODERATION ═════════════════════════ */
let bFilter = "pending";
renderers.blessings = function () {
  const pend = blessings.filter(b => !b.approved), app = blessings.filter(b => b.approved);
  const list = bFilter === "pending" ? pend : bFilter === "approved" ? app : blessings;
  const ch = (t, v) => '<button class="chip' + (bFilter === v ? " active" : "") + '" data-b="' + v + '" type="button">' + esc(t) + '</button>';
  const when = (b) => b.ts && b.ts.seconds ? new Date(b.ts.seconds * 1000).toLocaleString("si-LK") : "";

  $("#p-blessings").innerHTML =
    '<div class="stats">' + stat(pend.length, "අනුමැතියට", pend.length ? "warn" : "") +
      stat(app.length, "අනුමත", "ok") + stat(blessings.length, "මුළු පැතුම්") + '</div>' +
    card('<div class="filters">' + ch("අනුමැතියට (" + pend.length + ")", "pending") +
      ch("අනුමත (" + app.length + ")", "approved") + ch("සියල්ල (" + blessings.length + ")", "all") + '</div>' +
      '<p class="hint">අනුමත කළ පසු ක්ෂණිකව පොදු අඩවියේ දිස් වේ</p>' +
      (list.length ? '<div class="list">' + list.map(b =>
        '<div class="item" style="align-items:flex-start">' +
          '<div class="meta"><div class="t">' + esc(b.name || "—") + ' ' +
            (b.approved ? '<span class="pill yes">අනුමත</span>' : '<span class="pill pend">අනුමැතියට</span>') + '</div>' +
            '<div class="d" style="white-space:pre-wrap;color:var(--mut);margin-top:5px">' + esc(b.message || "") + '</div>' +
            (when(b) ? '<div class="d">' + esc(when(b)) + '</div>' : '') + '</div>' +
          '<div class="acts">' +
            (b.approved
              ? '<button class="btn xs ghost b-un" data-id="' + esc(b.id) + '" type="button">සඟවන්න</button>'
              : '<button class="btn xs ok b-ap" data-id="' + esc(b.id) + '" type="button">අනුමත</button>') +
            '<button class="btn xs bad b-del" data-id="' + esc(b.id) + '" type="button">මකන්න</button>' +
          '</div></div>').join("") + '</div>'
        : '<div class="empty">මෙම පෙරහනට කිසිවක් නැත.</div>'));

  $$("[data-b]", $("#p-blessings")).forEach(c => c.onclick = () => { bFilter = c.dataset.b; renderers.blessings(); });
  $$(".b-ap", $("#p-blessings")).forEach(b => b.onclick = () => updBlessing(b.dataset.id, { approved: true }).then(() => toast("අනුමත විය — පොදු අඩවියේ දිස් වේ ✓", "ok")).catch(() => toast("දෝෂයකි", "err")));
  $$(".b-un", $("#p-blessings")).forEach(b => b.onclick = () => updBlessing(b.dataset.id, { approved: false }).then(() => toast("සඟවන ලදී", "ok")).catch(() => toast("දෝෂයකි", "err")));
  $$(".b-del", $("#p-blessings")).forEach(b => b.onclick = async () => {
    if (!await confirmBox("මෙම සුබ පැතුම මකන්නද?")) return;
    try { await delBlessing(b.dataset.id); toast("මකා දැමිණි", "ok"); } catch (_) { toast("දෝෂයකි", "err"); }
  });
};

/* ════════════════════════ 8 · VISIBILITY TOGGLES ═══════════════════════════ */
renderers.visibility = function () {
  const show = content.show || {};
  $("#p-visibility").innerHTML =
    card('<h3>පොදු අඩවියේ දිස්වන කොටස්</h3><p class="hint">සෑම වෙනසක්ම ක්ෂණිකව සජීවී අඩවියට යෙදේ</p>' +
      VIS_FIELDS.map(([k, label, hint, isRoot]) =>
        swRow(label, hint, "v_" + k, isRoot ? content.rsvpOpen !== false : show[k] !== false)).join(""));

  VIS_FIELDS.forEach(([k, label, hint, isRoot]) => {
    const sw = $("#v_" + k); if (!sw) return;
    sw.onclick = async () => {
      const on = !sw.classList.contains("on");
      sw.classList.toggle("on", on); sw.setAttribute("aria-checked", String(on));
      try {
        await saveContent(isRoot ? { rsvpOpen: on } : { show: Object.assign({}, show, { [k]: on }) });
        toast(on ? label + " — පෙන්වයි ✓" : label + " — සඟවයි ✓", "ok");
      } catch (e) {
        sw.classList.toggle("on", !on); sw.setAttribute("aria-checked", String(!on));
        toast("වෙනස් කිරීම අසාර්ථකයි", "err");
      }
    };
  });
};

/* ════════════════════════ 9 · THEME CUSTOMISER ═════════════════════════════ */
const isHex = (v) => /^#[0-9a-fA-F]{6}$/.test(String(v || "").trim());
renderers.theme = function () {
  const t = Object.assign({}, THEME_DEFAULT, theme);
  $("#p-theme").innerHTML =
    card('<div class="card-head"><h3>වර්ණ තේමාව</h3>' +
      '<button class="btn sm ghost" id="thReset" type="button">පෙරනිමි වර්ණ</button></div>' +
      '<p class="hint">සුරැකූ විට පොදු අඩවියේ CSS විචල්‍ය ක්ෂණිකව යාවත්කාලීන වේ</p>' +
      '<div class="presets">' + Object.keys(THEME_PRESETS).map(nm => {
        const p = THEME_PRESETS[nm];
        return '<button class="preset" data-preset="' + esc(nm) + '" type="button"><span class="sw3">' +
          '<i style="background:' + p.primary + '"></i><i style="background:' + p.secondary + '"></i><i style="background:' + p.accent + '"></i>' +
          '</span>' + esc(nm) + '</button>';
      }).join("") + '</div>' +
      THEME_FIELDS.map(([k, label, hint]) =>
        '<div class="thm-row"><div class="thm-meta"><b>' + esc(label) + '</b><div class="faint" style="font-size:.78rem">' + esc(hint) + '</div></div>' +
        '<div class="thm-pick"><input type="color" class="thm-color" data-k="' + k + '" value="' + esc(t[k]) + '" aria-label="' + esc(label) + '">' +
        '<input type="text" class="inp thm-hex" data-k="' + k + '" value="' + esc(String(t[k]).toUpperCase()) + '" maxlength="7" spellcheck="false"></div></div>').join("") +
      '<div class="thm-prev" id="thPrev"><div class="thm-card">' +
        '<div class="ay">ශුභ මංගලම්</div><div class="nm">කෞශානි &amp; ගෞරව</div>' +
        '<div class="ln">ඔබගේ පැමිණීම අපගේ භාග්‍යයකි</div></div></div>' +
      '<div class="row" style="margin-top:16px;justify-content:flex-end">' +
        '<button class="btn primary" id="thSave" type="button">වර්ණ සුරකින්න</button>' +
        '<span class="saved" id="thSaved">✓ සුරැකිණි</span></div>');

  const prev = $("#thPrev");
  const paint = () => {
    const map = { primary: "--pv-pri", secondary: "--pv-sec", accent: "--pv-acc", surface: "--pv-bg", text: "--pv-ink" };
    THEME_FIELDS.forEach(([k]) => {
      const v = $('.thm-hex[data-k="' + k + '"]').value.trim();
      if (isHex(v)) prev.style.setProperty(map[k], v);
    });
  };
  $$(".thm-color", $("#p-theme")).forEach(c => c.oninput = () => {
    $('.thm-hex[data-k="' + c.dataset.k + '"]').value = c.value.toUpperCase(); paint();
  });
  $$(".thm-hex", $("#p-theme")).forEach(h => h.oninput = () => {
    let v = h.value.trim(); if (v && v[0] !== "#") v = "#" + v;
    if (isHex(v)) { $('.thm-color[data-k="' + h.dataset.k + '"]').value = v; paint(); }
  });
  $$("[data-preset]", $("#p-theme")).forEach(b => b.onclick = () => {
    const p = THEME_PRESETS[b.dataset.preset]; if (!p) return;
    THEME_FIELDS.forEach(([k]) => {
      $('.thm-color[data-k="' + k + '"]').value = p[k];
      $('.thm-hex[data-k="' + k + '"]').value = p[k].toUpperCase();
    });
    paint(); toast(b.dataset.preset + " තේමාව යෙදිණි — සුරකින්න", "warn");
  });
  $("#thReset").onclick = () => {
    THEME_FIELDS.forEach(([k]) => {
      $('.thm-color[data-k="' + k + '"]').value = THEME_DEFAULT[k];
      $('.thm-hex[data-k="' + k + '"]').value = THEME_DEFAULT[k].toUpperCase();
    });
    paint();
  };
  paint();
  $("#thSave").onclick = async () => {
    const out = {}; let bad = false;
    THEME_FIELDS.forEach(([k]) => {
      let v = $('.thm-hex[data-k="' + k + '"]').value.trim();
      if (v && v[0] !== "#") v = "#" + v;
      if (!isHex(v)) bad = true; out[k] = String(v).toUpperCase();
    });
    if (bad) { toast("වර්ණ කේතය #RRGGBB ආකාරයෙන් විය යුතුය", "err"); return; }
    const b = $("#thSave"); b.disabled = true; b.textContent = "සුරකිමින්…";
    try {
      await saveTheme(out);
      const s = $("#thSaved"); s.classList.add("show"); setTimeout(() => s.classList.remove("show"), 1900);
      toast("වර්ණ තේමාව සුරැකිණි ✓ — පොදු අඩවියට යෙදිණි", "ok");
    } catch (e) { toast("සුරැකීම අසාර්ථකයි", "err"); }
    b.disabled = false; b.textContent = "වර්ණ සුරකින්න";
  };
};

/* ════════════════════════ 10 · SEATING PLANNER ═════════════════════════════ */
let extraTables = [], seatPick = null;
renderers.seating = function () {
  const C = effGuests().filter(g => g.status === "confirmed");
  const pool = C.filter(g => !g.tableNumber);
  const used = Array.from(new Set(C.filter(g => g.tableNumber).map(g => g.tableNumber)));
  const tables = Array.from(new Set(used.concat(extraTables))).sort((a, b) => a - b);
  const people = (a) => a.reduce((n, g) => n + Math.max(1, g.party || g.count), 0);

  $("#p-seating").innerHTML =
    '<div class="stats">' + stat(C.length, "තහවුරු පවුල්", "ok") +
      stat(pool.length, "පැවරීමට ඉතිරි", pool.length ? "warn" : "ok") +
      stat(tables.length, "මේස ගණන") + stat(people(C), "මුළු පුද්ගලයන්") + '</div>' +
    card('<div class="card-head"><h3>මේසයක් එක් කරන්න</h3>' +
      '<div class="row"><input class="inp" id="tNum" type="number" min="1" max="99" placeholder="මේස අංකය" style="max-width:130px">' +
      '<button class="btn primary sm" id="tAdd" type="button">මේසය එක් කරන්න</button></div></div>' +
      '<p class="hint">ආගන්තුකයන් මේසයකට ඇද දමන්න (drag & drop) · ✕ මගින් ඉවත් කරන්න</p>') +
    '<div class="split" style="align-items:start">' +
      '<div class="card"><h3>පවරා නැති ආගන්තුකයෝ (' + pool.length + ')</h3>' +
        '<div class="seat-pool" id="seatPool">' + (pool.length ? pool.map(g =>
          '<div class="seat-chip" draggable="true" data-gid="' + esc(g.id) + '">' +
          '<span class="pill side">' + esc(sideName(g.side)) + '</span> ' + esc(g.name) +
          ' <span class="faint">· ' + Math.max(1, g.party || g.count) + '</span></div>').join("")
          : '<div class="empty">සියලු ආගන්තුකයන් පවරා ඇත ✓</div>') + '</div></div>' +
      '<div class="card"><h3>මේස</h3>' + (tables.length
        ? '<div class="seat-grid">' + tables.map(tn => {
            const at = C.filter(g => g.tableNumber === tn);
            return '<div class="table-card" data-table="' + tn + '">' +
              '<h4>මේස ' + tn + '<button class="btn xs ghost t-clr" data-table="' + tn + '" type="button">හිස් කරන්න</button></h4>' +
              '<div class="cnt">' + at.length + ' පවුල් · ' + people(at) + ' පුද්ගලයන්</div>' +
              at.map(g => '<div class="seat-chip" draggable="true" data-gid="' + esc(g.id) + '">' + esc(g.name) +
                '<span class="x" data-un="' + esc(g.id) + '" title="ඉවත් කරන්න">✕</span></div>').join("") +
            '</div>';
          }).join("") + '</div>'
        : '<div class="empty">තවම මේස එක් කර නැත.</div>') + '</div>' +
    '</div>';

  $("#tAdd").onclick = () => {
    const n = clampInt($("#tNum").value, 1, 99);
    if (!$("#tNum").value || n < 1) { toast("වලංගු මේස අංකයක් දෙන්න", "warn"); return; }
    if (tables.includes(n)) { toast("මේස " + n + " දැනටමත් ඇත", "warn"); return; }
    extraTables.push(n); $("#tNum").value = ""; renderers.seating();
    toast("මේස " + n + " එක් කෙරිණි — ආගන්තුකයන් ඇද දමන්න", "ok");
  };
  const assign = async (gid, tn) => {
    try { await updGuest(gid, { tableNumber: tn }); toast(tn ? "මේස " + tn + " ට පවරන ලදී ✓" : "ඉවත් කරන ලදී", "ok"); }
    catch (_) { toast("දෝෂයකි", "err"); }
  };
  $$("[data-un]", $("#p-seating")).forEach(x => x.onclick = (e) => { e.stopPropagation(); assign(x.dataset.un, null); });
  $$(".t-clr", $("#p-seating")).forEach(b => b.onclick = async () => {
    const tn = +b.dataset.table;
    const at = C.filter(g => g.tableNumber === tn);
    if (!at.length) { extraTables = extraTables.filter(t => t !== tn); renderers.seating(); return; }
    if (!await confirmBox("මේස " + tn + " හි සියලු පැවරුම් ඉවත් කරන්නද?")) return;
    try {
      const batch = writeBatch(db);
      at.forEach(g => batch.update(doc(db, "guests", g.id), { tableNumber: null }));
      await batch.commit(); toast("මේස " + tn + " හිස් කෙරිණි", "ok");
    } catch (_) { toast("දෝෂයකි", "err"); }
  });

  let dragGid = null;
  $$(".seat-chip", $("#p-seating")).forEach(ch => {
    ch.addEventListener("dragstart", (e) => { dragGid = ch.dataset.gid; ch.classList.add("drag"); if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", dragGid); } catch (_) {} } });
    ch.addEventListener("dragend", () => { dragGid = null; ch.classList.remove("drag"); $$(".table-card").forEach(t => t.classList.remove("over")); });
  });
  $$(".table-card", $("#p-seating")).forEach(tc => {
    tc.addEventListener("dragover", (e) => { e.preventDefault(); tc.classList.add("over"); });
    tc.addEventListener("dragleave", () => tc.classList.remove("over"));
    tc.addEventListener("drop", (e) => {
      e.preventDefault(); tc.classList.remove("over");
      const gid = dragGid || (e.dataTransfer && e.dataTransfer.getData("text/plain"));
      if (gid) assign(gid, +tc.dataset.table);
    });
  });
  /* ── tap-to-assign: touch screens cannot use HTML5 drag at all ──
     tap a guest → tap a table. Tap the pool to un-assign. */
  $$(".seat-chip", $("#p-seating")).forEach(ch => {
    ch.addEventListener("click", (e) => {
      if (e.target && e.target.classList && e.target.classList.contains("x")) return;
      const was = ch.classList.contains("picked");
      $$(".seat-chip", $("#p-seating")).forEach(c => c.classList.remove("picked"));
      if (was) { seatPick = null; return; }
      ch.classList.add("picked"); seatPick = ch.dataset.gid;
      toast("දැන් මේසයක් තට්ටු කරන්න (ඉවත් කිරීමට ලැයිස්තුව)", "warn");
    });
  });
  const clearPick = () => { seatPick = null; $$(".seat-chip", $("#p-seating")).forEach(c => c.classList.remove("picked")); };
  $$(".table-card", $("#p-seating")).forEach(tc => {
    tc.addEventListener("click", (e) => {
      if (e.target.closest && e.target.closest(".seat-chip")) return;
      if (e.target.closest && e.target.closest(".t-clr")) return;
      if (!seatPick) return;
      const gid = seatPick; clearPick(); assign(gid, +tc.dataset.table);
    });
  });
  const poolTap = $("#seatPool");
  if (poolTap) poolTap.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest(".seat-chip")) return;
    if (!seatPick) return;
    const gid = seatPick; clearPick(); assign(gid, null);
  });

  const poolEl = $("#seatPool");
  if (poolEl) {
    poolEl.addEventListener("dragover", (e) => e.preventDefault());
    poolEl.addEventListener("drop", (e) => {
      e.preventDefault();
      const gid = dragGid || (e.dataTransfer && e.dataTransfer.getData("text/plain"));
      if (gid) assign(gid, null);
    });
  }
};

/* ════════════════════════ BOOT WIRING ══════════════════════════════════════ */
/* ── wrong-repository guard ───────────────────────────────────────────────────
   This file belongs to the ADMIN repo only. If it is ever dropped into the
   public wedding repo the gate markup will be absent — say so loudly instead of
   throwing a cryptic error. */
if (!$("#googleBtn") || !$("#app")) {
  console.error("[Helasiritha] This app.js is the ADMIN panel script, but the admin gate " +
    "markup (#googleBtn / #app) is missing. Wrong repository? The public site has its own app.js.");
} else {

$("#googleBtn").addEventListener("click", doGoogleLogin);

/* ── alternate sign-in methods + live diagnostics ── */
(function wireDiagnostics() {
  const rb = $("#btnRedirect");
  if (rb) rb.onclick = async () => {
    loginError(""); loginHint(""); setBusy(true, "යොමු කරමින්…");
    if (!(await startRedirect())) setBusy(false);
  };
  const so = $("#soAuth");
  if (so) {
    so.checked = SAME_ORIGIN_AUTH;
    so.onchange = () => {
      try { localStorage.setItem("hs_same_origin_auth", so.checked ? "1" : "0"); } catch (_) {}
      toast(so.checked ? "Same-origin මාදිලිය ON — යළි පූරණය වේ…" : "Same-origin මාදිලිය OFF — යළි පූරණය වේ…", "warn");
      setTimeout(() => location.reload(), 900);
    };
  }
  const cd = $("#copyDiag");
  if (cd) cd.onclick = async () => {
    paintDiag();
    try { await navigator.clipboard.writeText(diagText()); toast("තාක්ෂණික විස්තර copy විය ✓", "ok"); }
    catch (_) { const el = $("#diagOut"); if (el) { const r = document.createRange(); r.selectNodeContents(el);
      const sel = getComputedStyle ? window.getSelection() : null; if (sel) { sel.removeAllRanges(); sel.addRange(r); } }
      toast("පෙළ තෝරා ඇත — copy කරන්න", "warn"); }
  };
  const dg = $("#loginDiag");
  if (dg) dg.addEventListener("toggle", () => { if (dg.open) paintDiag(); });

  /* pre-flight: warn about blocked storage BEFORE an attempt is wasted */
  const st = storageReport();
  if (!st.local || !st.session || !st.indexedDB) {
    loginError("බ්‍රවුසරයේ ගබඩාව අවහිර කර ඇත — පිවිසුම සම්පූර්ණ කළ නොහැක.");
    loginHint('<div style="text-align:start">Safari: <b>Settings → Safari → Block All Cookies</b> ක්‍රියාවිරහිත කරන්න.' +
      '<br>නැතහොත් Private/Incognito කවුළුවෙන් ඉවත් වී සාමාන්‍ය කවුළුවක් භාවිතා කරන්න.</div>');
    if (dg) dg.open = true;
    paintDiag();
  }
})();
$("#logoutBtn").addEventListener("click", async () => {
  enteredAt = 0;                                  /* deliberate exit — honour it at once */
  await signOut(auth).catch(() => {});
  $("#app").hidden = true; $("#login").hidden = false; setBusy(false);
  toast("පිටවිය.", "ok");
});
$("#menuBtn").addEventListener("click", openDrawer);
$("#scrim").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
window.addEventListener("online",  () => syncState(true));
window.addEventListener("offline", () => syncState(false));

} /* ── end wrong-repository guard ── */

/* ════════════════════════════════════════════════════════════════════════════
   v2 · SECURE UPLOADS — signed first, unsigned fallback
   When the admin is served from Vercel, /api/sign-upload signs the request with
   CLOUDINARY_API_SECRET **on the server**; the secret never reaches the browser
   and the public unsigned preset can then be switched off in Cloudinary. On a
   host without functions (GitHub Pages) it degrades to the unsigned preset.
   ════════════════════════════════════════════════════════════════════════════ */
let signDiag = { state: "untested", status: 0, reason: "" };
async function getSignature(paramsToSign) {
  try {
    const u = auth.currentUser;
    if (!u) { signDiag = { state: "fail", status: 0, reason: "not signed in" }; return null; }
    const token = await u.getIdToken();          /* proves who is asking */
    const r = await fetch(SIGN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify(paramsToSign)
    });
    let j = null;
    try { j = await r.json(); } catch (_) {}
    if (!r.ok) {
      signDiag = { state: "fail", status: r.status,
                   reason: (j && (j.message || j.error)) || ("HTTP " + r.status) };
      return null;
    }
    if (!(j && j.signature && j.apiKey && j.cloudName)) {
      signDiag = { state: "fail", status: r.status, reason: "incomplete signature response" };
      return null;
    }
    signDiag = { state: "ok", status: 200, reason: "signed uploads active" };
    return j;
  } catch (e) {
    /* 404 on a host without functions (e.g. GitHub Pages) lands here too */
    signDiag = { state: "fail", status: 0, reason: (e && e.message) || "endpoint unreachable" };
    return null;
  }
}
uploadImage = function (file, onProgress) {
  return new Promise(async (resolve, reject) => {
    const blob = await downscale(file);
    const sig = await getSignature({ timestamp: Math.round(Date.now() / 1000), folder: "helasiritha" });
    signMode = sig ? "signed" : "unsigned";
    const fd = new FormData();
    fd.append("file", blob);
    if (sig) {
      /* echo back exactly what the server signed — a drifting device clock can
         no longer invalidate the signature */
      fd.append("api_key", sig.apiKey);
      fd.append("timestamp", String(sig.timestamp));
      fd.append("folder", sig.folder || "helasiritha");
      fd.append("signature", sig.signature);
    } else {
      fd.append("upload_preset", CLOUD.preset);
    }
    const cloudName = (sig && sig.cloudName) || CLOUD.name;
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "https://api.cloudinary.com/v1_1/" + cloudName + "/image/upload");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round(e.loaded / e.total * 100)); };
    xhr.onload = () => {
      try {
        const j = JSON.parse(xhr.responseText);
        if (j.secure_url) { resolve(j); return; }
        const raw = (j.error && j.error.message) || "උඩුගත කිරීම අසාර්ථකයි";
        reject(new Error(explainUploadError(raw)));
      } catch (err) { reject(err); }
    };
    xhr.onerror = () => reject(new Error("ජාල දෝෂයකි"));
    xhr.send(fd);
  });
};

/* Cloudinary's raw messages are opaque. Translate the ones that actually happen
   into the exact action that fixes them. */
function explainUploadError(raw) {
  const m = String(raw || "");
  if (/preset/i.test(m)) {
    return "Upload preset හමු නොවීය. " +
      (signDiag.state === "ok"
        ? "නමුත් signed මාදිලිය සක්‍රීයයි — නැවත උත්සාහ කරන්න."
        : "Signed මාදිලිය ක්‍රියා නොකරයි (" + (signDiag.reason || "?") +
          "). ආරක්ෂාව → “උඩුගත කිරීම පරීක්ෂා කරන්න” බලන්න, නැතහොත් Cloudinary හි " +
          "unsigned preset එකක් “" + CLOUD.preset + "” නමින් සාදන්න.");
  }
  if (/signature/i.test(m)) return "Signature වලංගු නොවේ — CLOUDINARY_API_SECRET නිවැරදිද බලන්න.";
  if (/api_key|api key/i.test(m)) return "CLOUDINARY_API_KEY වැරදියි.";
  if (/File size too large|too large/i.test(m)) return "ගොනුව විශාල වැඩියි — කුඩා ඡායාරූපයක් උත්සාහ කරන්න.";
  if (/Invalid image file|unsupported/i.test(m)) return "මෙම ගොනු වර්ගය සහාය නොදක්වයි (JPG / PNG / WEBP භාවිතා කරන්න).";
  return m;
}

/* ════════════════════ v2 · VISIT ANALYTICS ════════════════════ */
const dayKey = (d) => {
  const z = new Date(d); const p = (n) => String(n).padStart(2, "0");
  return z.getFullYear() + "-" + p(z.getMonth() + 1) + "-" + p(z.getDate());
};
function visitSecs(v) { return (v.ts && v.ts.seconds) ? v.ts.seconds : 0; }
function visitDay(v) { return v.day || (visitSecs(v) ? dayKey(visitSecs(v) * 1000) : ""); }
function visitKind(v) { const k = String(v.kind || "").toLowerCase(); return VISIT_KINDS.includes(k) ? k : "direct"; }
function visitStats() {
  const by = { qr: 0, web: 0, direct: 0 };
  const today = dayKey(Date.now()); let todayN = 0;
  const cut7 = Math.floor(Date.now() / 1000) - 7 * 86400; let last7 = 0;
  visits.forEach(v => { by[visitKind(v)]++; if (visitDay(v) === today) todayN++; if (visitSecs(v) >= cut7) last7++; });
  return { by, total: visits.length, today: todayN, last7 };
}
renderers.analytics = function () {
  const S = visitStats();
  const days = 14, series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = dayKey(Date.now() - i * 86400000);
    series.push({ d, qr: 0, web: 0, direct: 0, n: 0 });
  }
  const idx = {}; series.forEach((r, i) => idx[r.d] = i);
  visits.forEach(v => { const i = idx[visitDay(v)]; if (i != null) { series[i][visitKind(v)]++; series[i].n++; } });
  const peak = Math.max(1, ...series.map(r => r.n));
  const ic = (d) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>';
  const tile = (v, l, sub, cls, icon) =>
    '<div class="kpi-tile ' + (cls || "") + '"><div class="ic">' + ic(icon) + '</div>' +
    '<div class="v num">' + esc(String(v)) + '</div><div class="l">' + esc(l) + '</div>' +
    (sub ? '<div class="s">' + esc(sub) + '</div>' : '') + '</div>';
  const recent = visits.slice(0, 25);
  const kindLabel = { qr: "QR කේතය", web: "වෙබ් සබැඳිය", direct: "සෘජු" };

  $("#p-analytics").innerHTML =
    '<div class="kpi">' +
      tile(S.total, "මුළු පැමිණීම්", "සියලු මූලාශ්‍ර", "", ICONS.eye) +
      tile(S.by.qr, "QR කේතයෙන්", "ආරාධනා කාඩ්පත් / QR", "qr", ICONS.qr) +
      tile(S.by.web, "වෙබ් සබැඳියෙන්", "WhatsApp, සමාජ මාධ්‍ය…", "web", ICONS.grid) +
      tile(S.by.direct, "සෘජු පිවිසුම්", "කෙලින්ම ලිපිනය ටයිප් කර", "", ICONS.users) +
      tile(S.today, "අද පැමිණීම්", dayKey(Date.now()), "", ICONS.chart) +
      tile(S.last7, "දින 7ක", "පසුගිය සතිය", "", ICONS.chart) +
    '</div>' +
    card('<h3>දෛනික පැමිණීම් · පසුගිය දින 14</h3>' +
      '<div class="chart">' + series.map(r => {
        const h = (x) => Math.round(x / peak * 100);
        return '<div class="col" title="' + esc(r.d) + ' · ' + r.n + '">' +
          '<div class="stack">' +
            (r.direct ? '<div class="seg direct" style="height:' + h(r.direct) + '%"></div>' : '') +
            (r.web ? '<div class="seg web" style="height:' + h(r.web) + '%"></div>' : '') +
            (r.qr ? '<div class="seg qr" style="height:' + h(r.qr) + '%"></div>' : '') +
          '</div><div class="cl">' + esc(r.d.slice(5)) + '</div></div>';
      }).join("") + '</div>' +
      '<div class="legend"><span><i style="background:linear-gradient(180deg,#9CC9F5,#5E93CE)"></i>QR</span>' +
      '<span><i style="background:linear-gradient(180deg,#9CEFC9,#43BE8B)"></i>වෙබ්</span>' +
      '<span><i style="background:linear-gradient(105deg,#F7E9C4,#C9A35C)"></i>සෘජු</span></div>' +
      (visitsCapped ? '<p class="slot-note warn">නවතම වාර්තා 5000 පමණක් පෙන්වයි.</p>' : '')) +
    card('<div class="card-head"><h3>නවතම පැමිණීම්</h3>' +
      '<button class="btn sm ghost" id="vCsv" type="button">CSV බාගන්න</button></div>' +
      (recent.length
        ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>දිනය</th><th>මූලාශ්‍රය</th><th>භාෂාව</th><th>යොමුව</th></tr></thead><tbody>' +
          recent.map(v => '<tr><td>' + esc(visitSecs(v) ? new Date(visitSecs(v) * 1000).toLocaleString("si-LK") : visitDay(v)) + '</td>' +
            '<td><span class="pill side">' + esc(kindLabel[visitKind(v)]) + '</span></td>' +
            '<td>' + esc(v.lang || "—") + '</td><td>' + esc((v.ref || "—").slice(0, 46)) + '</td></tr>').join("") +
          '</tbody></table></div>'
        : '<div class="empty">තවම පැමිණීම් වාර්තා නැත. පොදු අඩවියේ නව <code>app.js</code> deploy කළ පසු මෙය පිරෙනු ඇත.</div>'));

  if ($("#vCsv")) $("#vCsv").onclick = () => downloadCsv(
    [["දිනය", "මූලාශ්‍රය", "භාෂාව", "යොමුව"]].concat(visits.map(v =>
      [visitSecs(v) ? new Date(visitSecs(v) * 1000).toLocaleString("si-LK") : visitDay(v), kindLabel[visitKind(v)], v.lang || "", v.ref || ""])),
    "helasiritha-visits.csv");
};

/* ════════════════════ v2 · QR STUDIO ════════════════════ */
let qrP = null;
function loadQR() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (qrP) return qrP;
  qrP = new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = QR_CDN; s.async = true;
    s.onload = () => window.qrcode ? res(window.qrcode) : rej(new Error("qr load"));
    s.onerror = () => rej(new Error("qr load"));
    document.head.appendChild(s);
  });
  return qrP;
}
renderers.qr = function () {
  const S = visitStats();
  $("#p-qr").innerHTML =
    card('<h3>ආරාධනා QR කේතය</h3>' +
      '<p class="hint">මෙම QR කේතය හරහා පැමිණෙන අය <b>“QR කේතයෙන්”</b> ලෙස වෙන් වෙන්ව ගණන් ගැනේ</p>' +
      '<div class="grid2">' +
        fld("ඉලක්ක ලිපිනය", "qr_url", PUBLIC_SITE) +
        fld("මූලාශ්‍ර ලේබලය (src)", "qr_src", "qr") +
      '</div>' +
      '<div class="row" style="margin-bottom:16px">' +
        '<button class="btn primary sm" id="qrMake" type="button">QR කේතය සාදන්න</button>' +
        '<button class="btn sm ghost" id="qrPng" type="button" disabled>PNG බාගන්න</button>' +
        '<button class="btn sm ghost" id="qrCopy" type="button">සබැඳිය copy</button>' +
      '</div>' +
      '<div class="qr-wrap"><div class="qr-box" id="qrBox"><div class="empty" style="width:210px">QR කේතය මෙහි දිස් වේ</div></div>' +
      '<div class="qr-meta"><label style="font-size:.8rem;font-weight:700;color:var(--mut)">සම්පූර්ණ සබැඳිය</label>' +
      '<code id="qrLink">' + esc(PUBLIC_SITE + "/?src=qr") + '</code>' +
      '<p class="hint" style="padding:0;margin-top:12px">මුද්‍රිත ආරාධනා පත්‍රවල මෙය භාවිතා කරන්න. ' +
      'WhatsApp වැනි තැන්වලට <code>?src=web</code> යොදන්න — එවිට ඒවා වෙන් වෙන්ව ගණන් ගැනේ.</p>' +
      '<div class="stats" style="margin-top:14px">' + stat(S.by.qr, "QR ස්කෑන්", "gold") + stat(S.by.web, "වෙබ්", "ok") + '</div>' +
      '</div></div>');

  const link = () => {
    const base = ($("#qr_url").value.trim() || PUBLIC_SITE).replace(/\/+$/, "");
    const src = encodeURIComponent($("#qr_src").value.trim() || "qr");
    return base + "/?src=" + src;
  };
  const paint = () => { $("#qrLink").textContent = link(); };
  $("#qr_url").oninput = paint; $("#qr_src").oninput = paint;
  $("#qrMake").onclick = async () => {
    const b = $("#qrMake"); b.disabled = true; b.textContent = "සාදමින්…";
    try {
      const qrcode = await loadQR();
      const q = qrcode(0, "M"); q.addData(link()); q.make();
      $("#qrBox").innerHTML = q.createSvgTag({ cellSize: 6, margin: 4 });
      $("#qrPng").disabled = false;
      $("#qrPng").onclick = () => {
        const a = document.createElement("a");
        a.href = q.createDataURL(10, 4); a.download = "helasiritha-qr.png"; a.click();
        toast("QR කේතය බාගත විය ✓", "ok");
      };
      toast("QR කේතය සාදන ලදී ✓", "ok");
    } catch (e) { toast("QR සෑදීම අසාර්ථකයි — අන්තර්ජාලය පරීක්ෂා කරන්න", "err"); }
    b.disabled = false; b.textContent = "QR කේතය සාදන්න";
  };
  $("#qrCopy").onclick = async () => {
    try { await navigator.clipboard.writeText(link()); toast("සබැඳිය copy විය ✓", "ok"); }
    catch (_) { toast("copy කළ නොහැක — අතින් තෝරන්න", "warn"); }
  };
};

/* ════════════════════ v2 · SECURITY & AUDIT ════════════════════ */
renderers.security = function () {
  const u = auth.currentUser;
  const https = location.protocol === "https:" || location.hostname === "localhost";
  const mins = Math.round((Date.now() - sessionStart) / 60000);
  const row = (ok, label, detail) =>
    '<div class="sec-note ' + (ok ? "ok" : "") + '">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="' +
      (ok ? "M20 6L9 17l-5-5" : "M12 8v5M12 16h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 3.9a2 2 0 00-3.4 0z") +
    '"/></svg><div><b>' + esc(label) + '</b><div>' + detail + '</div></div></div>';

  $("#p-security").innerHTML =
    card('<h3>වත්මන් සැසිය</h3>' +
      row(true, "තනි පරිපාලක ගිණුම තහවුරුයි", esc((u && u.email) || "—") + " · Google OAuth") +
      row(!!(u && u.emailVerified), "විද්‍යුත් තැපෑල තහවුරු කර ඇත", (u && u.emailVerified) ? "Firestore rules සඳහා අවශ්‍යයි" : "තහවුරු කර නැත") +
      row(https, "සම්බන්ධතාවය සංකේතනය කර ඇත", https ? "HTTPS" : "HTTP — ආරක්ෂිත නොවේ") +
      row(signDiag.state === "ok", "ඡායාරූප උඩුගත කිරීම",
        signDiag.state === "ok" ? "Signed — රහස server එකේ ✓"
        : signDiag.state === "fail" ? "Signed ක්‍රියා නොකරයි: " + esc(signDiag.reason) + (signDiag.status ? " (HTTP " + signDiag.status + ")" : "")
        : "තවම පරීක්ෂා කර නැත — පහත බොත්තම ඔබන්න") +
      '<div class="row" style="margin:2px 0 8px"><button class="btn sm primary" id="secTestUp" type="button">උඩුගත කිරීම පරීක්ෂා කරන්න</button></div>' +
      '<pre id="upTest" class="up-test"' + (upTestReport ? '>' + esc(upTestReport) : ' hidden>') + '</pre>' +
      '<div class="row" style="margin-top:6px">' +
        '<span class="faint" style="font-size:.8rem">සැසිය මිනිත්තු ' + mins + 'ක් · අක්‍රීය මිනිත්තු 20කින් ස්වයංක්‍රීයව පිටවේ</span>' +
        '<span class="sp" style="flex:1"></span>' +
        '<button class="btn sm bad" id="secOut" type="button">දැන්ම පිටවෙන්න</button></div>') +

    card('<h3>දත්ත උපස්ථය</h3><p class="hint">සම්පූර්ණ මංගල දත්ත JSON ගොනුවක් ලෙස බාගන්න — නිතර ගන්න</p>' +
      '<div class="row"><button class="btn primary sm" id="secBackup" type="button">සම්පූර්ණ උපස්ථය බාගන්න</button>' +
      '<span class="faint" style="font-size:.8rem">ආගන්තුකයෝ ' + guests.length + ' · පිළිතුරු ' + rsvps.length +
      ' · ඡායාරූප ' + gallery.length + ' · පැතුම් ' + blessings.length + '</span></div>') +

    card('<div class="card-head"><h3>පරිපාලන ක්‍රියා සටහන</h3>' +
      '<span class="faint" style="font-size:.78rem">නවතම ' + audit.length + ' · වෙනස් කළ නොහැක</span></div>' +
      '<p class="hint">සෑම වෙනසක්ම මෙහි ස්ථිරව සටහන් වේ. rules මගින් මකා දැමීම හෝ සංස්කරණය තහනම්.</p>' +
      (audit.length
        ? '<div class="list audit">' + audit.map(a =>
            '<div class="item"><div class="meta"><div class="act">' + esc(a.action || "—") + '</div>' +
            '<div class="tgt">' + esc(a.target || "") + '</div>' +
            '<div class="who">' + esc(a.email || "") + ' · ' +
            esc(a.ts && a.ts.seconds ? new Date(a.ts.seconds * 1000).toLocaleString("si-LK") : "") + '</div></div></div>').join("") + '</div>'
        : '<div class="empty">තවම සටහන් නැත. (rules deploy කළ පසු ක්‍රියාත්මක වේ)</div>'));

  /* One tap tells you exactly what the uploader will do and why. */
  $("#secTestUp").onclick = async () => {
    const btn = $("#secTestUp");
    const paint = (txt) => {
      upTestReport = txt;
      const el = $("#upTest");
      if (el) { el.hidden = false; el.textContent = txt; }
    };
    paint("පරීක්ෂා කරමින්…");
    btn.disabled = true;
    const lines = [];
    /* 1 — is the function deployed at all, and is it configured? */
    try {
      const r = await fetch(SIGN_ENDPOINT, { method: "GET", cache: "no-store" });
      lines.push("GET  " + SIGN_ENDPOINT + "  →  HTTP " + r.status);
      if (r.status === 404 || r.status === 405) {
        lines.push("  ⚠ Serverless function එක හමු නොවීය.");
        lines.push("    • Vercel නම්: repo එකේ  api/sign-upload.js  තිබේද? redeploy කරන්න.");
        lines.push("    • GitHub Pages නම්: functions නැත → Cloudinary හි unsigned preset");
        lines.push("      “" + CLOUD.preset + "” නමින් සාදන්න (Settings → Upload → Add upload preset,");
        lines.push("      Signing mode = Unsigned).");
      } else {
        let j = null; try { j = await r.json(); } catch (_) {}
        if (j && j.configured) {
          const c = j.configured;
          lines.push("  CLOUDINARY_CLOUD_NAME : " + (c.cloudName ? "✓" : "✗ නැත"));
          lines.push("  CLOUDINARY_API_KEY    : " + (c.apiKey ? "✓" : "✗ නැත"));
          lines.push("  CLOUDINARY_API_SECRET : " + (c.apiSecret ? "✓" : "✗ නැත"));
          lines.push("  Firebase key          : " + (c.firebaseKey ? "✓" : "✗"));
          lines.push("  සූදානම්               : " + (j.ready ? "✓ ඔව්" : "✗ නැත"));
          if (!j.ready) lines.push("  ⚠ Vercel → Settings → Environment Variables වල නැති ඒවා දමා redeploy කරන්න.");
        }
      }
    } catch (e) {
      lines.push("GET " + SIGN_ENDPOINT + " → ළඟා විය නොහැක (" + ((e && e.message) || "?") + ")");
    }
    /* 2 — actually request a signature the same way an upload would */
    const sig = await getSignature({ timestamp: Math.round(Date.now() / 1000), folder: "helasiritha" });
    lines.push("");
    lines.push("POST (signature request) → " + (sig ? "HTTP 200 ✓" : "අසාර්ථක: " + signDiag.reason +
      (signDiag.status ? " (HTTP " + signDiag.status + ")" : "")));
    if (sig) {
      lines.push("  cloud   : " + sig.cloudName);
      lines.push("  folder  : " + sig.folder);
      lines.push("  ts      : " + sig.timestamp + "  (server clock)");
      lines.push("  එබැවින් preset එකක් අවශ්‍ය නැත. ඡායාරූප දැන් උඩුගත වේ. ✓");
    }
    /* store first, then re-render — the report survives the refresh */
    upTestReport = lines.join("\n");
    btn.disabled = false;
    renderers.security();
    paint(upTestReport);
    toast(sig ? "Signed උඩුගත කිරීම සූදානම් ✓" : "උඩුගත කිරීම සකසා නැත — විස්තර බලන්න", sig ? "ok" : "err");
  };

  $("#secOut").onclick = async () => {
    enteredAt = 0; await signOut(auth).catch(() => {});
    $("#app").hidden = true; $("#login").hidden = false; setBusy(false);
  };
  $("#secBackup").onclick = () => {
    const payload = {
      exportedAt: new Date().toISOString(), by: (u && u.email) || "",
      content, agenda, theme, gallery, guests, rsvps, blessings,
      visitSummary: visitStats()
    };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    a.download = "helasiritha-backup-" + dayKey(Date.now()) + ".json"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    logAudit("backup.download", dayKey(Date.now()));
    toast("උපස්ථය බාගත විය ✓", "ok");
  };
};

/* ════════════════════ v2 · IDLE AUTO-LOGOUT ════════════════════ */
["pointerdown", "keydown", "scroll", "touchstart"].forEach(ev =>
  window.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true }));
setInterval(() => {
  if (!auth.currentUser) return;
  if (Date.now() - lastActivity > IDLE_LOGOUT_MS) {
    lastActivity = Date.now(); enteredAt = 0;
    signOut(auth).catch(() => {});
    $("#app").hidden = true; $("#login").hidden = false;
    toast("අක්‍රීයතාවය නිසා ස්වයංක්‍රීයව පිටවිය", "warn");
  }
}, 30000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && auth.currentUser && !isAdminEmail(auth.currentUser.email)) {
    rejectIntruder("auth/not-admin");
  }
});

