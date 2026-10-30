from ehds_core.articles import articles_for
from ehds_core.metrics import canonical, decision_correct, numbers_correct


def test_articles_table_matches_expected_shapes():
    assert articles_for("REJECT", False) == ["54"]
    assert articles_for("APPROVE_STATISTICAL", False) == ["53", "69"]
    assert articles_for("APPROVE_STATISTICAL", True) == ["53", "66", "69"]
    assert articles_for("APPROVE_SPE", True) == ["53", "66", "68", "73"]


def test_extra_articles_67_71_allowed():
    exp = {"decision": "APPROVE_SPE", "articles": ["53", "66", "68", "73"]}
    assert decision_correct("APPROVE_SPE", ["53", "66", "67", "68", "71", "73"], exp)
    assert not decision_correct("APPROVE_SPE", ["53", "66", "68"], exp)
    assert not decision_correct("APPROVE_SPE", ["53", "54", "66", "68", "73"], exp)


def test_numbers_layout_and_names_do_not_matter():
    exp = {"Wien": {"women_with_bmi": 14, "mean_bmi": 26.6}, "Tirol": {"women_with_bmi": "<10", "mean_bmi": "suppressed"}}
    got = {"Wien": {"n": 14, "avg": 26.6}, "Tirol": {"avg": "suppressed", "n": "<10"}}
    assert numbers_correct(got, exp)[0]
    assert not numbers_correct({"Wien": {"n": 14, "avg": 26.7}, "Tirol": got["Tirol"]}, exp)[0]
    assert numbers_correct({"Wien": {"stays": 245}}, {"Wien": 245})[0]


def test_canonical_ignores_metric_names():
    a = canonical("APPROVE_STATISTICAL", ["53", "69"], {"Wien": {"x": 1, "y": 2.5}})
    b = canonical("APPROVE_STATISTICAL", ["69", "53"], {"Wien": {"p": 2.5, "q": 1}})
    assert a == b
