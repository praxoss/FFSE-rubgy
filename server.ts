import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import dotenv from "dotenv";
import admin from "firebase-admin";
import cron from "node-cron";
import fs from "fs";
import path from "path";

dotenv.config();

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : null;

if (serviceAccount) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} else {
  console.warn("FIREBASE_SERVICE_ACCOUNT_JSON not found. Admin routes will fail.");
}

const app = express();
const PORT = 3000;
const db = new Database("rugby.db");

const BACKUP_PATH = path.join(process.cwd(), "backup.json");

function writeBackupFile(payload: any) {
  try {
    fs.writeFileSync(BACKUP_PATH, JSON.stringify(payload, null, 2), "utf-8");
    console.log(`[backup] wrote ${BACKUP_PATH}`);
  } catch (e: any) {
    console.error("[backup] failed to write backup:", e?.message || e);
  }
}

function readBackupFile(): any | null {
  try {
    if (!fs.existsSync(BACKUP_PATH)) return null;
    return JSON.parse(fs.readFileSync(BACKUP_PATH, "utf-8"));
  } catch (e: any) {
    console.error("[backup] failed to read backup:", e?.message || e);
    return null;
  }
}

function seedDbFromBackup(backup: any) {
  const divisions: { division: string; rankings: any[]; matches: any[] }[] = [];

  for (const div of ["d1", "d2", "d3", "d4"]) {
    const d = backup?.[div] || {};
    if (d.rankings || d.matches) {
      divisions.push({ division: div, rankings: d.rankings || [], matches: d.matches || [] });
    }
  }
  if (divisions.length === 0 && Array.isArray(backup?.rankings)) {
    divisions.push({ division: "d3", rankings: backup.rankings || [], matches: backup.matches || [] });
  }

  if (divisions.length === 0) {
    console.warn("[backup] backup file exists but contains no data");
    return;
  }

  const insertRanking = db.prepare(`
    INSERT OR REPLACE INTO rankings (team, division, played, won, drawn, lost, bonus, diff, points, updated_at)
    VALUES (@team, @division, @played, @won, @drawn, @lost, @bonus, @diff, @points, CURRENT_TIMESTAMP)
  `);

  const insertMatch = db.prepare(`
    INSERT OR REPLACE INTO matches (matchday, division, date, time, location, home_team, away_team, score_home, score_away, updated_at)
    VALUES (@matchday, @division, @date, @time, @location, @home_team, @away_team, @score_home, @score_away, CURRENT_TIMESTAMP)
  `);

  const upsertClub = db.prepare(`
    INSERT INTO clubs (name, logo) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET
      logo = excluded.logo
    WHERE (clubs.logo IS NULL OR clubs.logo = '') AND excluded.logo IS NOT NULL AND excluded.logo != ''
  `);

  const tx = db.transaction(() => {
    for (const { division, rankings, matches } of divisions) {
      db.prepare("DELETE FROM matches WHERE division = ?").run(division);
      db.prepare("DELETE FROM rankings WHERE division = ?").run(division);

      for (const r of rankings) {
        if (r?.team && r?.logo) upsertClub.run(String(r.team), String(r.logo));
      }
      for (const m of matches) {
        if (m?.home_team && m?.home_logo) upsertClub.run(String(m.home_team), String(m.home_logo));
        if (m?.away_team && m?.away_logo) upsertClub.run(String(m.away_team), String(m.away_logo));
      }

      for (const r of rankings) {
        const row = {
          team: String(r.team || "").trim(),
          division,
          played: Number(r.played) || 0,
          won: Number(r.won) || 0,
          drawn: Number(r.drawn) || 0,
          lost: Number(r.lost) || 0,
          bonus: Number(r.bonus) || 0,
          diff: Number(r.diff) || 0,
          points: Number(r.points) || 0,
        };
        if (row.team) insertRanking.run(row);
      }

      for (const m of matches) {
        const row = {
          matchday: Number(m.matchday) || 0,
          division,
          date: String(m.date || "").trim(),
          time: String(m.time || "").trim(),
          location: String(m.location || "").trim(),
          home_team: String(m.home_team || "").trim(),
          away_team: String(m.away_team || "").trim(),
          score_home: m.score_home == null ? null : Number(m.score_home),
          score_away: m.score_away == null ? null : Number(m.score_away),
        };
        if (row.matchday > 0 && row.home_team && row.away_team) insertMatch.run(row);
      }
    }

    db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_update', CURRENT_TIMESTAMP)").run();
    db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('backup_loaded', CURRENT_TIMESTAMP)").run();
  });

  tx();
}

