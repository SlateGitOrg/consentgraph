/**
 * The 60-second artefact: one graph, three purposes, three profiles.
 * Run: `npm run demo`
 */
import {
  EDGE_PURPOSES, PURPOSES, createDatabase, generateCandidates, hasConsent,
  loadGraph, profileFor, setConsent, type EdgeKind, type Purpose,
} from './graph.ts';
import { buildFixture, householdPairs } from './fixtures.ts';
import { PRECISION_FLOOR, evaluate } from './evaluate.ts';

const fixture = buildFixture(300, 20260911);
const db = createDatabase();
const candidates = generateCandidates(fixture.records);
loadGraph(db, fixture.records, candidates, 0.85);

console.log('\n  CONSENTGRAPH - the same graph, three different profiles');
console.log('  ' + '='.repeat(76));
console.log(`  ${fixture.records.length.toLocaleString()} source records, ` +
            `${fixture.truth.size.toLocaleString()} real people, ` +
            `${householdPairs(fixture).length} household pairs.`);
console.log(`  ${candidates.length.toLocaleString()} candidate links generated.\n`);

console.log('  WHICH EVIDENCE EACH PURPOSE MAY USE');
console.log('  ' + '-'.repeat(76));
console.log(`  ${'evidence'.padEnd(30)}${'email'.padEnd(9)}` +
            `${'ad match'.padEnd(11)}service`);
for (const kind of Object.keys(EDGE_PURPOSES) as EdgeKind[]) {
  const allowed = EDGE_PURPOSES[kind];
  const mark = (p: Purpose) => (allowed.includes(p) ? 'yes' : '-');
  console.log(`  ${kind.padEnd(30)}${mark('email_marketing').padEnd(9)}` +
              `${mark('ad_platform_match').padEnd(11)}${mark('service')}`);
}
console.log('\n  Household evidence - shared address, shared device - is');
console.log('  available to service only. It is precisely the evidence that');
console.log('  merges two people who live together.\n');

console.log('  MATCH QUALITY BY PURPOSE');
console.log('  ' + '-'.repeat(76));
console.log(`  ${'purpose'.padEnd(20)}${'precision'.padEnd(12)}` +
            `${'recall'.padEnd(10)}${'links'.padEnd(9)}household confusions`);
for (const purpose of PURPOSES) {
  const q = evaluate(db, fixture, purpose);
  const flag = q.precision >= PRECISION_FLOOR ? '' : '  <- BELOW FLOOR';
  console.log(`  ${purpose.padEnd(20)}${q.precision.toFixed(4).padEnd(12)}` +
              `${q.recall.toFixed(3).padEnd(10)}` +
              `${String(q.truePositives + q.falsePositives).padEnd(9)}` +
              `${q.householdConfusions}${flag}`);
}
console.log(`\n  Floor for marketing purposes: precision >= ${PRECISION_FLOOR}, ` +
            'household confusions = 0.');
console.log('  Service resolves more and is less precise. That is the trade,');
console.log('  and it is stated rather than averaged away.\n');

// One record, three purposes.
const sample = fixture.records.find(
  (r) => profileFor(db, r.id, 'service').length >
         profileFor(db, r.id, 'email_marketing').length)!;
console.log(`  ONE RECORD (id ${sample.id}, ${sample.full_name}, ` +
            `${sample.postcode})`);
console.log('  ' + '-'.repeat(76));
for (const purpose of PURPOSES) {
  const profile = profileFor(db, sample.id, purpose);
  const people = new Set(
    profile.map((id) => fixture.records.find((r) => r.id === id)!.true_person));
  console.log(`    ${purpose.padEnd(20)}${profile.length} records, ` +
              `${people.size} real ${people.size === 1 ? 'person' : 'people'}`);
}
console.log('    The service profile spans two people in one household. That');
console.log('    is correct for a service lookup and unlawful for marketing,');
console.log('    and the difference is enforced at traversal - not at send.\n');

console.log('  CONSENT');
console.log('  ' + '-'.repeat(76));
const person = sample.true_person;
console.log(`    person ${person}, no recorded consent:`);
for (const purpose of PURPOSES) {
  console.log(`      ${purpose.padEnd(20)}${hasConsent(db, person, purpose)}`);
}
setConsent(db, person, 'email_marketing', true, 1_000);
console.log(`    after granting email_marketing:`);
for (const purpose of PURPOSES) {
  console.log(`      ${purpose.padEnd(20)}${hasConsent(db, person, purpose)}`);
}
setConsent(db, person, 'email_marketing', false, 2_000);
console.log(`    after withdrawal, same transaction:`);
console.log(`      email_marketing     ` +
            `${hasConsent(db, person, 'email_marketing')}`);
console.log('    A withdrawal that takes effect on the next nightly batch is');
console.log('    a window in which unlawful sends happen.\n');
db.close();
