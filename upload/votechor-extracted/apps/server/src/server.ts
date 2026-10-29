import { createEndpoint, createRouter, defineRoom, defineServer } from "@colyseus/core";
import { CityRoom } from "./CityRoom.ts";

const health = createEndpoint("/health", { method: "GET" }, async () => ({ ok: true, uptime: Math.round(process.uptime()) }));

/** Server definition: rooms + HTTP routes share one transport (matchmaking and /health). */
export function buildServer() {
  const server = defineServer({
    greet: false,
    rooms: { city: defineRoom(CityRoom) },
    routes: createRouter({ health }),
  } as any);
  return { server };
}
