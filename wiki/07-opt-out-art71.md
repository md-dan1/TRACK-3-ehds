---
id: opt-out
title: Right to opt out (Art. 71)
articles: [71]
source: sources/art71.md
---

# Right to opt out – Art. 71

- People may opt out of secondary use **at any time, without giving a reason**, and may reverse it (Art. 71(1)).
- Once someone has opted out, their data **must not be made available or processed** under data
  permits or health data requests approved **after** the opt-out (Art. 71(3)).
- Permits and requests approved **before** the opt-out are not affected (Art. 71(3), second subparagraph).
- Member States *may* create an exception for public-sector public-health uses under strict conditions (Art. 71(4)).

## How the app applies it

- Patients with `opted_out = true` are excluded from **every** count, denominator, mean, cohort
  and SPE copy. Exclusion happens before anything else, inside each hospital node.
- The prototype does not implement the Art. 71(4) exception. No request can override opt-outs.
- The prototype has no history of opt-out dates, so the current flag is applied to every new decision.
- Staff see how many opted-out patients were excluded per hospital. Applicants do not.

Citing `71` in an approval is allowed but optional.
