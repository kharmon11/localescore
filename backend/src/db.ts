import pg from "pg";
import type { QueryResult, QueryResultRow } from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  // Fail loudly and immediately rather than letting every query fail later
  // with a confusing connection error.
  throw new Error(
    "DATABASE_URL is not set. Copy backend/.env.example to backend/.env and fill in your Postgres connection string."
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Without a listener, an idle client's network error crashes the process;
// pg replaces the client automatically once this is handled.
pool.on("error", (err) => {
  console.error("Unexpected error on idle database client:", err);
});

// Everything actually passed to query() across this codebase: plain scalars,
// arrays (e.g. category patterns for `= ANY($1)`), and raw nested objects
// (a GeoJSON FeatureCollection passed straight through for a JSONB column).
// Deliberately excludes things that would be a real mistake to pass as a SQL
// param, like `undefined` (should be `null`) or a function.
type QueryParam = string | number | boolean | null | Date | object;

/**
 * Thin query helper. Kept intentionally dumb; this project uses raw,
 * parameterized SQL for spatial queries rather than an ORM (see
 * docs/design.md section 3.2 for why: PostGIS functions are just SQL, and
 * ORM geometry support tends to get in the way more than it helps).
 */
export async function query<R extends QueryResultRow = any>(
  text: string,
  params?: QueryParam[]
): Promise<QueryResult<R>> {
  return pool.query<R>(text, params);
}
