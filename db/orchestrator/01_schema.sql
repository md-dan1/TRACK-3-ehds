-- Access body database: requests with their pipeline state, append-only audit log, LLM cache.
CREATE TABLE requests (
    run_id      text PRIMARY KEY,
    reference   text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    intake_mode text NOT NULL,
    status      text NOT NULL,
    decision    text,
    payload     jsonb NOT NULL,
    state       jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX ON requests (created_at DESC);

CREATE TABLE audit_log (
    id          bigserial PRIMARY KEY,
    run_id      text,
    ts          timestamptz NOT NULL DEFAULT clock_timestamp(),
    actor       text NOT NULL,
    step        text NOT NULL,
    level       text NOT NULL DEFAULT 'info',
    message     text NOT NULL DEFAULT '',
    duration_ms integer,
    payload     jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX ON audit_log (run_id, id);

CREATE FUNCTION audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only';
END $$;
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_append_only();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION audit_append_only();

CREATE TABLE llm_cache (
    key        text PRIMARY KEY,
    response   jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE benchmarks (
    id         text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    status     text NOT NULL,
    report     jsonb NOT NULL DEFAULT '{}'
);
