/* ════════════════════════════════════════════════════════════════════════════
   හෙළ සිරිත · HELASIRITHA ADMIN  —  admin.js   [ES module]
   ADMIN REPOSITORY FILE  (admin-helasiritha.vercel.app)

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
  writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

/* ── configuration (public web config — safety comes from Auth + Rules) ───── */
const FB = {
  apiKey: "AIzaSyCC18zyof_ORDkKwxAMJK4G3Atu2AkWodM",
  authDomain: "helasiritha-official.firebaseapp.com",
  projectId: "helasiritha-official",
  storageBucket: "helasiritha-official.firebasestorage.app",
  messagingSenderId: "993883662089",
  appId: "1:993883662089:web:b583123218df07be9155d8",
  measurementId: "G-PBJWLXWVD9"
};
const ADMIN_EMAIL = "gaurawasachintha@gmail.com";
const CLOUD = { name: "dzrfpc9be", preset: "helasiritha_unsigned" };
const XLSX_CDN = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";

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
let gallery = [], guests = [], rsvps = [], blessings = [];
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
    "auth/unauthorized-domain": "මෙම වසමට Firebase Auth අවසර දී නොමැත.",
    "auth/operation-not-supported-in-this-environment": "මෙම බ්‍රවුසරයේ මෙය සහාය නොදක්වයි."
  })[code] || "පිවිසීම අසාර්ථකයි. නැවත උත්සාහ කරන්න.";
}
const isAdminEmail = (e) => !!e && String(e).trim().toLowerCase() === ADMIN_EMAIL;
const isCoarse = () => (typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(navigator.userAgent || ""))
  || (window.matchMedia && window.matchMedia("(pointer:coarse)").matches);

function provider() {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ login_hint: ADMIN_EMAIL, prompt: "select_account" });
  return p;
}
function loginError(msg) {
  const el = $("#loginErr"); if (!el) return;
  el.textContent = msg; el.classList.remove("show");
  void el.offsetWidth; el.classList.add("show");
}
/* Reject non-authorised accounts immediately, before any data is touched. */
async function rejectIntruder(reason) {
  try { await signOut(auth); } catch (_) {}
  $("#app").hidden = true; $("#login").hidden = false;
  loginError(authMsg(reason));
}
async function doGoogleLogin() {
  const b = $("#googleBtn"); const label = b.innerHTML;
  loginError(""); b.disabled = true; b.textContent = "පිවිසෙමින්…";
  try {
    if (isCoarse()) { await signInWithRedirect(auth, provider()); return; }
    const res = await signInWithPopup(auth, provider());
    if (!isAdminEmail(res.user && res.user.email)) { await rejectIntruder("auth/not-admin"); }
  } catch (e) {
    const code = e && e.code;
    if (["auth/popup-blocked", "auth/popup-closed-by-user", "auth/cancelled-popup-request",
         "auth/operation-not-supported-in-this-environment"].includes(code)) {
      try { await signInWithRedirect(auth, provider()); return; } catch (e2) { loginError(authMsg(e2 && e2.code)); }
    } else loginError(authMsg(code));
  }
  b.disabled = false; b.innerHTML = label;
}
/* Handle the mobile redirect hand-back */
getRedirectResult(auth).then((res) => {
  if (res && res.user && !isAdminEmail(res.user.email)) rejectIntruder("auth/not-admin");
}).catch((e) => { if (e && e.code) loginError(authMsg(e.code)); });

