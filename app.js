/* ════════════════════════════════════════════════════════════════════════
   හෙළ සිරිත · Helasiritha — ADMIN application  (admin/app.js)  [ES module]
   Modern control centre · real-time Firestore sync with the public site.
   ACCESS STRICTLY RESTRICTED to gaurawasachintha@gmail.com (client + rules).
   Images via Cloudinary UNSIGNED upload — no Google Drive, no secrets.
   ════════════════════════════════════════════════════════════════════════ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail }
  from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot, collection, addDoc, deleteDoc, updateDoc, serverTimestamp, query, orderBy }
  from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

/* Firebase web config — IDENTICAL byte-for-byte to the public site's config */
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

const app = initializeApp(FB);
const auth = getAuth(app);
const db = getFirestore(app);

/* ── helpers ─────────────────────────────────────────────────────────────── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (x) => String(x == null ? "" : x).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function toast(msg, kind) { const t = $("#toast"); t.textContent = msg; t.className = "toast show " + (kind || ""); clearTimeout(t._t); t._t = setTimeout(() => t.className = "toast", 2600); }

/* Built-in defaults mirror the public site (so editor shows real current text) */
const CONTENT_DEFAULT = {
  brideName: "කෞශානි", groomName: "ගෞරව", brideNameEn: "Kaushani", groomNameEn: "Gaurawa",
  bridePreLine: "මහත්මා සහ එම මැතිනියගේ ආදරණීය දියණිය වූ,",
  groomPreLine: "මහත්මා සහ එම මැතිනියගේ ආදරණීය පුත් වූ,",
  dateISO: "2028-01-12T09:28:00+05:30",
  venue: "The Epitome Hotel", venueCity: "කුරුණෑගල",
  venueMapUrl: "https://www.google.com/maps/search/?api=1&query=The+Epitome+Hotel+Kurunegala",
  ceremonyTime: "පෙ.ව. 09.00 සිට සවස 04.00 දක්වා", poruwaTime: "පෙ.ව. 09.28",
  heroImageUrl: "",
  loveNote: "ආදරයෙන් හා කෘතඥතාවයෙන් පිරුණු හදවත් සමඟ, අපගේ ජීවිතයේ මෙම සුන්දර පරිච්ඡේදය ඔබ සමඟ සැමරීමට ලැබීම ගැන අපි ඉතා සතුටු වෙමු.",
  loveSign: "කෞශානි & ගෞරව",
  phone: "", whatsapp: "", ambientAudioUrl: "", rsvpOpen: true,
  show: { countdown: true, agenda: true, gallery: true, lovenote: true, lamp: true, blessings: true, rsvp: true }
};
const AGENDA_DEFAULT = [
  { icon: "sesath", titleSi: "ආගන්තුක පිළිගැනීම", timeLabel: "පෙ.ව. 09.00", descSi: "මඟුල් බෙර හඬ මැද, සේසත් සෙවණේ ආරාධිතයන් සාදරයෙන් පිළිගැනීම." },
  { icon: "poruwa", titleSi: "පෝරුවට වැඩම වීම", timeLabel: "පෙ.ව. 09.28", descSi: "ජයමංගල ගාථා මධ්‍යයේ මනාල යුවළ පෝරුවට වැඩම කරවීම." },
  { icon: "ring", titleSi: "පෝරු චාරිත්‍ර", timeLabel: "", descSi: "බුලත් හුවමාරුව, මුදු පැළඳවීම හා පිරිත් නූල් බැඳීම." },
  { icon: "lamp", titleSi: "මඟුල් පහන දැල්වීම", timeLabel: "", descSi: "උභය පාර්ශවයේ ආශීර්වාදය මැද මඟුල් පහන දැල්වීම." },
  { icon: "feast", titleSi: "භෝජන සංග්‍රහය", timeLabel: "", descSi: "රසවත් භෝජන සංග්‍රහයකින් ආරාධිතයන් සංග්‍රහ කිරීම." },
  { icon: "mayura", titleSi: "සැමරුම් හා නර්තන", timeLabel: "සවස 04.00 දක්වා", descSi: "උඩරට නර්තන හා සැමරුම් අවස්ථාව." }
];
const ICON_OPTIONS = ["sesath", "poruwa", "ring", "lamp", "feast", "mayura"];

/* ── live state ──────────────────────────────────────────────────────────── */
let content = Object.assign({}, CONTENT_DEFAULT);
let agenda = AGENDA_DEFAULT.slice();
let gallery = [], guests = [], rsvps = [], blessings = [];
let current = "dashboard";
const renderers = {};

