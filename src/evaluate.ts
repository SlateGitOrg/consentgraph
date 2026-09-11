import { DatabaseSync } from 'node:sqlite';
import { profileFor, type Purpose } from './graph.ts';
import type { Fixture } from './fixtures.ts';

/**
 * Precision, recall, and the metric that actually matters here.
 *
 * Measured over PAIRS: for every pair of records the resolver puts in the same
 * profile, do they genuinely belong to the same person?
 *
 * Household confusion is broken out separately because it is not just another
 * false positive. Merging two strangers produces a slightly wrong audience;
 * merging two people who live together means somebody sees their partner's
 * purchase history, and that is the failure that ends up in a newspaper.
 */

export interface Quality {
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly householdConfusions: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

export function evaluate(
  db: DatabaseSync, fixture: Fixture, purpose: Purpose,
): Quality {
  const personOf = new Map<number, number>();
  for (const r of fixture.records) personOf.set(r.id, r.true_person);

  const sameHousehold = new Map<number, string>();
  for (const r of fixture.records) sameHousehold.set(r.id, r.postcode ?? '');

  const seenPair = new Set<string>();
  let truePositives = 0;
  let falsePositives = 0;
  let householdConfusions = 0;

  for (const r of fixture.records) {
    const profile = profileFor(db, r.id, purpose);
    for (const other of profile) {
      if (other === r.id) continue;
      const key = r.id < other ? `${r.id}:${other}` : `${other}:${r.id}`;
      if (seenPair.has(key)) continue;
      seenPair.add(key);

      if (personOf.get(r.id) === personOf.get(other)) {
        truePositives++;
      } else {
        falsePositives++;
        if (sameHousehold.get(r.id) === sameHousehold.get(other)) {
          householdConfusions++;
        }
      }
    }
  }

  // Every within-person pair that SHOULD have been linked.
  let shouldLink = 0;
  for (const ids of fixture.truth.values()) {
    shouldLink += (ids.length * (ids.length - 1)) / 2;
  }
  const falseNegatives = Math.max(0, shouldLink - truePositives);

  const precision = truePositives + falsePositives > 0
    ? truePositives / (truePositives + falsePositives) : 1;
  const recall = shouldLink > 0 ? truePositives / shouldLink : 1;
  const f1 = precision + recall > 0
    ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    truePositives, falsePositives, falseNegatives, householdConfusions,
    precision, recall, f1,
  };
}

export interface ThresholdRow {
  threshold: number;
  precision: number;
  recall: number;
  householdConfusions: number;
}

/** The precision floor this project commits to. */
export const PRECISION_FLOOR = 0.99;
