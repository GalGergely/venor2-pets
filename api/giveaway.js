import { createClient } from "@libsql/client";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

const ADMIN_USERS = ["airfalconx"];
const SE_CHANNEL_ID = process.env.SE_CHANNEL_ID || "6658bffc3137495d33b0a3f7";
const SE_JWT_TOKEN = process.env.SE_JWT_TOKEN;

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

async function loadState() {
  try {
    const result = await db.execute({ sql: "SELECT data FROM state WHERE id = 'main'", args: [] });
    if (result.rows.length > 0) {
      return JSON.parse(result.rows[0].data);
    }
  } catch (e) {
    console.error("[GW] Turso load error:", e.message);
  }
  return { giveaways: [], history: [] };
}

async function saveState(state) {
  state.history = (state.history || []).slice(-20);
  try {
    await db.execute({
      sql: "INSERT OR REPLACE INTO state (id, data) VALUES ('main', ?)",
      args: [JSON.stringify(state)]
    });
  } catch (e) {
    console.error("[GW] Turso save error:", e.message);
  }
}

function pickWinners(entries, count) {
  if (entries.length === 0) return [];
  var shuffled = entries.slice().sort(function() { return Math.random() - 0.5; });
  return shuffled.slice(0, count);
}

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
  } catch (e) {
    return null;
  }
}

