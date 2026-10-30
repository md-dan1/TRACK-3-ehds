---
id: request-types
title: Request types (Art. 67–69)
articles: [67, 68, 69]
source: [sources/art67.md, sources/art68.md, sources/art69.md]
---

# Request types – Art. 67, 68, 69

The EHDS has two ways to ask for data. The request's `requested_as` field says which one.

| | Health data request (Art. 69) | Health data access application (Art. 67) |
|---|---|---|
| `requested_as` | `"health data request"` | `"health data access application"` |
| Usual `requested_format` | `"anonymised statistics"` | `"pseudonymised records"` (or anonymised data) |
| What the applicant gets | **Only** an answer in anonymised statistical format. The applicant never sees the underlying data (Art. 69(1)). | If approved: a **data permit** (Art. 68) and access to the data **inside a secure processing environment** (Art. 73) |
| What it must contain | Identity, intended use and Art. 53 purpose, description of data and statistical content, safeguards, legal basis (Art. 69(2)) | Identity and who will access the data, Art. 53 purpose, detailed explanation of use and benefit, description of data, **whether pseudonymised or anonymised and, if pseudonymised, why anonymised data are not enough**, safeguards, period, tools, ethics (Art. 67(2)) |
| Possible decisions here | `REJECT` or `APPROVE_STATISTICAL` | `REJECT`, `APPROVE_SPE` or `APPROVE_STATISTICAL` |

## Key consequences

- A health data request can never become an SPE approval, even if it asks for "records".
  Art. 69(1): the access body "shall not provide a response … in any other format".
- An access application can be answered with statistics instead of a permit. Art. 68(3):
  where the conditions for a permit are not met but those for an Art. 69 answer are, the access
  body may answer in anonymised statistical format. That is step 4 in the decision procedure.
- Anonymised is the default. Art. 66(2): the access body provides anonymised data whenever the
  purpose can be achieved with them. Pseudonymised data need justification (page 05).

## Completeness

The example requests do not contain every element of Art. 67(2) or 69(2) (safeguards, legal
basis, period). For this prototype, missing formal elements **do not** change the decision. Staff
can see them. Do not reject or downgrade a request because a formal element is missing.
