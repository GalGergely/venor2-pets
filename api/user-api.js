import { createClient } from "@libsql/client";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

const SE_CHANNEL_ID = process.env.SE_CHANNEL_ID || "6658bffc3137495d33b0a3f7";
const SE_JWT_TOKEN = process.env.SE_JWT_TOKEN;

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

async function ensureTables() {
  await db.execute(`CREATE TABLE IF NOT EXISTS spins (username TEXT PRIMARY KEY, lastSpin TEXT NOT NULL)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS pet_ownership (username TEXT NOT NULL, pet_index INTEGER NOT NULL, PRIMARY KEY(username, pet_index))`);
  await db.execute(`CREATE TABLE IF NOT EXISTS user_stats (username TEXT PRIMARY KEY, display_name TEXT, avatar TEXT, total_spins INTEGER DEFAULT 0, total_points_won INTEGER DEFAULT 0)`);
}

async function addSEPoints(username, amount) {
  if (!SE_JWT_TOKEN || amount <= 0) return false;
  try {
    const res = await fetch(
      "https://api.streamelements.com/kappa/v2/points/" + SE_CHANNEL_ID + "/" + encodeURIComponent(username) + "/" + amount,
      { method: "PUT", headers: { Authorization: "Bearer " + SE_JWT_TOKEN, Accept: "application/json" } }
    );
    return res.ok;
  } catch (e) { return false; }
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
  } catch (e) { return null; }
}

const SPIN_OPTIONS = [
  { label: "0 pont", points: 0, weight: 50 },
  { label: "10 pont", points: 10, weight: 25 },
  { label: "20 pont", points: 20, weight: 15 },
  { label: "50 pont", points: 50, weight: 7 },
  { label: "100 pont", points: 100, weight: 3 }
];

