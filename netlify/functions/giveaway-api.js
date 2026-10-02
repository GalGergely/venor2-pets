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

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const action = url.searchParams.get("action") || "list";

      if (action === "list") {
        const state = await loadState();
        return new Response(JSON.stringify(state), { headers });
      }

      return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const action = body.action;

      if (action === "create") {
        const adminUser = body.adminUser;
        if (!adminUser || typeof adminUser !== "string" || ADMIN_USERS.indexOf(adminUser.toLowerCase()) === -1) {
          return new Response(JSON.stringify({ error: "Unauthorized: admin only" }), { status: 403, headers });
        }

        const gw = body.giveaway;
        if (!gw) return new Response(JSON.stringify({ error: "Missing giveaway data" }), { status: 400, headers });

        const prize = typeof gw.prize === "string" ? gw.prize.trim() : "";
        if (prize.length === 0 || prize.length > 200) {
          return new Response(JSON.stringify({ error: "Invalid prize (1-200 chars)" }), { status: 400, headers });
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
        return new Response(JSON.stringify({ ok: true, giveaway: newGw }), { headers });
      }

      if (action === "join") {
        const gwId = body.giveawayId;
        const user = body.user;

        if (!gwId || !user || typeof user !== "string") {
          return new Response(JSON.stringify({ error: "Invalid parameters" }), { status: 400, headers });
        }

        const userLower = user.toLowerCase().trim();
        const state = await loadState();
        const gw = state.giveaways.find(function(g) { return g.id === gwId; });

        if (!gw || gw.status !== "active") {
          return new Response(JSON.stringify({ error: "Giveaway not found or ended" }), { status: 400, headers });
        }

        if (gw.endsAt <= Date.now()) {
          return new Response(JSON.stringify({ error: "Giveaway has expired" }), { status: 400, headers });
        }

        if (gw.entries.indexOf(userLower) !== -1) {
          return new Response(JSON.stringify({ error: "Already entered" }), { status: 400, headers });
        }

        if (gw.entryCost > 0) {
          const points = await fetchSEPoints(userLower);
          if (points === null) {
            return new Response(JSON.stringify({ error: "Could not verify points" }), { status: 502, headers });
          }
          if (points < gw.entryCost) {
            return new Response(JSON.stringify({ error: "Insufficient points", has: points, needs: gw.entryCost }), { status: 400, headers });
          }

          const deducted = await deductSEPoints(userLower, gw.entryCost);
          if (!deducted) {
            return new Response(JSON.stringify({ error: "Failed to deduct points" }), { status: 500, headers });
          }
        }

        gw.entries.push(userLower);
        await saveState(state);
        return new Response(JSON.stringify({ ok: true, entryCost: gw.entryCost }), { headers });
      }

      if (action === "delete") {
        const adminUser = body.adminUser;
        if (!adminUser || typeof adminUser !== "string" || ADMIN_USERS.indexOf(adminUser.toLowerCase()) === -1) {
          return new Response(JSON.stringify({ error: "Unauthorized: admin only" }), { status: 403, headers });
        }

        const gwId = body.giveawayId;
        if (!gwId) {
          return new Response(JSON.stringify({ error: "Missing giveawayId" }), { status: 400, headers });
        }

        const state = await loadState();
        const idx = state.giveaways.findIndex(function(g) { return g.id === gwId; });
        if (idx === -1) {
          return new Response(JSON.stringify({ error: "Giveaway not found" }), { status: 404, headers });
        }

        state.giveaways.splice(idx, 1);
        await saveState(state);
        return new Response(JSON.stringify({ ok: true }), { headers });
      }

      if (action === "draw") {
        const adminUser = body.adminUser;
        if (!adminUser || typeof adminUser !== "string" || ADMIN_USERS.indexOf(adminUser.toLowerCase()) === -1) {
          return new Response(JSON.stringify({ error: "Unauthorized: admin only" }), { status: 403, headers });
        }

        const gwId = body.giveawayId;
        const state = await loadState();
        const gw = state.giveaways.find(function(g) { return g.id === gwId; });
        if (!gw || gw.status !== "active") {
          return new Response(JSON.stringify({ error: "Giveaway not found or not active" }), { status: 400, headers });
        }

        gw.status = "ended";
        gw.drawnWinners = pickWinners(gw.entries, gw.winners);
        await saveState(state);
        return new Response(JSON.stringify({ ok: true, winners: gw.drawnWinners }), { headers });
      }

      if (action === "reroll") {
        const adminUser = body.adminUser;
        if (!adminUser || typeof adminUser !== "string" || ADMIN_USERS.indexOf(adminUser.toLowerCase()) === -1) {
          return new Response(JSON.stringify({ error: "Unauthorized: admin only" }), { status: 403, headers });
        }

        const gwId = body.giveawayId;
        const state = await loadState();
        const gw = state.giveaways.find(function(g) { return g.id === gwId; });
        if (!gw) {
          return new Response(JSON.stringify({ error: "Giveaway not found" }), { status: 404, headers });
        }

        gw.drawnWinners = pickWinners(gw.entries, gw.winners);
        await saveState(state);
        return new Response(JSON.stringify({ ok: true, winners: gw.drawnWinners }), { headers });
      }

      if (action === "archive") {
        const adminUser = body.adminUser;
        if (!adminUser || typeof adminUser !== "string" || ADMIN_USERS.indexOf(adminUser.toLowerCase()) === -1) {
          return new Response(JSON.stringify({ error: "Unauthorized: admin only" }), { status: 403, headers });
        }

        const gwId = body.giveawayId;
        const state = await loadState();
        const idx = state.giveaways.findIndex(function(g) { return g.id === gwId; });
        if (idx === -1) {
          return new Response(JSON.stringify({ error: "Giveaway not found" }), { status: 404, headers });
        }

        const gw = state.giveaways.splice(idx, 1)[0];
        state.history.push(gw);
        await saveState(state);
        return new Response(JSON.stringify({ ok: true }), { headers });
      }

      return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), { status: 500, headers });
  }
};

export const config = {
  path: "/api/giveaway"
};
