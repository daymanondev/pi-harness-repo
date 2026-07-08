-- Harness schema migration 009
-- pi-harness extension: link a slice story to its parent initiative intake.
--
-- Upstream repository-harness models an initiative as a `new_initiative` intake
-- (docs/FEATURE_INTAKE.md, ADR-0010) plus initiative notes — NOT as a parent
-- story. This column gives each slice story a direct, 1-hop reference to the
-- initiative intake it belongs to, so the dashboard can render an
-- initiative -> slices hierarchy without inventing a parent "initiative story"
-- (which would drift from upstream theory).
--
-- Additive + nullable: does not alter existing rows, columns, or constraints.
-- The prebuilt Rust CLI (ADR-0005) has no command for this column yet, so it
-- is read and written through `harness-cli query sql` (verified write-capable).
-- The kicker sets it when decomposing an initiative into slices.

PRAGMA foreign_keys = ON;

ALTER TABLE story ADD COLUMN parent_intake_id INTEGER REFERENCES intake(id);

CREATE INDEX IF NOT EXISTS idx_story_parent_intake
    ON story(parent_intake_id);

INSERT INTO schema_version (version) VALUES (9);
