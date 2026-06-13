/* ════════════════════════════════════════════════════════════════════════
 *  හෙළ සිරිත · DRIVE UPLOAD ENDPOINT  ·  api/drive/upload.js   (Vercel · Node)
 *  POST { name, mimeType, dataBase64 }  +  Authorization: Bearer <firebase-id-token>
 *  → verifies admin → service-account upload to the Drive folder → { fileId, url }
 * ════════════════════════════════════════════════════════════════════════ */

const { getAccessToken, verifyAdmin, applyCors } = require("../../lib/drive.js");

module.exports = async (req, res) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method-not-allowed" });

  try { await verifyAdmin(req); }
  catch (e) { return res.status(401).json({ error: "unauthorized:" + (e.message || e) }); }

  try {
    const { name, mimeType, dataBase64 } = (req.body || {});
    if (!dataBase64) return res.status(400).json({ error: "no-data" });
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) return res.status(500).json({ error: "no-folder-configured" });

    const token = await getAccessToken();
    const buf = Buffer.from(dataBase64, "base64");
    const mt = mimeType || "image/jpeg";
    const boundary = "helasiritha_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name: name || ("photo_" + Date.now() + ".jpg"), parents: [folderId] });
    const pre = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mt}\r\n\r\n`, "utf8");
    const post = Buffer.from(`\r\n--${boundary}--`, "utf8");
    const body = Buffer.concat([pre, buf, post]);

    const up = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    const uj = await up.json().catch(() => ({}));
    if (!up.ok || !uj.id) return res.status(502).json({ error: "drive-upload:" + ((uj.error && uj.error.message) || up.status) });
    const fileId = uj.id;

    /* make link-readable so the public gallery can show it (best effort) */
    try {
      await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "reader", type: "anyone" }),
      });
    } catch (_) { /* non-fatal */ }

    return res.status(200).json({ fileId, url: `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600` });
  } catch (e) {
    return res.status(500).json({ error: "server:" + (e.message || e) });
  }
};
module.exports.config = { api: { bodyParser: { sizeLimit: "8mb" } } };
