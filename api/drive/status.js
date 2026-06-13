/* ════════════════════════════════════════════════════════════════════════
 *  හෙළ සිරිත · DRIVE SELF-TEST  ·  api/drive/status.js   (Vercel · Node)
 *  GET/POST + Authorization: Bearer <firebase-id-token>
 *  → verifies admin, then reports: which credential source is set, whether a
 *    token can be minted, and whether the folder is reachable & writable.
 *  Lets you see EXACTLY what to fix (no env? bad key? folder not shared?).
 * ════════════════════════════════════════════════════════════════════════ */

const { getAccessToken, verifyAdmin, applyCors, loadServiceAccount } = require("../../lib/drive.js");

module.exports = async (req, res) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try { await verifyAdmin(req); }
  catch (e) { return res.status(401).json({ error: "unauthorized:" + (e.message || e) }); }

  const out = { ok: false, env: {}, token: null, folder: null, hint: "" };
  // 1) which credentials are present?
  let sa = { email: "", key: "", src: "none" };
  try { sa = loadServiceAccount(); } catch (e) { out.env.parseError = String(e.message || e); }
  out.env.source = sa.src;
  out.env.hasEmail = !!sa.email;
  out.env.hasKey = !!sa.key && sa.key.includes("BEGIN PRIVATE KEY");
  out.env.folderConfigured = !!process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!out.env.hasEmail || !out.env.hasKey) {
    out.hint = "Set GOOGLE_SERVICE_ACCOUNT_B64 (base64 of the whole key JSON) in Vercel → Settings → Environment Variables, then redeploy.";
    return res.status(200).json(out);
  }
  // 2) can we mint a token?
  let token;
  try { token = await getAccessToken(); out.token = "ok"; }
  catch (e) {
    out.token = String(e.message || e);
    out.hint = out.token.includes("invalid_grant")
      ? "invalid_grant = the key is wrong/rotated/mangled. Re-set GOOGLE_SERVICE_ACCOUNT_B64 from a FRESH key JSON (Google Cloud → Service Accounts → Keys → Add key)."
      : "Could not mint a Google token. Check the key JSON and that the Drive API is enabled.";
    return res.status(200).json(out);
  }
  // 3) can the service account see & write the folder?
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  try {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,capabilities/canAddChildren&supportsAllDrives=true`, { headers: { Authorization: "Bearer " + token } });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      out.folder = { name: j.name, canAddChildren: !!(j.capabilities && j.capabilities.canAddChildren) };
      out.ok = out.folder.canAddChildren;
      out.hint = out.ok ? "All good — Drive is connected." :
        "Folder found but not writable. Share the folder with the service-account email as Editor.";
    } else {
      out.folder = "error:" + ((j.error && j.error.message) || r.status);
      out.hint = "Folder not accessible. Share it with the service-account email as Editor, and confirm GOOGLE_DRIVE_FOLDER_ID.";
    }
  } catch (e) {
    out.folder = "network:" + String(e.message || e);
    out.hint = "Could not reach Google Drive.";
  }
  return res.status(200).json(out);
};
