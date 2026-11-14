// Check terrainHeight along the cemetery lane and around the graveyard
const seed = 1337;
// replicate rng + terrainHeight from src/lib/game/worldgen.ts
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
// hash2 helper (copied conceptually) — instead, import the real module via tsx-like eval
