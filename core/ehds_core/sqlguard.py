"""SQL guard: validate LLM-written PostgreSQL, split it into per-hospital partial aggregates,
merge the partials centrally with Decimal arithmetic and apply the small-cell rule.

Each patient's records live in exactly one hospital, so patient-level logic (CTEs, EXISTS,
latest value per patient) runs unchanged on every node. Only the outermost SELECT is rewritten:
every aggregate becomes an additive partial (COUNT, SUM, COUNT FILTER), and the output
expressions are re-evaluated over the summed partials."""

from __future__ import annotations

import itertools
import json
import re
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import sqlglot
from sqlglot import exp

from .vocab import DOMAINS

VIEWS = frozenset({"v_patients", "v_conditions", "v_medications", "v_observations", "v_encounters"})
_FORBIDDEN_NAMES = ("Insert", "Update", "Delete", "Drop", "Create", "Alter", "Command", "Copy",
                    "Merge", "Anonymous", "Into", "Lock", "Set", "Transaction", "Commit", "Rollback")
FORBIDDEN = tuple(getattr(exp, n) for n in _FORBIDDEN_NAMES if hasattr(exp, n))
# functions sqlglot does not model that are still harmless: they read nothing but their arguments
SAFE_FUNCTIONS = {"age"}
SMALL_CELL = 10
# prefix of a hospital's 422 detail when its database refused SQL that passed this guard
SQL_FAILED = "SQL failed in the database:"
PATIENT_ID_RE = re.compile(r"\bp-[0-9a-f]{8}\b")
ONE_DECIMAL = Decimal("0.1")


class QueryRejected(ValueError):
    """The SQL breaks the contract; the message is fed back to the LLM for repair."""


# ---------- validation ----------
def _parse(sql: str) -> exp.Expression:
    try:
        statements = [s for s in sqlglot.parse(sql, read="postgres") if s is not None]
    except sqlglot.errors.ParseError as e:
        raise QueryRejected(f"SQL does not parse: {str(e).splitlines()[0]}") from None
    if len(statements) != 1:
        raise QueryRejected("exactly one SQL statement is allowed")
    return statements[0]


def _common_checks(sql: str) -> exp.Select:
    tree = _parse(sql)
    if not isinstance(tree, exp.Select):
        raise QueryRejected("only a single SELECT is allowed (no UNION at the top level, no DDL/DML)")
    funcs = sorted({n.name for n in tree.walk() if isinstance(n, exp.Anonymous) and n.name.lower() not in SAFE_FUNCTIONS})
    if funcs:
        # name them, so a repair can replace them instead of sending the same SQL again
        raise QueryRejected(f"functions not allowed: {', '.join(f + '()' for f in funcs)}. Use standard SQL "
                            "(EXTRACT, CASE, COALESCE, date comparisons such as birth_date <= DATE '2007-12-31')")
    bad = sorted({type(n).__name__ for n in tree.walk() if isinstance(n, FORBIDDEN) and not isinstance(n, exp.Anonymous)})
    if bad:
        raise QueryRejected(f"forbidden statements: {bad}")
    ctes = {c.alias_or_name for c in tree.find_all(exp.CTE)}
    unknown = {t.name for t in tree.find_all(exp.Table)} - VIEWS - ctes
    if unknown:
        raise QueryRejected(f"tables not allowed: {sorted(unknown)}; read only {sorted(VIEWS)}")
    return tree


def _own_aggs(expr: exp.Expression) -> list[exp.AggFunc]:
    """Aggregates of an outer projection, not those inside nested SELECTs (EXISTS, subqueries)."""
    detached = expr.copy()
    return [a for a in detached.find_all(exp.AggFunc) if a.find_ancestor(exp.Select) is None]


def case_labels(case: exp.Case) -> list[exp.Expression]:
    outs = [i.args["true"] for i in case.args["ifs"]]
    if case.args.get("default") is not None:
        outs.append(case.args["default"])
    return outs