async function deductSEPoints(username, amount) {
  if (!SE_JWT_TOKEN || amount <= 0) return false;
  try {
    const currentPoints = await fetchSEPoints(username);
    if (currentPoints === null || currentPoints < amount) return false;
    const res = await fetch(
      "https://api.streamelements.com/kappa/v2/points/" + SE_CHANNEL_ID + "/" + encodeURIComponent(username) + "/-" + amount,
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer " + SE_JWT_TOKEN,
          Accept: "application/json"
        }
      }
    );
    return res.ok;
  } catch (e) {
    return false;
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
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const action = url.searchParams.get("action") || "list";

      if (action === "list") {
        const state = await loadState();
        return res.json(state);
      }

      return res.status(400).json({ error: "Invalid action" });
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const action = body.action;

      if (action === "create") {
        const adminUser = body.adminUser;
        if (!adminUser || typeof adminUser !== "string" || ADMIN_USERS.indexOf(adminUser.toLowerCase()) === -1) {
          return res.status(403).json({ error: "Unauthorized: admin only" });
        }

        const gw = body.giveaway;
        if (!gw) return res.status(400).json({ error: "Missing giveaway data" });

        const prize = typeof gw.prize === "string" ? gw.prize.trim() : "";
        if (prize.length === 0 || prize.length > 200) {
          return res.status(400).json({ error: "Invalid prize (1-200 chars)" });
        }

        const winners = Math.max(1, Math.min(100, parseInt(gw.winners) || 1));
        const entryCost = Math.max(0, Math.min(100000, parseInt(gw.entryCost) || 0));
        const durationMin = Math.max(1, Math.min(1440, parseInt(gw.duration) || 5));
        const description = typeof gw.description === "string" ? gw.description.slice(0, 500) : "";

        const now = Date.now();
        const newGw = {
          id: generateId(),
          prize: prize,
          winners: winners,
          entryCost: entryCost,
          duration: durationMin,
          description: description,
          entries: [],
          status: "active",
          createdAt: now,
          endsAt: now + durationMin * 60 * 1000,
          drawnWinners: [],
          createdBy: adminUser
        };

        const state = await loadState();
        state.giveaways.push(newGw);
        await saveState(state);
        return res.json({ ok: true, giveaway: newGw });
      }

      if (action === "join") {
        const gwId = body.giveawayId;
        const user = body.user;

        if (!gwId || !user || typeof user !== "string") {
          return res.status(400).json({ error: "Invalid parameters" });
        }

        const userLower = user.toLowerCase().trim();
        const state = await loadState();
        const gw = state.giveaways.find(function(g) { return g.id === gwId; });

        if (!gw || gw.status !== "active") {
          return res.status(400).json({ error: "Giveaway not found or ended" });
        }

        if (gw.endsAt <= Date.now()) {
          return res.status(400).json({ error: "Giveaway has expired" });
        }

        if (gw.entries.indexOf(userLower) !== -1) {
          return res.status(400).json({ error: "Already entered" });
        }

        if (gw.entryCost > 0) {
          const points = await fetchSEPoints(userLower);
          if (points === null) {
            return res.status(502).json({ error: "Could not verify points" });
          }
          if (points < gw.entryCost) {
            return res.status(400).json({ error: "Insufficient points", has: points, needs: gw.entryCost });
          }

          const deducted = await deductSEPoints(userLower, gw.entryCost);
          if (!deducted) {
            return res.status(500).json({ error: "Failed to deduct points" });
          }
        }

        gw.entries.push(userLower);
        await saveState(state);
        return res.json({ ok: true, entryCost: gw.entryCost });
      }

      if (action === "delete") {
        const adminUser = body.adminUser;
        if (!adminUser || typeof adminUser !== "string" || ADMIN_USERS.indexOf(adminUser.toLowerCase()) === -1) {
          return res.status(403).json({ error: "Unauthorized: admin only" });
        }

        const gwId = body.giveawayId;
        if (!gwId) {
          return res.status(400).json({ error: "Missing giveawayId" });
        }

        const state = await loadState();
        const idx = state.giveaways.findIndex(function(g) { return g.id === gwId; });
        if (idx === -1) {
          return res.status(404).json({ error: "Giveaway not found" });
        }

        state.giveaways.splice(idx, 1);
        await saveState(state);
        return res.json({ ok: true });
      }

      if (action === "draw") {
        const adminUser = body.adminUser;
        if (!adminUser || typeof adminUser !== "string" || ADMIN_USERS.indexOf(adminUser.toLowerCase()) === -1) {
          return res.status(403).json({ error: "Unauthorized: admin only" });
        }

        const gwId = body.giveawayId;
        const state = await loadState();
        const gw = state.giveaways.find(function(g) { return g.id === gwId; });
        if (!gw || gw.status !== "active") {
          return res.status(400).json({ error: "Giveaway not found or not active" });
        }

        gw.status = "ended";
        gw.drawnWinners = pickWinners(gw.entries, gw.winners);
        await saveState(state);
        return res.json({ ok: true, winners: gw.drawnWinners });
      }

      if (action === "reroll") {
        const adminUser = body.adminUser;
        if (!adminUser || typeof adminUser !== "string" || ADMIN_USERS.indexOf(adminUser.toLowerCase()) === -1) {
          return res.status(403).json({ error: "Unauthorized: admin only" });
        }

        const gwId = body.giveawayId;
        const state = await loadState();
        const gw = state.giveaways.find(function(g) { return g.id === gwId; });
        if (!gw) {
          return res.status(404).json({ error: "Giveaway not found" });
        }

        gw.drawnWinners = pickWinners(gw.entries, gw.winners);
        await saveState(state);
        return res.json({ ok: true, winners: gw.drawnWinners });
      }

      if (action === "archive") {
        const adminUser = body.adminUser;
        if (!adminUser || typeof adminUser !== "string" || ADMIN_USERS.indexOf(adminUser.toLowerCase()) === -1) {
          return res.status(403).json({ error: "Unauthorized: admin only" });
        }

        const gwId = body.giveawayId;
        const state = await loadState();
        const idx = state.giveaways.findIndex(function(g) { return g.id === gwId; });
        if (idx === -1) {
          return res.status(404).json({ error: "Giveaway not found" });
        }

        const gw = state.giveaways.splice(idx, 1)[0];
        state.history.push(gw);
        await saveState(state);
        return res.json({ ok: true });
      }

      return res.status(400).json({ error: "Invalid action" });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
}
