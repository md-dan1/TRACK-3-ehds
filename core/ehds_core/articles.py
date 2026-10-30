"""Articles of Regulation (EU) 2025/327, Chapter IV, cited by decisions. Deterministic: the LLM
never picks articles."""

EURLEX = "https://eur-lex.europa.eu/eli/reg/2025/327/oj/eng"

ARTICLES = {
    "53": "Purposes for which health data may be used for secondary use",
    "54": "Prohibited secondary uses",
    "66": "Data minimisation: anonymised first, pseudonymised only when justified",
    "67": "Health data access applications",
    "68": "Data permits",
    "69": "Health data requests (anonymised statistics)",
    "71": "Right to opt out",
    "73": "Secure processing environments",
}

REJECT = "REJECT"
APPROVE_STATISTICAL = "APPROVE_STATISTICAL"
APPROVE_SPE = "APPROVE_SPE"
DECISIONS = [REJECT, APPROVE_STATISTICAL, APPROVE_SPE]

ART54_CATEGORIES = {
    "A": "Decisions detrimental to a person or group based on their health data",
    "B": "Decisions on employment, insurance or credit terms and premiums",
    "C": "Advertising or marketing",
    "D": "Developing harmful products (tobacco, nicotine, alcohol, drugs, weapons)",
    "E": "Activities conflicting with national ethics provisions",
}


def articles_for(decision: str, is_application: bool) -> list[str]:
    if decision == REJECT:
        return ["54"]
    if decision == APPROVE_SPE:
        return ["53", "66", "68", "73"]
    return ["53", "66", "69"] if is_application else ["53", "69"]