/* ── Cloudinary unsigned upload (downscaled client-side) ─────────────────── */
function downscale(file, max = 1600) {
  return new Promise((res) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width: w, height: h } = img;
      if (Math.max(w, h) > max) { const r = max / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r); }
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob(b => res(b || file), "image/jpeg", 0.88);
    };
    img.onerror = () => res(file);
    img.src = url;
  });
}
async function uploadImage(file) {
  const blob = await downscale(file);
  const fd = new FormData();
  fd.append("file", blob); fd.append("upload_preset", CLOUD.preset);
  const r = await fetch("https://api.cloudinary.com/v1_1/" + CLOUD.name + "/image/upload", { method: "POST", body: fd });
  const j = await r.json();
  if (!j.secure_url) throw new Error((j.error && j.error.message) || "උඩුගත කිරීම අසාර්ථකයි");
  return j.secure_url;
}

/* ── Firestore writes ────────────────────────────────────────────────────── */
const saveContent = (patch) => setDoc(doc(db, "site", "content"), patch, { merge: true });
const saveAgenda = (items) => setDoc(doc(db, "site", "agenda"), { items }, { merge: true });
const addGalleryItem = (o) => addDoc(collection(db, "gallery"), Object.assign({ ts: serverTimestamp() }, o));
const delDoc = (col, id) => deleteDoc(doc(db, col, id));
const updDoc = (col, id, o) => updateDoc(doc(db, col, id), o);
const addGuest = (o) => addDoc(collection(db, "guests"), o);

/* ── AUTH (strict email gate) ────────────────────────────────────────────── */
function authMsg(code) {
  return ({
    "auth/invalid-email": "විද්‍යුත් තැපැල් ලිපිනය වලංගු නැත.",
    "auth/missing-password": "මුරපදය ඇතුළත් කරන්න.",
    "auth/invalid-credential": "විද්‍යුත් තැපෑල හෝ මුරපදය වැරදියි.",
    "auth/wrong-password": "මුරපදය වැරදියි.",
    "auth/user-not-found": "මෙම ගිණුම හමු නොවීය.",
    "auth/too-many-requests": "උත්සාහයන් වැඩියි. මඳ වේලාවකින් නැවත උත්සාහ කරන්න.",
    "auth/network-request-failed": "ජාල සම්බන්ධතාවය පරීක්ෂා කරන්න."
  })[code] || "පිවිසීම අසාර්ථකයි. නැවත උත්සාහ කරන්න.";
}
async function doLogin() {
  const email = $("#email").value.trim(), pass = $("#pass").value;
  const err = $("#loginErr"); err.textContent = "";
  if (email.toLowerCase() !== ADMIN_EMAIL) { err.textContent = "ඔබට මෙම පද්ධතියට පිවිසීමට අවසර නැත."; return; }
  const b = $("#loginBtn"); b.disabled = true; b.textContent = "පිවිසෙමින්…";
  try { await signInWithEmailAndPassword(auth, email, pass); }
  catch (e) { err.textContent = authMsg(e.code); }
  b.disabled = false; b.textContent = "පිවිසෙන්න";
}
async function doReset() {
  const email = $("#email").value.trim(); const err = $("#loginErr");
  if (email.toLowerCase() !== ADMIN_EMAIL) { err.textContent = "අවසර ලත් විද්‍යුත් තැපෑල ඇතුළත් කරන්න."; return; }
  try { await sendPasswordResetEmail(auth, email); err.style.color = "var(--ok)"; err.textContent = "නැවත සැකසීමේ සබැඳිය ඔබගේ විද්‍යුත් තැපෑලට යවන ලදී."; }
  catch (e) { err.style.color = "var(--no)"; err.textContent = authMsg(e.code); }
}

let subsStarted = false;
onAuthStateChanged(auth, (user) => {
  if (user && user.email && user.email.toLowerCase() === ADMIN_EMAIL) {
    $("#login").classList.add("hidden");
    $("#app").classList.remove("hidden");
    $("#whoEmail").textContent = user.email;
    if (!subsStarted) { subsStarted = true; startSubscriptions(); }
  } else if (user) {
    // Signed in but NOT the authorised account → reject immediately
    signOut(auth);
    $("#login").classList.remove("hidden");
    $("#app").classList.add("hidden");
    $("#loginErr").textContent = "ඔබට මෙම පද්ධතියට පිවිසීමට අවසර නැත.";
  } else {
    $("#login").classList.remove("hidden");
    $("#app").classList.add("hidden");
  }
});

