"""All LLM prompts, versioned. Few-shot examples are synthetic, never the R01-R10 test requests."""

from ehds_core.articles import ART54_CATEGORIES
from ehds_core.vocab import REFERENCE_DATE, vocabulary_text

PROMPT_VERSION = "v2"

ART54_QUESTION = "Is the purpose of this request prohibited under Art. 54?"
ART54 = """You check data requests under Art. 54 of the European Health Data Space Regulation (EU) 2025/327.
Art. 54 prohibits using health data for:
(a) taking decisions detrimental to a natural person or group based on their health data;
(b) decisions about a person or group regarding job offers or employment, offering less favourable terms for goods or services, excluding them from insurance or credit, or modifying their insurance contributions, premiums or loan conditions;
(c) advertising or marketing activities;
(d) developing products or services that may harm individuals, public health or society, such as illicit drugs, alcoholic beverages, tobacco and nicotine products, weaponry, or products designed to create addiction or mislead;
(e) activities conflicting with ethical provisions of national law.
Judge what the applicant will do with the results, not how the request is worded. Research framing does not make a prohibited use allowed.
""" + ART54_QUESTION + " Answer yes or no."

NEED_QUESTION = "Does the applicant justify why anonymised statistics are not enough for the purpose?"
NEED = """You review a health data access application under the European Health Data Space Regulation (EU) 2025/327.
Pseudonymised individual-level data in a secure processing environment is only justified if the applicant explains why anonymised aggregate statistics cannot serve the purpose (Art. 66, data minimisation), for example because a model must be trained on individual patient histories.
If the stated question can be answered with counts, percentages or means per group, statistics are enough.
""" + NEED_QUESTION + " Answer yes or no."

CATEGORY = ("You classify data requests under Art. 54 of the European Health Data Space Regulation (EU) 2025/327.\n"
            "If the purpose were prohibited, which category would fit best?\n"
            + "\n".join(f"{k}: {v}" for k, v in ART54_CATEGORIES.items())
            + "\nAnswer with one letter: A, B, C, D or E.")

REASON = """You write the reason for a decision of a Health Data Access Body under the European Health Data Space Regulation (EU) 2025/327.
The decision is already made; explain it, do not change it. Cite only the articles given. Plain language, no legal jargon, no hedging.
applicant_reason: 1-3 sentences addressed to the applicant ("Your request ...").
staff_note: 1-2 sentences for access body staff: the decisive fact in the request."""

REASON_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["applicant_reason", "staff_note"],
    "properties": {"applicant_reason": {"type": "string"}, "staff_note": {"type": "string"}},
}

_SCHEMA_TEXT = f"""Views (read only these; opted-out patients are already removed):
 v_patients(patient_id, sex 'female'|'male', birth_date date, region, data_holder, opted_out)
 v_conditions(patient_id, icd10, description, onset_date date)  -- one row per diagnosis
 v_medications(patient_id, atc, name, start_date date, end_date date)  -- end_date NULL = still taking it
 v_observations(patient_id, loinc, name, value numeric, unit, date date)  -- at most one value per patient, test and day
 v_encounters(encounter_id, patient_id, data_holder, type 'inpatient'|'outpatient'|'emergency', start_date date, end_date date, primary_icd10)
Each column exists only in the view it is listed under: sex, birth_date and region are only in v_patients.
Reference date {REFERENCE_DATE}: age = 2025 - EXTRACT(YEAR FROM birth_date).
A diagnosis means a row in v_conditions. Use v_encounters.primary_icd10 only when the request names the main/primary diagnosis of a stay.
A medication is active on {REFERENCE_DATE} if start_date <= DATE '{REFERENCE_DATE}' AND (end_date IS NULL OR end_date >= DATE '{REFERENCE_DATE}').
"Hospital" means data_holder. Match codes by prefix with LIKE 'X%'. Match measurements on loinc.

Code vocabulary of the data:
{vocabulary_text()}"""

