# VoteChor: The Great Parliament Run

Browser-based 3D multiplayer action-comedy. Stack: TypeScript, React 19, Three.js + React Three Fiber, Vite 8,
Zustand, Colyseus 0.18 (authoritative server), Zod 4, Vitest 5.

## Run locally
```bash
npm install
npm run dev:server      # ws://localhost:2567  (health: http://localhost:2567/health)
npm run dev:game        # http://localhost:5173  (open in two tabs to see multiplayer)
npm test                # unit + live multi-client integration tests
npm run typecheck && npm run build
```

## Layout
- `packages/shared` - constants, Zod protocol, deterministic world generator, movement sim, bot-fill rule.
- `apps/server` - Colyseus `CityRoom` (100 entities), police AI, detention, health, day/night clock.
- `apps/game` - R3F client: character creator, world, prediction, interpolation, HUD, minimap, audio.

## How multiplayer works
Clients send input intent (`{f,r,yaw,sprint,jump}`, validated by Zod, rate-limited). The server runs the same
`stepBody` as the client, owns position, health, stamina, detention and police AI, and replicates delta state at 20 Hz.
Every room holds 100 entities: a join removes one AI filler bot, a leave adds one back. At 100 real players Colyseus
locks the room and the next player opens a new room starting with 99 bots. Bots are never counted as players.

## Gameplay systems
Police chase + detention, food pickups, zombies and animals, squads (4 max) with rescue, and the 5-phase boss
(stand in the arena north of the city to summon it). Room options: `difficulty` (easy|normal|hard), `minBossPlayers`.

## Deploy
Server: `docker build -t votechor-server . && docker run -p 2567:2567 votechor-server`, behind a TLS proxy
(Caddy/nginx/Cloudflare) forwarding WebSocket upgrades on `wss://api.votechor.app`.
Client: `VITE_SERVER_URL=wss://api.votechor.app npm run build`, host `apps/game/dist` on any static host for votechor.app.
