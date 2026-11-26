/**
 * 7Nights net protocol — compact binary player-state packets.
 *
 * Every client publishes ONLY its own survivor @ ~12 Hz as a 12-byte packet:
 *
 *   ┌──────┬────────┬────────┬─────┬───────┬────┬───────┬──────┬──────┐
 *   │ slot │ x      │ z      │ y   │ yaw   │ hp │ flags │ ci   │ down │
 *   │ u8   │ i16×10 │ i16×10 │ u8×4│ u8    │ u8 │ u8    │ u16  │ u8   │
 *   └──────┴────────┴────────┴─────┴───────┴────┴───────┴──────┴──────┘
 *
 *   `y` — ✈️ THE DROP: the byte rides the absolute altitude at ×4 (max
 *   63.75 u, 25 cm steps). Freefall/chute altitudes (ship cruise 62 u) now
 *   replicate whole — peers SEE each other jump from the dropship, fall and
 *   land. The old ×8 packed clamped at 25.5 u: a skydiver on every other
 *   screen teleported to that ceiling for the whole flight.
 *
 *   `down` — 🥊 the floored/get-up clock (added for cross-wire PvP: when a
 *   rival's punch FLOORS you, every peer's mirror plays the fall + push-off):
 *     0        = standing
 *     1..120   = floored — downT seconds remaining = byte / 40
 *     121..240 = getting up — getupT seconds remaining = (byte − 121) / 40
 *
 * flags bits: 0 sprint · 1 airborne · 2 beast · 3 dead · 4 driving · 5 attackAnim
 *                        · 6 riding (passenger — inside a car someone else drives)
 *                        · 7 paused (personal pause / AFK — the town kept living,
 *                          their body stands still; peers show a ⏸ tag)
 *
 * `ci` is the car index they occupy — the car they DRIVE or ride shotgun in
 * (0xffff = on foot). The deterministic world makes the index mean the SAME
 * vehicle on every client, so peers can seat drivers & passengers on the
 * open-top car styles (jeep / bus / van / convertible) exactly like the
 * local driver's body is glued to its seat — nobody inside a shared car
 * vanishes from the other screens any more.
 *
 * A DRIVER additionally publishes a 8-byte car packet @15 Hz on `mp:car` so
 * every peer sees the vehicle MOVE (and its lamps BLAZE) in real time:
 *
 *   ┌──────┬────────┬────────┬─────┬───────┐
 *   │ ci   │ x      │ z      │ rot │ flags │
 *   │ u16  │ i16×10 │ i16×10 │ u8  │ u8    │
 *   └──────┴────────┴────────┴─────┴───────┘
 *
 * flags bits (car): 0 headlights on. `ci` indexes world.cars — the world is
 * deterministic (seed 1337), so the same index means the same vehicle on
 * every client. rot quantizes to 1.4° — plenty for a mirrored body pose.
 *
 * Quantization: the world is a 712 u-radius disc (walls at ±712, mountains at
 * 610) → i16 with 0.1 u steps covers ±3276 u at 10 cm resolution. (The old
 * ×100 scale clamped at ±320 u — anyone who drove past that got PACKED to the
 * 320 mark, so remote souls teleported to the map corner and players literally
 * could not see each other. 🐛) 9 bytes/soul @ 12 Hz ≈ 108 B/s per player
 * uplink — fast enough for a school Wi-Fi laptop farm.
 *
 * Implemented with ArrayBuffer/DataView — identical on browsers (socket.io
 * treats it as a native binary attachment) and on the Bun/Node relay.
 */

export const STATE_BYTES = 12;

/** Encode the local floored/get-up clocks into one state byte (0 = standing).
 *  Down clock decays in 1/40 s steps (a ~0.94 s lie → byte ≈ 38); the get-up
 *  push-off runs 1 → 0 over ~1.05 s → byte ≈ 161. Both fit their slots with
 *  headroom for a longer lie. */
export function packDown(downT: number, getupT: number): number {
  if (downT > 0) return Math.max(1, Math.min(120, Math.round(downT * 40)));
  if (getupT > 0) return Math.max(121, Math.min(240, 121 + Math.round(getupT * 40)));
  return 0;
}

/** Decode a state byte back into { downT, getupT } — 0 = standing. */
export function unpackDown(b: number): { downT: number; getupT: number } {
  if (b >= 1 && b <= 120) return { downT: b / 40, getupT: 0 };
  if (b >= 121 && b <= 240) return { downT: 0, getupT: (b - 121) / 40 };
  return { downT: 0, getupT: 0 };
}

/** car index meaning "on foot" (no drive / no ride) in the state packet */
export const CARIDX_NONE = 0xffff;

