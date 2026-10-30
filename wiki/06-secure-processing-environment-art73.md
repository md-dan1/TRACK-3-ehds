---
id: spe
title: Secure processing environment (Art. 73)
articles: [68, 73, 74]
source: sources/art73.md
---

# Secure processing environment – Art. 73

Data under a **data permit** are made available **only** through a secure processing
environment (SPE) (Art. 73(1); Art. 68(11)).

## What the SPE must ensure (Art. 73(1))

| Requirement | How the app implements it |
|---|---|
| (a) Only authorised persons named in the permit get in | SPE bound to the applicant's user account |
| (b) Minimise unauthorised reading, copying, modification or removal | No endpoint returns SPE contents |
| (c) Only a few authorised people can put data in or change it | Only the pipeline writes into the SPE |
| (d) Users see only the data covered by their permit | Only the cohort and the record types named in the request are copied |
| (e) Identifiable logs of access and activity, kept at least one year | Every access and download attempt is logged with user and time |
| (f) Monitoring of these measures | Staff view of SPE events |

## Downloads (Art. 73(2))

Users may download only **non-personal** data, such as results in anonymised statistical format,
and only after the access body has reviewed the download request. Pseudonymised records are
personal data, so **a download of records is always refused**. In this prototype every download
attempt returns "blocked" and is logged. A later version could allow reviewed downloads of model
weights or aggregate results.

## Related rules

- Art. 61(2): users must not give third parties not named in the permit access to the data.
- Art. 64(5)(b): extracting personal data from an SPE is subject to the highest fines.
- Art. 68(12): data in the SPE are deleted within six months after the permit expires.
- Art. 74(1): in the SPE the access body acts as processor for the user.

## Applicant-facing message

"Your data are available only inside the secure processing environment. Records cannot be
downloaded (Art. 73). You can export anonymous results only after review."
