const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  const CHANNEL_ID = process.env.SE_CHANNEL_ID || "6658bffc3137495d33b0a3f7";
  const JWT_TOKEN = process.env.SE_JWT_TOKEN;

  if (!JWT_TOKEN) {
    console.error("[LB] SE_JWT_TOKEN not configured");
    return new Response(JSON.stringify({ error: "SE_JWT_TOKEN not configured" }), { status: 500, headers });
  }

  const url = new URL(req.url);
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
      return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers });
    }

    console.log("[LB] SE API request:", seUrl);
    const res = await fetch(seUrl, { headers: authHeader });
    console.log("[LB] SE API status:", res.status);
    const data = await res.json();
    console.log("[LB] SE API response type:", Array.isArray(data) ? "array(len=" + data.length + ")" : typeof data, "keys:", data ? Object.keys(data).join(",") : "null");

    return new Response(JSON.stringify(data), { status: res.status, headers });
  } catch (err) {
    console.error("[LB] SE API error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};

export const config = {
  path: "/api/se-proxy"
};