// Auth Middleware
const authenticateAdmin = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }
  const idToken = authHeader.split("Bearer ")[1];
  const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map(e => e.trim().toLowerCase());
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const email = decodedToken.email?.toLowerCase();
    if (email && adminEmails.includes(email)) {
      (req as any).user = decodedToken;
      next();
    } else {
      res.status(403).json({ error: "Forbidden: Not an admin" });
    }
  } catch (error) {
    console.error("Auth error:", error);
    res.status(401).json({ error: "Invalid token" });
  }
};

app.get("/health", (req, res) => res.send("OK"));

// ── Database Init ─────────────────────────────────────────
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clubs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      logo TEXT
    );
  `);

  // ── Matches migration ──
  const matchesInfo = db.prepare("PRAGMA table_info(matches)").all() as any[];
  const hasMatchesLogo = matchesInfo.some(col => col.name === 'home_logo');
  const hasMatchesDivision = matchesInfo.some(col => col.name === 'division');

  if (hasMatchesLogo) {
    console.log("Migrating matches table (remove logo, add division)...");
    db.transaction(() => {
      db.exec(`
        ALTER TABLE matches RENAME TO matches_old;
        CREATE TABLE matches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          matchday INTEGER,
          division TEXT NOT NULL DEFAULT 'd3',
          date TEXT,
          time TEXT,
          location TEXT,
          home_team TEXT,
          away_team TEXT,
          score_home INTEGER,
          score_away INTEGER,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO matches (id, matchday, division, date, time, location, home_team, away_team, score_home, score_away, updated_at)
        SELECT id, matchday, 'd3', date, time, location, home_team, away_team, score_home, score_away, updated_at FROM matches_old;
        DROP TABLE matches_old;
      `);
    })();
  } else if (!hasMatchesDivision && matchesInfo.length > 0) {
    console.log("Adding division column to matches...");
    db.exec(`ALTER TABLE matches ADD COLUMN division TEXT NOT NULL DEFAULT 'd3'`);
  } else if (matchesInfo.length === 0) {
    db.exec(`
      CREATE TABLE matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        matchday INTEGER,
        division TEXT NOT NULL DEFAULT 'd3',
        date TEXT,
        time TEXT,
        location TEXT,
        home_team TEXT,
        away_team TEXT,
        score_home INTEGER,
        score_away INTEGER,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  try {
    db.exec(`DROP INDEX IF EXISTS idx_matches_unique`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_unique ON matches(matchday, division, home_team, away_team)`);
    console.log("Index idx_matches_unique (re)created with division");
  } catch (e) {
    console.warn("Index creation warning:", e);
  }

  // ── Rankings migration ──
  const rankingsInfo = db.prepare("PRAGMA table_info(rankings)").all() as any[];
  const tableExists = rankingsInfo.length > 0;
  const hasRankingsLogo = rankingsInfo.some(col => col.name === 'logo');
  const hasBonus = rankingsInfo.some(col => col.name === 'bonus');
  const hasRankingsDivision = rankingsInfo.some(col => col.name === 'division');

  if (tableExists && (hasRankingsLogo || !hasBonus)) {
    console.log("Migrating rankings table...");
    db.transaction(() => {
      db.exec(`
        ALTER TABLE rankings RENAME TO rankings_old;
        CREATE TABLE rankings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          team TEXT,
          division TEXT NOT NULL DEFAULT 'd3',
          played INTEGER,
          won INTEGER,
          drawn INTEGER,
          lost INTEGER,
          bonus INTEGER DEFAULT 0,
          diff INTEGER DEFAULT 0,
          points INTEGER,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(team, division)
        );
        INSERT INTO rankings (id, team, division, played, won, drawn, lost, bonus, diff, points, updated_at)
        SELECT id, team, 'd3', played, won, drawn, lost, 0, 0, points, updated_at FROM rankings_old;
        DROP TABLE rankings_old;
      `);
    })();
  } else if (tableExists && !hasRankingsDivision) {
    console.log("Adding division column to rankings...");
    db.exec(`ALTER TABLE rankings ADD COLUMN division TEXT NOT NULL DEFAULT 'd3'`);
  } else if (!tableExists) {
    db.exec(`
      CREATE TABLE rankings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team TEXT,
        division TEXT NOT NULL DEFAULT 'd3',
        played INTEGER,
        won INTEGER,
        drawn INTEGER,
        lost INTEGER,
        bonus INTEGER DEFAULT 0,
        diff INTEGER DEFAULT 0,
        points INTEGER,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(team, division)
      );
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // ── Rankings history ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS rankings_history (
      team TEXT,
      division TEXT,
      position INTEGER,
      points INTEGER,
      saved_at TEXT,
      PRIMARY KEY (team, division, saved_at)
    );
  `);

  console.log("Database initialized successfully");

  const c1 = db.prepare("SELECT COUNT(*) as c FROM rankings").get() as any;
  const c2 = db.prepare("SELECT COUNT(*) as c FROM matches").get() as any;

  if ((c1?.c || 0) === 0 && (c2?.c || 0) === 0) {
    const backup = readBackupFile();
    if (backup) {
      console.log("[backup] DB empty -> restoring from backup.json");
      seedDbFromBackup(backup);
    } else {
      console.warn("[backup] DB empty and no backup.json found");
    }
  }
} catch (err) {
  console.error("Database initialization/migration failed:", err);
}

app.use(express.json());
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// ── API REST SportsPress ──────────────────────────────────
const FFSE_BASE = "https://www.rugby-ffse.fr/wp-json";
const SEASON_ID = 217;

const DIVISIONS = {
  d1: { leagueId: 161, tableId: 11798 },
  d2: { leagueId: 162, tableId: 11659 },
  d3: { leagueId: 163, tableId: 11807 },
  d4: { leagueId: 164, tableId: 11809 },
} as const;

type Division = keyof typeof DIVISIONS;

const normalizeText = (str: string) =>
  str.replace(/&rsquo;/g, "'").replace(/&amp;/g, "&").replace(/&#8211;/g, "–").replace(/&#038;/g, "&").replace(/&[a-z0-9#]+;/gi, "");

async function fetchAllPages<T>(url: string): Promise<T[]> {
  const results: T[] = [];
  let page = 1;
  while (true) {
    const sep = url.includes("?") ? "&" : "?";
    const res = await fetch(`${url}${sep}per_page=100&page=${page}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) { console.error(`[api] HTTP ${res.status} — ${url} page ${page}`); break; }
    const data: T[] = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    results.push(...data);
    const totalPages = parseInt(res.headers.get("X-WP-TotalPages") || "1", 10);
    if (page >= totalPages) break;
    page++;
  }
  return results;
}

