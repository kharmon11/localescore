import "dotenv/config";
import express from "express";
import cors from "cors";
import { scoreRouter } from "./routes/score.js";

const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(",");
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use(scoreRouter);

const port = process.env.PORT ?? 8787;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`localescore backend listening on http://localhost:${port}`);
});