/* ── live subscriptions → keep panels fresh ──────────────────────────────── */
function startSubscriptions() {
  onSnapshot(doc(db, "site", "content"), s => { content = Object.assign({}, CONTENT_DEFAULT, s.exists() ? s.data() : {}); content.show = Object.assign({}, CONTENT_DEFAULT.show, content.show || {}); refresh("details"); refresh("couple"); refresh("dashboard"); });
  onSnapshot(doc(db, "site", "agenda"), s => { agenda = (s.exists() && Array.isArray(s.data().items) && s.data().items.length) ? s.data().items : AGENDA_DEFAULT.slice(); refresh("agenda"); });
  onSnapshot(query(collection(db, "gallery"), orderBy("order", "asc")), qs => { gallery = qs.docs.map(d => Object.assign({ id: d.id }, d.data())); refresh("gallery"); refresh("dashboard"); });
  onSnapshot(collection(db, "guests"), qs => { guests = qs.docs.map(d => Object.assign({ id: d.id }, d.data())); refresh("guests"); refresh("rsvp"); refresh("dashboard"); });
  onSnapshot(collection(db, "rsvps"), qs => {
    rsvps = qs.docs.map(d => Object.assign({ id: d.id }, d.data()));
    const headcount = rsvps.filter(r => r.attending).reduce((n, r) => n + (r.party || 1), 0);
    setDoc(doc(db, "site", "stats"), { confirmedCount: headcount }, { merge: true }).catch(() => {});
    refresh("rsvp"); refresh("dashboard");
  });
  onSnapshot(query(collection(db, "blessings"), orderBy("ts", "desc")), qs => { blessings = qs.docs.map(d => Object.assign({ id: d.id }, d.data())); refresh("blessings"); refresh("dashboard"); updateBlBadge(); });
}
function refresh(panel) { if (current === panel && renderers[panel]) renderers[panel](); }
function updateBlBadge() {
  const pend = blessings.filter(b => !b.approved).length;
  const b = $("#blBadge"); b.textContent = pend; b.classList.toggle("hidden", pend === 0);
}

/* ── navigation ──────────────────────────────────────────────────────────── */
const TITLES = {
  dashboard: ["දළ විශ්ලේෂණය", "පද්ධතියේ වත්මන් තත්ත්වය"],
  details: ["මංගල තොරතුරු", "පොදු පිටුවේ අන්තර්ගතය සංස්කරණය කරන්න"],
  couple: ["මනාල යුවළ පින්තූරය", "මුල් පිටුවේ පින්තූරය customize කරන්න"],
  guests: ["ආගන්තුක නාම ලේඛනය", "RSVP සෙවීම සඳහා ආගන්තුකයන් එක් කරන්න"],
  rsvp: ["පැමිණීම් පිළිතුරු", "ලැබුණු සියලු පිළිතුරු"],
  agenda: ["වැඩසටහන", "මංගල සභාවේ සැලැස්ම"],
  gallery: ["ඡායාරූප එකතුව", "ගැලරියේ ඡායාරූප කළමනාකරණය"],
  blessings: ["සුබ පැතුම්", "ලැබුණු සුබ පැතුම් අනුමත කරන්න"]
};
function go(panel) {
  current = panel;
  $$(".navlink[data-go]").forEach(b => b.classList.toggle("active", b.dataset.go === panel));
  $$(".panel").forEach(p => p.classList.toggle("active", p.dataset.panel === panel));
  $("#pageTitle").textContent = TITLES[panel][0];
  $("#pageSub").textContent = TITLES[panel][1];
  if (renderers[panel]) renderers[panel]();
  closeDrawer();
}
function openDrawer() { $("#side").classList.add("open"); $("#scrim").classList.add("show"); }
function closeDrawer() { $("#side").classList.remove("open"); $("#scrim").classList.remove("show"); }

/* ── boot wiring ─────────────────────────────────────────────────────────── */
$("#loginBtn").addEventListener("click", doLogin);
$("#resetBtn").addEventListener("click", doReset);
$("#pass").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
$("#email").addEventListener("keydown", e => { if (e.key === "Enter") $("#pass").focus(); });
$("#logoutBtn").addEventListener("click", () => signOut(auth));
$("#menuBtn").addEventListener("click", openDrawer);
$("#scrim").addEventListener("click", closeDrawer);
$$(".navlink[data-go]").forEach(b => b.addEventListener("click", () => go(b.dataset.go)));

/* ════════════════════════════════════════════════════════════════════════
   PANEL RENDERERS
   ════════════════════════════════════════════════════════════════════════ */
