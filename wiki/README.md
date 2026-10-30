---
id: index
title: EHDS secondary-use wiki – index
---

# EHDS secondary-use wiki

A knowledge base for the LLM steps of the Health Data Access Body app. It covers
Regulation (EU) 2025/327 (European Health Data Space), **Chapter IV – Secondary use**,
reduced to what is needed to decide data requests.

Two kinds of pages:

- **Guidance pages** (`01-…` to `11-…`): interpretation, decision tests, red flags and examples,
  written for an LLM. They say *how to reason*.
- **Source pages** (`sources/artNN.md`): verbatim article text. Use them to check wording and
  to quote. They are the authority; if a guidance page seems to contradict a source page,
  the source page wins and the case is flagged for staff.

## Pages

| File | Use it for |
|---|---|
| `01-decision-procedure.md` | The fixed decision order, the articles to cite per outcome, the output format. **Always load.** |
| `02-permitted-purposes-art53.md` | Classifying the purpose into an Art. 53(1) category; public-sector-only purposes |
| `03-prohibited-uses-art54.md` | Detecting prohibited uses, including disguised ones. **Always load.** |
| `04-request-types-art67-69.md` | Health data request vs health data access application; anonymised vs pseudonymised |
| `05-patient-level-justification-art66-68.md` | Deciding whether an access application justifies patient-level data (SPE) or gets statistics |
| `06-secure-processing-environment-art73.md` | What an SPE must do; why downloads are blocked |
| `07-opt-out-art71.md` | Opt-out handling |
| `08-reidentification-and-user-duties-art61.md` | Re-identification, linking with external lists, duties of users |
| `09-anonymised-statistics-small-cell.md` | What an anonymised statistical answer may contain; the small-cell rule |
| `10-writing-reasons.md` | How to write the reason shown to applicants; article one-liners |
| `11-worked-examples.md` | Example cases with the reasoning |
| `12-glossary.md` | Terms used in the regulation and the app |
| `articles.json` | Machine-readable article list and decision table for the app code |

## Which pages each pipeline step should load

| Pipeline step | Pages |
|---|---|
| Purpose check (prohibited? which Art. 53 purpose?) | 01, 02, 03, 08, 11, sources/art53, sources/art54 |
| Patient-level justification (access applications) | 01, 04, 05, 11, sources/art66, sources/art68 |
| Reason text | 10 plus the result of the previous steps |
| Staff explanation / Q&A | all |

The whole wiki (without `sources/`) is about 10–12k tokens, so it can also simply be put in the
system prompt in full. Put it in the cached part of the prompt so repeated calls are cheap and
consistent.

## Ground rules for the LLM

1. Decide only from the request text. Never ask for or expect patient data.
2. Follow `01-decision-procedure.md` exactly; it is the order the access body uses.
3. Quote evidence from the request for every finding (a short phrase, not a paraphrase).
4. When a case is genuinely ambiguous, still give your best classification, set
   `needs_staff_review: true` and say why. Do not invent facts about the applicant.
5. Cite articles only from the lists in `01-decision-procedure.md`. Never cite paragraph
   numbers you have not checked against `sources/`.

Source: Regulation (EU) 2025/327 of 11 February 2025, OJ L, 5.3.2025,
ELI http://data.europa.eu/eli/reg/2025/327/oj. Guidance pages are an interpretation for
this prototype, not legal advice.
