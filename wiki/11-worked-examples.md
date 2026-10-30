---
id: worked-examples
title: Worked examples
articles: [53, 54, 66, 68, 69, 73]
---

# Worked examples

Each example gives the decisive facts, the decision and why. They are illustrations of the
reasoning, not a lookup table: apply the decision procedure to every new request.

## Cases


| Case | Decision | Why |
|---|---|---|
| Private insurer: "research on which lifestyle programmes reduce diabetes complications, results published, no use in pricing" | APPROVE (format by step 2–4), `needs_staff_review: true` | No decision about people stated; (e). Flag because of the applicant type |
| Bank: "how common is dementia by age, to adapt our loan products for older clients" | REJECT (54) | Conditions of loans for a group based on health data, 54(b) |
| Pharma: "size the market for our new statin by region to plan our sales force" | REJECT (54) | Marketing/sales, 54(c) |
| Pharma: "rate of liver injury among patients on our drug, for the safety report to the regulator" | APPROVE | Safety of medicinal products, (a)/(e) |
| Medtech start-up, access application: "validate our ECG algorithm on individual recordings; we need raw signals per patient" | APPROVE_SPE | (e)(ii); patient-level need is explicit and plausible |
| University, access application: "we want the records to calculate diabetes prevalence per region ourselves" | APPROVE_STATISTICAL (53, 66, 69) | Descriptive table; wanting to compute it yourself is no justification |
| Municipality: "list patients with diabetes in our town so we can send them invitations" | REJECT (54) | Identifying individuals, re-identification; not secondary use for a 53 purpose |
| E-cigarette maker: "study lung function in vapers to show our product is safer" | REJECT (54) | Developing/marketing nicotine products, 54(c)/(d) |
| Political party: "diabetes rates by region for our campaign" | REJECT (53), `needs_staff_review: true` | No Art. 53 purpose fits; campaign material, not policymaking by a public body |
| Health authority: "monthly influenza-like illness counts by region for surveillance" | APPROVE_STATISTICAL | (a) public health surveillance by a public body |
| Regional statistics office: "hospital admissions per year and district for the yearly statistical yearbook" | APPROVE_STATISTICAL | (c) official statistics by a public body |
| Nursing college, access application: "records of patients with heart failure so students can see how often diuretics are prescribed by age" | APPROVE_STATISTICAL (53, 66, 69) | (d) teaching; the question is a share per age group, no reason why statistics are insufficient |
| University hospital, access application: "estimate the effect of early rehabilitation on readmission using propensity score matching on individual covariates" | APPROVE_SPE | (e)/(f); matching needs individual covariates, which aggregates cannot provide |
| Recruitment agency: "share of people with chronic back pain by occupation, to advise clients which candidates to avoid" | REJECT (54) | Decisions about job offers, 54(b) |