export const FLAG_SPRINT = 1 << 0;
export const FLAG_AIR = 1 << 1;
export const FLAG_BEAST = 1 << 2;
export const FLAG_DEAD = 1 << 3;
export const FLAG_DRIVE = 1 << 4;
export const FLAG_ATTACK = 1 << 5;
export const FLAG_RIDE = 1 << 6;
export const FLAG_PAUSE = 1 << 7;

export const CAR_BYTES = 8;
export const CARFLAG_LIGHTS = 1 << 0;

/* ---------------- 🧟 AI replication — the host's horde is the truth ----------------
 * Every client used to simulate its OWN zombies/hunters/hounds with local RNG:
 * the host's night had beasts A/B/C hunting it while a guest stared at beasts
 * D/E/F hunting THEM — two players standing side by side saw two different
 * nights. Now the host broadcasts the night's AI poses and guests mirror them
 * (narrow replication of shared facts — same principle as the car stream).
 *
 * One `mp:ai` packet = 2-byte header + N×7-byte entries:
 *
 *   ┌──────┬───────┬─────────┬──────────────────────────────────────┐
 *   │ kind │ count │ idx u8  │ x i16×10 │ z i16×10 │ yaw u8 │ flags u8 │
 *   │ u8   │ u8    │ per ent │      per entity: 7 bytes           │
 *   └──────┴───────┴─────────┴──────────────────────────────────────┘
 *
 * kind: 0 zombies (array index over world zombies) · 1 hunters (possessed crew
 * index) · 2 hounds (zombie-dog index over the animals array). The arrays are
 * rebuilt deterministically from the shared roster, so an index means the SAME
 * beast on every client. flags: 1 dead (fall anim) · 2 attackAnim (claw swipe).
 * ~60 zombies = 422 B @ 12 Hz ≈ 5 KB/s uplink on the host — nothing. */

export const AIKIND_ZOMBIE = 0;
export const AIKIND_HUNTER = 1;
export const AIKIND_HOUND = 2;
/** 🤖 crew contestants — the 99 seeded bots. The HOST's bot town is the truth
 *  (foraging, hiding, joyriding); guests mirror the poses from this stream
 *  instead of running private RNG divergent brains, so every screen shows the
 *  SAME bots walking the SAME streets (and the same food still on the ground). */
export const AIKIND_CREW = 3;

export const AI_ENTRY_BYTES = 7;

/** One decoded AI snapshot entry (engine consumes these in applyNetAi). */
export interface AiEntry {
  idx: number;
  x: number; z: number;
  yaw: number;
  dead: boolean;
  atk: boolean;
}

const AI_FLAG_DEAD = 1 << 0;
const AI_FLAG_ATK = 1 << 1;

/** Pack one AI stream packet (header + entries). Empty entries → null. */
export function packAi(kind: number, entries: AiEntry[]): ArrayBuffer | null {
  if (!entries.length) return null;
  const buf = new ArrayBuffer(2 + entries.length * AI_ENTRY_BYTES);
  const v = new DataView(buf);
  v.setUint8(0, kind & 0xff);
  v.setUint8(1, Math.min(255, entries.length));
  let o = 2;
  for (const e of entries) {
    v.setUint8(o, Math.max(0, Math.min(255, Math.round(e.idx))));
    v.setInt16(o + 1, Math.round(Math.max(-3276, Math.min(3276, e.x)) * 10), true);
    v.setInt16(o + 3, Math.round(Math.max(-3276, Math.min(3276, e.z)) * 10), true);
    v.setUint8(o + 5, Math.round((wrap(e.yaw) / (Math.PI * 2)) * 255));
    let f = 0;
    if (e.dead) f |= AI_FLAG_DEAD;
    if (e.atk) f |= AI_FLAG_ATK;
    v.setUint8(o + 6, f);
    o += AI_ENTRY_BYTES;
  }
  return buf;
}

/** Unpack an AI stream packet. Returns null on malformed input. */
export function unpackAi(data: BinSrc): { kind: number; entries: AiEntry[] } | null {
  const v = toDataView(data);
  if (!v || v.byteLength < 2) return null;
  const kind = v.getUint8(0);
  const count = v.getUint8(1);
  if (v.byteLength < 2 + count * AI_ENTRY_BYTES) return null;
  const entries: AiEntry[] = [];
  let o = 2;
  for (let i = 0; i < count; i++) {
    const f = v.getUint8(o + 6);
    entries.push({
      idx: v.getUint8(o),
      x: v.getInt16(o + 1, true) / 10,
      z: v.getInt16(o + 3, true) / 10,
      yaw: (v.getUint8(o + 5) / 255) * Math.PI * 2,
      dead: !!(f & AI_FLAG_DEAD),
      atk: !!(f & AI_FLAG_ATK),
    });
    o += AI_ENTRY_BYTES;
  }
  return { kind, entries };
}