onAuthStateChanged(auth, (user) => {
  if (!user) { $("#app").hidden = true; $("#login").hidden = false; return; }
  if (!isAdminEmail(user.email)) { rejectIntruder("auth/not-admin"); return; }
  if (user.emailVerified === false) { rejectIntruder("auth/unverified"); return; }
  $("#login").hidden = true; $("#app").hidden = false;
  $("#whoEmail").textContent = user.email;
  if (!subsStarted) { subsStarted = true; startSubscriptions(); buildNav(); }
  go(current);
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
    gallery = a; refresh("gallery"); refresh("dashboard");
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
const saveContent = (patch) => setDoc(doc(db, "site", "content"), Object.assign({}, patch, { updatedAt: Date.now() }), { merge: true });
const saveAgenda  = (items) => setDoc(doc(db, "site", "agenda"), { items, updatedAt: Date.now() }, { merge: true });
const saveTheme   = (t)     => setDoc(doc(db, "site", "theme"), Object.assign({}, t, { updatedAt: Date.now() }), { merge: true });
const addGuest    = (o)     => addDoc(collection(db, "guests"), Object.assign({ ts: serverTimestamp() }, o));
const updGuest    = (id, o) => updateDoc(doc(db, "guests", id), o);
const delGuest    = (id)    => deleteDoc(doc(db, "guests", id));
const addGalleryItem = (o)  => addDoc(collection(db, "gallery"), Object.assign({ ts: serverTimestamp() }, o));
const updGallery  = (id, o) => updateDoc(doc(db, "gallery", id), o);
const delGallery  = (id)    => deleteDoc(doc(db, "gallery", id));
const updBlessing = (id, o) => updateDoc(doc(db, "blessings", id), o);
const delBlessing = (id)    => deleteDoc(doc(db, "blessings", id));
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
  table:"M3 5h18v14H3zM3 10h18M9 5v14"
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
  { group: "පෙනුම",    items: [
    { key: "visibility", label: "කොටස් පෙන්වීම",     icon: "eye" },
    { key: "theme",      label: "වර්ණ සැකසුම්",      icon: "paint" }
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
  theme:      ["වර්ණ සැකසුම්", "පොදු අඩවියේ වර්ණ තේමාව"]
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

/* ════════════════════════ 6 · GALLERY MANAGER ══════════════════════════════ */
renderers.gallery = function () {
  const n = gallery.length;
  const slot = n === 9 ? '<p class="slot-note ok">✓ Moments of Love සඳහා ඡායාරූප 9ම සම්පූර්ණයි.</p>'
    : n < 9 ? '<p class="slot-note warn">තව ' + (9 - n) + 'ක් එක් කළොත් Moments of Love සම්පූර්ණ වේ (දැන් ' + n + '/9).</p>'
    : '<p class="slot-note warn">ඡායාරූප ' + n + 'ක් ඇත — පළමු 9 Moments of Love ලෙස දිස් වේ.</p>';

  $("#p-gallery").innerHTML =
    card('<h3>ඡායාරූප එක් කරන්න</h3><p class="hint">ගොනු මෙතැනට ඇද දමන්න (drag & drop) හෝ click කරන්න · කිහිපයක් එකවර</p>' +
      '<label class="drop" id="galDrop"><b>ඡායාරූප තෝරන්න හෝ මෙතැනට ඇද දමන්න</b>' +
      '<i>JPG / PNG / WEBP · ස්වයංක්‍රීයව optimise වී Cloudinary වෙත යයි</i>' +
      '<input type="file" id="galFile" accept="image/*" multiple hidden></label>' +
      '<div class="prog" id="galProg" hidden><i></i></div>' + slot) +
    card('<div class="card-head"><h3>එකතුව (' + n + ')</h3><span class="faint" style="font-size:.8rem">අනුපිළිවෙළ වෙනස් කිරීමට ඡායාරූප ඇද දමන්න</span></div>' +
      (n ? '<div class="gal" id="galGrid">' + gallery.map((g, i) =>
        '<div class="gcell" draggable="true" data-id="' + esc(g.id) + '" data-i="' + i + '">' +
          '<span class="gnum">' + (i + 1) + '</span>' +
          '<button class="btn xs bad del" data-del="' + esc(g.id) + '" type="button">✕</button>' +
          '<img src="' + esc(thumb(g.url)) + '" alt="' + esc(g.caption || "") + '" loading="lazy" decoding="async">' +
          '<div class="gbar"><input class="mini cap" data-cap="' + esc(g.id) + '" value="' + esc(g.caption || "") + '" placeholder="සිරැසිය"></div>' +
        '</div>').join("") + '</div>'
        : '<div class="empty">තවම ඡායාරූප නැත.</div>'));

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

  $$("[data-del]", $("#p-gallery")).forEach(b => b.onclick = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!await confimDel()) return;
    try { await delGallery(b.dataset.del); toast("මකා දැමිණි", "ok"); } catch (_) { toast("දෝෂයකි", "err"); }
  });
  function confimDel() { return confirmBox("මෙම ඡායාරූපය එකතුවෙන් මකන්නද?"); }
  $$("[data-cap]", $("#p-gallery")).forEach(inp => {
    inp.onclick = (e) => e.stopPropagation();
    inp.onchange = () => updGallery(inp.dataset.cap, { caption: inp.value.trim() }).then(() => toast("සිරැසිය සුරැකිණි", "ok")).catch(() => toast("දෝෂයකි", "err"));
  });

  /* drag-to-reorder → writes `order`, which the public site sorts by */
  let dragId = null;
  $$(".gcell", $("#p-gallery")).forEach(cell => {
    cell.addEventListener("dragstart", (e) => { dragId = cell.dataset.id; cell.classList.add("drag"); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; });
    cell.addEventListener("dragend", () => { dragId = null; cell.classList.remove("drag"); $$(".gcell").forEach(c => c.classList.remove("dragover")); });
    cell.addEventListener("dragover", (e) => { e.preventDefault(); if (dragId && dragId !== cell.dataset.id) cell.classList.add("dragover"); });
    cell.addEventListener("dragleave", () => cell.classList.remove("dragover"));
    cell.addEventListener("drop", async (e) => {
      e.preventDefault(); cell.classList.remove("dragover");
      if (!dragId || dragId === cell.dataset.id) return;
      const from = gallery.findIndex(g => g.id === dragId);
      const to = gallery.findIndex(g => g.id === cell.dataset.id);
      if (from < 0 || to < 0) return;
      const arr = gallery.slice(); const [m] = arr.splice(from, 1); arr.splice(to, 0, m);
      try {
        const batch = writeBatch(db);
        arr.forEach((g, i) => batch.update(doc(db, "gallery", g.id), { order: i }));
        await batch.commit();
        toast("අනුපිළිවෙළ යාවත්කාලීන විය ✓", "ok");
      } catch (_) { toast("අනුපිළිවෙළ සුරැකීම අසාර්ථකයි", "err"); }
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
let extraTables = [];
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
$("#googleBtn").addEventListener("click", doGoogleLogin);
$("#logoutBtn").addEventListener("click", async () => { await signOut(auth).catch(() => {}); toast("පිටවිය.", "ok"); });
$("#menuBtn").addEventListener("click", openDrawer);
$("#scrim").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
window.addEventListener("online",  () => syncState(true));
window.addEventListener("offline", () => syncState(false));
