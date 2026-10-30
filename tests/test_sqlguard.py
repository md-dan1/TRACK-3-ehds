"""SQL guard: split correctness against the expected answers on three DuckDB hospital partitions,
the attack suite, and the small-cell rule. No Docker or LLM needed."""

import json
from pathlib import Path

import duckdb
import pytest
import sqlglot

from ehds_core.sqlguard import QueryRejected, merge_and_release, split, validate_cohort, validate_node_partials, validate_stats
from ehds_core.vocab import HOSPITALS

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
EXPECTED = json.loads((ROOT / "requests" / "expected.json").read_text())


def _load(con, where):
    con.execute(f"CREATE TABLE patients AS SELECT * FROM read_csv('{DATA}/patients.csv') WHERE {where}")
    for t in ("conditions", "medications", "encounters"):
        con.execute(f"CREATE TABLE {t} AS SELECT * FROM read_csv('{DATA}/{t}.csv') WHERE patient_id IN (SELECT patient_id FROM patients)")
    con.execute(f"CREATE TABLE observations AS SELECT * FROM read_csv('{DATA}/observations.csv', types={{'value': 'DECIMAL(10,2)'}}) "
                "WHERE patient_id IN (SELECT patient_id FROM patients)")
    con.execute("CREATE VIEW v_patients AS SELECT * FROM patients WHERE NOT opted_out")
    for t in ("conditions", "medications", "observations", "encounters"):
        con.execute(f"CREATE VIEW v_{t} AS SELECT * FROM {t} WHERE patient_id IN (SELECT patient_id FROM v_patients)")
    return con


@pytest.fixture(scope="module")
def nodes():
    return [_load(duckdb.connect(), f"data_holder = '{h}'") for h in HOSPITALS]


def run(nodes, sql):
    plan = split(validate_stats(sql))
    node_sql = sqlglot.transpile(plan.node_sql, read="postgres", write="duckdb")[0]
    validate_node_partials(plan.node_sql)
    return merge_and_release(plan, [n.execute(node_sql).fetchall() for n in nodes])["released"]


