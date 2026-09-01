import { test } from "node:test";
import assert from "node:assert/strict";

// db.js throws at import time if DATABASE_URL isn't set. Tests never make a
// real connection (pool.query is always mocked below), so a dummy value is
// fine. It just needs to be set before db.js is evaluated, hence the
// dynamic import after this assignment (a static `import` at the top of the
// file would be hoisted ahead of this line).
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
const { pool, query } = await import("./db.js");

test("query() delegates to pool.query with the same args and returns its result", async () => {
  const originalQuery = pool.query;
  const calls = [];
  const fakeResult = { rows: [{ n: 1 }] };
  pool.query = (text, params) => {
    calls.push({ text, params });
    return Promise.resolve(fakeResult);
  };

  try {
    const result = await query("SELECT 1 AS n WHERE $1 = $1", [42]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].text, "SELECT 1 AS n WHERE $1 = $1");
    assert.deepEqual(calls[0].params, [42]);
    assert.equal(result, fakeResult);
  } finally {
    pool.query = originalQuery;
  }
});

test("pool.on('error', ...) logs an idle client error instead of throwing", () => {
  const originalConsoleError = console.error;
  const loggedArgs = [];
  console.error = (...args) => {
    loggedArgs.push(args);
  };

  try {
    const idleClientError = new Error("read ECONNRESET");
    // Emitting "error" on an EventEmitter with no listener throws; if this
    // repo's pool.on("error", ...) handler is wired up, this just logs.
    pool.emit("error", idleClientError);

    assert.equal(loggedArgs.length, 1);
    assert.equal(loggedArgs[0][0], "Unexpected error on idle database client:");
    assert.equal(loggedArgs[0][1], idleClientError);
  } finally {
    console.error = originalConsoleError;
  }
});
