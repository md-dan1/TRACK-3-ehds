---
id: patient-level-justification
title: When are pseudonymised records justified? (Art. 66, 68)
articles: [66, 68, 73]
source: [sources/art66.md, sources/art68.md]
---

# When are pseudonymised records justified? – Art. 66 and 68

Only for **health data access applications** that are not prohibited. Output:
`justifies_patient_level: true|false` with a quote in `justification_evidence`.

## The legal test

- Art. 66(2): provide **anonymised** data where the purpose can be achieved with them.
- Art. 66(3): provide **pseudonymised** data only where the user has **sufficiently demonstrated**
  that the purpose cannot be achieved with anonymised data.
- Art. 68(1)(c): a data permit for pseudonymised data needs "sufficient justification that the
  purpose cannot be achieved with anonymised data".
- Art. 67(2)(e): the application itself must contain that justification.

So the question is: **does the application explain why aggregate statistics would not answer
it, and is that explanation plausible for the stated purpose?**

## `true` – patient-level data are needed

The purpose needs individual rows, histories or linkage over time that a table of counts,
percentages and means cannot provide:
- Training, validating or testing a **prediction model / AI / algorithm** on individual patients.
- **Longitudinal or survival analysis**: time-to-event, trajectories, sequences of treatments.
- Multivariable **regression** with individual covariates, propensity scores, causal inference.
- Developing or validating a **phenotype definition** or a risk score.
- Studying **treatment pathways** (which drug follows which) at patient level.

And the application **says so**, e.g. "the survival model needs each patient's follow-up time;
grouped counts cannot provide this".

## `false` – statistics are enough

- The question itself is a **table**: counts, shares or means per group, prevalence by region,
  % on a drug by age band. Wanting records to compute it yourself is not a justification.
- The purpose is **teaching, reporting, policy planning or describing** how common something is.
- No justification is given at all, or only "we prefer raw data", "more flexibility",
  "we want to do our own analysis" with no specific method that requires rows.
- The stated method is descriptive even though records were requested.

## Tie-breakers

- An explicit justification that is **implausible** for the question (claims a model, but the
  question and definitions only ask for a count per region) → `false`, flag for staff.
- A plausible method-based need that is **not** spelled out but obvious (e.g. "we train a model")
  → `true`. The method itself shows aggregates cannot work.
- When unsure → `false`. Anonymised data are the legal default and the applicant can reapply.

## What `true` leads to

`APPROVE_SPE` with articles 53, 66, 68, 73. The app then copies only the cohort and the record
types named in the request into the SPE (data minimisation, Art. 66(1); permit content,
Art. 68(10)(a)) and reports the exact cohort size.

## What `false` leads to

`APPROVE_STATISTICAL` with articles 53, 66, 69. The reason must say plainly that records were
requested but statistics answer the question, so pseudonymised records are not justified.
