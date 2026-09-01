import { app } from "./app.js";

const port = process.env.PORT ?? 8787;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`localescore backend listening on http://localhost:${port}`);
});