async function fetchStandingsFromAPI(division: Division): Promise<any[]> {
  const { tableId } = DIVISIONS[division];
  console.log(`[api] Fetching ${division.toUpperCase()} standings (table ${tableId})...`);
  const res = await fetch(`${FFSE_BASE}/sportspress/v2/tables/${tableId}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) { console.error(`[api] standings HTTP ${res.status}`); return []; }
  const table = await res.json();
  const data: Record<string, any> = table.data || {};
  return Object.entries(data)
    .filter(([teamId, row]) => teamId !== "0" && row.name)
    .map(([teamId, row]) => ({
      id:     Number(teamId),
      team:   normalizeText(String(row.name).trim()),
      played: Number(row.j)       || 0,
      won:    Number(row.g)       || 0,
      drawn:  Number(row.n)       || 0,
      lost:   Number(row.p)       || 0,
      bonus:  (Number(row.pb) || 0) + (Number(row.pp) || 0),
      diff:   Number(row.twofive) || 0,
      points: Number(row.pts)     || 0,
    }))
    .sort((a, b) => a.points !== b.points ? b.points - a.points : b.diff - a.diff);
}

async function fetchTeamsFromAPI(division: Division): Promise<Map<number, { name: string; logo: string | null }>> {
  const { leagueId } = DIVISIONS[division];
  console.log(`[api] Fetching ${division.toUpperCase()} teams...`);
  const teams = await fetchAllPages<any>(
    `${FFSE_BASE}/sportspress/v2/teams?leagues=${leagueId}&seasons=${SEASON_ID}`
  );
  console.log(`[api] ${teams.length} teams found for ${division.toUpperCase()}`);

  const mediaIds = teams.filter(t => t.featured_media > 0).map(t => t.featured_media as number);
  const logoMap = new Map<number, string>();

  if (mediaIds.length > 0) {
    try {
      const res = await fetch(
        `${FFSE_BASE}/wp/v2/media?include=${mediaIds.join(",")}&per_page=100`,
        { headers: { Accept: "application/json" } }
      );
      if (res.ok) {
        const items: any[] = await res.json();
        for (const item of items) {
          const url = item.media_details?.sizes?.thumbnail?.source_url || item.source_url;
          if (url) logoMap.set(item.id, url);
        }
      }
    } catch (e: any) {
      console.warn("[api] Media fetch failed:", e.message);
    }
  }

  const teamMap = new Map<number, { name: string; logo: string | null }>();
  for (const t of teams) {
    teamMap.set(t.id, {
      name: normalizeText((t.title?.rendered || t.slug || "").trim()),
      logo: t.featured_media ? (logoMap.get(t.featured_media) ?? null) : null,
    });
  }
  return teamMap;
}

async function fetchMatchesFromAPI(division: Division): Promise<any[]> {
  const { leagueId } = DIVISIONS[division];
  console.log(`[api] Fetching ${division.toUpperCase()} events...`);
  const events = await fetchAllPages<any>(
    `${FFSE_BASE}/sportspress/v2/events?leagues=${leagueId}&seasons=${SEASON_ID}`
  );
  console.log(`[api] ${events.length} events found for ${division.toUpperCase()}`);

  return events
    .filter(e => Array.isArray(e.teams) && e.teams.length >= 2)
    .map(e => {
      const dateStr: string = e.date || "";
      const date = dateStr.split("T")[0] || "";
      const timePart = dateStr.split("T")[1] || "";
      const timeMatch = timePart.match(/^(\d{2}:\d{2})/);
      const time = timeMatch ? timeMatch[1] : "15:00";

      const homeId: number = e.teams[0];
      const awayId: number = e.teams[1];

      let score_home: number | null = null;
      let score_away: number | null = null;
      if (e.results && e.status !== "future") {
        const h = e.results[String(homeId)]?.points;
        const a = e.results[String(awayId)]?.points;
        if (h !== "" && h != null) score_home = Number(h);
        if (a !== "" && a != null) score_away = Number(a);
      }

      const venueClass = (e.class_list || []).find((c: string) => c.startsWith("sp_venue-"));
      const location = venueClass
        ? venueClass.replace("sp_venue-", "").split("-").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
        : "Terrain FFSE";

      return {
        matchday: parseInt(e.day, 10) || 999,
        date,
        time,
        location,
        home_team_id: homeId,
        away_team_id: awayId,
        score_home,
        score_away,
      };
    })
    .sort((a, b) => a.matchday !== b.matchday ? a.matchday - b.matchday : a.date.localeCompare(b.date));
}

// ── API Routes ────────────────────────────────────────────

app.get("/api/data", (req, res) => {
  try {
    const getRankings = (division: string) => {
      const rows = db.prepare(`
        SELECT r.*, c.logo
        FROM rankings r
        LEFT JOIN clubs c ON r.team = c.name
        WHERE r.division = ?
        ORDER BY r.points DESC, r.diff DESC
      `).all(division) as any[];

      return rows.map((r, idx) => {
        const prev = db.prepare(`
          SELECT position FROM rankings_history
          WHERE team = ? AND division = ?
          ORDER BY saved_at DESC LIMIT 1
        `).get(r.team, division) as any;

        let trend: "up" | "down" | "equal" | null = null;
        if (prev) {
          const currentPos = idx + 1;
          if (currentPos < prev.position) trend = "up";
          else if (currentPos > prev.position) trend = "down";
          else trend = "equal";
        }
        return { ...r, trend };
      });
    };

    const getMatches = (division: string) => db.prepare(`
      SELECT m.*, c_home.logo AS home_logo, c_away.logo AS away_logo
      FROM matches m
      LEFT JOIN clubs c_home ON m.home_team = c_home.name
      LEFT JOIN clubs c_away ON m.away_team = c_away.name
      WHERE m.division = ?
      ORDER BY m.matchday ASC, m.date ASC
    `).all(division);

    const lastUpdate = db.prepare("SELECT value FROM metadata WHERE key = 'last_update'").get() as { value: string } | undefined;

    res.json({
      d1: { rankings: getRankings("d1"), matches: getMatches("d1") },
      d2: { rankings: getRankings("d2"), matches: getMatches("d2") },
      d3: { rankings: getRankings("d3"), matches: getMatches("d3") },
      d4: { rankings: getRankings("d4"), matches: getMatches("d4") },
      lastUpdate: lastUpdate?.value,
    });
  } catch (error) {
    console.error("Database query error:", error);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

async function refreshDivision(division: Division) {
  const [rawMatches, teamMap, allRankings] = await Promise.all([
    fetchMatchesFromAPI(division),
    fetchTeamsFromAPI(division),
    fetchStandingsFromAPI(division),
  ]);

  const rankingNameMap = new Map<number, string>();
  for (const r of allRankings) rankingNameMap.set((r as any).id, r.team);

  const allMatches = rawMatches.map(m => {
    const home = teamMap.get(m.home_team_id);
    const away = teamMap.get(m.away_team_id);
    return {
      matchday:   m.matchday,
      division,
      date:       m.date,
      time:       m.time,
      location:   m.location || "Terrain FFSE",
      home_team:  rankingNameMap.get(m.home_team_id) ?? home?.name ?? `Team#${m.home_team_id}`,
      away_team:  rankingNameMap.get(m.away_team_id) ?? away?.name ?? `Team#${m.away_team_id}`,
      home_logo:  home?.logo ?? null,
      away_logo:  away?.logo ?? null,
      score_home: m.score_home,
      score_away: m.score_away,
    };
  });

  const upsertMatch = db.prepare(`
    INSERT INTO matches (matchday, division, date, time, location, home_team, away_team, score_home, score_away, updated_at)
    VALUES (@matchday, @division, @date, @time, @location, @home_team, @away_team, @score_home, @score_away, CURRENT_TIMESTAMP)
    ON CONFLICT(matchday, division, home_team, away_team) DO UPDATE SET
      score_home = COALESCE(excluded.score_home, matches.score_home),
      score_away = COALESCE(excluded.score_away, matches.score_away),
      date       = excluded.date,
      time       = excluded.time,
      location   = excluded.location,
      updated_at = CURRENT_TIMESTAMP
  `);

  const insertRanking = db.prepare(`
    INSERT INTO rankings (team, division, played, won, drawn, lost, bonus, diff, points, updated_at)
    VALUES (@team, @division, @played, @won, @drawn, @lost, @bonus, @diff, @points, CURRENT_TIMESTAMP)
  `);

  const upsertClub = db.prepare(`
    INSERT INTO clubs (name, logo) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET
      logo = excluded.logo
    WHERE (clubs.logo IS NULL OR clubs.logo = '') AND excluded.logo IS NOT NULL AND excluded.logo != ''
  `);

  db.transaction(() => {
    // Sauvegarder positions actuelles avant MAJ
      const currentRankings = db.prepare(
        "SELECT team, points FROM rankings WHERE division = ? ORDER BY points DESC, diff DESC"
      ).all(division) as any[];
      
      if (currentRankings.length > 0) {
        const savedAt = new Date().toISOString();
        const saveHistory = db.prepare(`
          INSERT OR REPLACE INTO rankings_history (team, division, position, points, saved_at)
          VALUES (?, ?, ?, ?, ?)
        `);
        currentRankings.forEach((r, idx) => {
          saveHistory.run(r.team, division, idx + 1, r.points, savedAt);
        });
      } else {
        // Première MAJ — initialiser depuis J-1
        const allMatchesInDb = db.prepare(
          "SELECT * FROM matches WHERE division = ? AND score_home IS NOT NULL ORDER BY matchday ASC"
        ).all(division) as any[];
      
        if (allMatchesInDb.length > 0) {
          const maxMatchday = Math.max(...allMatchesInDb.map((m: any) => m.matchday));
          const prevMatches = allMatchesInDb.filter((m: any) => m.matchday < maxMatchday);
      
          if (prevMatches.length > 0) {
            // Calculer points par équipe à J-1
            const pointsMap = new Map<string, number>();
            for (const m of prevMatches) {
              const home = m.home_team;
              const away = m.away_team;
              if (!pointsMap.has(home)) pointsMap.set(home, 0);
              if (!pointsMap.has(away)) pointsMap.set(away, 0);
      
              if (m.score_home > m.score_away) {
                pointsMap.set(home, pointsMap.get(home)! + 4);
              } else if (m.score_away > m.score_home) {
                pointsMap.set(away, pointsMap.get(away)! + 4);
              } else {
                pointsMap.set(home, pointsMap.get(home)! + 2);
                pointsMap.set(away, pointsMap.get(away)! + 2);
              }
            }
      
            // Trier et sauvegarder comme historique J-1
            const sorted = Array.from(pointsMap.entries())
              .sort((a, b) => b[1] - a[1]);
      
            const savedAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // -7 jours
            const saveHistory = db.prepare(`
              INSERT OR REPLACE INTO rankings_history (team, division, position, points, saved_at)
              VALUES (?, ?, ?, ?, ?)
            `);
            sorted.forEach(([team, pts], idx) => {
              saveHistory.run(team, division, idx + 1, pts, savedAt);
            });
            console.log(`[history] ${division.toUpperCase()} initialisé depuis J${maxMatchday - 1}`);
          }
        }
      }

    for (const [id, team] of teamMap) {
      const canonicalName = rankingNameMap.get(id) ?? team.name;
      if (canonicalName && team.logo) upsertClub.run(canonicalName, team.logo);
    }
    for (const m of allMatches) {
      const { home_logo, away_logo, ...matchData } = m;
      upsertMatch.run(matchData);
    }
    if (allRankings.length > 0) {
      db.prepare("DELETE FROM rankings WHERE division = ?").run(division);
      for (const r of allRankings) insertRanking.run({ ...r, division });
    }
    db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_update', CURRENT_TIMESTAMP)").run();
  })();

  console.log(`[refresh] ${division.toUpperCase()} done — ${allMatches.length} matches, ${allRankings.length} teams`);
  return { allMatches, allRankings };
}

