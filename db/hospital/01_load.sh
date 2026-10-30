#!/bin/sh
# Initialises one hospital database with only that hospital's patients (HOSPITAL env var).
# The federation role can read only the v_* views, which leave out opted-out patients (Art. 71).
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v hospital="$HOSPITAL" -v fed_pw="$FEDERATION_PASSWORD" <<'SQL'
CREATE TABLE patients (patient_id text PRIMARY KEY, sex text NOT NULL, birth_date date NOT NULL,
                       region text NOT NULL, data_holder text NOT NULL, opted_out boolean NOT NULL);
CREATE TABLE conditions (patient_id text NOT NULL REFERENCES patients, icd10 text NOT NULL,
                         description text, onset_date date);
CREATE TABLE medications (patient_id text NOT NULL REFERENCES patients, atc text NOT NULL, name text,
                          start_date date, end_date date);
CREATE TABLE observations (patient_id text NOT NULL REFERENCES patients, loinc text NOT NULL, name text,
                           value numeric, unit text, date date);
CREATE TABLE encounters (encounter_id text PRIMARY KEY, patient_id text NOT NULL REFERENCES patients,
                         data_holder text NOT NULL, type text NOT NULL, start_date date, end_date date,
                         primary_icd10 text);

-- stage the shared synthetic CSVs, keep only this hospital's patients and their records
CREATE TEMP TABLE s_patients (LIKE patients);
CREATE TEMP TABLE s_conditions (LIKE conditions);
CREATE TEMP TABLE s_medications (LIKE medications);
CREATE TEMP TABLE s_observations (LIKE observations);
CREATE TEMP TABLE s_encounters (LIKE encounters);
COPY s_patients FROM '/seed/patients.csv' WITH (FORMAT csv, HEADER true, NULL '');
COPY s_conditions FROM '/seed/conditions.csv' WITH (FORMAT csv, HEADER true, NULL '');
COPY s_medications FROM '/seed/medications.csv' WITH (FORMAT csv, HEADER true, NULL '');
COPY s_observations FROM '/seed/observations.csv' WITH (FORMAT csv, HEADER true, NULL '');
COPY s_encounters FROM '/seed/encounters.csv' WITH (FORMAT csv, HEADER true, NULL '');
INSERT INTO patients SELECT * FROM s_patients WHERE data_holder = :'hospital';
INSERT INTO conditions SELECT * FROM s_conditions WHERE patient_id IN (SELECT patient_id FROM patients);
INSERT INTO medications SELECT * FROM s_medications WHERE patient_id IN (SELECT patient_id FROM patients);
INSERT INTO observations SELECT * FROM s_observations WHERE patient_id IN (SELECT patient_id FROM patients);
INSERT INTO encounters SELECT * FROM s_encounters WHERE patient_id IN (SELECT patient_id FROM patients);

CREATE INDEX ON conditions (patient_id);
CREATE INDEX ON conditions (icd10);
CREATE INDEX ON medications (patient_id);
CREATE INDEX ON observations (patient_id, loinc, date);
CREATE INDEX ON encounters (patient_id);

-- opt-out enforced in the only objects the federation can read
CREATE VIEW v_patients AS SELECT * FROM patients WHERE NOT opted_out;
CREATE VIEW v_conditions AS SELECT c.* FROM conditions c JOIN v_patients p USING (patient_id);
CREATE VIEW v_medications AS SELECT m.* FROM medications m JOIN v_patients p USING (patient_id);
CREATE VIEW v_observations AS SELECT o.* FROM observations o JOIN v_patients p USING (patient_id);
CREATE VIEW v_encounters AS SELECT e.* FROM encounters e JOIN v_patients p USING (patient_id);

CREATE ROLE federation_ro LOGIN PASSWORD :'fed_pw';
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO federation_ro;
GRANT SELECT ON v_patients, v_conditions, v_medications, v_observations, v_encounters TO federation_ro;
ALTER ROLE federation_ro SET default_transaction_read_only = on;
ALTER ROLE federation_ro SET statement_timeout = '10s';
ANALYZE;
SQL
