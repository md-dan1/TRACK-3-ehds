"""The session container's in-memory store gives analysis the same types the database did."""

import datetime as dt

from spe_service import store


def test_ingest_parses_types_and_load_keeps_shape():
    store.init(["patients", "observations"])
    store.ingest(["p-2", "p-1"], {
        "patients": {"columns": store.COLUMNS["patients"], "rows": [["p-1", "F", "1970-05-01", "Nord", "Klinikum Nord"]]},
        "observations": {"columns": store.COLUMNS["observations"], "rows": [["p-1", "4548-4", "HbA1c", "7.1", "%", None]]},
    })
    store.ingest(["p-1"], {})
    assert store.seal() == {"cohort": 2, "patients": 1, "observations": 1}
    cohort, tables, columns = store.load()
    assert cohort == ["p-1", "p-2"]
    assert tables["patients"]["rows"][0][2] == dt.date(1970, 5, 1)
    assert tables["observations"]["rows"][0][3] == 7.1 and tables["observations"]["rows"][0][5] is None
    assert columns["observations"][3] == ("value", "numeric")