def key_domain(tree: exp.Select, body: exp.Expression, depth: int = 0) -> list[str] | None:
    """Full group list of a key: a canonical column, a CASE with literal labels, or a column a CTE
    defines as one of those. Groups outside the list are never released."""
    if isinstance(body, exp.Case):
        labels = case_labels(body)
        if labels and all(isinstance(x, exp.Literal) and x.is_string for x in labels):
            return list(dict.fromkeys(x.this for x in labels))
        return None
    if not isinstance(body, exp.Column) or depth > 5:
        return None
    for cte in tree.find_all(exp.CTE):
        if isinstance(cte.this, exp.Select):
            for proj in cte.this.expressions:
                if isinstance(proj, exp.Alias) and proj.alias == body.name:
                    found = key_domain(tree, proj.unalias(), depth + 1)
                    if found is not None:
                        return found
    return DOMAINS.get(body.name)


def validate_stats(sql: str) -> exp.Select:
    tree = _common_checks(sql)
    if tree.args.get("having"):
        raise QueryRejected("HAVING is not allowed")
    keys, aggs = [], []
    for p in tree.expressions:
        (aggs if _own_aggs(p.unalias()) else keys).append(p)
        if p.find(exp.Window):
            raise QueryRejected(f"window functions are not allowed in the outer SELECT: {p.sql()}")
    if not aggs:
        raise QueryRejected("a statistical query needs aggregates (COUNT, SUM, AVG) in the outer SELECT")
    for k in keys:
        if key_domain(tree, k.unalias()) is None:
            raise QueryRejected(
                f"group key must be one of {sorted(DOMAINS)} or a CASE with literal string labels "
                f"(directly or defined in a CTE): {k.sql()}")
    group = tree.args.get("group")
    if len(group.expressions if group else []) != len(keys):
        raise QueryRejected("GROUP BY must list exactly the non-aggregate output columns")
    return tree


def validate_cohort(sql: str) -> exp.Select:
    tree = _common_checks(sql)
    if len(tree.expressions) != 1 or tree.expressions[0].alias_or_name != "patient_id":
        raise QueryRejected("a cohort query must return exactly one column named patient_id")
    if _own_aggs(tree.expressions[0].unalias()):
        raise QueryRejected("a cohort query returns patient_id values, not aggregates")
    return tree


def validate_node_partials(sql: str) -> exp.Select:
    """What a hospital re-checks before running: the contract, and only additive partials."""
    tree = validate_stats(sql)
    for p in tree.expressions:
        for agg in _own_aggs(p.unalias()):
            if not isinstance(agg, (exp.Count, exp.Sum)):
                raise QueryRejected(f"hospitals only return COUNT/SUM partials, got {agg.sql()}")
    return tree


# ---------- split ----------
@dataclass
class Partial:
    alias: str
    sql: str
    op: str  # how partials combine across hospitals: always "sum"
    is_count: bool


@dataclass
class Output:
    name: str
    expr: exp.Expression
    kind: str  # "count" (count rule) or "ratio" (suppress if a component count < 10)
    counts: list[str]
    is_mean: bool


@dataclass
class Plan:
    keys: list[str]
    domains: list[list[str]]
    partials: list[Partial]
    outputs: list[Output]
    node_sql: str
    original_sql: str = ""
    dropped_groups: list[str] = field(default_factory=list)

    def describe(self) -> dict:
        return {
            "group_keys": self.keys,
            "groups": self.domains,
            "partials": [p.__dict__ for p in self.partials],
            "outputs": [{"name": o.name, "merge_expression": o.expr.sql(dialect="postgres"),
                         "rule": o.kind, "count_components": o.counts, "is_mean": o.is_mean}
                        for o in self.outputs],
            "node_sql": self.node_sql,
        }


def _is_indicator(e: exp.Expression) -> bool:
    """CASE WHEN ... THEN 1 ELSE 0 END: a SUM of it is a count."""
    e = e.unnest() if isinstance(e, exp.Paren) else e
    if isinstance(e, exp.Case):
        outs = case_labels(e)
        return bool(outs) and all(isinstance(o, exp.Literal) and not o.is_string and
                                  Decimal(o.this) in (0, 1) for o in outs)
    return False