function pickSpinResult() {
  var total = 0;
  for (var i = 0; i < SPIN_OPTIONS.length; i++) total += SPIN_OPTIONS[i].weight;
  var r = Math.random() * total;
  var acc = 0;
  for (var i = 0; i < SPIN_OPTIONS.length; i++) {
    acc += SPIN_OPTIONS[i].weight;
    if (r < acc) return SPIN_OPTIONS[i];
  }
  return SPIN_OPTIONS[0];
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

  try {
    await ensureTables();

    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const action = url.searchParams.get("action");

      if (action === "spin-check") {
        const username = url.searchParams.get("user");
        if (!username) return res.status(400).json({ error: "Missing user" });
        const result = await db.execute({ sql: "SELECT lastSpin FROM spins WHERE username = ?", args: [username.toLowerCase()] });
        var canSpin = true;
        if (result.rows.length > 0) {
          var last = new Date(result.rows[0].lastSpin);
          var now = new Date();
          canSpin = last.toDateString() !== now.toDateString();
        }
        return res.json({ canSpin });
      }

      if (action === "stats") {
        var totalUsers = 0;
        try {
          var r = await db.execute("SELECT COUNT(*) as cnt FROM user_stats");
          totalUsers = r.rows.length > 0 ? Number(r.rows[0].cnt) : 0;
        } catch(e) {}

        var totalSpins = 0;
        try {
          var r = await db.execute("SELECT COALESCE(SUM(total_spins),0) as cnt FROM user_stats");
          totalSpins = r.rows.length > 0 ? Number(r.rows[0].cnt) : 0;
        } catch(e) {}

        var petCounts = [];
        try {
          var r = await db.execute("SELECT pet_index, COUNT(DISTINCT username) as cnt FROM pet_ownership GROUP BY pet_index ORDER BY cnt DESC");
          petCounts = r.rows.map(function(row) { return { pet_index: Number(row.pet_index), count: Number(row.cnt) }; });
        } catch(e) {}

        return res.json({ totalUsers, petCounts, totalSpins });
      }

      if (action === "profile") {
        const username = url.searchParams.get("user");
        const localPetCount = parseInt(url.searchParams.get("petCount")) || 0;
        if (!username) return res.status(400).json({ error: "Missing user" });
        var userLower = username.toLowerCase();

        var ownedPets = [];
        try {
          var r = await db.execute({ sql: "SELECT pet_index FROM pet_ownership WHERE username = ?", args: [userLower] });
          ownedPets = r.rows.map(function(row) { return Number(row.pet_index); });
        } catch(e) {}

        var points = await fetchSEPoints(userLower);

        var spinStats = { totalSpins: 0, totalPointsWon: 0 };
        try {
          var r = await db.execute({ sql: "SELECT total_spins, total_points_won FROM user_stats WHERE username = ?", args: [userLower] });
          if (r.rows.length > 0) {
            spinStats.totalSpins = Number(r.rows[0].total_spins) || 0;
            spinStats.totalPointsWon = Number(r.rows[0].total_points_won) || 0;
          }
        } catch(e) {}

        var userPetCount = localPetCount || ownedPets.length;

        var rank = 0;
        try {
          var allCounts = await db.execute("SELECT username, COUNT(*) as cnt FROM pet_ownership GROUP BY username");
          var sorted = allCounts.rows.slice().sort(function(a,b) { return Number(b.cnt) - Number(a.cnt); });
          var inserted = false;
          for (var i = 0; i < sorted.length; i++) {
            if (sorted[i].username === userLower) { rank = i + 1; inserted = true; break; }
            if (Number(sorted[i].cnt) < userPetCount && !inserted) { rank = i + 1; inserted = true; break; }
          }
          if (!inserted) rank = sorted.length + 1;
        } catch(e) {}

        var totalWithPets = 0;
        try {
          var r = await db.execute("SELECT COUNT(DISTINCT username) as cnt FROM pet_ownership");
          totalWithPets = r.rows.length > 0 ? Number(r.rows[0].cnt) : 0;
        } catch(e) {}
        if (localPetCount > 0 && rank === 0) totalWithPets++;

        var percentile = totalWithPets > 0 ? Math.round(((totalWithPets - rank) / totalWithPets) * 100) : 0;

        return res.json({
          username: userLower,
          ownedPets: ownedPets,
          petCount: userPetCount,
          points: points,
          spinStats: spinStats,
          rank: rank,
          totalWithPets: totalWithPets,
          percentile: percentile
        });
      }

      return res.status(400).json({ error: "Invalid action" });
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const action = body.action;

      if (action === "spin") {
        const username = body.username;
        if (!username || typeof username !== "string") {
          return res.status(400).json({ error: "Invalid user" });
        }
        var userLower = username.toLowerCase();

        var canSpin = true;
        var existing = await db.execute({ sql: "SELECT lastSpin FROM spins WHERE username = ?", args: [userLower] });
        if (existing.rows.length > 0) {
          var last = new Date(existing.rows[0].lastSpin);
          var now = new Date();
          canSpin = last.toDateString() !== now.toDateString();
        }
        if (!canSpin) {
          return res.status(400).json({ error: "Already spun today" });
        }

        var result = pickSpinResult();

        await db.execute({
          sql: "INSERT OR REPLACE INTO spins (username, lastSpin) VALUES (?, ?)",
          args: [userLower, new Date().toISOString()]
        });

        await db.execute({
          sql: "INSERT INTO user_stats (username, total_spins, total_points_won) VALUES (?, 1, ?) ON CONFLICT(username) DO UPDATE SET total_spins = total_spins + 1, total_points_won = total_points_won + ?",
          args: [userLower, result.points, result.points]
        });

        if (result.points > 0) {
          await addSEPoints(userLower, result.points);
        }

        return res.json({ ok: true, result: result });
      }

      if (action === "sync-pets") {
        const username = body.username;
        const pets = body.pets;
        if (!username || !Array.isArray(pets)) {
          return res.status(400).json({ error: "Invalid data" });
        }
        var userLower = username.toLowerCase();

        await db.execute({ sql: "DELETE FROM pet_ownership WHERE username = ?", args: [userLower] });

        if (pets.length > 0) {
          var values = pets.map(function(p) { return "(?, ?)"; }).join(",");
          var args = [];
          pets.forEach(function(p) { args.push(userLower); args.push(Number(p)); });
          await db.execute({ sql: "INSERT INTO pet_ownership " + values, args: args });
        }

        return res.json({ ok: true, synced: pets.length });
      }

      return res.status(400).json({ error: "Invalid action" });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
}
