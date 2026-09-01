import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import { scoreRouter } from "./routes/score.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(",");
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use(scoreRouter);

app.use(express.static(path.join(__dirname, "../public")));
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});
