import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  EDGE_PURPOSES, PURPOSES, audienceFor, createDatabase, generateCandidates,
  hasConsent, loadGraph, profileFor, setConsent, similarity,
  type Purpose,
} from '../src/graph.ts';
import { buildFixture, householdPairs } from '../src/fixtures.ts';
import { PRECISION_FLOOR, evaluate } from '../src/evaluate.ts';

const FIXTURE = buildFixture(300, 20260911);

function build(threshold = 0.85) {
  const db = createDatabase();
  loadGraph(db, FIXTURE.records, generateCandidates(FIXTURE.records), threshold);
  return db;
}

describe('precision against planted person ids', () => {
  test('THE FLOOR: marketing purposes hold precision at or above 0.99', () => {
    const db = build();
    for (const purpose of ['email_marketing', 'ad_platform_match'] as Purpose[]) {
      const q = evaluate(db, FIXTURE, purpose);
      assert.ok(
        q.precision >= PRECISION_FLOOR,
        `${purpose}: precision ${q.precision.toFixed(4)} is below the ` +
        `${PRECISION_FLOOR} floor (${q.falsePositives} false merges)`,
      );
    }
    db.close();
  });

  test('THE METRIC THAT MATTERS: zero household confusions for marketing', () => {
    // A false merge between strangers is a slightly wrong audience. A false
    // merge between two people who live together means somebody sees their
    // partner's purchase history.
    const db = build();
    for (const purpose of ['email_marketing', 'ad_platform_match'] as Purpose[]) {
      const q = evaluate(db, FIXTURE, purpose);
      assert.equal(
        q.householdConfusions, 0,
        `${purpose}: ${q.householdConfusions} household members were merged`,
      );
    }
    db.close();
  });

  test('recall is still useful - this is not achieved by linking nothing', () => {
    const db = build();
    const q = evaluate(db, FIXTURE, 'email_marketing');
    assert.ok(q.recall > 0.5,
      `recall ${q.recall.toFixed(3)}: perfect precision by refusing to link ` +
      `anything is not a resolver`);
    assert.ok(q.truePositives > 100);
    db.close();
  });

  test('the fixture genuinely contains households, or the test proves nothing', () => {
    const pairs = householdPairs(FIXTURE);
    assert.ok(pairs.length > 50,
      `only ${pairs.length} household pairs - the trap is not present`);
    db_close_noop();
  });
});

function db_close_noop() { /* fixture-only assertion */ }

describe('purpose scoping changes what exists', () => {
  test('the SERVICE purpose can use household evidence', () => {
    const db = build();
    const service = evaluate(db, FIXTURE, 'service');
    const marketing = evaluate(db, FIXTURE, 'email_marketing');
    assert.ok(
      service.truePositives + service.falsePositives >
      marketing.truePositives + marketing.falsePositives,
      'service should link more, because more evidence is available to it',
    );
    db.close();
  });

  test('and it pays for that in precision - which is the trade, stated', () => {
    const db = build();
    const service = evaluate(db, FIXTURE, 'service');
    const marketing = evaluate(db, FIXTURE, 'email_marketing');
    assert.ok(service.precision <= marketing.precision);
    assert.ok(service.recall >= marketing.recall);
    db.close();
  });

  test('the same record yields DIFFERENT profiles for different purposes', () => {
    const db = build();
    let differing = 0;
    for (const r of FIXTURE.records.slice(0, 200)) {
      const service = profileFor(db, r.id, 'service').join(',');
      const email = profileFor(db, r.id, 'email_marketing').join(',');
      if (service !== email) differing++;
    }
    assert.ok(differing > 0,
      'if every purpose sees the same graph, consent is not gating anything');
    db.close();
  });

  test('probabilistic household evidence is never available to marketing', () => {
    for (const kind of
      ['PROBABILISTIC_NAME_ADDRESS', 'PROBABILISTIC_DEVICE'] as const) {
      assert.ok(!EDGE_PURPOSES[kind].includes('email_marketing'));
      assert.ok(!EDGE_PURPOSES[kind].includes('ad_platform_match'));
    }
  });

  test('phone evidence is not available for email marketing', () => {
    assert.ok(!EDGE_PURPOSES.DETERMINISTIC_PHONE.includes('email_marketing'));
    assert.ok(EDGE_PURPOSES.DETERMINISTIC_PHONE.includes('ad_platform_match'));
  });
});

