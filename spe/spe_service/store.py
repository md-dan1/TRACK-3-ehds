"""In-memory records of the one session this container serves. Nothing is written to disk: the
records go away with the container."""

from __future__ import annotations

import datetime as dt

# column types of the record tables the hospitals may send (same names as their v_* views)
TYPES = {
    "patient_id": "text", "sex": "text", "birth_date": "date", "region": "text", "data_holder": "text",
    "icd10": "text", "description": "text", "onset_date": "date", "atc": "text", "name": "text",
    "start_date": "date", "end_date": "date", "loinc": "text", "value": "numeric", "unit": "text",
    "date": "date", "encounter_id": "text", "type": "text", "primary_icd10": "text",
}
# the columns each record type arrives with (the hospitals' EXPORT_COLUMNS)
COLUMNS = {
    "patients": ["patient_id", "sex", "birth_date", "region", "data_holder"],
    "conditions": ["patient_id", "icd10", "description", "onset_date"],
    "medications": ["patient_id", "atc", "name", "start_date", "end_date"],
    "observations": ["patient_id", "loinc", "name", "value", "unit", "date"],
    "encounters": ["encounter_id", "patient_id", "data_holder", "type", "start_date", "end_date", "primary_icd10"],
}

_PARSE = {"date": dt.date.fromisoformat, "numeric": float, "text": str}

cohort: set[str] = set()
tables: dict[str, list[list]] = {}
sealed = False


def init(names: list[str]) -> None:
    """Empty tables for the record types the permit allows."""
    global sealed
    cohort.clear()
    tables.clear()
    tables.update({name: [] for name in names})
    sealed = False


def _parse(column: str, value):
    return None if value is None else _PARSE[TYPES[column]](value)


def ingest(patient_ids: list[str], records: dict[str, dict]) -> dict[str, int]:
    """Add one hospital's cohort patients and records (JSON values, dates as ISO strings)."""
    cohort.update(patient_ids)
    added = {"cohort": len(patient_ids)}
    for name, t in records.items():
        cols = t["columns"]
        tables[name].extend([_parse(c, v) for c, v in zip(cols, row)] for row in t["rows"])
        added[name] = len(t["rows"])
    return added


def counts() -> dict[str, int]:
    return {"cohort": len(cohort), **{name: len(rows) for name, rows in tables.items()}}


def seal() -> dict[str, int]:
    """Close ingestion; returns counts only."""
    global sealed
    sealed = True
    return counts()


def load() -> tuple[list[str], dict[str, dict], dict[str, list[tuple[str, str]]]]:
    """Cohort ids, the record tables and their column types: read inside the SPE only."""
    return (sorted(cohort),
            {name: {"columns": COLUMNS[name], "rows": rows} for name, rows in tables.items()},
            {name: [(c, TYPES[c]) for c in COLUMNS[name]] for name in tables})