def split(tree: exp.Select) -> Plan:
    keys: list[tuple[str, exp.Expression]] = []
    outputs: list[Output] = []
    partials: list[Partial] = []

    def add(node_expr: exp.Expression, is_count: bool) -> str:
        alias = f"_p{len(partials)}"
        partials.append(Partial(alias, node_expr.sql(dialect="postgres"), "sum", is_count))
        node_exprs.append(exp.alias_(node_expr, alias))
        return alias

    node_exprs: list[exp.Expression] = []
    for proj in tree.expressions:
        name, body = proj.alias_or_name, proj.unalias()
        if not _own_aggs(body):
            keys.append((name, body))
            continue
        reduced = body.copy()
        counts: list[str] = []
        is_mean = False

        def swap(unit: exp.Expression, new: exp.Expression) -> None:
            nonlocal reduced
            if unit is reduced:
                reduced = new
            else:
                unit.replace(new)

        for agg in [a for a in reduced.find_all(exp.AggFunc) if a.find_ancestor(exp.Select) is None]:
            unit = agg.parent if isinstance(agg.parent, exp.Filter) else agg
            filt = unit.expression.copy() if isinstance(unit, exp.Filter) else None

            def wrap(a: exp.Expression, filt=filt) -> exp.Expression:
                return exp.Filter(this=a, expression=filt.copy()) if filt is not None else a

            if isinstance(agg, exp.Count):
                arg = agg.this
                if isinstance(arg, exp.Distinct):
                    cols = {c.name for c in arg.find_all(exp.Column)}
                    if not cols or cols - {"patient_id", "encounter_id"}:
                        raise QueryRejected("COUNT(DISTINCT ...) is only allowed on patient_id or encounter_id")
                a = add(unit.copy(), True)
                counts.append(a)
                swap(unit, exp.column(a))
            elif isinstance(agg, exp.Sum):
                indicator = _is_indicator(agg.this)
                a = add(unit.copy(), indicator)
                if indicator:
                    counts.append(a)
                swap(unit, exp.column(a))
            elif isinstance(agg, exp.Avg):
                s = add(wrap(exp.Sum(this=agg.this.copy())), _is_indicator(agg.this))
                n = add(wrap(exp.Count(this=agg.this.copy())), True)
                counts.append(n)
                is_mean = not _is_indicator(agg.this)
                if _is_indicator(agg.this):
                    counts.append(s)
                swap(unit, exp.Paren(this=exp.Div(this=exp.column(s), expression=exp.column(n))))
            elif isinstance(agg, (exp.Min, exp.Max)):
                raise QueryRejected("MIN/MAX are not allowed: an extreme value is one patient's value")
            else:
                raise QueryRejected(f"aggregate cannot be split across hospitals: {agg.sql()}; "
                                    "use COUNT, SUM or AVG")
        if not counts:
            raise QueryRejected(f"output {name} has no count, so the small-cell rule cannot apply; "
                                "use COUNT or AVG instead of a bare SUM of values")
        has_div = bool(reduced.find(exp.Div)) or isinstance(reduced, exp.Div)
        kind = "ratio" if has_div else "count"
        outputs.append(Output(name, reduced, kind, counts, is_mean))

    # a mean is never released without the number of patients it is based on
    means = [o for o in outputs if o.is_mean]
    if means and not any(o.kind == "count" for o in outputs):
        base = means[0].counts[0]
        outputs.insert(0, Output("n", exp.column(base), "count", [base], False))

    node = tree.copy()
    node.set("expressions", [exp.alias_(k.copy(), n) for n, k in keys] + node_exprs)
    node.set("group", exp.Group(expressions=[exp.Literal.number(i + 1) for i in range(len(keys))])
             if keys else None)
    node.set("order", None)
    node.set("limit", None)
    node.set("offset", None)
    domains = [key_domain(tree, k) for _, k in keys]
    return Plan(keys=[n for n, _ in keys], domains=domains, partials=partials, outputs=outputs,
                node_sql=node.sql(dialect="postgres"), original_sql=tree.sql(dialect="postgres"))


# ---------- merge + small-cell rule ----------
def _evaluate(e: exp.Expression, env: dict[str, Decimal | None]) -> Decimal | None:
    if isinstance(e, (exp.Paren, exp.Cast, exp.Round)):
        return _evaluate(e.this, env)  # rounding is the release gate's job, half up
    if isinstance(e, exp.Column):
        return env[e.name]
    if isinstance(e, exp.Literal) and not e.is_string:
        return Decimal(e.this)
    if isinstance(e, exp.Neg):
        v = _evaluate(e.this, env)
        return None if v is None else -v
    if isinstance(e, exp.Nullif):
        a, b = _evaluate(e.this, env), _evaluate(e.expression, env)
        return None if a == b else a
    if isinstance(e, exp.Coalesce):
        for x in [e.this, *e.expressions]:
            v = _evaluate(x, env)
            if v is not None:
                return v
        return None
    if isinstance(e, (exp.Add, exp.Sub, exp.Mul, exp.Div)):
        a, b = _evaluate(e.this, env), _evaluate(e.expression, env)
        if a is None or b is None:
            return None
        if isinstance(e, exp.Div):
            return None if b == 0 else a / b
        return a + b if isinstance(e, exp.Add) else a - b if isinstance(e, exp.Sub) else a * b
    raise QueryRejected(f"expression not supported in the central merge: {e.sql()}")