describe('consent state', () => {
  test('a person with no recorded consent is not in the audience', () => {
    const db = build();
    assert.equal(audienceFor(db, 'email_marketing').length, 0,
      'consent must be opt-in, not assumed');
    db.close();
  });

  test('granting consent adds the person to that audience only', () => {
    const db = build();
    setConsent(db, 1, 'email_marketing', true, 1_000);
    assert.ok(audienceFor(db, 'email_marketing').length > 0);
    assert.equal(audienceFor(db, 'ad_platform_match').length, 0,
      'consent for one purpose is not consent for another');
    db.close();
  });

  test('WITHDRAWAL takes effect in the same transaction', () => {
    const db = build();
    setConsent(db, 1, 'email_marketing', true, 1_000);
    assert.equal(hasConsent(db, 1, 'email_marketing'), true);
    setConsent(db, 1, 'email_marketing', false, 2_000);
    assert.equal(
      hasConsent(db, 1, 'email_marketing'), false,
      'a withdrawal that takes effect on the next batch run is a gap where ' +
      'unlawful sends happen',
    );
    db.close();
  });

  test('the full consent history is retained', () => {
    const db = build();
    setConsent(db, 1, 'service', true, 1_000);
    setConsent(db, 1, 'service', false, 2_000);
    setConsent(db, 1, 'service', true, 3_000);
    const rows = db.prepare(
      'SELECT COUNT(*) n FROM consent WHERE person_id = 1').get() as
      { n: number };
    assert.equal(rows.n, 3, 'the history is the audit trail');
    assert.equal(hasConsent(db, 1, 'service'), true);
    db.close();
  });

  test('jurisdiction is recorded on every consent row', () => {
    const db = build();
    setConsent(db, 1, 'service', true, 1_000, 'UK');
    const row = db.prepare(
      'SELECT jurisdiction FROM consent WHERE person_id = 1').get() as
      { jurisdiction: string };
    assert.equal(row.jurisdiction, 'UK');
    db.close();
  });
});

describe('threshold behaviour', () => {
  test('lowering the threshold trades precision for recall', () => {
    const strict = build(0.95);
    const loose = build(0.62);
    const a = evaluate(strict, FIXTURE, 'service');
    const b = evaluate(loose, FIXTURE, 'service');
    assert.ok(b.recall >= a.recall);
    assert.ok(b.precision <= a.precision);
    strict.close();
    loose.close();
  });

  test('a loose threshold on SERVICE creates household confusions', () => {
    // Which is exactly why that evidence is unavailable to marketing.
    const loose = build(0.62);
    const q = evaluate(loose, FIXTURE, 'service');
    assert.ok(q.householdConfusions > 0);
    loose.close();
  });
});

describe('similarity', () => {
  test('identical names score 1', () => {
    assert.equal(similarity('Priya Okafor', 'Priya Okafor'), 1);
  });

  test('a near-miss scores high but below 1', () => {
    const s = similarity('Sarah Brennan', 'Sara Brennan');
    assert.ok(s > 0.8 && s < 1);
  });

  test('different names score low', () => {
    assert.ok(similarity('Priya Okafor', 'Tom Lindqvist') < 0.6);
  });

  test('household members with similar names are the hard case', () => {
    // James and Jamie Whitfield at one address: the pair that must not merge.
    assert.ok(similarity('James Whitfield', 'Jamie Whitfield') > 0.85);
  });
});
