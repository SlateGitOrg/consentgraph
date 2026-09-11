# consentgraph

> Identity resolution where consent gates the join itself, measured on precision because a false merge is the expensive error.

`FLAGSHIP` · **Marketing Analyst** · Advanced · ~4-5 weeks · Retail - omnichannel loyalty

**Primary language:** TypeScript
**Tags:** `identity-resolution`, `consent`, `privacy`, `postgres`, `sql`, `entity-matching`

---

## The problem

A retailer wants one view of the customer across web, app, in-store card and email. Probabilistic matching will happily merge two people in the same household onto one profile - so somebody receives marketing based on a relative's browsing, or worse, sees their purchase history. Separately, consent granted for email cannot lawfully justify an ad-platform audience match, yet the same resolved profile feeds both.

## ⭐ The differentiator

**Consent state is a first-class edge property that gates the join itself**, so an identity link created from data the customer did not consent to share across contexts is never traversable for that purpose - rather than the common pattern of resolving everything and filtering at send time, by which point the unlawful inference has already been made. Match quality is measured as **precision against planted ground truth with an explicit precision floor**, because in identity resolution a false merge is far more damaging than a missed one.

This is the sentence to lead with when someone asks you to walk through the
project. Everything else in this repo exists to make it true and to prove it.

## Data

A documented synthetic generator producing households with shared devices and addresses, **known true person IDs**, realistic name and address noise, and per-purpose consent states - so precision, recall and a household-confusion rate are all measurable.

> No paid API key is required to run or demo this project. Where a paid
> service would add value it is wired as an optional enhancement behind an
> interface with an offline mock as the default implementation.

## Stack

- TypeScript, Node
- PostgreSQL: recursive CTEs for graph traversal, pg_trgm for fuzzy matching
- Splink (Python) for probabilistic scoring
- Docker, Vitest

## Core capabilities

- Deterministic linking (email, loyalty ID, hashed phone) plus probabilistic scoring with a tunable threshold
- Consent ledger with per-purpose, per-jurisdiction state and full history
- Purpose-scoped graph traversal - the same graph yields different profiles for different purposes
- Precision and recall reported at each threshold, plus a dedicated household-confusion metric
- Erasure and consent-withdrawal propagation that un-links rather than flags

## Repository layout

```
src/resolve/
src/consent/
db/migrations/
generator/
test/precision/
```

## Build plan

1. Generator with households, shared devices and known person IDs. Household confusion is the failure you must be able to measure.
2. Deterministic linking first, then probabilistic - and always report both separately.
3. Consent as an edge property from the start. Retrofitting consent onto a resolved graph does not work and the README should say why.
4. Threshold tuning against the precision floor last.

## Testing strategy

Assert **precision at or above 0.99** at the chosen threshold against ground truth, with the household-confusion rate reported separately. Assert that a withdrawn consent makes the corresponding edge untraversable for that purpose **within the same transaction** - not on the next batch run, which is the gap where unlawful sends happen.

Tests assert **correctness**, not merely that the code runs. A green suite on
this repo is a claim about behaviour under adversarial conditions; treat any
test that would pass against a deliberately broken implementation as a bug in
the test.

## Quality & safety layer

Purpose scoping is enforced at traversal, so an audience built for one purpose cannot borrow links justified by another. Consent withdrawal is transactional.

## Measurable outcome

> Single customer view at 99.2% precision with zero household false-merges, and every downstream audience provably built only from consented links.

State it in these terms — business units, not technical ones — in your CV
bullet and in the first thirty seconds of describing the project.

## Interview questions this project answers

- **Why is precision more important than recall in identity resolution?**
- **How do you prevent a household from collapsing into one person?**
- **Where does consent belong in a data model?**

## What this deliberately is *not*

- Not a CDP. It solves the resolution-and-consent problem and exposes it over an API.
- Not a deterministic-only matcher - the point is handling probabilistic links responsibly.


## Run it now

```bash
npm test        # runs the suite; no install step needed
npm run demo    # the 60-second artefact
```

Requires Node 22.6+ (24 recommended). TypeScript runs natively via
type stripping - there is no build step and no `node_modules`.

## Getting started

```bash
git clone <your-fork-url> consentgraph
cd consentgraph
docker compose up -d
npm install
npm run generate              # households + known person IDs
npm run resolve
npm run test:precision        # >= 0.99, household confusion reported
```

Docker is supported but optional — every path above works on a plain
Windows/macOS/Linux laptop without a cloud account.

## Definition of done

- [ ] The differentiator above is implemented, and a test proves it
- [ ] The measurable outcome is produced by a command anyone can run
- [ ] `README` explains the one decision a generic version gets wrong
- [ ] CI runs the full suite on every push and is green on `main`
- [ ] A recruiter can see the headline artefact in under 60 seconds

## Licence

MIT — see [LICENSE](LICENSE).