/** One decoded snapshot of a remote-driven car. */
export interface CarState {
  slot: number;
  ci: number;               // index into world.cars (deterministic across clients)
  x: number; z: number; rot: number;
  lights: boolean;
  /** receive timestamp (ms, performance.now) — set by the transport, drives staleness */
  t: number;
}

/** One decoded snapshot of a remote survivor. */
export interface NetState {
  slot: number;
  x: number; z: number; y: number;
  yaw: number;
  hp: number;
  sprint: boolean; air: boolean; beast: boolean; dead: boolean; drive: boolean; attack: boolean;
  /** riding shotgun — inside a car someone else is driving */
  ride: boolean;
  /** ⏸ personal pause — their world kept living, their body stands still */
  paused: boolean;
  /** 🚗 car index they occupy (drive or ride) — CARIDX_NONE when on foot */
  ci: number;
  /** 🥊 floored/get-up clock byte (0 = standing — see packDown/unpackDown) */
  down: number;
  /** receive timestamp (ms, performance.now) — interpolation bookkeeping */
  t: number;
}

const wrap = (yaw: number): number => ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

/** Pack one survivor state into a fresh 11-byte ArrayBuffer. */
export function packState(s: {
  slot: number; x: number; z: number; y: number; yaw: number; hp: number;
  sprint?: boolean; air?: boolean; beast?: boolean; dead?: boolean; drive?: boolean; attack?: boolean; ride?: boolean;
  paused?: boolean;
  /** 🚗 car index they occupy (drive / ride) — CARIDX_NONE on foot */
  ci?: number;
  /** 🥊 floored/get-up clock byte (0 = standing — see packDown) */
  down?: number;
}): ArrayBuffer {
  const buf = new ArrayBuffer(STATE_BYTES);
  const v = new DataView(buf);
  v.setUint8(0, s.slot & 0xff);
  v.setInt16(1, Math.round(Math.max(-3276, Math.min(3276, s.x)) * 10), true);
  v.setInt16(3, Math.round(Math.max(-3276, Math.min(3276, s.z)) * 10), true);
  v.setUint8(5, Math.max(0, Math.min(63.75, s.y)) * 4 | 0);
  v.setUint8(6, Math.round((wrap(s.yaw) / (Math.PI * 2)) * 255));
  v.setUint8(7, Math.max(0, Math.min(100, Math.round(s.hp))));
  let f = 0;
  if (s.sprint) f |= FLAG_SPRINT;
  if (s.air) f |= FLAG_AIR;
  if (s.beast) f |= FLAG_BEAST;
  if (s.dead) f |= FLAG_DEAD;
  if (s.drive) f |= FLAG_DRIVE;
  if (s.attack) f |= FLAG_ATTACK;
  if (s.ride) f |= FLAG_RIDE;
  if (s.paused) f |= FLAG_PAUSE;
  v.setUint8(8, f);
  v.setUint16(9, Math.max(0, Math.min(0xffff, Math.round(s.ci ?? CARIDX_NONE))), true);
  v.setUint8(11, Math.max(0, Math.min(255, Math.round(s.down ?? 0))));
  return buf;
}

/** Pack one driven-car snapshot into a fresh 8-byte ArrayBuffer. */
export function packCar(s: { slot?: number; ci: number; x: number; z: number; rot: number; lights?: boolean }): ArrayBuffer {
  const buf = new ArrayBuffer(CAR_BYTES);
  const v = new DataView(buf);
  v.setUint16(0, Math.max(0, Math.min(0xffff, Math.round(s.ci))), true);
  v.setInt16(2, Math.round(Math.max(-3276, Math.min(3276, s.x)) * 10), true);
  v.setInt16(4, Math.round(Math.max(-3276, Math.min(3276, s.z)) * 10), true);
  v.setUint8(6, Math.round((wrap(s.rot) / (Math.PI * 2)) * 255));
  v.setUint8(7, s.lights ? CARFLAG_LIGHTS : 0);
  return buf;
}

/** Unpack a received car packet. Returns null on malformed input. */
export function unpackCar(data: BinSrc): CarState | null {
  const v = toDataView(data);
  if (!v || v.byteLength < CAR_BYTES) return null;
  const f = v.getUint8(7);
  return {
    slot: -1, // the transport stamps the sender's real slot
    ci: v.getUint16(0, true),
    x: v.getInt16(2, true) / 10,
    z: v.getInt16(4, true) / 10,
    rot: (v.getUint8(6) / 255) * Math.PI * 2,
    lights: !!(f & CARFLAG_LIGHTS),
    t: 0, // the transport stamps the arrival time right after decode (client.ts)
  };
}

