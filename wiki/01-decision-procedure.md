---
id: decision-procedure
title: Decision procedure
articles: [53, 54, 66, 68, 69, 73]
load: always
---

# Decision procedure

The access body decides every request in this fixed order. Stop at the first step that applies.

| Step | Condition | Decision | Articles to cite |
|---|---|---|---|
| 1 | The purpose, the question or the intended use is a **prohibited use** under Art. 54 (see page 03) | `REJECT` | `54` |
| 2 | `requested_as` is **"health data request"** (applicant wants anonymised statistics) | `APPROVE_STATISTICAL` | `53`, `69` |
| 3 | `requested_as` is **"health data access application"** and the applicant **sufficiently explains why anonymised statistics are not enough** (see page 05) | `APPROVE_SPE` | `53`, `66`, `68`, `73` |
| 4 | Any other health data access application | `APPROVE_STATISTICAL` | `53`, `66`, `69` |

Adding `67` (contents of an access application) or `71` (opt-out) to an approval is acceptable but not required. Do not add other articles.

## Why this order

- **Step 1 first.** A prohibited use is refused whatever the format. Pseudonymised records
  for a prohibited use are refused just like statistics for it. Art. 54 applies to "seeking
  access to and processing" data under both a data permit (Art. 68) and a health data
  request (Art. 69).
- **Step 2.** A health data request can only ever be answered in anonymised statistical
  format (Art. 69(1)), so the only question left is whether the purpose is allowed (Art. 53).
- **Step 3.** Pseudonymised, patient-level data are given only when the applicant has
  "sufficiently demonstrated" that anonymised data cannot achieve the purpose (Art. 66(3),
  Art. 68(1)(c)). They are then given only under a data permit (Art. 68) and only inside a
  secure processing environment (Art. 73).
- **Step 4.** If that justification is missing, the access body must provide anonymised data
  where they achieve the purpose (Art. 66(2)). Art. 68(3) lets the access body answer an access
  application in anonymised statistical format instead (Art. 69). The applicant asked for
  records but receives statistics.

## Purposes that are neither prohibited nor permitted

Art. 53(1) says access is granted *only* for the listed purposes. The four steps above assume
every non-prohibited request has an Art. 53 purpose. If a purpose clearly fits **no** Art. 53(1)
category (e.g. a purely private curiosity, a political campaign, a commercial goal with no
health or care benefit), return `REJECT` citing `53`, mark `needs_staff_review: true` and say so
in the reason. This is an extension of the four steps; use it only when no category fits, never
as a softer form of step 1.

## Output of the purpose check

```json
{
  "prohibited": false,
  "prohibited_category": null,
  "prohibited_evidence": null,
  "art53_purposes": ["e"],
  "art53_label": "scientific research",
  "art53_evidence": "we investigate whether long-term statin use lowers dementia risk",
  "public_sector_only_purpose_by_private_applicant": false,
  "justifies_patient_level": null,
  "justification_evidence": null,
  "needs_staff_review": false,
  "review_note": null
}
```

- `prohibited_category` is one of `detrimental_decisions` (54(a)), `discriminatory_terms_insurance_credit_employment` (54(b)), `advertising_marketing` (54(c)), `harmful_products` (54(d)), `national_ethics` (54(e)), `reidentification` (see page 08), or `null`.
- `art53_purposes` uses the letters of Art. 53(1): `a` public/occupational health, `b` policymaking/regulation, `c` official statistics, `d` education/teaching, `e` scientific research (incl. product development and algorithm training), `f` improving care delivery.
- `justifies_patient_level` is only filled for access applications (`true`/`false`); `null` for health data requests.

## Things that do NOT change the decision

- The applicant being a company. Companies may use the EHDS for permitted purposes
  (Art. 53(1)(e)(i)–(ii) explicitly covers product development and algorithm training).
- The applicant being from another EU country.
- How sensitive the condition is. Sensitivity is handled by anonymisation and the small-cell rule, not by refusal.
- A request asking for groups that will turn out to be small. That is handled by suppression, not refusal.