def _label(key: tuple) -> str:
    return " | ".join(map(str, key)) if key else "all"


def merge_and_release(plan: Plan, node_rows: list[list[list[Any]]]) -> dict:
    """Sum the partials of all hospitals per group, evaluate outputs, apply the small-cell rule.
    Returns the released table plus internal per-cell metadata (never shown to anyone)."""
    nk = len(plan.keys)
    acc: dict[tuple, list[Decimal]] = {}
    for rows in node_rows:
        for r in rows:
            key = tuple(None if v is None else str(v) for v in r[:nk])
            vals = [Decimal(str(v)) if v is not None else Decimal(0) for v in r[nk:]]
            prev = acc.get(key)
            acc[key] = vals if prev is None else [a + b for a, b in zip(prev, vals)]
    domain = list(itertools.product(*plan.domains))
    dropped = sorted(_label(k) for k in acc if k not in set(domain))

    rows_out, by_group, suppression, internal = [], {}, [], {}
    for key in domain:
        vals = acc.get(key) or [Decimal(0)] * len(plan.partials)
        env = {p.alias: v for p, v in zip(plan.partials, vals)}
        label = _label(key)
        cells, meta = {}, {}
        for o in plan.outputs:
            value = _evaluate(o.expr, env)
            min_count = min(env[c] for c in o.counts)
            if o.kind == "count":
                if value is None or value < SMALL_CELL:
                    cells[o.name] = "<10"
                    suppression.append({"group": label, "metric": o.name, "rule": "count below 10"})
                else:
                    cells[o.name] = int(value) if value == value.to_integral_value() else \
                        float(value.quantize(ONE_DECIMAL, ROUND_HALF_UP))
            elif value is None or min_count < SMALL_CELL:
                cells[o.name] = "suppressed"
                rule = "mean of fewer than 10 patients" if o.is_mean else "numerator or denominator below 10"
                suppression.append({"group": label, "metric": o.name, "rule": rule})
            else:
                cells[o.name] = float(value.quantize(ONE_DECIMAL, ROUND_HALF_UP))
            meta[o.name] = {"rule": o.kind, "min_count": int(min_count),
                            "value_below_10": value is None or value < SMALL_CELL}
        by_group[label] = cells
        rows_out.append({**dict(zip(plan.keys, key)), **cells})
        internal[label] = meta

    released = {
        "group_keys": plan.keys,
        "columns": plan.keys + [o.name for o in plan.outputs],
        "rows": rows_out,
        "by_group": by_group,
        "suppression": suppression,
        "cells": len(domain) * len(plan.outputs),
    }
    problems = leak_check(released, internal)
    if problems:  # last line of defence: never release
        raise RuntimeError(f"release gate blocked the result: {problems}")
    released["privacy_checks"] = {
        "all_groups_present": True,
        "no_patient_ids": True,
        "no_counts_below_10": True,
        "small_ratios_suppressed": True,
        "groups_outside_request_dropped": dropped,
    }
    return {"released": released, "internal": internal, "dropped_groups": dropped}


def leak_check(released: dict, internal: dict) -> list[str]:
    """Independent re-check of a released table: no patient identifiers, no shown count below 10,
    no shown ratio or mean built on a count below 10."""
    problems = []
    if PATIENT_ID_RE.search(json.dumps(released, ensure_ascii=False)):
        problems.append("patient identifier in output")
    for group, cells in released["by_group"].items():
        for metric, v in cells.items():
            meta = internal[group][metric]
            if meta["rule"] == "count" and isinstance(v, (int, float)) and v < SMALL_CELL:
                problems.append(f"{group}/{metric}: count below 10 shown")
            if meta["rule"] == "ratio" and isinstance(v, (int, float)) and meta["min_count"] < SMALL_CELL:
                problems.append(f"{group}/{metric}: value shown with a count below 10")
    return problems
