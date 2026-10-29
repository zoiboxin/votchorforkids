# Progress
## Done (verified by tests)
- [x] Monorepo, shared protocol, deterministic world, shared movement sim
- [x] Character creator (faction, boy/girl, age group, colours) + procedural 3D characters
- [x] Authoritative Colyseus server, 100-entity rooms, 99-bot fill/replace rule, 20 s reconnection window
- [x] Input validation + strike-based kick, name sanitising, /health endpoint
- [x] City, farmland, jungle, graveyard, mountain wall, day/night synced from server
- [x] Police AI (patrol, notice, chase, bump damage, escape, detention + release), wanted stars
- [x] Items: 45 server-spawned food/first-aid pickups, server-validated proximity, health/stamina caps, 25 s respawn, pickup message + sound
- [x] Creatures: 14 zombies (graveyard, chase unprotected players, faster at night, -4 hp and -15 stamina on touch) and 26 harmless animals that wander and flee; server AI, replicated, rendered
- [x] Generic server `hurt()` (cooldown, spawn protection, detention at 0 hp) + `hit` message to the client
- [x] Squads: create/join by 4-letter code, max 4, leave; squad panel, teammate bars, minimap markers
- [x] Rescue: squadmates free a detained teammate with E (within 3.5 m), +1 support point, server-validated
- [x] Boss "The Great Vote Collector": server state machine, 5 phases (speech, bureaucracy, giant stamp, teamwork, final vote), telegraphed hazards, difficulty setting (room option `difficulty`), victory/failure, rewards once per player, replayable
- [x] Boss client: arena ring, boss + shield, hazard telegraphs, document piles, plates, ballot box, boss HUD and prompts
- [x] Client prediction + interpolation, HUD, minimap, zone ambience, captions
## Not built yet (next, in order)
1. PostgreSQL profiles, XP, achievements, leaderboards (support points are in-room only for now)
2. Inventory/throwables  3. Mobile touch controls
4. Interest management, LOD, instanced characters  5. Playwright suite in CI, load test at 100 real clients
6. Real GLB art and audio assets  7. Boss music/voice lines, private rooms with join codes, chat moderation
