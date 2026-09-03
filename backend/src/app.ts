import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import type { Request, Response } from "express";
import cors from "cors";
import { scoreRouter } from "./routes/score.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(",");
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => res.json({ ok: true }));
app.use(scoreRouter);

app.use(express.static(path.join(__dirname, "../public")));
app.get("/{*splat}", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});