function fld(label, id, val, type) {
  type = type || "text";
  if (type === "textarea") return '<div class="field"><label for="' + id + '">' + label + '</label><textarea class="inp" id="' + id + '">' + esc(val) + '</textarea></div>';
  return '<div class="field"><label for="' + id + '">' + label + '</label><input class="inp" id="' + id + '" type="' + type + '" value="' + esc(val) + '"></div>';
}
function toLocalInput(iso) { const m = String(iso || "").match(/(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/); return m ? m[1] + "T" + m[2] : ""; }
function fromLocalInput(v) { return v ? v + ":00+05:30" : CONTENT_DEFAULT.dateISO; }

/* ── DASHBOARD ── */
renderers.dashboard = function () {
  const attending = rsvps.filter(r => r.attending);
  const headcount = attending.reduce((n, r) => n + (r.party || 1), 0);
  const liquor = attending.filter(r => r.liquor).length;
  const notComing = rsvps.filter(r => r.attending === false).length;
  const pending = blessings.filter(b => !b.approved).length;
  $("#p-dashboard").innerHTML =
    '<div class="stats">' +
      stat(headcount, "තහවුරු වූ පැමිණෙන්නන්") +
      stat(attending.length, "පැමිණෙන පවුල්/පිළිතුරු") +
      stat(notComing, "නොපැමිණෙන") +
      stat(rsvps.length, "මුළු පිළිතුරු") +
      stat(guests.length, "ආගන්තුක නාම") +
      stat(liquor, "මත්පැන් අවශ්‍ය") +
      stat(gallery.length, "ඡායාරූප") +
      stat(pending, "අනුමැතියට සුබ පැතුම්") +
    '</div>' +
    '<div class="card"><h3>ඉක්මන් සබැඳි</h3><div class="ch-sub">පොදු පිටුව: <a href="https://helasiritha.vercel.app" target="_blank" rel="noopener">helasiritha.vercel.app</a></div>' +
      '<div class="row">' +
        '<button class="btn sm" data-jump="details">මංගල තොරතුරු</button>' +
        '<button class="btn sm" data-jump="couple">මනාල පින්තූරය</button>' +
        '<button class="btn sm" data-jump="guests">ආගන්තුකයන්</button>' +
        '<button class="btn sm" data-jump="rsvp">පිළිතුරු</button>' +
      '</div></div>';
  $$("[data-jump]", $("#p-dashboard")).forEach(b => b.onclick = () => go(b.dataset.jump));
  function stat(v, l) { return '<div class="stat"><div class="v num">' + v + '</div><div class="l">' + l + '</div></div>'; }
};

/* ── WEDDING DETAILS ── */
renderers.details = function () {
  const c = content;
  $("#p-details").innerHTML =
    '<div class="card"><h3>මනාල යුවළ <span style="color:var(--mut);font-weight:400">(මනාලිය මුලින්)</span></h3>' +
      '<div class="grid2">' + fld("මනාලියගේ නම (සිංහල)", "f_brideName", c.brideName) + fld("මනාලයාගේ නම (සිංහල)", "f_groomName", c.groomName) + '</div>' +
      '<div class="grid2">' + fld("මනාලියගේ නම (English)", "f_brideNameEn", c.brideNameEn) + fld("මනාලයාගේ නම (English)", "f_groomNameEn", c.groomNameEn) + '</div>' +
      fld("මනාලිය — හඳුන්වාදීම (උදා: ගම, නිවස, දෙමාපියන්)", "f_bridePreLine", c.bridePreLine, "textarea") +
      fld("මනාලයා — හඳුන්වාදීම", "f_groomPreLine", c.groomPreLine, "textarea") +
    '</div>' +
    '<div class="card"><h3>දිනය හා ස්ථානය</h3>' +
      '<div class="grid2">' + fld("මංගල දිනය හා වේලාව", "f_date", toLocalInput(c.dateISO), "datetime-local") + fld("පෝරු වේලාව", "f_poruwaTime", c.poruwaTime) + '</div>' +
      '<div class="grid2">' + fld("උත්සව වේලාව", "f_ceremonyTime", c.ceremonyTime) + fld("ස්ථානයේ නම", "f_venue", c.venue) + '</div>' +
      '<div class="grid2">' + fld("නගරය", "f_venueCity", c.venueCity) + fld("Google Maps සබැඳිය", "f_venueMapUrl", c.venueMapUrl) + '</div>' +
    '</div>' +
    '<div class="card"><h3>විශේෂ සටහන හා සම්බන්ධතා</h3>' +
      fld("ආදරණීය සටහන (Love Note)", "f_loveNote", c.loveNote, "textarea") +
      '<div class="grid2">' + fld("අත්සන (මනාලිය මුලින්)", "f_loveSign", c.loveSign) + fld("දුරකථන අංකය", "f_phone", c.phone) + '</div>' +
      '<div class="grid2">' + fld("WhatsApp අංකය (94...)", "f_whatsapp", c.whatsapp) + fld("මංගල සංගීත URL (mp3, විකල්ප)", "f_ambientAudioUrl", c.ambientAudioUrl) + '</div>' +
      '<div class="row" style="margin-top:.6rem"><button class="btn" id="saveDetails">සියල්ල සුරකින්න</button><span class="saved" id="savedDetails">✓ සුරැකිණි</span></div>' +
    '</div>' +
    '<div class="card"><h3>දෘශ්‍යතාව හා පැමිණීම</h3><div class="ch-sub">පොදු පිටුවේ දිස්වන කොටස් පාලනය කරන්න (සජීවීව සුරැකේ)</div>' +
      toggle("RSVP / පැමිණීම් දැනුම්දීම විවෘතද?", "t_rsvpOpen", c.rsvpOpen) +
      toggle("ගණන් කිරීම (Countdown)", "t_show_countdown", c.show.countdown) +
      toggle("වැඩසටහන", "t_show_agenda", c.show.agenda) +
      toggle("ඡායාරූප එකතුව", "t_show_gallery", c.show.gallery) +
      toggle("ආදරණීය සටහන", "t_show_lovenote", c.show.lovenote) +
      toggle("මංගල පහන", "t_show_lamp", c.show.lamp) +
      toggle("සුබ පැතුම් පොත", "t_show_blessings", c.show.blessings) +
      toggle("RSVP කොටස", "t_show_rsvp", c.show.rsvp) +
    '</div>';
  $("#saveDetails").onclick = async () => {
    const v = id => $("#" + id).value.trim();
    const patch = {
      brideName: v("f_brideName"), groomName: v("f_groomName"), brideNameEn: v("f_brideNameEn"), groomNameEn: v("f_groomNameEn"),
      bridePreLine: v("f_bridePreLine"), groomPreLine: v("f_groomPreLine"),
      dateISO: fromLocalInput($("#f_date").value), poruwaTime: v("f_poruwaTime"), ceremonyTime: v("f_ceremonyTime"),
      venue: v("f_venue"), venueCity: v("f_venueCity"), venueMapUrl: v("f_venueMapUrl"),
      loveNote: v("f_loveNote"), loveSign: v("f_loveSign") || (v("f_brideName") + " & " + v("f_groomName")),
      phone: v("f_phone"), whatsapp: v("f_whatsapp"), ambientAudioUrl: v("f_ambientAudioUrl")
    };
    try { await saveContent(patch); $("#savedDetails").classList.add("show"); setTimeout(() => $("#savedDetails").classList.remove("show"), 1800); toast("මංගල තොරතුරු සුරැකිණි", "ok"); }
    catch (e) { toast("සුරැකීම අසාර්ථකයි", "err"); }
  };
  wireToggles();
};
function toggle(label, id, on) { return '<div class="toggle"><span>' + label + '</span><button class="sw' + (on ? " on" : "") + '" id="' + id + '" role="switch" aria-checked="' + !!on + '"></button></div>'; }
function wireToggles() {
  $$(".sw", $("#p-details")).forEach(sw => sw.onclick = async () => {
    const on = !sw.classList.contains("on"); sw.classList.toggle("on", on); sw.setAttribute("aria-checked", on);
    try {
      if (sw.id === "t_rsvpOpen") await saveContent({ rsvpOpen: on });
      else { const key = sw.id.replace("t_show_", ""); await saveContent({ ["show." + key]: on }); }
      toast("යාවත්කාලීන විය", "ok");
    } catch (e) { sw.classList.toggle("on", !on); toast("දෝෂයකි", "err"); }
  });
}

/* ── COUPLE IMAGE (the IMG_9231 ↔ custom swap) ── */
renderers.couple = function () {
  const url = content.heroImageUrl;
  $("#p-couple").innerHTML =
    '<div class="card"><h3>මුල් පිටුවේ මනාල යුවළ පින්තූරය</h3>' +
      '<div class="ch-sub">පෙරනිමියෙන් උඩරට සම්ප්‍රදායික මනාල යුවළ චිත්‍රය (IMG&nbsp;9231) දිස් වේ. ඔබට අවශ්‍ය ඕනෑම පින්තූරයක් උඩුගත කර එය මෙතැනට customize කළ හැක.</div>' +
      '<img class="preview" id="couplePreview" src="' + (url ? esc(url) : "assets/couple.jpg") + '" alt="මනාල යුවළ" onerror="this.style.display=\'none\'">' +
      (url ? '' : '<p class="ch-sub" style="text-align:center;margin-top:.6rem">දැනට පෙරනිමි සම්ප්‍රදායික චිත්‍රය භාවිතා වේ.</p>') +
      '<label class="uploader" id="coupleDrop" style="display:block;margin-top:1rem">නව පින්තූරයක් තේරීමට මෙතැන click කරන්න<br><span style="font-size:.82rem">(JPG / PNG · ස්වයංක්‍රීයව optimize වේ)</span>' +
        '<input type="file" id="coupleFile" accept="image/*" hidden></label>' +
      '<div class="row" style="margin-top:1rem">' +
        (url ? '<button class="btn ghost" id="coupleDefault">පෙරනිමි සම්ප්‍රදායික චිත්‍රයට හරවන්න</button>' : '') +
      '</div>' +
    '</div>';
  $("#coupleFile").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    toast("උඩුගත කරමින්…");
    try { const u = await uploadImage(f); await saveContent({ heroImageUrl: u }); toast("මනාල පින්තූරය යාවත්කාලීන විය", "ok"); }
    catch (err) { toast(err.message || "උඩුගත කිරීම අසාර්ථකයි", "err"); }
  };
  if ($("#coupleDefault")) $("#coupleDefault").onclick = async () => { try { await saveContent({ heroImageUrl: "" }); toast("පෙරනිමි චිත්‍රයට හරවන ලදී", "ok"); } catch (e) { toast("දෝෂයකි", "err"); } };
};

