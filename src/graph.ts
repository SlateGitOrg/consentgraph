import { DatabaseSync } from 'node:sqlite';

/**
 * Identity resolution where CONSENT GATES THE JOIN ITSELF.
 *
 * THE DIFFERENTIATOR LIVES HERE.
 *
 * The usual pattern resolves every identity it can, then filters at send time.
 * By then the unlawful inference has already been made: the profile that
 * merged a web session with a loyalty record on the strength of data the
 * customer never agreed to share across contexts now exists, and everything
 * downstream is built on it. Filtering the send does not un-know it.
 *
 * So consent is a property of the EDGE, and traversal is scoped by purpose. The
 * same graph yields a different profile for email than for ad-platform
 * matching, because the edges available to each are different.
 *
 * The second decision: this is measured on PRECISION with an explicit floor.
 * In identity resolution a false merge is far more damaging than a missed one -
 * a missed link means a slightly worse audience, a false merge means someone
 * sees their partner's purchase history. Optimising recall is how that happens.
 */

export type Purpose = 'email_marketing' | 'ad_platform_match' | 'service';
export const PURPOSES: readonly Purpose[] = [
  'email_marketing', 'ad_platform_match', 'service',
];

export type EdgeKind =
  | 'DETERMINISTIC_EMAIL'
  | 'DETERMINISTIC_LOYALTY'
  | 'DETERMINISTIC_PHONE'
  | 'PROBABILISTIC_NAME_ADDRESS'
  | 'PROBABILISTIC_DEVICE';

/** Which consent purposes each evidence type may be used for. */
export const EDGE_PURPOSES: Record<EdgeKind, readonly Purpose[]> = {
  // A shared login is service evidence and may be used for anything the
  // customer consented to.
  DETERMINISTIC_EMAIL: ['email_marketing', 'ad_platform_match', 'service'],
  DETERMINISTIC_LOYALTY: ['email_marketing', 'ad_platform_match', 'service'],
  DETERMINISTIC_PHONE: ['ad_platform_match', 'service'],
  // Household-level matching is exactly the evidence that merges two people,
  // so it is never available for marketing purposes.
  PROBABILISTIC_NAME_ADDRESS: ['service'],
  // A shared device is a household signal too - a family tablet is not a
  // person.
  PROBABILISTIC_DEVICE: ['service'],
};

export function createDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
CREATE TABLE record (
  id          INTEGER PRIMARY KEY,
  source      TEXT NOT NULL,        -- web | app | instore | email
  email       TEXT,
  loyalty_id  TEXT,
  phone_hash  TEXT,
  device_id   TEXT,
  full_name   TEXT,
  postcode    TEXT,
  -- GROUND TRUTH, never read by the resolver.
  true_person INTEGER NOT NULL
);

CREATE TABLE edge (
  a          INTEGER NOT NULL REFERENCES record(id),
  b          INTEGER NOT NULL REFERENCES record(id),
  kind       TEXT NOT NULL,
  score      REAL NOT NULL,
  PRIMARY KEY (a, b, kind)
);
CREATE INDEX idx_edge_a ON edge(a);

