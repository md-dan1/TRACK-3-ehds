# Metric results

Measured 2026-10-30 13:51 with 3 runs per request, LLM cache off. Endpoint LOGPROB_LLM_PROVIDER_API: openai/gpt-5.6-luna (scoring), openai/gpt-5.6-luna (text).

| Metric | Result | Target |
|---|---|---|
| Correct decisions | 10 of 10 | 10 of 10 |
| Correct numbers | 6 of 6 | 6 of 6 |
| Privacy leaks | 0 | 0 |
| Consistency (3 runs) | 10 of 10 | 10 of 10 |
| Time to answer (slowest) | 40.51 s | under 60 s |

| Request | Expected | Decision | Articles | Decision ok | Numbers ok | Consistent | Slowest s | Leaks |
|---|---|---|---|---|---|---|---|---|
| R01 | APPROVE_STATISTICAL | APPROVE_STATISTICAL | 53, 69 | ✅ | ✅ | ✅ | 9.6 | 0 |
| R02 | REJECT | REJECT | 54 | ✅ | – | ✅ | 6.7 | 0 |
| R03 | APPROVE_STATISTICAL | APPROVE_STATISTICAL | 53, 69 | ✅ | ✅ | ✅ | 22.7 | 0 |
| R04 | REJECT | REJECT | 54 | ✅ | – | ✅ | 12.3 | 0 |
| R05 | APPROVE_SPE | APPROVE_SPE | 53, 66, 68, 73 | ✅ | ✅ | ✅ | 12.2 | 0 |
| R06 | REJECT | REJECT | 54 | ✅ | – | ✅ | 8.9 | 0 |
| R07 | APPROVE_STATISTICAL | APPROVE_STATISTICAL | 53, 69 | ✅ | ✅ | ✅ | 11.8 | 0 |
| R08 | APPROVE_STATISTICAL | APPROVE_STATISTICAL | 53, 69 | ✅ | ✅ | ✅ | 40.5 | 0 |
| R09 | APPROVE_STATISTICAL | APPROVE_STATISTICAL | 53, 66, 69 | ✅ | ✅ | ✅ | 40.0 | 0 |
| R10 | REJECT | REJECT | 54 | ✅ | – | ✅ | 7.1 | 0 |
