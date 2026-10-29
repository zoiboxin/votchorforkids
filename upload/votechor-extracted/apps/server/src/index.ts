import { z } from "zod";
import { buildServer } from "./server.ts";

const Env = z.object({ PORT: z.coerce.number().int().min(1).max(65535).default(2567) });
const env = Env.parse(process.env);
const { server } = buildServer();
await server.listen(env.PORT);
console.log(`VoteChor server listening on :${env.PORT}  (health: /health)`);