-- Consent, per person per purpose, with full history. The CURRENT state is
-- the row with the latest granted_at.
CREATE TABLE consent (
  person_id   INTEGER NOT NULL,
  purpose     TEXT NOT NULL,
  granted     INTEGER NOT NULL,
  jurisdiction TEXT NOT NULL DEFAULT 'EU',
  granted_at  INTEGER NOT NULL
);
CREATE INDEX idx_consent ON consent(person_id, purpose, granted_at);
`);
  return db;
}

export interface Record {
  id: number;
  source: string;
  email: string | null;
  loyalty_id: string | null;
  phone_hash: string | null;
  device_id: string | null;
  full_name: string | null;
  postcode: string | null;
  true_person: number;
}

/** Jaro-Winkler-ish similarity, enough to rank name candidates. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const s1 = a.toLowerCase();
  const s2 = b.toLowerCase();
  const longer = s1.length >= s2.length ? s1 : s2;
  const shorter = s1.length >= s2.length ? s2 : s1;
  if (longer.length === 0) return 1;

  let matches = 0;
  const window = Math.max(0, Math.floor(longer.length / 2) - 1);
  const used = new Array(longer.length).fill(false);
  for (let i = 0; i < shorter.length; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(longer.length, i + window + 1);
    for (let j = start; j < end; j++) {
      if (!used[j] && longer[j] === shorter[i]) {
        used[j] = true;
        matches++;
        break;
      }
    }
  }
  return matches / longer.length;
}

export interface Candidate {
  a: number;
  b: number;
  kind: EdgeKind;
  score: number;
}

/**
 * Generate candidate links.
 *
 * Deterministic links come from shared strong identifiers. Probabilistic links
 * come from name plus postcode, which is precisely the evidence that merges
 * two people in the same household - hence its restriction above.
 */
export function generateCandidates(records: Record[]): Candidate[] {
  const out: Candidate[] = [];

  const index = <K extends keyof Record>(key: K) => {
    const map = new Map<unknown, number[]>();
    for (const r of records) {
      const value = r[key];
      if (value === null || value === undefined || value === '') continue;
      const list = map.get(value) ?? [];
      list.push(r.id);
      map.set(value, list);
    }
    return map;
  };

  const deterministic: Array<[keyof Record, EdgeKind]> = [
    ['email', 'DETERMINISTIC_EMAIL'],
    ['loyalty_id', 'DETERMINISTIC_LOYALTY'],
    ['phone_hash', 'DETERMINISTIC_PHONE'],
    ['device_id', 'PROBABILISTIC_DEVICE'],
  ];
  for (const [key, kind] of deterministic) {
    for (const ids of index(key).values()) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          out.push({
            a: ids[i]!, b: ids[j]!, kind,
            score: kind.startsWith('DETERMINISTIC') ? 1.0 : 0.55,
          });
        }
      }
    }
  }

  // Probabilistic: blocked on postcode so this stays tractable.
  const byPostcode = new Map<string, Record[]>();
  for (const r of records) {
    if (!r.postcode) continue;
    const list = byPostcode.get(r.postcode) ?? [];
    list.push(r);
    byPostcode.set(r.postcode, list);
  }
  for (const block of byPostcode.values()) {
    for (let i = 0; i < block.length; i++) {
      for (let j = i + 1; j < block.length; j++) {
        const a = block[i]!;
        const b = block[j]!;
        if (!a.full_name || !b.full_name) continue;
        const score = similarity(a.full_name, b.full_name);
        if (score >= 0.6) {
          out.push({
            a: a.id, b: b.id, kind: 'PROBABILISTIC_NAME_ADDRESS', score,
          });
        }
      }
    }
  }
  return out;
}

export function loadGraph(
  db: DatabaseSync, records: Record[], candidates: Candidate[],
  threshold: number,
): void {
  const r = db.prepare(
    `INSERT INTO record (id, source, email, loyalty_id, phone_hash, device_id,
                         full_name, postcode, true_person)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const x of records) {
    r.run(x.id, x.source, x.email, x.loyalty_id, x.phone_hash, x.device_id,
          x.full_name, x.postcode, x.true_person);
  }
  const e = db.prepare(
    'INSERT OR IGNORE INTO edge (a, b, kind, score) VALUES (?, ?, ?, ?)');
  for (const c of candidates) {
    if (c.score < threshold) continue;
    const [lo, hi] = c.a < c.b ? [c.a, c.b] : [c.b, c.a];
    e.run(lo, hi, c.kind, c.score);
  }
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

export function setConsent(
  db: DatabaseSync, personId: number, purpose: Purpose, granted: boolean,
  at: number, jurisdiction = 'EU',
): void {
  db.prepare(
    `INSERT INTO consent (person_id, purpose, granted, jurisdiction, granted_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(personId, purpose, granted ? 1 : 0, jurisdiction, at);
}

export function hasConsent(
  db: DatabaseSync, personId: number, purpose: Purpose,
): boolean {
  const row = db.prepare(
    `SELECT granted FROM consent
      WHERE person_id = ? AND purpose = ?
      ORDER BY granted_at DESC LIMIT 1`,
  ).get(personId, purpose) as { granted: number } | undefined;
  return row?.granted === 1;
}

/**
 * Purpose-scoped traversal.
 *
 * The edge kinds available depend on the purpose, so the connected component
 * differs. This is the whole design: the graph is not resolved once and
 * filtered later.
 */
export function profileFor(
  db: DatabaseSync, recordId: number, purpose: Purpose,
): number[] {
  const kinds = (Object.keys(EDGE_PURPOSES) as EdgeKind[])
    .filter((k) => EDGE_PURPOSES[k].includes(purpose));
  if (kinds.length === 0) return [recordId];

  const placeholders = kinds.map(() => '?').join(', ');
  const rows = db.prepare(`
WITH RECURSIVE reachable(id) AS (
  SELECT ?
  UNION
  SELECT CASE WHEN e.a = r.id THEN e.b ELSE e.a END
    FROM reachable r
    JOIN edge e ON (e.a = r.id OR e.b = r.id)
   WHERE e.kind IN (${placeholders})
)
SELECT id FROM reachable ORDER BY id
  `).all(recordId, ...kinds) as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

/** The audience for a purpose: only records whose person consented. */
export function audienceFor(
  db: DatabaseSync, purpose: Purpose,
): number[] {
  const all = db.prepare('SELECT id, true_person FROM record ORDER BY id')
    .all() as Array<{ id: number; true_person: number }>;
  return all
    .filter((r) => hasConsent(db, r.true_person, purpose))
    .map((r) => r.id);
}
