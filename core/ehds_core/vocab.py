"""Canonical group domains and the closed code vocabulary of the data.

The LLM never sees patient data, only this vocabulary, so it can map plain-English terms
("statins", "heart failure", "HbA1c") to the codes the hospitals store."""

REFERENCE_DATE = "2025-12-31"

REGIONS = [
    "Burgenland", "Kärnten", "Niederösterreich", "Oberösterreich", "Salzburg",
    "Steiermark", "Tirol", "Vorarlberg", "Wien",
]
HOSPITALS = ["Klinikum Nord", "Klinikum Süd", "Klinikum West"]
SEXES = ["female", "male"]

# Every requested group is shown, even when empty, so the full list must be known up front.
DOMAINS: dict[str, list[str]] = {"region": REGIONS, "data_holder": HOSPITALS, "sex": SEXES}

# (code, description, plain-English synonyms)
ICD10_CONDITIONS = [
    ("C50.9", "Malignant neoplasm of breast, unspecified", "breast cancer"),
    ("E11.65", "Type 2 diabetes mellitus with hyperglycaemia", "type 2 diabetes, T2D"),
    ("E11.9", "Type 2 diabetes mellitus without complications", "type 2 diabetes, T2D"),
    ("E66.9", "Obesity, unspecified", "obesity, adiposity"),
    ("F32.9", "Depressive episode, unspecified", "depression"),
    ("I10", "Essential (primary) hypertension", "hypertension, high blood pressure"),
    ("I48.0", "Paroxysmal atrial fibrillation", "atrial fibrillation, AF, AFib"),
    ("I48.2", "Chronic atrial fibrillation", "atrial fibrillation, AF, AFib"),
    ("I50.9", "Heart failure, unspecified", "heart failure, cardiac insufficiency"),
    ("I63.9", "Cerebral infarction, unspecified", "stroke, ischaemic stroke"),
    ("J44.9", "Chronic obstructive pulmonary disease, unspecified", "COPD, smokers' lung"),
    ("J45.9", "Asthma, unspecified", "asthma"),
    ("N18.3", "Chronic kidney disease, stage 3", "CKD, chronic kidney disease"),
]
# Only in encounters.primary_icd10 (main diagnosis of an inpatient stay), never in conditions.
ICD10_ENCOUNTER_ONLY = [
    ("J18.9", "Pneumonia, unspecified organism", "pneumonia"),
    ("K35.8", "Acute appendicitis, other and unspecified", "appendicitis"),
    ("N39.0", "Urinary tract infection, site not specified", "UTI, urinary tract infection"),
    ("S72.0", "Fracture of neck of femur", "hip fracture, femoral neck fracture"),
]
ATC = [
    ("A10AE04", "Insulin glargine", "long-acting insulin (A10AE), insulins (A10A)"),
    ("A10BA02", "Metformin", "biguanide (A10BA), oral antidiabetic (A10B)"),
    ("A10BJ06", "Semaglutide", "GLP-1 receptor agonist (A10BJ)"),
    ("A10BK03", "Empagliflozin", "SGLT2 inhibitor (A10BK)"),
    ("B01AA04", "Phenprocoumon", "vitamin K antagonist (B01AA), oral anticoagulant"),
    ("B01AF01", "Rivaroxaban", "direct factor Xa inhibitor (B01AF), DOAC, oral anticoagulant"),
    ("B01AF02", "Apixaban", "direct factor Xa inhibitor (B01AF), DOAC, oral anticoagulant"),
    ("C03CA01", "Furosemide", "loop diuretic (C03CA)"),
    ("C07AB07", "Bisoprolol", "selective beta blocker (C07AB)"),
    ("C08CA01", "Amlodipine", "calcium channel blocker (C08CA)"),
    ("C09AA05", "Ramipril", "ACE inhibitor (C09AA)"),
    ("C09CA06", "Candesartan", "angiotensin II receptor blocker, ARB, sartan (C09CA)"),
    ("C10AA05", "Atorvastatin", "statin, HMG-CoA reductase inhibitor (C10AA)"),
    ("N06AB06", "Sertraline", "SSRI antidepressant (N06AB)"),
    ("R03AK06", "Salmeterol/fluticasone", "inhaled LABA + corticosteroid (R03AK)"),
    ("R03BB04", "Tiotropium", "inhaled anticholinergic, LAMA (R03BB)"),
]
LOINC = [
    ("4548-4", "HbA1c", "%"),
    ("39156-5", "BMI (body mass index)", "kg/m2"),
    ("8480-6", "Systolic blood pressure", "mm[Hg]"),
    ("62238-1", "eGFR (kidney function)", "mL/min/{1.73_m2}"),
]
LOINC_CODES = [code for code, _, _ in LOINC]


def vocabulary_text() -> str:
    lines = ["Conditions (v_conditions.icd10; also possible in v_encounters.primary_icd10):"]
    lines += [f"  {c}  {d}  [{s}]" for c, d, s in ICD10_CONDITIONS]
    lines.append("Main diagnoses that occur only in v_encounters.primary_icd10:")
    lines += [f"  {c}  {d}  [{s}]" for c, d, s in ICD10_ENCOUNTER_ONLY]
    lines.append("Medications (v_medications.atc):")
    lines += [f"  {c}  {n}  [{s}]" for c, n, s in ATC]
    lines.append("Measurements (v_observations.loinc, unit):")
    lines += [f"  {c}  {n}  {u}" for c, n, u in LOINC]
    lines.append("Regions: " + ", ".join(REGIONS))
    lines.append("Hospitals (data_holder): " + ", ".join(HOSPITALS))
    return "\n".join(lines)