/* ── GUESTS ── */
let guestSideFilter = "all";
renderers.guests = function () {
  const byBride = guests.filter(g => g.side === "bride").length, byGroom = guests.filter(g => g.side === "groom").length;
  const shown = guests.filter(g => guestSideFilter === "all" || g.side === guestSideFilter);
  $("#p-guests").innerHTML =
    '<div class="card"><h3>ආගන්තුකයෙකු එක් කරන්න</h3>' +
      '<div class="grid2">' + fld("නම", "g_name", "") +
        '<div class="field"><label for="g_side">පාර්ශවය</label><select class="inp" id="g_side"><option value="bride">කෞශානිගේ පාර්ශවය</option><option value="groom">ගෞරවගේ පාර්ශවය</option></select></div>' +
      '</div>' +
      '<div class="grid2">' + fld("පවුලේ නාමය (විකල්ප)", "g_family", "") + fld("සාමාජික සංඛ්‍යාව", "g_count", "1", "number") + '</div>' +
      '<button class="btn" id="addGuestBtn">ආගන්තුකයා එක් කරන්න</button>' +
    '</div>' +
    '<div class="filterbar">' +
      chip("සියල්ල (" + guests.length + ")", "all") +
      chip("කෞශානිගේ (" + byBride + ")", "bride") +
      chip("ගෞරවගේ (" + byGroom + ")", "groom") +
    '</div>' +
    '<div class="list">' + (shown.length ? shown.map(g =>
      '<div class="item"><div class="meta"><div class="t">' + esc(g.name) + ' <span class="pill ' + (g.side === "bride" ? "yes" : "no") + '">' + (g.side === "bride" ? "කෞශානි" : "ගෞරව") + '</span></div>' +
      '<div class="d">' + (g.family ? esc(g.family) + " · " : "") + "සාමාජිකයන් " + (g.count || 1) + '</div></div>' +
      '<div class="acts"><button class="btn danger sm" data-del="' + esc(g.id) + '">මකන්න</button></div></div>'
    ).join("") : '<div class="empty">තවම ආගන්තුකයන් එක් කර නැත</div>') + '</div>';
  function chip(t, v) { return '<button class="chip' + (guestSideFilter === v ? " active" : "") + '" data-f="' + v + '">' + t + '</button>'; }
  $("#addGuestBtn").onclick = async () => {
    const name = $("#g_name").value.trim(); if (!name) { toast("නම ඇතුළත් කරන්න", "err"); return; }
    try { await addGuest({ name, side: $("#g_side").value, family: $("#g_family").value.trim(), count: Math.max(1, +$("#g_count").value || 1) }); toast("ආගන්තුකයා එක් විය", "ok"); }
    catch (e) { toast("එක් කිරීම අසාර්ථකයි", "err"); }
  };
  $$("[data-f]", $("#p-guests")).forEach(c => c.onclick = () => { guestSideFilter = c.dataset.f; renderers.guests(); });
  $$("[data-del]", $("#p-guests")).forEach(b => b.onclick = async () => { if (!confirm("මෙම ආගන්තුකයා මකන්නද?")) return; try { await delDoc("guests", b.dataset.del); toast("මකන ලදී", "ok"); } catch (e) { toast("දෝෂයකි", "err"); } });
};

