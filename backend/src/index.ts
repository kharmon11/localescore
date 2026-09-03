import { app } from "./app.ts";

const port = process.env.PORT ?? 8787;
app.listen(port, () => {
  console.log(`localescore backend listening on http://localhost:${port}`);
});
