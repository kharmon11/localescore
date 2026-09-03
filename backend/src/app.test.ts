import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Server } from "node:http";

// app.ts mounts scoreRouter, which pulls in db.ts; same stubbing as
// score.test.ts/db.test.ts, needed before the dynamic import below.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.ORS_API_KEY ??= "test-key";
process.env.CORS_ORIGINS = "http://allowed.example";
const { app } = await import("./app.ts");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The real public/ dir only exists after the Docker build copies the built
// frontend in (see backend/Dockerfile); it doesn't exist in dev/test, so the
// SPA-fallback route has nothing to serve. Fixture it for the duration of
// this file rather than requiring a real frontend build to test routing.
const publicDir = path.join(__dirname, "../public");
const indexHtmlPath = path.join(publicDir, "index.html");
const assetPath = path.join(publicDir, "real-asset.txt");
let createdPublicDir = false;

before(() => {
  createdPublicDir = !fs.existsSync(publicDir);
  fs.mkdirSync(publicDir, { recursive: true });
  fs.writeFileSync(indexHtmlPath, "<!doctype html><title>fixture</title>");
  fs.writeFileSync(assetPath, "real static asset");
});

after(() => {
  if (createdPublicDir) {
    fs.rmSync(publicDir, { recursive: true, force: true });
  } else {
    fs.rmSync(indexHtmlPath, { force: true });
    fs.rmSync(assetPath, { force: true });
  }
});

function startServer(): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function withApp(fn: (port: number) => Promise<void>): Promise<void> {
  const server = await startServer();
  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("GET /health returns ok", async () => {
  await withApp(async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });
});

test("scoreRouter is mounted on the real app", async () => {
  await withApp(async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 999, lng: 0, subtype: "coffee_shop" }),
    });
    assert.equal(res.status, 400);
  });
});

test("a real static asset in public/ is served by express.static, not the SPA fallback", async () => {
  await withApp(async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/real-asset.txt`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "real static asset");
  });
});

test("GET / falls back to index.html (SPA fallback matches the root path)", async () => {
  await withApp(async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /fixture/);
  });
});

test("an unknown deep path falls back to index.html (client-side routing)", async () => {
  await withApp(async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/some/deep/nested/route`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /fixture/);
  });
});

test("CORS allows a configured origin", async () => {
  await withApp(async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { Origin: "http://allowed.example" },
    });
    assert.equal(res.headers.get("access-control-allow-origin"), "http://allowed.example");
  });
});

test("CORS omits the allow-origin header for a disallowed origin", async () => {
  await withApp(async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { Origin: "http://evil.example" },
    });
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  });
});