app.post("/admin/refresh", authenticateAdmin, async (req, res) => {
  try {
    const [d1Result, d2Result, d3Result, d4Result] = await Promise.all([
      refreshDivision("d1"),
      refreshDivision("d2"),
      refreshDivision("d3"),
      refreshDivision("d4"),
    ]);

    if ([d1Result, d2Result, d3Result, d4Result].every(r => r.allMatches.length === 0 && r.allRankings.length === 0)) {
      return res.status(500).json({ error: "API returned no data" });
    }

    writeBackupFile({
      saved_at: new Date().toISOString(),
      source: "wp-json REST API",
      d1: { rankings: d1Result.allRankings, matches: d1Result.allMatches },
      d2: { rankings: d2Result.allRankings, matches: d2Result.allMatches },
      d3: { rankings: d3Result.allRankings, matches: d3Result.allMatches },
      d4: { rankings: d4Result.allRankings, matches: d4Result.allMatches },
    });

    res.json({
      success: true,
      count: {
        d1: { matches: d1Result.allMatches.length, rankings: d1Result.allRankings.length },
        d2: { matches: d2Result.allMatches.length, rankings: d2Result.allRankings.length },
        d3: { matches: d3Result.allMatches.length, rankings: d3Result.allRankings.length },
        d4: { matches: d4Result.allMatches.length, rankings: d4Result.allRankings.length },
      },
    });
  } catch (error: any) {
    console.error("[refresh] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/admin/reset-history", authenticateAdmin, (req, res) => {
  try {
    db.prepare("DELETE FROM rankings_history").run();
    res.json({ success: true, message: "History cleared" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/admin/reset-db", authenticateAdmin, (req, res) => {
  try {
    db.prepare("DELETE FROM matches").run();
    db.prepare("DELETE FROM rankings").run();
    db.prepare("DELETE FROM rankings_history").run();
    db.prepare("DELETE FROM metadata").run();
    res.json({ success: true, message: "Database cleared" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/admin/debug-fetch", authenticateAdmin, async (req, res) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) return res.status(400).json({ error: "Missing url parameter" });
  try {
    const response = await fetch(targetUrl, {
      headers: { "Accept": "application/json, text/html", "Accept-Language": "fr-FR,fr;q=0.9" },
    });
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json")
      ? await response.json()
      : { raw: (await response.text()).substring(0, 600) };
    res.json({ status: response.status, finalUrl: targetUrl, body });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/debug-html", async (req, res) => {
  try {
    const response = await fetch(`${FFSE_BASE}/sportspress/v2/tables/11807`);
    res.json({ status: response.status, data: await response.json() });
  } catch (error: any) {
    res.status(500).send(error.message);
  }
});

app.all("/api/*", (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.url}` });
});

// Lundi à 12h GMT+1
cron.schedule("0 12 * * 1", async () => {
  console.log("[cron] MAJ automatique du lundi...");
  try {
    await Promise.all([
      refreshDivision("d1"),
      refreshDivision("d2"),
      refreshDivision("d3"),
      refreshDivision("d4"),
    ]);
    console.log("[cron] MAJ terminée avec succès");
  } catch (err) {
    console.error("[cron] Erreur lors de la MAJ:", err);
  }
}, { timezone: "Europe/Paris" });

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