QUERIES = {
    "R01": """
WITH adults AS (
  SELECT p.patient_id, p.region,
         EXISTS (SELECT 1 FROM v_conditions c WHERE c.patient_id = p.patient_id AND c.icd10 LIKE 'E11%') AS has_t2d
  FROM v_patients p WHERE 2025 - EXTRACT(YEAR FROM p.birth_date) >= 18)
SELECT region, COUNT(*) AS adults, COUNT(*) FILTER (WHERE has_t2d) AS type2_diabetes,
       ROUND(100.0 * COUNT(*) FILTER (WHERE has_t2d) / COUNT(*), 1) AS prevalence_pct
FROM adults GROUP BY region""",
    "R03": """
WITH af AS (
  SELECT p.patient_id, 2025 - EXTRACT(YEAR FROM p.birth_date) AS age,
         CASE WHEN 2025 - EXTRACT(YEAR FROM p.birth_date) BETWEEN 65 AND 74 THEN '65-74'
              WHEN 2025 - EXTRACT(YEAR FROM p.birth_date) BETWEEN 75 AND 84 THEN '75-84' ELSE '85+' END AS age_band
  FROM v_patients p
  WHERE EXISTS (SELECT 1 FROM v_conditions c WHERE c.patient_id = p.patient_id AND c.icd10 LIKE 'I48%')),
oac AS (
  SELECT DISTINCT patient_id FROM v_medications
  WHERE (atc LIKE 'B01AA%' OR atc LIKE 'B01AF%') AND start_date <= DATE '2025-12-31'
    AND (end_date IS NULL OR end_date >= DATE '2025-12-31'))
SELECT af.age_band, COUNT(*) AS af_patients,
       SUM(CASE WHEN o.patient_id IS NULL THEN 1 ELSE 0 END) AS without_oac,
       100.0 * SUM(CASE WHEN o.patient_id IS NULL THEN 1 ELSE 0 END) / COUNT(*) AS share_without_oac_pct
FROM af LEFT JOIN oac o ON o.patient_id = af.patient_id
WHERE af.age >= 65 GROUP BY af.age_band""",
    "R07": """
SELECT p.region AS region, COUNT(*) AS inpatient_stays
FROM v_encounters e JOIN v_patients p ON p.patient_id = e.patient_id
WHERE e.type = 'inpatient' AND EXTRACT(YEAR FROM e.start_date) = 2025 GROUP BY p.region""",
    "R08": """
WITH cohort AS (
  SELECT p.patient_id, p.region FROM v_patients p
  WHERE p.sex = 'female' AND EXISTS (SELECT 1 FROM v_conditions c WHERE c.patient_id = p.patient_id AND c.icd10 LIKE 'C50%')),
latest_bmi AS (
  SELECT DISTINCT ON (patient_id) patient_id, value FROM v_observations WHERE loinc = '39156-5' ORDER BY patient_id, date DESC)
SELECT c.region AS region, COUNT(*) AS women_with_bmi, AVG(b.value) AS mean_bmi
FROM cohort c JOIN latest_bmi b ON b.patient_id = c.patient_id GROUP BY c.region""",
    "R09": """
WITH htn AS (
  SELECT p.patient_id, 2025 - EXTRACT(YEAR FROM p.birth_date) AS age FROM v_patients p
  WHERE 2025 - EXTRACT(YEAR FROM p.birth_date) >= 18
    AND EXISTS (SELECT 1 FROM v_conditions c WHERE c.patient_id = p.patient_id AND c.icd10 LIKE 'I10%')),
active AS (
  SELECT patient_id, atc FROM v_medications
  WHERE start_date <= DATE '2025-12-31' AND (end_date IS NULL OR end_date >= DATE '2025-12-31'))
SELECT CASE WHEN h.age <= 49 THEN '18-49' WHEN h.age <= 64 THEN '50-64' ELSE '65+' END AS age_band,
       COUNT(*) AS adults_with_hypertension,
       100.0 * COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM active a WHERE a.patient_id = h.patient_id AND a.atc LIKE 'C09AA%')) / COUNT(*) AS ace_inhibitor_pct,
       100.0 * COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM active a WHERE a.patient_id = h.patient_id AND a.atc LIKE 'C09CA%')) / COUNT(*) AS arb_pct
FROM htn h GROUP BY 1""",
}


@pytest.mark.parametrize("ref", sorted(QUERIES))
def test_federated_answer_matches_expected(nodes, ref):
    released = run(nodes, QUERIES[ref])
    want = EXPECTED[ref]["answer"]
    got = {g: (v if isinstance(want[g], dict) else next(iter(v.values()))) for g, v in released["by_group"].items()}
    assert got == want


def test_cohort_size_r05(nodes):
    sql = """SELECT DISTINCT p.patient_id FROM v_patients p
             WHERE 2025 - EXTRACT(YEAR FROM p.birth_date) >= 18
               AND EXISTS (SELECT 1 FROM v_conditions c WHERE c.patient_id = p.patient_id AND c.icd10 LIKE 'E11%')
               AND EXISTS (SELECT 1 FROM v_observations o WHERE o.patient_id = p.patient_id AND o.loinc = '4548-4')"""
    checked = sqlglot.transpile(validate_cohort(sql).sql(dialect="postgres"), read="postgres", write="duckdb")[0]
    assert sum(len(n.execute(checked).fetchall()) for n in nodes) == EXPECTED["R05"]["answer"]["cohort_size"]


