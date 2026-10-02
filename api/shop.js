const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

const SE_CHANNEL_ID = process.env.SE_CHANNEL_ID || "6658bffc3137495d33b0a3f7";
const SE_JWT_TOKEN = process.env.SE_JWT_TOKEN;
const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1541481984973340802/bgXTUp9Wm2yBjAnUxJv5CViI-OoUEVHcupRZW9xR8jClqcLAHG2b7nM2hiYaQXurmGs0";

const SHOP_ITEMS = {
  "1k":  { ve: 1000,  cost: 2000,  label: "Kicsi csomag" },
  "3k":  { ve: 3000,  cost: 6000,  label: "Közepes csomag" },
  "5k":  { ve: 5000,  cost: 10000, label: "Nagy csomag" },
  "10k": { ve: 10000, cost: 20000, label: "Prémium csomag" }
};

async function fetchSEPoints(username) {
  if (!SE_JWT_TOKEN) return null;
  try {
    const res = await fetch(
      "https://api.streamelements.com/kappa/v2/points/" + SE_CHANNEL_ID + "/" + encodeURIComponent(username),
      { headers: { Authorization: "Bearer " + SE_JWT_TOKEN, Accept: "application/json" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.points === "number" ? data.points : null;
  } catch (e) { return null; }
}

async function deductSEPoints(username, amount) {
  if (!SE_JWT_TOKEN || amount <= 0) return false;
  try {
    const res = await fetch(
      "https://api.streamelements.com/kappa/v2/points/" + SE_CHANNEL_ID + "/" + encodeURIComponent(username) + "/-" + amount,
      { method: "PUT", headers: { Authorization: "Bearer " + SE_JWT_TOKEN, Accept: "application/json" } }
    );
    return res.ok;
  } catch (e) { return false; }
}

async function sendDiscordWebhook(payload) {
  try {
    await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.error("[SHOP] Discord webhook error:", e.message);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = await readBody(req);
    const action = body.action;

    if (action === "purchase") {
      const username = body.username;
      const displayName = body.displayName || username;
      const itemKey = body.item;

      if (!username || typeof username !== "string") {
        return res.status(400).json({ error: "Hiányzó felhasználó" });
      }

      const item = SHOP_ITEMS[itemKey];
      if (!item) {
        return res.status(400).json({ error: "Érvénytelen termék" });
      }

      const userLower = username.toLowerCase();
      const points = await fetchSEPoints(userLower);
      if (points === null) {
        return res.status(502).json({ error: "Nem sikerült lekérni a pontegyenleged" });
      }

      if (points < item.cost) {
        return res.status(400).json({ error: "Nincs elég pontod! Szükséges: " + item.cost.toLocaleString() + ", rendelkezésre áll: " + points.toLocaleString() });
      }

      const deducted = await deductSEPoints(userLower, item.cost);
      if (!deducted) {
        return res.status(500).json({ error: "A pontok levonása nem sikerült" });
      }

      const newBalance = await fetchSEPoints(userLower);

      const embed = {
        color: 0x3ddc97,
        title: "🛒 Bolt vásárlás",
        fields: [
          { name: "Felhasználó", value: "`" + esc(username) + "`", inline: true },
          { name: "Termék", value: item.label, inline: true },
          { name: "VÉ mennyiség", value: item.ve.toLocaleString() + " VÉ", inline: true },
          { name: "Fizetett pont", value: item.cost.toLocaleString() + " pont", inline: true },
          { name: "Egyenleg", value: newBalance !== null ? newBalance.toLocaleString() + " pont" : "?", inline: true }
        ],
        footer: { text: "airfalconx.vercel.app" },
        timestamp: new Date().toISOString()
      };

      await sendDiscordWebhook({ embeds: [embed] });

      return res.json({ ok: true, cost: item.cost, item: itemKey, ve: item.ve, newBalance: newBalance });
    }

    return res.status(400).json({ error: "Érvénytelen művelet" });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, function(c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c;
  });
}
