/* ════════════════════════════════════════════════════════════════════════
 *  හෙළ සිරිත · DRIVE DELETE ENDPOINT  ·  api/drive/delete.js   (Vercel · Node)
 *  POST { fileId }  +  Authorization: Bearer <firebase-id-token>
 *  → verifies admin → service-account delete from Drive (delete-sync) → { ok }
 * ════════════════════════════════════════════════════════════════════════ */

const { getAccessToken, verifyAdmin, applyCors } = require("../../lib/drive.js");

module.exports = async (req, res) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method-not-allowed" });

  try { await verifyAdmin(req); }
  catch (e) { return res.status(401).json({ error: "unauthorized:" + (e.message || e) }); }

  try {
    const { fileId } = (req.body || {});
    if (!fileId) return res.status(400).json({ error: "no-id" });
    const token = await getAccessToken();
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
      method: "DELETE", headers: { Authorization: "Bearer " + token },
    });
    if (r.status === 204 || r.status === 200 || r.status === 404) return res.status(200).json({ ok: true });
    const j = await r.json().catch(() => ({}));
    return res.status(502).json({ error: "drive-delete:" + ((j.error && j.error.message) || r.status) });
  } catch (e) {
    return res.status(500).json({ error: "server:" + (e.message || e) });
  }
};
