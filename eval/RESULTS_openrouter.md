# Metric results

Measured 2026-10-30 13:35 with 3 runs per request, LLM cache off. Endpoint OPENROUTER: qwen/qwen3-vl-30b-a3b-instruct (scoring), deepseek/deepseek-v4-flash (text).

| Metric | Result | Target |
|---|---|---|
| Correct decisions | 10 of 10 | 10 of 10 |
| Correct numbers | 6 of 6 | 6 of 6 |
| Privacy leaks | 0 | 0 |
| Consistency (3 runs) | 10 of 10 | 10 of 10 |
| Time to answer (slowest) | 18.04 s | under 60 s |

| Request | Expected | Decision | Articles | Decision ok | Numbers ok | Consistent | Slowest s | Leaks |
|---|---|---|---|---|---|---|---|---|
| R01 | APPROVE_STATISTICAL | APPROVE_STATISTICAL | 53, 69 | ✅ | ✅ | ✅ | 6.4 | 0 |
| R02 | REJECT | REJECT | 54 | ✅ | – | ✅ | 4.3 | 0 |
| R03 | APPROVE_STATISTICAL | APPROVE_STATISTICAL | 53, 69 | ✅ | ✅ | ✅ | 12.1 | 0 |
| R04 | REJECT | REJECT | 54 | ✅ | – | ✅ | 2.9 | 0 |
| R05 | APPROVE_SPE | APPROVE_SPE | 53, 66, 68, 73 | ✅ | ✅ | ✅ | 12.6 | 0 |
| R06 | REJECT | REJECT | 54 | ✅ | – | ✅ | 4.4 | 0 |
| R07 | APPROVE_STATISTICAL | APPROVE_STATISTICAL | 53, 69 | ✅ | ✅ | ✅ | 13.2 | 0 |
| R08 | APPROVE_STATISTICAL | APPROVE_STATISTICAL | 53, 69 | ✅ | ✅ | ✅ | 18.0 | 0 |
| R09 | APPROVE_STATISTICAL | APPROVE_STATISTICAL | 53, 66, 69 | ✅ | ✅ | ✅ | 13.9 | 0 |
| R10 | REJECT | REJECT | 54 | ✅ | – | ✅ | 4.6 | 0 |
