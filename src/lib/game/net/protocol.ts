/**
 * 7Nights net protocol — compact binary player-state packets.
 *
 * Every client publishes ONLY its own survivor @ ~12 Hz as a 9-byte packet:
 *
 *   ┌──────┬────────┬────────┬─────┬───────┬────┬───────┐
 *   │ slot │ x      │ z      │ y   │ yaw   │ hp │ flags │
 *   │ u8   │ i16×100│ i16×100│ u8×8│ u8    │ u8 │ u8    │
 *   └──────┴────────┴────────┴─────┴───────┴────┴───────┘
 *
 * flags bits: 0 sprint · 1 airborne · 2 beast · 3 dead · 4 driving · 5 attackAnim
 *
 * Quantization: world is ≤ 1500 u across → i16 (±327 u fits easily) with 2
 * decimals = 1 cm resolution; y ≤ 25 u at 8 cm; yaw wraps to one byte (2π/256 ≈
 * 1.4° — plenty for an interpolated avatar). 9 bytes/soul @ 12 Hz ≈ 108 B/s
 * per player uplink — fast enough for a school Wi-Fi laptop farm.
 *
 * Implemented with ArrayBuffer/DataView — identical on browsers (socket.io
 * treats it as a native binary attachment) and on the Bun/Node relay.
 */

export const STATE_BYTES = 9;

export const FLAG_SPRINT = 1 << 0;
export const FLAG_AIR = 1 << 1;
export const FLAG_BEAST = 1 << 2;
export const FLAG_DEAD = 1 << 3;
export const FLAG_DRIVE = 1 << 4;
export const FLAG_ATTACK = 1 << 5;

/** One decoded snapshot of a remote survivor. */
export interface NetState {
  slot: number;
  x: number; z: number; y: number;
  yaw: number;
  hp: number;
  sprint: boolean; air: boolean; beast: boolean; dead: boolean; drive: boolean; attack: boolean;
  /** receive timestamp (ms, performance.now) — interpolation bookkeeping */
  t: number;
}

const wrap = (yaw: number): number => ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

/** Pack one survivor state into a fresh 9-byte ArrayBuffer. */
export function packState(s: {
  slot: number; x: number; z: number; y: number; yaw: number; hp: number;
  sprint?: boolean; air?: boolean; beast?: boolean; dead?: boolean; drive?: boolean; attack?: boolean;
}): ArrayBuffer {
  const buf = new ArrayBuffer(STATE_BYTES);
  const v = new DataView(buf);
  v.setUint8(0, s.slot & 0xff);
  v.setInt16(1, Math.max(-320, Math.min(320, s.x)) * 100 | 0, true);
  v.setInt16(3, Math.max(-320, Math.min(320, s.z)) * 100 | 0, true);
  v.setUint8(5, Math.max(0, Math.min(25.5, s.y)) * 8 | 0);
  v.setUint8(6, Math.round((wrap(s.yaw) / (Math.PI * 2)) * 255));
  v.setUint8(7, Math.max(0, Math.min(100, Math.round(s.hp))));
  let f = 0;
  if (s.sprint) f |= FLAG_SPRINT;
  if (s.air) f |= FLAG_AIR;
  if (s.beast) f |= FLAG_BEAST;
  if (s.dead) f |= FLAG_DEAD;
  if (s.drive) f |= FLAG_DRIVE;
  if (s.attack) f |= FLAG_ATTACK;
  v.setUint8(8, f);
  return buf;
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

/** Unpack a received packet. Returns null on malformed input. */
export function unpackState(data: BinSrc, t = 0): NetState | null {
  const v = toDataView(data);
  if (!v || v.byteLength < STATE_BYTES) return null;
  const f = v.getUint8(8);
  return {
    slot: v.getUint8(0),
    x: v.getInt16(1, true) / 100,
    z: v.getInt16(3, true) / 100,
    y: v.getUint8(5) / 8,
    yaw: (v.getUint8(6) / 255) * Math.PI * 2,
    hp: v.getUint8(7),
    sprint: !!(f & FLAG_SPRINT),
    air: !!(f & FLAG_AIR),
    beast: !!(f & FLAG_BEAST),
    dead: !!(f & FLAG_DEAD),
    drive: !!(f & FLAG_DRIVE),
    attack: !!(f & FLAG_ATTACK),
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

  /** Extrapolated pose for "now". Falls back to the last raw snapshot. */
  sample(): NetState | null {
    if (!this.a) return null;
    if (!this.b) return this.a;
    const now = performance.now();
    const ta = this.a.t, tb = this.b.t;
    const span = Math.max(16, ta - tb);
    // render target sits `delay` behind the newest snapshot
    const target = now - this.delay;
    let k = (target - tb) / span;
    k = Math.max(0, Math.min(1.35, k)); // mild extrapolation when packets hiccup
    const lerp = (p: number, q: number) => p + (q - p) * k;
    // yaw eases the SHORT way around the circle
    let dy = this.a.yaw - this.b.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
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
