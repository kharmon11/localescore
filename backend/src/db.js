import pg from "pg";

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

/**
 * Thin query helper. Kept intentionally dumb -- this project uses raw,
 * parameterized SQL for spatial queries rather than an ORM (see
 * docs/design.md section 3.2 for why: PostGIS functions are just SQL, and
 * ORM geometry support tends to get in the way more than it helps).
 */
export async function query(text, params) {
  return pool.query(text, params);
}
