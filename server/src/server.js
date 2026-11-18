import "dotenv/config";
import { buildApp } from "./app.js";

const app = await buildApp();
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  });
}
