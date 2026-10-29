#!/usr/bin/env bash
# Runs inside the Postgres initdb hook.
# HOSPITAL_DATA_DIR is injected via docker-compose environment.
set -euo pipefail

psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" \
     --dbname   "$POSTGRES_DB" \
     <<SQL

CREATE TABLE patients (
    patient_id  TEXT PRIMARY KEY,
    sex         TEXT,
    birth_date  DATE,
    region      TEXT,
    data_holder TEXT,
    opted_out   BOOLEAN
);

CREATE TABLE conditions (
    patient_id  TEXT,
    icd10       TEXT,
    description TEXT,
    onset_date  DATE
);

CREATE TABLE medications (
    patient_id TEXT,
    atc        TEXT,
    name       TEXT,
    start_date DATE,
    end_date   DATE
);

CREATE TABLE observations (
    patient_id TEXT,
    loinc      TEXT,
    name       TEXT,
    value      NUMERIC,
    unit       TEXT,
    date       DATE
);

CREATE TABLE encounters (
    encounter_id  TEXT PRIMARY KEY,
    patient_id    TEXT,
    data_holder   TEXT,
    type          TEXT,
    start_date    DATE,
    end_date      DATE,
    primary_icd10 TEXT
);

\copy patients     FROM '${HOSPITAL_DATA_DIR}/patients.csv'     CSV HEADER
\copy conditions   FROM '${HOSPITAL_DATA_DIR}/conditions.csv'   CSV HEADER
\copy medications  FROM '${HOSPITAL_DATA_DIR}/medications.csv'  CSV HEADER
\copy observations FROM '${HOSPITAL_DATA_DIR}/observations.csv' CSV HEADER
\copy encounters   FROM '${HOSPITAL_DATA_DIR}/encounters.csv'   CSV HEADER

SQL