/* ── RSVP RESPONSES ── */
let rsvpFilter = "all";
renderers.rsvp = function () {
  const shown = rsvps.filter(r => rsvpFilter === "all" || (rsvpFilter === "yes" && r.attending) || (rsvpFilter === "no" && r.attending === false));
  const yes = rsvps.filter(r => r.attending).length, no = rsvps.filter(r => r.attending === false).length;
  $("#p-rsvp").innerHTML =
    '<div class="filterbar">' +
      chip("සියල්ල (" + rsvps.length + ")", "all") + chip("පැමිණේ (" + yes + ")", "yes") + chip("නොපැමිණේ (" + no + ")", "no") +
      '<button class="btn sm ghost" id="csvBtn" style="margin-left:auto">CSV බාගන්න</button>' +
    '</div>' +
    '<div class="list">' + (shown.length ? shown.map(r =>
      '<div class="item"><div class="meta"><div class="t">' + esc(r.name) + ' ' +
        (r.attending ? '<span class="pill yes">පැමිණේ</span>' : '<span class="pill no">නොපැමිණේ</span>') +
        (r.attending && r.liquor ? ' <span class="pill pend">මත්පැන්</span>' : '') + '</div>' +
        '<div class="d">' + (r.family ? esc(r.family) + " · " : "") + (r.attending ? "සංඛ්‍යාව " + (r.party || 1) : "") + (r.dietary ? " · " + esc(r.dietary) : "") + '</div></div>' +
        '<div class="acts"><button class="btn danger sm" data-del="' + esc(r.id) + '">මකන්න</button></div></div>'
    ).join("") : '<div class="empty">තවම පිළිතුරු නැත</div>') + '</div>';
  function chip(t, v) { return '<button class="chip' + (rsvpFilter === v ? " active" : "") + '" data-f="' + v + '">' + t + '</button>'; }
  $$("[data-f]", $("#p-rsvp")).forEach(c => c.onclick = () => { rsvpFilter = c.dataset.f; renderers.rsvp(); });
  $$("[data-del]", $("#p-rsvp")).forEach(b => b.onclick = async () => { if (!confirm("මෙම පිළිතුර මකන්නද?")) return; try { await delDoc("rsvps", b.dataset.del); toast("මකන ලදී", "ok"); } catch (e) { toast("දෝෂයකි", "err"); } });
  $("#csvBtn").onclick = exportCsv;
};
function exportCsv() {
  const rows = [["නම", "පාර්ශවය/පවුල", "පැමිණේ", "මත්පැන්", "සංඛ්‍යාව", "ආහාර"]].concat(
    rsvps.map(r => [r.name || "", r.family || "", r.attending ? "ඔව්" : "නැහැ", r.liquor ? "ඔව්" : "නැහැ", r.party || 0, r.dietary || ""]));
  const csv = "\uFEFF" + rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = "helasiritha-rsvp.csv"; a.click();
}