def test_every_group_shown_even_if_empty(nodes):
    sql = """SELECT CASE WHEN 2025 - EXTRACT(YEAR FROM birth_date) < 10 THEN '0-9' ELSE '10+' END AS band,
                    COUNT(*) AS copd FROM v_patients p
             WHERE EXISTS (SELECT 1 FROM v_conditions c WHERE c.patient_id = p.patient_id AND c.icd10 LIKE 'J44%')
             GROUP BY 1"""
    released = run(nodes, sql)
    assert released["by_group"]["0-9"] == {"copd": "<10"}


def test_mean_without_count_gets_its_n(nodes):
    sql = """SELECT sex, AVG(o.value) AS mean_bmi FROM v_patients p JOIN v_observations o USING (patient_id)
             WHERE o.loinc = '39156-5' GROUP BY sex"""
    released = run(nodes, sql)
    assert released["columns"] == ["sex", "n", "mean_bmi"]


def test_difference_of_counts_follows_count_rule(nodes):
    sql = """SELECT region, COUNT(*) - COUNT(*) FILTER (WHERE sex = 'female') + 0 * COUNT(*) AS males_tiny
             FROM v_patients p WHERE EXISTS (SELECT 1 FROM v_conditions c WHERE c.patient_id = p.patient_id AND c.icd10 LIKE 'C50%')
             GROUP BY region"""
    released = run(nodes, sql)
    assert all(v["males_tiny"] == "<10" or v["males_tiny"] >= 10 for v in released["by_group"].values())


ATTACKS = {
    "patient-level rows": "SELECT patient_id, birth_date FROM v_patients",
    "bypass opt-out view": "SELECT region, COUNT(*) FROM patients GROUP BY region",
    "group by patient": "SELECT patient_id, COUNT(*) FROM v_conditions GROUP BY patient_id",
    "ddl": "DROP TABLE patients",
    "two statements": "SELECT region, COUNT(*) FROM v_patients GROUP BY region; DELETE FROM patients",
    "file read": "SELECT region, COUNT(*), pg_read_file('/etc/passwd') FROM v_patients GROUP BY region",
    "catalog": "SELECT region, COUNT(*) FROM pg_catalog.pg_user, v_patients GROUP BY region",
    "median": "SELECT region, PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY birth_date) FROM v_patients GROUP BY region",
    "extreme value": "SELECT region, COUNT(*), MAX(birth_date) FROM v_patients GROUP BY region",
    "bare sum of values": "SELECT region, SUM(value) FROM v_observations o JOIN v_patients USING (patient_id) GROUP BY region",
    "free group key": "SELECT birth_date, COUNT(*) FROM v_patients GROUP BY birth_date",
    "having": "SELECT region, COUNT(*) FROM v_patients GROUP BY region HAVING COUNT(*) < 5",
}


@pytest.mark.parametrize("name", sorted(ATTACKS))
def test_attack_rejected(name):
    with pytest.raises(QueryRejected):
        split(validate_stats(ATTACKS[name]))


def test_renamed_patient_column_never_released(nodes):
    # a CTE that renames patient_id to region: groups outside the 9 regions are dropped, never shown
    sql = """WITH x AS (SELECT patient_id AS region FROM v_patients)
             SELECT region, COUNT(*) AS n FROM x GROUP BY region"""
    released = run(nodes, sql)
    assert set(released["by_group"]) == {"Burgenland", "Kärnten", "Niederösterreich", "Oberösterreich", "Salzburg",
                                         "Steiermark", "Tirol", "Vorarlberg", "Wien"}
    assert all(v["n"] == "<10" for v in released["by_group"].values())


def test_unknown_function_is_named_for_the_repair():
    with pytest.raises(QueryRejected, match=r"pg_read_file\(\)"):
        validate_stats("SELECT region, COUNT(*), pg_read_file('/etc/passwd') FROM v_patients GROUP BY region")


def test_age_is_allowed():
    sql = ("SELECT region, COUNT(*) AS adults FROM v_patients "
           "WHERE EXTRACT(YEAR FROM age(DATE '2025-12-31', birth_date)) >= 18 GROUP BY region")
    assert split(validate_stats(sql)).keys == ["region"]
