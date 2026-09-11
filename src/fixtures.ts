import type { Record } from './graph.ts';

/**
 * Households with shared devices and addresses, and KNOWN person ids.
 *
 * The households are the point. Two people at one address with a shared family
 * tablet and similar names are exactly the pair a probabilistic matcher
 * collapses into one profile, and the reason precision matters more than
 * recall here.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['James', 'Jamie', 'Sarah', 'Sara', 'Michael', 'Michaela',
               'Priya', 'Pria', 'Tom', 'Thomas', 'Anna', 'Hannah'];
const LAST = ['Okafor', 'Whitfield', 'Nakamura', 'Silva', 'Brennan',
              'Kowalski', 'Adeyemi', 'Lindqvist'];

export interface Fixture {
  records: Record[];
  /** person id -> the record ids that genuinely belong to them. */
  truth: Map<number, number[]>;
  households: Map<string, number[]>;
}

export function buildFixture(
  households = 400, seed = 20260911,
): Fixture {
  const rnd = mulberry32(seed);
  const records: Record[] = [];
  const truth = new Map<number, number[]>();
  const byHousehold = new Map<string, number[]>();

  let recordId = 1;
  let personId = 1;

  for (let h = 0; h < households; h++) {
    const postcode = `PC${String(h % 220).padStart(4, '0')}`;
    const surname = LAST[Math.floor(rnd() * LAST.length)]!;
    const deviceId = `dev-${h}`;
    const members = 1 + (rnd() < 0.55 ? 1 : 0);

    for (let m = 0; m < members; m++) {
      const person = personId++;
      const first = FIRST[Math.floor(rnd() * FIRST.length)]!;
      const name = `${first} ${surname}`;
      const email = `${first.toLowerCase()}.${surname.toLowerCase()}${person}@example.com`;
      const loyalty = rnd() < 0.7 ? `LOY${person}` : null;
      const phone = rnd() < 0.5 ? `ph-${person}` : null;
      const ids: number[] = [];

      // Each person appears in several source systems.
      const sources = ['web', 'app', 'instore', 'email']
        .filter(() => rnd() < 0.75);
      if (sources.length === 0) sources.push('web');

      for (const source of sources) {
        // Not every system holds every identifier: that is why probabilistic
        // matching exists at all.
        const holdsEmail = source !== 'instore' || rnd() < 0.4;
        const holdsLoyalty = source === 'instore' || rnd() < 0.5;
        // The household device is shared - the trap.
        const holdsDevice = (source === 'web' || source === 'app')
          && rnd() < 0.8;

        records.push({
          id: recordId,
          source,
          email: holdsEmail ? email : null,
          loyalty_id: holdsLoyalty ? loyalty : null,
          phone_hash: rnd() < 0.5 ? phone : null,
          device_id: holdsDevice ? deviceId : null,
          full_name: name,
          postcode,
          true_person: person,
        });
        ids.push(recordId);
        recordId++;
      }

      truth.set(person, ids);
      const list = byHousehold.get(postcode) ?? [];
      list.push(person);
      byHousehold.set(postcode, list);
    }
  }

  return { records, truth, households: byHousehold };
}

/** Person ids that share an address with someone else. */
export function householdPairs(fixture: Fixture): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const people of fixture.households.values()) {
    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        out.push([people[i]!, people[j]!]);
      }
    }
  }
  return out;
}