/* ── AGENDA ── */
renderers.agenda = function () {
  $("#p-agenda").innerHTML =
    '<div class="card"><h3>මංගල සභාවේ සැලැස්ම</h3><div class="ch-sub">අංග සංස්කරණය, එක් කිරීම හෝ ඉවත් කිරීම</div>' +
      '<div class="list" id="agList"></div>' +
      '<div class="row" style="margin-top:1rem"><button class="btn ghost" id="addAg">+ නව අංගයක්</button><button class="btn" id="saveAg">සැලැස්ම සුරකින්න</button><span class="saved" id="savedAg">✓ සුරැකිණි</span></div>' +
    '</div>';
  drawAgenda();
  $("#addAg").onclick = () => { agenda.push({ icon: "lamp", titleSi: "", timeLabel: "", descSi: "" }); drawAgenda(); };
  $("#saveAg").onclick = async () => {
    readAgenda();
    try { await saveAgenda(agenda); $("#savedAg").classList.add("show"); setTimeout(() => $("#savedAg").classList.remove("show"), 1800); toast("සැලැස්ම සුරැකිණි", "ok"); }
    catch (e) { toast("සුරැකීම අසාර්ථකයි", "err"); }
  };
};
function drawAgenda() {
  $("#agList").innerHTML = agenda.map((it, i) =>
    '<div class="item" style="align-items:flex-start;flex-direction:column;gap:.6rem">' +
      '<div class="row" style="width:100%">' +
        '<select class="inp" data-ag="icon" data-i="' + i + '" style="max-width:130px">' + ICON_OPTIONS.map(o => '<option value="' + o + '"' + (it.icon === o ? " selected" : "") + '>' + o + '</option>').join("") + '</select>' +
        '<input class="inp" data-ag="titleSi" data-i="' + i + '" value="' + esc(it.titleSi) + '" placeholder="මාතෘකාව" style="flex:1;min-width:140px">' +
        '<input class="inp" data-ag="timeLabel" data-i="' + i + '" value="' + esc(it.timeLabel) + '" placeholder="වේලාව" style="max-width:130px">' +
      '</div>' +
      '<textarea class="inp" data-ag="descSi" data-i="' + i + '" placeholder="විස්තරය" style="width:100%">' + esc(it.descSi) + '</textarea>' +
      '<div class="row" style="width:100%;justify-content:flex-end">' +
        '<button class="btn sm ghost" data-mv="up" data-i="' + i + '">↑</button>' +
        '<button class="btn sm ghost" data-mv="down" data-i="' + i + '">↓</button>' +
        '<button class="btn sm danger" data-rm="' + i + '">මකන්න</button>' +
      '</div></div>'
  ).join("");
  $$("[data-rm]", $("#agList")).forEach(b => b.onclick = () => { readAgenda(); agenda.splice(+b.dataset.rm, 1); drawAgenda(); });
  $$("[data-mv]", $("#agList")).forEach(b => b.onclick = () => { readAgenda(); const i = +b.dataset.i, j = b.dataset.mv === "up" ? i - 1 : i + 1; if (j < 0 || j >= agenda.length) return; [agenda[i], agenda[j]] = [agenda[j], agenda[i]]; drawAgenda(); });
}
function readAgenda() {
  $$("[data-ag]", $("#agList")).forEach(el => { agenda[+el.dataset.i][el.dataset.ag] = el.value; });
}

