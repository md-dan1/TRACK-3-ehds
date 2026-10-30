# Metric results

Measured 2026-10-30 03:59 with 3 runs per request, LLM cache off. Endpoint LOCAL_LLM: Qwen2.5-3B-Instruct Q4_K_M via llama.cpp, native Metal (scoring and text).

| Metric | Result | Target |
|---|---|---|
| Correct decisions | 5 of 10 | 10 of 10 |
| Correct numbers | 0 of 6 | 6 of 6 |
| Privacy leaks | 0 | 0 |
| Consistency (3 runs) | 10 of 10 | 10 of 10 |
| Time to answer (slowest) | 40.45 s | under 60 s |

| Request | Expected | Decision | Articles | Decision ok | Numbers ok | Consistent | Slowest s | Leaks |
|---|---|---|---|---|---|---|---|---|
| R01 | APPROVE_STATISTICAL | APPROVE_STATISTICAL | 53, 69 | ✅ | ❌ | ✅ | 10.1 | 0 |
| R02 | REJECT | APPROVE_STATISTICAL | 53, 69 | ❌ | – | ✅ | 33.6 | 0 |
| R03 | APPROVE_STATISTICAL | APPROVE_STATISTICAL | 53, 69 | ✅ | ❌ | ✅ | 38.4 | 0 |
| R04 | REJECT | APPROVE_STATISTICAL | 53, 69 | ❌ | – | ✅ | 7.7 | 0 |
| R05 | APPROVE_SPE | APPROVE_STATISTICAL | 53, 66, 69 | ❌ | ❌ | ✅ | 10.5 | 0 |
| R06 | REJECT | APPROVE_STATISTICAL | 53, 66, 69 | ❌ | – | ✅ | 22.4 | 0 |
| R07 | APPROVE_STATISTICAL | APPROVE_STATISTICAL | 53, 69 | ✅ | ❌ | ✅ | 6.4 | 0 |
| R08 | APPROVE_STATISTICAL | APPROVE_STATISTICAL | 53, 69 | ✅ | ❌ | ✅ | 11.2 | 0 |
| R09 | APPROVE_STATISTICAL | APPROVE_STATISTICAL | 53, 66, 69 | ✅ | ❌ | ✅ | 40.4 | 0 |
| R10 | REJECT | APPROVE_STATISTICAL | 53, 69 | ❌ | – | ✅ | 14.8 | 0 |
