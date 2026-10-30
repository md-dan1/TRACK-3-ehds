---
id: small-cell
title: Anonymised statistics and the small-cell rule
articles: [66, 69, 73]
---

# Anonymised statistics and the small-cell rule

An Art. 69 answer must be in **anonymised statistical format**, and the user has no access to the
underlying data (Art. 69(1)). Results that leave an SPE must be non-personal (Art. 73(2)).
The regulation does not fix a threshold. This app uses the following **small-cell rule**
(a rule of the challenge, not of the regulation). It is applied in code, not by the LLM.

1. Show **every requested group**, even if it has no patients.
2. Show counts **below 10, including 0**, as `<10`.
3. Show `suppressed` for a **percentage** whose numerator **or** denominator is below 10.
4. Show `suppressed` for a **mean** of fewer than 10 patients.
5. Round to **one decimal, halves up**.

## Why each part exists

- Small counts can identify people, especially combined with region, age and sex.
- A percentage with a small numerator reveals a small count; with a small denominator it reveals
  the individuals' status.
- A mean of a few values can reveal individual measurements.
- Showing empty groups stops anyone from learning from which groups are missing.

## What the LLM should know

- Never promise exact small numbers in a reason text.
- Do not refuse a request because cells will be small. Suppression handles it. Mention it in the
  reason only when it applied: "Small cells are suppressed."
- An answer with only `<10` and `suppressed` is still a valid approval.
- Patient-level data never appear in a statistical answer.
