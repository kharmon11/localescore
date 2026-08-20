-- 003_prior_acs_vintage_label.sql
-- Adds a text label for the "prior" ACS vintage used in the Growth Trend
-- sub-score (docs/design.md 2.3), mirroring the existing `acs_vintage`
-- column which only ever recorded the "current" vintage. Lets the app report
-- the *actual* years being compared (read from the data itself, not a
-- hardcoded guess) when it surfaces the "this is a multi-year approximation,
-- not a true year-over-year rate" caveat -- see the note in
-- scripts/ingest-census.js and backend/src/routes/score.js.

ALTER TABLE census_block_groups
  ADD COLUMN population_prior_acs_vintage TEXT; -- e.g. '2019-5yr'