STATS_SQL = f"""Write ONE PostgreSQL SELECT that computes exactly what the request's definitions ask to report. Output only SQL, no prose, no code fence.
{_SCHEMA_TEXT}

Rules:
- Counting patients: one CTE with one row per patient, FROM v_patients p, holding the group key (e.g. the age band CASE) and one boolean per condition, e.g. EXISTS (SELECT 1 FROM v_conditions c WHERE c.patient_id = p.patient_id AND c.icd10 LIKE 'I48%') AS has_af. Filter the population ("among patients with ...", age limits) in that CTE's WHERE.
- Count each patient once: use EXISTS for conditions and medications, or COUNT(DISTINCT patient_id).
- "How many of them have X and that share": the population is the denominator. Report COUNT(*), COUNT(*) FILTER (WHERE x) and 100.0 * COUNT(*) FILTER (WHERE x) / COUNT(*); never filter on x in WHERE.
- Latest value per patient: SELECT DISTINCT ON (patient_id) patient_id, value FROM v_observations WHERE loinc = '...' ORDER BY patient_id, date DESC.
- The outer SELECT has only group keys and aggregates. Group keys: region, data_holder, sex, or a CASE expression with literal string labels for bands (the CASE may be defined in a CTE). GROUP BY lists exactly the group keys.
- Aggregates: COUNT(*), COUNT(*) FILTER (WHERE ...), COUNT(DISTINCT patient_id), AVG(...). Percentages: 100.0 * COUNT(*) FILTER (WHERE ...) / COUNT(*). Means: AVG(value).
- No ROUND, no HAVING, no MIN/MAX, no ORDER BY, no LIMIT, no window functions.
- One output column per reported number, aliased with a short snake_case name, in the order the definitions list them. Every number the "Report ..." definition names is a column, counts included: "patients with X and their mean Y" is two columns (COUNT(*) and AVG).
- Count stays (rows of v_encounters) only when the request says to count stays/visits; otherwise count patients."""

COHORT = f"""The applicant was granted pseudonymised records in a secure processing environment.
Write ONE PostgreSQL SELECT returning exactly one column, patient_id (use SELECT DISTINCT), for the cohort the definitions describe, and list which record types the request asks for.
{_SCHEMA_TEXT}

Rules for cohort_sql: read only the views above, count nothing, no ORDER BY, no LIMIT, no code fence.
Record types: conditions, medications, observations (list only the LOINC codes asked for), encounters, demographics (sex, birth date, region; only if asked). Copy only what the request names (data minimisation)."""

COHORT_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["cohort_sql", "conditions", "medications", "observation_loinc", "encounters", "demographics"],
    "properties": {
        "cohort_sql": {"type": "string"},
        "conditions": {"type": "boolean"},
        "medications": {"type": "boolean"},
        "observation_loinc": {"type": "array", "items": {"type": "string", "enum": ["4548-4", "39156-5", "8480-6", "62238-1"]}},
        "encounters": {"type": "boolean"},
        "demographics": {"type": "boolean"},
    },
}

FORM = """Convert the applicant's free text into a European Health Data Space data request form.
Copy facts only; leave a field as an empty string (or empty list) if the text does not say it. Do not fill in who the applicant is.
- requested_as: "health data access application" only if the applicant wants individual-level / pseudonymised records; otherwise "health data request".
- requested_format: "pseudonymised records" for an access application, else "anonymised statistics".
- purpose: the intended use of the data, which purpose it serves (public health, policy-making, official statistics, education, scientific research, improving care) and the expected benefit (Art. 67(2)(b)(c), 69(2)(b)).
- question: the statistical content needed: what should be counted or measured, and for which groups (Art. 69(2)(d)).
- definitions: a description of the requested data (Art. 69(2)(c), 67(2)(d)) as short plain-English sentences, one per term (e.g. "Adult = aged 18 or older on 31 December 2025.", "Type 2 diabetes = any condition with an ICD-10 code starting with E11."), and a final "Report per <group>: <numbers>." sentence when the text says what to report."""

FORM_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["requested_as", "requested_format", "purpose", "question", "definitions"],
    "properties": {
        "requested_as": {"type": "string", "enum": ["health data request", "health data access application"]},
        "requested_format": {"type": "string", "enum": ["anonymised statistics", "pseudonymised records"]},
        "purpose": {"type": "string"}, "question": {"type": "string"},
        "definitions": {"type": "array", "items": {"type": "string"}},
    },
}