/* ── GALLERY ── */
renderers.gallery = function () {
  $("#p-gallery").innerHTML =
    '<div class="card"><h3>ඡායාරූපයක් එක් කරන්න</h3>' +
      '<label class="uploader" style="display:block">ඡායාරූප තේරීමට click කරන්න (කිහිපයක් තේරිය හැක)<input type="file" id="galFile" accept="image/*" multiple hidden></label>' +
    '</div>' +
    '<div class="list" id="galList"></div>';
  drawGallery();
  $("#galFile").onchange = async (e) => {
    const files = Array.from(e.target.files); if (!files.length) return;
    toast("ඡායාරූප " + files.length + "ක් උඩුගත කරමින්…");
    let ok = 0;
    for (const f of files) {
      try { const u = await uploadImage(f); await addGalleryItem({ url: u, caption: "", order: gallery.length + ok }); ok++; }
      catch (err) { console.warn(err); }
    }
    toast(ok + "ක් එක් විය" + (ok < files.length ? " (" + (files.length - ok) + "ක් අසාර්ථකයි)" : ""), ok ? "ok" : "err");
  };
};
function drawGallery() {
  $("#galList").innerHTML = gallery.length ? gallery.map((g, i) =>
    '<div class="item"><img class="thumb" src="' + esc(g.url) + '" alt="">' +
      '<div class="meta"><input class="inp" data-cap="' + esc(g.id) + '" value="' + esc(g.caption || "") + '" placeholder="සිරැසිය (විකල්ප)"></div>' +
      '<div class="acts"><button class="btn sm ghost" data-mv="up" data-id="' + esc(g.id) + '" data-i="' + i + '">↑</button>' +
      '<button class="btn sm ghost" data-mv="down" data-id="' + esc(g.id) + '" data-i="' + i + '">↓</button>' +
      '<button class="btn danger sm" data-del="' + esc(g.id) + '">මකන්න</button></div></div>'
  ).join("") : '<div class="empty">තවම ඡායාරූප නැත</div>';
  $$("[data-del]", $("#galList")).forEach(b => b.onclick = async () => { if (!confirm("මෙම ඡායාරූපය මකන්නද?")) return; try { await delDoc("gallery", b.dataset.del); toast("මකන ලදී", "ok"); } catch (e) { toast("දෝෂයකි", "err"); } });
  $$("[data-cap]", $("#galList")).forEach(inp => inp.onchange = async () => { try { await updDoc("gallery", inp.dataset.cap, { caption: inp.value.trim() }); toast("සිරැසිය සුරැකිණි", "ok"); } catch (e) { toast("දෝෂයකි", "err"); } });
  $$("[data-mv]", $("#galList")).forEach(b => b.onclick = async () => {
    const i = +b.dataset.i, j = b.dataset.mv === "up" ? i - 1 : i + 1; if (j < 0 || j >= gallery.length) return;
    try { await Promise.all([updDoc("gallery", gallery[i].id, { order: j }), updDoc("gallery", gallery[j].id, { order: i })]); } catch (e) { toast("දෝෂයකි", "err"); }
  });
}

/* ── BLESSINGS ── */
let blFilter = "pending";
renderers.blessings = function () {
  const shown = blessings.filter(b => blFilter === "all" || (blFilter === "pending" && !b.approved) || (blFilter === "approved" && b.approved));
  const pend = blessings.filter(b => !b.approved).length, app = blessings.filter(b => b.approved).length;
  $("#p-blessings").innerHTML =
    '<div class="filterbar">' +
      chip("අනුමැතියට (" + pend + ")", "pending") + chip("අනුමතයි (" + app + ")", "approved") + chip("සියල්ල (" + blessings.length + ")", "all") +
    '</div>' +
    '<div class="list">' + (shown.length ? shown.map(b =>
      '<div class="item" style="align-items:flex-start"><div class="meta"><div class="t">' + esc(b.name) + ' ' + (b.approved ? '<span class="pill yes">අනුමතයි</span>' : '<span class="pill pend">අනුමැතියට</span>') + '</div>' +
        '<div class="d" style="white-space:pre-wrap">' + esc(b.message) + '</div></div>' +
        '<div class="acts">' + (b.approved ? '<button class="btn sm ghost" data-unapp="' + esc(b.id) + '">සඟවන්න</button>' : '<button class="btn sm" data-app="' + esc(b.id) + '">අනුමත කරන්න</button>') +
        '<button class="btn danger sm" data-del="' + esc(b.id) + '">මකන්න</button></div></div>'
    ).join("") : '<div class="empty">මෙහි කිසිවක් නැත</div>') + '</div>';
  function chip(t, v) { return '<button class="chip' + (blFilter === v ? " active" : "") + '" data-f="' + v + '">' + t + '</button>'; }
  $$("[data-f]", $("#p-blessings")).forEach(c => c.onclick = () => { blFilter = c.dataset.f; renderers.blessings(); });
  $$("[data-app]", $("#p-blessings")).forEach(b => b.onclick = async () => { try { await updDoc("blessings", b.dataset.app, { approved: true }); toast("අනුමත විය — පොදු පිටුවේ දිස් වේ", "ok"); } catch (e) { toast("දෝෂයකි", "err"); } });
  $$("[data-unapp]", $("#p-blessings")).forEach(b => b.onclick = async () => { try { await updDoc("blessings", b.dataset.unapp, { approved: false }); toast("සඟවන ලදී", "ok"); } catch (e) { toast("දෝෂයකි", "err"); } });
  $$("[data-del]", $("#p-blessings")).forEach(b => b.onclick = async () => { if (!confirm("මෙම සුබ පැතුම මකන්නද?")) return; try { await delDoc("blessings", b.dataset.del); toast("මකන ලදී", "ok"); } catch (e) { toast("දෝෂයකි", "err"); } });
};

/* initial paint (panels live inside hidden #app until authorised login) */
go("dashboard");
