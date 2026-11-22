import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

/* One blob per player per major version.
 *
 * Only a player writes their own key, so there is no shared counter here and
 * no read-modify-write race between people. Reading the board is a list plus
 * a parallel get of each key, which is fine at the scale this is built for
 * and avoids keeping an aggregate blob that everyone would have to update.
 *
 * Scores are keyed under the game's MAJOR version, so a rebalance starts a
 * clean table instead of leaving old runs sitting on top of it forever. */

/* Blobs default to eventual consistency: a write is durable at once, but the
 * key listing can take up to a minute to catch up. That meant a player's own
 * POST read back a board that did not yet contain the run it had just
 * written, so the board came back empty straight after a run and only filled
 * in later. Strong consistency costs a slower read and is worth it for a
 * handful of rows fetched once per menu. */
const STORE = { name: "voidrunner-scores", consistency: "strong" as const };
const MAX_ROWS = 200;
const NAME_MAX = 14;

type Row = {
  name: string;
  wave: number;
  score: number;
  ship: string;
  at: number;
};

/* FAE is one player's own hull. It has to be listed here or the server
 * would quietly coerce her runs to BLUE on the board - the same kind of
 * client/server mismatch that rejected every insanity wave. */
const SHIPS = ["YELLOW", "BLUE", "RED", "GREEN", "ORANGE", "PURPLE", "FAE"];

/* Everything below comes off the public internet, so none of it is trusted. */
function cleanName(v: unknown): string {
  const s = String(v ?? "").toUpperCase().replace(/[^A-Z0-9 _.-]/g, "").trim();
  return s.slice(0, NAME_MAX) || "ANON";
}
function cleanInt(v: unknown, lo: number, hi: number): number | null {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < lo || n > hi) return null;
  return n;
}
function cleanId(v: unknown): string | null {
  const s = String(v ?? "");
  return /^[a-z0-9]{6,32}$/.test(s) ? s : null;
}
function cleanMajor(v: unknown): string {
  const s = String(v ?? "1").replace(/[^0-9]/g, "");
  return s.slice(0, 4) || "1";
}

/* A run only counts if it beats what that player already has: further wave
 * first, then higher score on the same wave. */
function better(next: Row, prev: Row | null): boolean {
  if (!prev) return true;
  if (next.wave !== prev.wave) return next.wave > prev.wave;
  return next.score > prev.score;
}

async function readBoard(major: string) {
  const store = getStore(STORE);
  const prefix = `v${major}/`;
  const { blobs } = await store.list({ prefix });
  const rows = await Promise.all(
    blobs.slice(0, MAX_ROWS).map(async (b) => {
      const row = (await store.get(b.key, { type: "json" })) as Row | null;
      return row ? { ...row, id: b.key.slice(prefix.length) } : null;
    })
  );
  return rows
    .filter((r): r is Row & { id: string } => r !== null)
    .sort((a, b) => (b.wave - a.wave) || (b.score - a.score) || (a.at - b.at));
}

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const major = cleanMajor(url.searchParams.get("v"));
    try {
      return Response.json({ ok: true, rows: await readBoard(major) });
    } catch (err) {
      console.error("board read failed", err);
      return Response.json({ ok: false, error: "read failed" }, { status: 500 });
    }
  }

  if (req.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return Response.json({ ok: false, error: "bad json" }, { status: 400 });
    }

    const id = cleanId(body.id);
    /* Waves do not stop at 100 any more: clearing it opens insanity and the
     * count carries on without a ceiling. This bound was still 1-100, so
     * every single insanity run was rejected outright with a 400 and the
     * player kept only the 100 banked at the gate. The bounds here exist to
     * throw out garbage, not to encode the game's rules, so they are now
     * generous enough that the game can never outgrow them again. */
    const wave = cleanInt(body.wave, 1, 100_000);
    const score = cleanInt(body.score, 0, 1_000_000_000);
    const major = cleanMajor(body.v);
    if (!id || wave === null || score === null) {
      return Response.json({ ok: false, error: "bad score" }, { status: 400 });
    }

    const row: Row = {
      name: cleanName(body.name),
      wave,
      score,
      ship: SHIPS.includes(String(body.ship)) ? String(body.ship) : "BLUE",
      at: Date.now(),
    };

    try {
      const store = getStore(STORE);
      const key = `v${major}/${id}`;
      const prev = (await store.get(key, { type: "json" })) as Row | null;
      /* Keep the better run. A name is who you are, so it follows you onto
       * whatever run is on the board; a hull belongs to the run that earned
       * the place, so repainting and then posting a WORSE run must not
       * recolour the record that is still standing. The colour changes when,
       * and only when, a better run replaces it. */
      if (better(row, prev)) {
        await store.setJSON(key, row);
      } else if (prev && prev.name !== row.name) {
        await store.setJSON(key, { ...prev, name: row.name });
      }
      return Response.json({ ok: true, rows: await readBoard(major) });
    } catch (err) {
      console.error("score write failed", err);
      return Response.json({ ok: false, error: "write failed" }, { status: 500 });
    }
  }

  return Response.json({ ok: false, error: "method" }, { status: 405 });
};

export const config: Config = {
  path: "/api/scores",
  method: ["GET", "POST"],
};