/** Any binary flavor the transport may hand us (browser ArrayBuffer, typed views, Node Buffer). */
type BinSrc = ArrayBuffer | ArrayBufferView;

const toDataView = (data: BinSrc): DataView | null => {
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    // skip ByteOffset/Length safety — sockets hand us exact packets
    return new DataView(view.buffer, view.byteOffset, view.byteLength);
  }
  if (data instanceof ArrayBuffer) return new DataView(data);
  return null;
};

/** Unpack a received packet (accepts the legacy 9-byte form too). Returns null on malformed input. */
export function unpackState(data: BinSrc, t = 0): NetState | null {
  const v = toDataView(data);
  if (!v || v.byteLength < 9) return null;
  const f = v.getUint8(8);
  return {
    slot: v.getUint8(0),
    x: v.getInt16(1, true) / 10,
    z: v.getInt16(3, true) / 10,
    y: v.getUint8(5) / 4,
    yaw: (v.getUint8(6) / 255) * Math.PI * 2,
    hp: v.getUint8(7),
    sprint: !!(f & FLAG_SPRINT),
    air: !!(f & FLAG_AIR),
    beast: !!(f & FLAG_BEAST),
    dead: !!(f & FLAG_DEAD),
    drive: !!(f & FLAG_DRIVE),
    attack: !!(f & FLAG_ATTACK),
    ride: !!(f & FLAG_RIDE),
    paused: !!(f & FLAG_PAUSE),
    // 🚗 seat index (legacy 9-byte peers never carried one → treat as on foot)
    ci: v.byteLength >= STATE_BYTES ? v.getUint16(9, true) : CARIDX_NONE,
    // 🥊 floored/get-up clock (legacy packets read as standing)
    down: v.byteLength >= 12 ? v.getUint8(11) : 0,
    t,
  };
}

/**
 * 120 ms interpolation buffer for one remote survivor — snapshots go in,
 * smoothly-eased poses come out. Rendering asks `sample(now)` every frame;
 * the tail delay hides network jitter without feeling laggy.
 */
export class Interp {
  private a: NetState | null = null;
  private b: NetState | null = null;
  private delay = 120;

  push(s: NetState) {
    this.b = this.a;
    this.a = { ...s, t: performance.now() };
  }

  /** Extrapolated pose for "now". Falls back to the last raw snapshot.
   *
   *  🎮 DEAD RECKONING — a busy main thread (heavy scene, GC pause, throttled
   *  tab) delays packet arrivals past a second; the old buffer clamped at k=1.35
   *  and the remote soul FROZE mid-stride ("player 1 is ahead, player 2 shows
   *  something else"). Now, once the render target runs past the newest
   *  snapshot, the pose keeps GLIDING along the last measured velocity (with a
   *  gentle decay so a stale ghost never flies across the map) until fresh
   *  packets land and the lerp takes over again. */
  sample(): NetState | null {
    if (!this.a) return null;
    if (!this.b) return this.a;
    const now = performance.now();
    const ta = this.a.t, tb = this.b.t;
    const span = Math.max(16, ta - tb);
    // render target sits `delay` behind the newest snapshot
    const target = now - this.delay;
    let k = (target - tb) / span;
    // yaw eases the SHORT way around the circle
    let dy = this.a.yaw - this.b.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    if (k > 1) {
      // 🎯 dead reckoning — velocity from the last two snapshots carries the
      // soul forward through the gap; decays after ~1.5 s so a gone-silent
      // peer coasts to a stop instead of ghosting to the map edge
      const over = Math.min((k - 1) * span, 1500);
      const decay = Math.exp(-over / 900);
      const vx = ((this.a.x - this.b.x) / span) * 1000;
      const vz = ((this.a.z - this.b.z) / span) * 1000;
      const vy = ((this.a.y - this.b.y) / span) * 1000;
      return {
        ...this.a,
        x: this.a.x + (vx * over / 1000) * decay,
        z: this.a.z + (vz * over / 1000) * decay,
        y: Math.max(0, this.a.y + (vy * over / 1000) * decay),
        yaw: this.a.yaw + dy * decay,
        hp: this.a.hp,
      };
    }
    k = Math.max(0, k);
    const lerp = (p: number, q: number) => p + (q - p) * k;
    return {
      ...this.a,
      x: lerp(this.b.x, this.a.x),
      z: lerp(this.b.z, this.a.z),
      y: lerp(this.b.y, this.a.y),
      yaw: this.b.yaw + dy * Math.min(1, k),
      hp: this.a.hp,
    };
  }

  /** Teleport the buffer (big corrections / respawn) — no cross-map easing. */
  snap(s: NetState) {
    const t = performance.now();
    this.a = { ...s, t };
    this.b = { ...s, t: t - 50 };
  }
}
