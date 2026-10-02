const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const CHANNEL_ID = process.env.SE_CHANNEL_ID || "6658bffc3137495d33b0a3f7";
  const JWT_TOKEN = process.env.SE_JWT_TOKEN;

  if (!JWT_TOKEN) {
    console.error("[LB] SE_JWT_TOKEN not configured");
    return res.status(500).json({ error: "SE_JWT_TOKEN not configured" });
  }

  const url = new URL(req.url, "http://localhost");
  const action = url.searchParams.get("action") || "top";
  const user = url.searchParams.get("user") || "";
  const limit = parseInt(url.searchParams.get("limit")) || 10;
  const offset = parseInt(url.searchParams.get("offset")) || 0;

  const SE_BASE = "https://api.streamelements.com/kappa/v2";
  const authHeader = { "Authorization": "Bearer " + JWT_TOKEN, "Accept": "application/json" };

  try {
    let seUrl;

    if (action === "points" && user) {
      seUrl = `${SE_BASE}/points/${CHANNEL_ID}/${encodeURIComponent(user)}`;
    } else if (action === "rank" && user) {
      seUrl = `${SE_BASE}/points/${CHANNEL_ID}/${encodeURIComponent(user)}/rank`;
    } else if (action === "top") {
      seUrl = `${SE_BASE}/points/${CHANNEL_ID}/top?limit=${limit}&offset=${offset}`;
    } else if (action === "watchtime") {
      seUrl = `${SE_BASE}/points/${CHANNEL_ID}/watchtime?limit=${limit}&offset=${offset}`;
    } else {
      return res.status(400).json({ error: "Invalid action" });
    }

    console.log("[LB] SE API request:", seUrl);
    const seRes = await fetch(seUrl, { headers: authHeader });
    console.log("[LB] SE API status:", seRes.status);
    const data = await seRes.json();
    console.log("[LB] SE API response type:", Array.isArray(data) ? "array(len=" + data.length + ")" : typeof data, "keys:", data ? Object.keys(data).join(",") : "null");

    return res.status(seRes.status).json(data);
  } catch (err) {
    console.error("[LB] SE API error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
