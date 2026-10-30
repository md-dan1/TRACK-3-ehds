---
id: prohibited-uses
title: Prohibited uses (Art. 54)
articles: [54]
source: sources/art54.md
load: always
---

# Prohibited uses – Art. 54

Seeking access to data, or processing it, for any of these uses is prohibited. A match means
`REJECT` with article `54`, whatever format was requested.

| Point | Prohibited use | Category id |
|---|---|---|
| 54(a) | Taking decisions **detrimental** to a person or group based on their health data, where the decision has legal, social or economic effects or similarly significant effects | `detrimental_decisions` |
| 54(b) | Decisions about job offers; less favourable terms for goods or services; **excluding people from insurance or credit, changing their contributions, insurance premiums or loan conditions**; any other decision that discriminates against people on the basis of the health data | `discriminatory_terms_insurance_credit_employment` |
| 54(c) | **Advertising or marketing** activities | `advertising_marketing` |
| 54(d) | Developing products or services that may harm individuals, public health or society: **illicit drugs, alcoholic beverages, tobacco and nicotine products, weapons**, products designed to be **addictive**, that contravene public order or risk human health | `harmful_products` |
| 54(e) | Activities that conflict with ethical provisions of national law | `national_ethics` |

## How to test a request

Read the **purpose**, the **question**, the **organisation** and any **stated downstream use**
together. Ask:

1. **What will the result be used for?** Not what the data are, but what happens next.
   A statistic about heart disease is harmless; using it to set contract terms is prohibited.
2. **Does anyone take a decision about the people in the data, or people like them, that can
   hurt them?** Insurance pricing, underwriting, hiring, contract renewal, credit scoring,
   eligibility decisions → 54(a)/(b).
3. **Is the goal to sell, promote or target?** Deciding where to send sales representatives,
   finding prescribers to target, market sizing for sales → 54(c). Advertising to
   *professionals* counts too.
4. **Is the product itself harmful?** Alcohol, tobacco, nicotine pouches, e-cigarettes, vapes,
   gambling or addictive apps, weapons, recreational drugs → 54(d). A "harm reduction" or "safer
   choice" framing does not change this; the list names nicotine products explicitly.
5. **Will data be linked to identified people?** Matching with employee, customer or member
   lists → re-identification (page 08), and usually also 54(a)/(b). Use category
   `reidentification` only if no 54 point fits better; still cite `54`.

## Red flags in organisation names

Not decisive alone, but read the purpose more carefully when you see:
insurance (pricing, underwriting, actuarial), HR department, recruitment, bank, credit, marketing
or advertising agency, "commercial excellence", sales, tobacco, nicotine, alcohol, spirits,
betting, gaming, defence.

## Disguised purposes

Applicants rarely write "for advertising". Look at the effect:

| Request says | It is | Decision |
|---|---|---|
| "calibrate our tariffs for customers with chronic conditions" | insurance pricing → 54(b) | REJECT |
| "understand the risk profile of our policyholders" (insurer) | underwriting / pricing → 54(b) | REJECT |
| "find out which clinics should get our product samples first" | marketing → 54(c) | REJECT |
| "identify target markets / prioritise sales territories" | marketing → 54(c) | REJECT |
| "screen job applicants against diagnosis histories" | employment decisions + re-identification → 54(a)/(b) | REJECT |
| "develop a new flavoured e-liquid for adult smokers" | nicotine product development → 54(d) | REJECT |
| "design a more engaging betting app for people with ADHD" | addictive product → 54(d) | REJECT |

## Look-alikes that are allowed

| Request | Why it is allowed | Purpose |
|---|---|---|
| Insurer **as a public social insurance body** studying prevention to lower disease burden, no individual pricing | No decision about individuals; public health benefit | (a)/(b)/(e) – flag for staff if the insurer is private |
| Pharma company running a **drug safety** study | Safety of medicinal products | (a)/(e) |
| Pharma company estimating **unmet medical need** for a trial design | Research with patient benefit | (e) – flag if the text also mentions sales |
| Occupational health research by a university on shift work and heart disease | No decisions about specific employees | (a)/(e) |
| Research on **smoking cessation** with an authorised medicinal product | Medicine to help people stop, not a consumer nicotine product | (e) – flag for staff |
| Studying alcohol-related liver disease to inform prevention | Studying harm, not developing a harmful product | (a)/(e) |

When a request mixes an allowed aim with a prohibited one ("research, and we will also use the
results for our sales team"), the prohibited part decides: `REJECT`.

## Evidence

Always quote the phrase that triggered the finding in `prohibited_evidence`
(e.g. "decide which loan applicants need a medical surcharge").
