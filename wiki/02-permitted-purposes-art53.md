---
id: permitted-purposes
title: Permitted purposes (Art. 53)
articles: [53]
source: sources/art53.md
---

# Permitted purposes – Art. 53

Access is granted only where processing is **necessary** for one of the purposes in
Art. 53(1). Classify every non-prohibited request into one or more of them.

| Letter | Purpose (short) | Typical applicants | Signals in the request |
|---|---|---|---|
| (a) | Public interest in public or occupational health: surveillance, cross-border health threats, quality and safety of healthcare, patient safety, safety of medicines and devices | Ministries, public health institutes, regional health authorities, medicines agencies | "surveillance", "outbreak", "patient safety", "quality of care", "pharmacovigilance" |
| (b) | Policymaking and regulatory activities supporting public sector bodies in health or care | Ministries, regulators, social insurance as a public body | "policy", "plan a programme", "regulation", "guideline compliance", "treatment gap" |
| (c) | Official statistics related to health or care | National statistics office, Eurostat | "official statistics", "annual health report", "national statistics" |
| (d) | Education or teaching in health or care at vocational or higher-education level | Universities, medical schools, nursing schools | "teaching module", "course", "training of GPs/students" |
| (e) | Scientific research related to health or care that contributes to public health or HTA, or ensures quality and safety of care, medicines or devices, aiming to benefit end-users. Includes (i) product and service development and (ii) training, testing and evaluating algorithms (AI, medical devices, digital health apps) | Universities, research institutes, hospitals, pharma and medtech R&D, start-ups | "study", "research", "risk factor", "predict", "train/validate a model", "develop a device" |
| (f) | Improving care delivery, optimising treatment, provision of healthcare based on other people's data | Hospitals, care networks, GP practices | "improve care pathways", "optimise treatment", "reduce readmissions" |

## Art. 53(2) – purposes (a), (b), (c) are for public bodies

Purposes (a), (b) and (c) are reserved for public sector bodies and EU bodies acting within
their mandate, or third parties acting **on their behalf**.

How to apply it here:
- A private applicant whose purpose sounds like (a)/(b)/(c) usually also fits (e) or (f).
  Classify it as (e)/(f) if it does. Example: a private research institute that measures asthma rates
  "so that the city can plan school health checks" → (e) research, possibly on behalf of a
  public body.
- Only if a private applicant fits **nothing but** (a)/(b)/(c) and is not acting for a public
  body: set `public_sector_only_purpose_by_private_applicant: true` and `needs_staff_review: true`.
  Do not reject on this ground alone.

## "Necessary" and "benefiting end-users"

- (e) requires that the research is **related to health or care** and aims to benefit patients,
  health professionals or health administrators. Research that serves only the applicant's
  sales, pricing or marketing is not (e); check page 03 first.
- Commercial applicants are fine when the product benefits care (a prediction tool for GPs,
  a diagnostic device, a drug safety study).

## Reason phrases (for page 10)

| Letter | Phrase for the reason text |
|---|---|
| (a) | "Protecting public health and the quality and safety of care is an allowed purpose (Art. 53)." |
| (b) | "Policy-making and improving care are allowed purposes (Art. 53)." |
| (c) | "Official statistics are an allowed purpose (Art. 53)." |
| (d) | "Teaching in health care is an allowed purpose (Art. 53)." |
| (e) | "Research is an allowed purpose (Art. 53)." / "Training and testing algorithms is an allowed purpose (Art. 53)." |
| (f) | "Improving the delivery of care is an allowed purpose (Art. 53)." |
| combos | Join them: "Research and public health are allowed purposes (Art. 53)." |
