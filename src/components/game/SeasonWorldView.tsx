/**
 * 🗺️ SEASON WORLD VIEW — the renderer for the 4×4 km seasonal arenas.
 *
 * Mirrors WorldView's architecture for the season maps: palette-driven Env
 * (day/dusk/night from the season def), a heightfield ground that follows the
 * season terrain exactly (what you walk is what you see), merged road strips,
 * instanced building/tree/lamp pools, POI plazas, kit GLB landmarks, rim
 * mountains and a static cull root — everything the lobby renderer does,
 * sized for the big map (far plane 2600, fog stretch, distance culling).
 */
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { GameEngine } from "@/lib/game/engine";
import { nightFactor } from "@/lib/game/sim";
import { registerCullRoot, resetCullRoots, tickStaticCull } from "@/lib/game/staticCull";
import { enableGlbCulling } from "@/lib/game/glbCull";
import { preloadSeasonModels, seasonModelSize, spawnSeasonModel } from "@/lib/game/seasonModels";
import { isKitType, kitWheelR, makeKitCar } from "@/lib/game/cars/kit";
import { buildMountainGeometry, clearPeaks, HILL_COLS, ROCK_COLS, type Peak } from "@/lib/game/mountainShapes";
import { mulberry32, range } from "@/lib/game/rng";
import type { SeasonWorld } from "@/lib/game/seasonWorld";
import { roadProfileH } from "@/lib/game/seasonWorld";
import type { SeasonDef, SeasonPalette, FoliageKind } from "@/lib/game/seasons";

/* ------------------------- environment ------------------------- */

function SeasonEnv({ clockRef, pal }: { clockRef: React.MutableRefObject<number>; pal: SeasonPalette }) {
  const { scene } = useThree();
  useEffect(() => {
    const vc = (window as unknown as { __vc?: Record<string, unknown> }).__vc;
    if (vc) vc.scene = scene;
  }, [scene]);
  const hemi = useRef<THREE.HemisphereLight>(null!);
  const sun = useRef<THREE.DirectionalLight>(null!);
  const sky = useMemo(() => new THREE.Color(), []);
  const horizon = useMemo(() => new THREE.Color(), []);
  const fog = useMemo(() => new THREE.Fog(pal.skyDay, 160, 1500), [pal]);
  const DAY = useMemo(() => new THREE.Color(pal.skyDay), [pal]);
  const DUSK = useMemo(() => new THREE.Color(pal.skyDusk), [pal]);
  const NIGHT = useMemo(() => new THREE.Color(pal.skyNight), [pal]);
  const FOG_DAY = useMemo(() => new THREE.Color(pal.fogDay), [pal]);
  const FOG_NIGHT = useMemo(() => new THREE.Color(pal.fogNight), [pal]);
  const PI2 = Math.PI * 2;
  useFrame(() => {
    const clock = clockRef.current;
    const n = nightFactor(clock);
    const h = Math.sin(PI2 * (clock - 0.25));
    const dk = Math.max(0, 1 - Math.abs(h) * 5);
    sky.copy(DAY).lerp(NIGHT, n);
    if (dk > 0) sky.lerp(DUSK, dk * 0.6);
    scene.background = sky;
    // the horizon band stays a touch warmer/brighter than the zenith — real
    // skies read by their horizon, not their overhead color
    horizon.copy(sky).lerp(dk > 0 ? DUSK : FOG_DAY, 0.42 + dk * 0.2).lerp(FOG_NIGHT, n * 0.35);
    fog.color.copy(horizon);
    // the big map breathes: day fog opens past the capital skyline, night
    // closes to a claustrophobic pocket just like the town island
    fog.far = n > 0.5 ? 300 : 1500;
    scene.fog = fog;
    hemi.current.intensity = 0.34 + 0.5 * (1 - n);
    sun.current.intensity = 0.2 + 0.95 * (1 - n);
    sun.current.position.set(Math.cos(PI2 * (clock - 0.25)) * 400, Math.max(30, h * 300), 120);
  });
  return (
    <>
      <hemisphereLight ref={hemi} args={[pal.skyDay, pal.ground, 0.8]} />
      <directionalLight ref={sun} args={[pal.sunDay, 1]} />
      <SeasonSkyDome clockRef={clockRef} pal={pal} zenith={sky} horizon={horizon} />
      <Stars clockRef={clockRef} />
      <SeasonClouds clockRef={clockRef} />
      {pal.snow && <SeasonSnow clockRef={clockRef} />}
    </>
  );
}

/* ---------------- gradient sky dome + sun & moon discs ---------------- */

const SKY_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const SKY_FRAG = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  varying vec3 vWorld;
  void main() {
    // 0 at the horizon band, 1 straight up — the dome IS the gradient
    float k = clamp(vWorld.y / 900.0, 0.0, 1.0);
    vec3 c = mix(horizonColor, topColor, smoothstep(0.0, 0.62, k));
    // a gentle brightening right at the horizon line (atmospheric thickness)
    c += horizonColor * 0.14 * (1.0 - smoothstep(0.0, 0.18, k));
    gl_FragColor = vec4(c, 1.0);
  }
`;

function SeasonSkyDome({ clockRef, pal, zenith, horizon }: {
  clockRef: React.MutableRefObject<number>;
  pal: SeasonPalette;
  zenith: THREE.Color;
  horizon: THREE.Color;
}) {
  const { camera } = useThree();
  const dome = useRef<THREE.Mesh>(null!);
  const sunDisc = useRef<THREE.Mesh>(null!);
  const moon = useRef<THREE.Mesh>(null!);
  const sunGlow = useRef<THREE.Sprite>(null!);
  const uniforms = useMemo(() => ({
    topColor: { value: new THREE.Color(pal.skyDay) },
    horizonColor: { value: new THREE.Color(pal.fogDay) },
  }), [pal]);
  const PI2 = Math.PI * 2;
  const glowTex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,244,214,0.9)");
    grad.addColorStop(0.35, "rgba(255,236,190,0.32)");
    grad.addColorStop(1, "rgba(255,230,170,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
  useFrame(() => {
    const clock = clockRef.current;
    const n = nightFactor(clock);
    // the dome rides WITH the camera (a skybox) — the far plane never clips it,
    // and the gradient stays put however far out into the arena you roam
    dome.current.position.copy(camera.position);
    uniforms.topColor.value.copy(zenith);
    uniforms.horizonColor.value.copy(horizon);
    // ☀️ the sun rides its real direction (same clock the light uses) — a disc
    // low at dawn/dusk, high at noon; 🌙 the moon sits opposite, fading in at night
    const h = Math.sin(PI2 * (clock - 0.25));
    const sx = Math.cos(PI2 * (clock - 0.25)) * 1500;
    const sy = Math.max(60, h * 1100);
    const dir = new THREE.Vector3(sx, sy, 320).normalize();
    sunDisc.current.position.copy(camera.position).addScaledVector(dir, 2000);
    sunDisc.current.visible = n < 0.75 && h > -0.12;
    if (sunGlow.current) {
      sunGlow.current.position.copy(sunDisc.current.position);
      sunGlow.current.visible = sunDisc.current.visible;
      (sunGlow.current.material as THREE.SpriteMaterial).opacity = Math.max(0, 0.8 - n) * 0.7;
    }
    const mDir = new THREE.Vector3(-Math.cos(PI2 * (clock - 0.25)) * 1200, Math.max(160, -h * 900), -420).normalize();
    moon.current.position.copy(camera.position).addScaledVector(mDir, 1950);
    moon.current.visible = n > 0.25;
  });
  return (
    <group>
      <mesh ref={dome} frustumCulled={false} renderOrder={-10}>
        <sphereGeometry args={[2300, 32, 20]} />
        <shaderMaterial
          vertexShader={SKY_VERT}
          fragmentShader={SKY_FRAG}
          uniforms={uniforms}
          side={THREE.BackSide}
          depthWrite={false}
          fog={false}
        />
      </mesh>
      {/* the sun — a warm disc + soft additive halo */}
      <mesh ref={sunDisc} frustumCulled={false} renderOrder={-9}>
        <sphereGeometry args={[46, 14, 12]} />
        <meshBasicMaterial color={pal.sunDay} fog={false} />
      </mesh>
      <sprite ref={sunGlow} scale={[560, 560, 1]} frustumCulled={false} renderOrder={-9}>
        <spriteMaterial map={glowTex} transparent opacity={0.6} depthWrite={false} fog={false} blending={THREE.AdditiveBlending} />
      </sprite>
      {/* the moon — a pale disc with a darker crater bite, high in the night sky */}
      <mesh ref={moon} frustumCulled={false} renderOrder={-9}>
        <sphereGeometry args={[30, 14, 12]} />
        <meshBasicMaterial color="#e8ecf4" fog={false} />
      </mesh>
    </group>
  );
}

/* ---------------- star dome + clouds ---------------- */

function Stars({ clockRef }: { clockRef: React.MutableRefObject<number> }) {
  const mat = useRef<THREE.PointsMaterial>(null!);
  const geo = useMemo(() => {
    const N = 480;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = Math.random() * 0.9 + 0.08;
      const r = 2300;
      pos[i * 3] = Math.cos(a) * Math.cos(el) * r;
      pos[i * 3 + 1] = Math.sin(el) * r;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(el) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  useFrame(() => {
    const n = nightFactor(clockRef.current);
    mat.current.opacity = n * 0.95;
    mat.current.visible = n > 0.05;
  });
  return (
    <points geometry={geo} frustumCulled={false}>
      {/* fog={false} — the night fog closes to a 300 u pocket; without this the
          whole star dome would wash out exactly when it should shine */}
      <pointsMaterial ref={mat} color="#e8ecff" size={7} sizeAttenuation transparent opacity={0} depthWrite={false} fog={false} />
    </points>
  );
}

function SeasonClouds({ clockRef }: { clockRef: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const mat = useRef<THREE.MeshLambertMaterial>(null!);
  const seeds = useMemo(
    () => Array.from({ length: 40 }, (_, i) => {
      const a = (i / 40) * Math.PI * 2 * 2.399963;
      const r = 300 + ((i * 137) % 1700);
      return { x: Math.cos(a) * r, z: Math.sin(a) * r, y: 170 + ((i * 53) % 90), s: 14 + ((i * 31) % 22) };
    }),
    [],
  );
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    seeds.forEach((c, i) => {
      m.makeScale(c.s, c.s * 0.42, c.s);
      m.setPosition(c.x, c.y, c.z);
      ref.current.setMatrixAt(i, m);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  }, [seeds]);
  useFrame(() => {
    const n = nightFactor(clockRef.current);
    mat.current.color.setScalar(0.62 + 0.38 * (1 - n));
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, seeds.length]} frustumCulled={false}>
      <sphereGeometry args={[1, 8, 6]} />
      <meshLambertMaterial ref={mat} color="#ffffff" transparent opacity={0.82} />
    </instancedMesh>
  );
}

/* ---------------- ❄️ falling snow (camera-following particle field) ---------------- */

function SeasonSnow({ clockRef }: { clockRef: React.MutableRefObject<number> }) {
  const { camera } = useThree();
  const snowMat = useRef<THREE.PointsMaterial>(null!);
  const N = 1500;
  const FIELD = 130;   // flakes live in a disc this wide around the camera
  const TOP = 46;      // spawn ceiling above the camera
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    return g;
  }, []);
  const state = useMemo(() =>
    Array.from({ length: N }, () => ({
      a: Math.random() * Math.PI * 2,
      d: Math.sqrt(Math.random()) * FIELD,
      y: Math.random() * TOP,
      fall: 1.7 + Math.random() * 1.9,
      sway: Math.random() * Math.PI * 2,
      swayAmp: 0.35 + Math.random() * 0.8,
      drift: 0.35 + Math.random() * 0.7,
    })), []);
  useFrame((_, dtRaw) => {
    const dt = Math.min(0.05, Math.max(0.001, dtRaw));
    const n = nightFactor(clockRef.current);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const windX = Math.sin(clockRef.current * 0.14) * 0.9;
    for (let i = 0; i < N; i++) {
      const s = state[i];
      s.y -= s.fall * dt;
      s.sway += dt * 1.4;
      if (s.y < -6) { s.y = TOP * (0.75 + Math.random() * 0.25); s.a = Math.random() * Math.PI * 2; s.d = Math.sqrt(Math.random()) * FIELD; }
      const flakeX = cx + Math.cos(s.a) * s.d + Math.sin(s.sway) * s.swayAmp + windX * s.drift * 3;
      const flakeZ = cz + Math.sin(s.a) * s.d + Math.cos(s.sway * 0.8) * s.swayAmp;
      arr[i * 3] = flakeX;
      arr[i * 3 + 1] = cy + s.y - 8;
      arr[i * 3 + 2] = flakeZ;
    }
    pos.needsUpdate = true;
    if (snowMat.current) snowMat.current.opacity = 0.52 + 0.3 * n; // a touch denser after dark
  });
  return (
    <points geometry={geo} frustumCulled={false}>
      <pointsMaterial ref={snowMat} color="#ffffff" size={0.26} sizeAttenuation transparent opacity={0.65} depthWrite={false} />
    </points>
  );
}

/* ---------------- heightfield ground ---------------- */

function SeasonGround({ world }: { world: SeasonWorld }) {
  const pal = world.def.pal;
  const geo = useMemo(() => {
    // the mesh hugs the arena: a 2×2 km village grounds on a ~2.7 km plate,
    // the 4×4 maps keep the old ~4.7 km one. 220 segments keep the fine
    // terrain octaves visible (what you walk is what you see — the physics
    // samples the SAME terrain function).
    const SIZE = Math.max(2700, world.map.wallR * 2 + 700);
    const SEG = 220;
    const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c1 = new THREE.Color(pal.ground);
    const c2 = new THREE.Color(pal.ground2);
    const dirt = new THREE.Color(pal.dirt);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = world.map.terrain(x, z);
      pos.setY(i, h);
      // patchwork: two noise bands pick ground vs ground2, road edges go dirt;
      // hilltops catch a brighter tint (snow settles on the crests)
      const n1 = Math.sin(x * 0.013 + z * 0.017) + Math.sin(x * 0.005 - z * 0.008);
      const n2 = Math.sin(x * 0.041 + z * 0.037) * 0.5;
      tmp.copy(c1).lerp(c2, Math.min(1, Math.max(0, n1 * 0.5 + 0.5)));
      if (n2 > 0.42) tmp.lerp(dirt, 0.35);
      if (h > 4) tmp.lerp(c2, Math.min(0.4, (h - 4) * 0.06));
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, [world, pal]);
  return (
    // sits EXACTLY on the physics ground (y=0 = terrain(x,z)) — the old -0.08
    // offset left every soul hovering a hair above the snow
    <mesh geometry={geo} receiveShadow frustumCulled={false}>
      <meshLambertMaterial vertexColors />
    </mesh>
  );
}

/* ---------------- roads + plazas ---------------- */

function SeasonRoads({ world }: { world: SeasonWorld }) {
  const pal = world.def.pal;
  const { roadGeo, lineGeo, plazaGeo } = useMemo(() => {
    const strips: THREE.BufferGeometry[] = [];
    const lines: THREE.BufferGeometry[] = [];
    for (const seg of world.roads) {
      const vx = seg.x2 - seg.x1, vz = seg.z2 - seg.z1;
      const L = Math.hypot(vx, vz) || 1;
      const nx = -vz / L, nz = vx / L;
      // ⛰️ the tarmac GRADES with its physics profile — end heights (h1→h2)
      // lift each corner so the road rides the hills instead of trenching
      const y1 = roadProfileH(seg, 0) + 0.07;
      const y2 = roadProfileH(seg, 1) + 0.07;
      const hw = seg.w / 2;
      const quad = new THREE.BufferGeometry();
      quad.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
        seg.x1 + nx * hw, y1, seg.z1 + nz * hw,
        seg.x2 + nx * hw, y2, seg.z2 + nz * hw,
        seg.x2 - nx * hw, y2, seg.z2 - nz * hw,
        seg.x1 - nx * hw, y1, seg.z1 - nz * hw,
      ]), 3));
      quad.setIndex([0, 1, 2, 0, 2, 3]);
      quad.computeVertexNormals();
      strips.push(quad);
      // dashed centre line on the big roads — each dash follows the profile
      if (seg.w >= 9) {
        const n = Math.floor(L / 22);
        for (let k = 0; k < n; k++) {
          const t0 = k / n, t1 = t0 + 0.35 / n;
          const q = new THREE.BufferGeometry();
          const w0 = 0.35;
          const yA = roadProfileH(seg, t0) + 0.12;
          const yB = roadProfileH(seg, t1) + 0.12;
          q.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
            seg.x1 + vx * t0 + nx * w0, yA, seg.z1 + vz * t0 + nz * w0,
            seg.x1 + vx * t1 + nx * w0, yB, seg.z1 + vz * t1 + nz * w0,
            seg.x1 + vx * t1 - nx * w0, yB, seg.z1 + vz * t1 - nz * w0,
            seg.x1 + vx * t0 - nx * w0, yA, seg.z1 + vz * t0 - nz * w0,
          ]), 3));
          q.setIndex([0, 1, 2, 0, 2, 3]);
          lines.push(q);
        }
      }
    }
    const plazas: THREE.BufferGeometry[] = [];
    for (const p of world.pois) {
      const disc = new THREE.CircleGeometry(p.type === "capital" ? 26 : 15, 22);
      disc.rotateX(-Math.PI / 2);
      disc.translate(p.x, p.h + 0.09, p.z);
      plazas.push(disc);
    }
    return {
      roadGeo: mergeGeometries(strips),
      lineGeo: mergeGeometries(lines),
      plazaGeo: mergeGeometries(plazas),
    };
  }, [world]);
  return (
    <group>
      {roadGeo && <mesh geometry={roadGeo} frustumCulled={false}><meshLambertMaterial color={pal.road} /></mesh>}
      {lineGeo && <mesh geometry={lineGeo} frustumCulled={false}><meshBasicMaterial color={pal.roadLine} /></mesh>}
      {plazaGeo && <mesh geometry={plazaGeo} frustumCulled={false}><meshLambertMaterial color={pal.plaza} /></mesh>}
    </group>
  );
}

/* ---------------- procedural buildings (instanced pools) ---------------- */

function SeasonBuildings({ world }: { world: SeasonWorld }) {
  const pal = world.def.pal;
  const B = world.buildings;
  // ❄️ snow seasons dust every roof white — the palette roof tint lerps toward
  // fresh snow so the village reads like the kit preview at a glance
  const SNOW_ROOF = useMemo(() => new THREE.Color("#eef4fa"), []);
  const roofOf = useMemo(() => {
    const cache = new Map<number, THREE.Color>();
    return (hex: number): THREE.Color => {
      let c = cache.get(hex);
      if (!c) {
        c = new THREE.Color(hex);
        if (pal.snow) c.lerp(SNOW_ROOF, 0.55);
        cache.set(hex, c);
      }
      return c;
    };
  }, [pal, SNOW_ROOF]);
  const wallRef = useRef<THREE.InstancedMesh>(null!);
  const flatRef = useRef<THREE.InstancedMesh>(null!);
  const pyrRef = useRef<THREE.InstancedMesh>(null!);
  const doorRef = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    let fi = 0, pi = 0, di = 0;
    B.forEach((b, i) => {
      const y = world.map.terrain(b.x, b.z);
      m.compose(
        new THREE.Vector3(b.x, y + b.h / 2, b.z),
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0),
        new THREE.Vector3(b.w * 2, b.h, b.d * 2),
      );
      wallRef.current.setMatrixAt(i, m);
      wallRef.current.setColorAt(i, col.set(b.color));
      if (b.kind === 2 || b.kind === 6) {
        const rise = b.kind === 6 ? 3.4 : 2.3;
        m.compose(
          new THREE.Vector3(b.x, y + b.h + rise / 2, b.z),
          q.identity(),
          new THREE.Vector3(b.w * 2.18, rise, b.d * 2.18),
        );
        pyrRef.current.setMatrixAt(pi++, m);
        pyrRef.current.setColorAt(pi - 1, col.copy(roofOf(b.roof)));
      } else {
        m.compose(
          new THREE.Vector3(b.x, y + b.h + 0.35, b.z),
          q.identity(),
          new THREE.Vector3(b.w * 2.16, 0.7, b.d * 2.16),
        );
        flatRef.current.setMatrixAt(fi++, m);
        flatRef.current.setColorAt(fi - 1, col.copy(roofOf(b.roof)));
        // door slab faces +z
        m.compose(
          new THREE.Vector3(b.x, y + 1.05, b.z + b.d + 0.02),
          q.identity(),
          new THREE.Vector3(b.w * 0.5, 2.1, 0.18),
        );
        doorRef.current.setMatrixAt(di++, m);
        doorRef.current.setColorAt(di - 1, col.copy(roofOf(b.roof)));
      }
    });
    flatRef.current.count = fi;
    pyrRef.current.count = pi;
    doorRef.current.count = di;
    [wallRef, flatRef, pyrRef, doorRef].forEach((r) => {
      r.current.instanceMatrix.needsUpdate = true;
      if (r.current.instanceColor) r.current.instanceColor.needsUpdate = true;
    });
  }, [world, B, roofOf]);
  return (
    <group>
      <instancedMesh ref={wallRef} args={[undefined, undefined, Math.max(1, B.length)]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={flatRef} args={[undefined, undefined, Math.max(1, B.length)]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={pyrRef} args={[undefined, undefined, Math.max(1, B.length)]} frustumCulled={false}>
        <coneGeometry args={[0.5, 1, 4]} />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={doorRef} args={[undefined, undefined, Math.max(1, B.length)]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial />
      </instancedMesh>
    </group>
  );
}

/* ---------------- themed tree pools ---------------- */

function crownBuilder(kind: FoliageKind, pal: SeasonPalette): { crown: "cone" | "blob" | "palm" | "column"; color: number; color2: number } {
  switch (kind) {
    case "pine": return { crown: "cone", color: pal.crown, color2: pal.crown2 };
    case "cypress": return { crown: "cone", color: pal.crown, color2: pal.crown2 };
    case "oak": return { crown: "blob", color: pal.crown, color2: pal.crown2 };
    case "sakura": return { crown: "blob", color: pal.crown, color2: pal.crown2 };
    case "palm": return { crown: "palm", color: pal.crown, color2: pal.crown2 };
    case "cactus": return { crown: "column", color: pal.crown, color2: pal.crown2 };
    case "bamboo": return { crown: "column", color: pal.crown, color2: pal.crown2 };
    default: return { crown: "blob", color: pal.trunk, color2: pal.crown }; // dead — bare
  }
}

function SeasonTrees({ world }: { world: SeasonWorld }) {
  const pal = world.def.pal;
  const foliage = world.def.foliage;
  const pools = useMemo(
    () => foliage.map((k) => ({ kind: k, ...crownBuilder(k, pal) })),
    [foliage, pal],
  );
  const byPool = useMemo(() => {
    const lists: { x: number; z: number; s: number }[][] = pools.map(() => []);
    for (const t of world.trees) {
      const k = Math.min(t.kind, pools.length - 1);
      lists[k].push({ x: t.x, z: t.z, s: t.s });
    }
    return lists;
  }, [world, pools]);
  return (
    <group>
      {pools.map((p, i) => (
        <TreePool key={i} kind={p.kind} crown={p.crown} color={p.color} color2={p.color2} pal={pal}
          items={byPool[i]} terrain={world.map.terrain} />
      ))}
    </group>
  );
}

function TreePool({ kind, crown, color, color2, pal, items, terrain }: {
  kind: FoliageKind; crown: "cone" | "blob" | "palm" | "column"; color: number; color2: number;
  pal: SeasonPalette; items: { x: number; z: number; s: number }[];
  terrain: (x: number, z: number) => number;
}) {
  const trunk = useRef<THREE.InstancedMesh>(null!);
  const crownRef = useRef<THREE.InstancedMesh>(null!);
  const crown2Ref = useRef<THREE.InstancedMesh>(null!);
  const snowRef = useRef<THREE.InstancedMesh>(null!);
  const N = Math.max(1, items.length);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    items.forEach((t, i) => {
      const y = terrain(t.x, t.z);
      const s = t.s;
      const bare = kind === "dead";
      const th = kind === "cactus" ? 2.6 * s : kind === "bamboo" ? 3.6 * s : bare ? 2.6 * s : 2.2 * s;
      const lean = kind === "palm" ? 0.16 * s : kind === "cactus" || kind === "bamboo" ? 0.04 : 0.05 * s;
      // trunk — a lean tilts the whole tree for the windswept kits
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), lean);
      m.compose(new THREE.Vector3(t.x, y + th / 2, t.z), q, new THREE.Vector3(kind === "bamboo" ? 0.22 * s : 0.5 * s, th, 0.5 * s));
      trunk.current.setMatrixAt(i, m);
      const cy = y + th;
      if (crown === "cone") {
        const ch = kind === "cypress" ? 3.4 * s : 4.6 * s;
        const cw = kind === "cypress" ? 1.15 * s : 1.75 * s;
        q.setFromAxisAngle(up, 0);
        m.compose(new THREE.Vector3(t.x, cy + ch / 2 - 0.3, t.z), q, new THREE.Vector3(cw, ch, cw));
        crownRef.current.setMatrixAt(i, m);
        // second tier + snow cap on pines
        const ch2 = ch * 0.5;
        m.compose(new THREE.Vector3(t.x, cy + ch - 0.5, t.z), q, new THREE.Vector3(cw * 0.62, ch2, cw * 0.62));
        crown2Ref.current.setMatrixAt(i, m);
        if (pal.snow) {
          m.compose(new THREE.Vector3(t.x, cy + ch + ch2 * 0.35, t.z), q, new THREE.Vector3(cw * 0.5, ch2 * 0.75, cw * 0.5));
          snowRef.current.setMatrixAt(i, m);
        }
      } else if (crown === "blob") {
        const cr = (kind === "sakura" ? 1.9 : 2.3) * s;
        q.setFromAxisAngle(up, 0);
        m.compose(new THREE.Vector3(t.x, cy + cr * 0.75, t.z), q, new THREE.Vector3(cr, cr * 1.12, cr));
        crownRef.current.setMatrixAt(i, m);
        m.compose(new THREE.Vector3(t.x + cr * 0.45, cy + cr * 1.15, t.z - cr * 0.3), q, new THREE.Vector3(cr * 0.62, cr * 0.62, cr * 0.62));
        crown2Ref.current.setMatrixAt(i, m);
      } else if (crown === "palm") {
        q.setFromAxisAngle(up, 0);
        const cr = 1.85 * s;
        m.compose(new THREE.Vector3(t.x + lean * th * 0.9, cy + 0.4, t.z), q, new THREE.Vector3(cr, cr * 0.4, cr));
        crownRef.current.setMatrixAt(i, m);
        m.compose(new THREE.Vector3(t.x + lean * th * 0.5, cy + 1.15, t.z), q, new THREE.Vector3(cr * 0.7, cr * 0.3, cr * 0.7));
        crown2Ref.current.setMatrixAt(i, m);
      } else { // column — cactus / bamboo (bamboo gets a slim crown tuft)
        const ch = kind === "cactus" ? 1.7 * s : 0.9 * s;
        q.setFromAxisAngle(up, 0);
        m.compose(new THREE.Vector3(t.x, cy + ch / 2 - 0.2, t.z), q, new THREE.Vector3(kind === "bamboo" ? 0.5 : 0.75, ch, kind === "bamboo" ? 0.5 : 0.75));
        crownRef.current.setMatrixAt(i, m);
        if (kind === "cactus") {
          // saguaro arms
          m.compose(new THREE.Vector3(t.x + 0.62 * s, cy + 0.55 * s, t.z), q, new THREE.Vector3(0.42 * s, 1.15 * s, 0.42 * s));
          crown2Ref.current.setMatrixAt(i, m);
        }
      }
      if (pal.snow && crown !== "cone") {
        // snow caps blanket the canopy tops
        const cr = crown === "blob" ? 1.9 * s : 1.2 * s;
        q.setFromAxisAngle(up, 0);
        m.compose(new THREE.Vector3(t.x, cy + (crown === "blob" ? 1.85 : 1.1) * s, t.z), q, new THREE.Vector3(cr, cr * 0.38, cr));
        snowRef.current.setMatrixAt(i, m);
      }
    });
    trunk.current.count = items.length;
    crownRef.current.count = kind === "dead" ? 0 : items.length;
    crown2Ref.current.count = kind === "dead" ? 0 : items.length;
    snowRef.current.count = pal.snow ? items.length : 0;
    [trunk, crownRef, crown2Ref, snowRef].forEach((r) => {
      r.current.instanceMatrix.needsUpdate = true;
    });
  }, [items, terrain, kind, crown, pal]);
  return (
    <group>
      <instancedMesh ref={trunk} args={[undefined, undefined, N]} frustumCulled={false}>
        <cylinderGeometry args={[0.7, 1, 1, 6]} />
        <meshLambertMaterial color={pal.trunk} />
      </instancedMesh>
      <instancedMesh ref={crownRef} args={[undefined, undefined, N]} frustumCulled={false}>
        {crown === "cone"
          ? <coneGeometry args={[0.5, 1, 7]} />
          : crown === "palm"
            ? <sphereGeometry args={[0.5, 7, 5]} />
            : <sphereGeometry args={[0.5, 8, 6]} />}
        <meshLambertMaterial color={color} />
      </instancedMesh>
      <instancedMesh ref={crown2Ref} args={[undefined, undefined, N]} frustumCulled={false}>
        {crown === "cone"
          ? <coneGeometry args={[0.5, 1, 7]} />
          : <sphereGeometry args={[0.5, 7, 5]} />}
        <meshLambertMaterial color={color2} />
      </instancedMesh>
      <instancedMesh ref={snowRef} args={[undefined, undefined, N]} frustumCulled={false} visible={pal.snow}>
        <sphereGeometry args={[0.5, 7, 5]} />
        <meshLambertMaterial color="#f4f8fc" />
      </instancedMesh>
    </group>
  );
}

/* ---------------- rocks, lamps, fields, flowers, camps, ponds, signs ---------------- */

function SeasonRocks({ world, engine }: { world: SeasonWorld; engine: GameEngine }) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const ver = useRef(-1);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    world.rocks.forEach((rk, i) => {
      const y = world.map.terrain(rk.x, rk.z);
      e.set(0, rk.s * 2.4, 0); q.setFromEuler(e);
      m.compose(new THREE.Vector3(rk.x, y + 0.5 * rk.s, rk.z), q, new THREE.Vector3(1.45 * rk.s, 1.1 * rk.s, 1.35 * rk.s));
      ref.current.setMatrixAt(i, m);
    });
    ref.current.instanceMatrix.needsUpdate = true;
    ver.current = engine.fellVersion;
  }, [world, engine]);
  useFrame(() => {
    if (engine.fellVersion === ver.current) return;
    ver.current = engine.fellVersion;
    const m = new THREE.Matrix4();
    world.rocks.forEach((rk, i) => {
      const broken = (engine as unknown as { brokenRocks?: Set<number> }).brokenRocks?.has(i);
      const s = broken ? 0 : 1;
      const y = world.map.terrain(rk.x, rk.z);
      m.makeScale(s, s, s);
      m.setPosition(rk.x, y + 0.5 * rk.s, rk.z);
      ref.current.setMatrixAt(i, m);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(1, world.rocks.length)]} frustumCulled={false}>
      <dodecahedronGeometry args={[0.75, 0]} />
      <meshLambertMaterial color="#8a8a86" />
    </instancedMesh>
  );
}

function SeasonLamps({ world, clockRef }: { world: SeasonWorld; clockRef: React.MutableRefObject<number> }) {
  const pal = world.def.pal;
  const headMat = useRef<THREE.MeshBasicMaterial>(null!);
  const glowMat = useRef<THREE.SpriteMaterial>(null!);
  const N = Math.max(1, world.lamps.length);
  const pole = useRef<THREE.InstancedMesh>(null!);
  const head = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    world.lamps.forEach((l, i) => {
      const y = world.map.terrain(l.x, l.z);
      m.compose(new THREE.Vector3(l.x, y + 2.3, l.z), new THREE.Quaternion(), new THREE.Vector3(0.16, 4.6, 0.16));
      pole.current.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(l.x, y + 4.85, l.z), new THREE.Quaternion(), new THREE.Vector3(0.55, 0.42, 0.55));
      head.current.setMatrixAt(i, m);
    });
    pole.current.instanceMatrix.needsUpdate = true;
    head.current.instanceMatrix.needsUpdate = true;
  }, [world]);
  useFrame(() => {
    const n = nightFactor(clockRef.current);
    const on = n > 0.35;
    headMat.current.color.set(on ? pal.accent : 0x555555);
    if (glowMat.current) glowMat.current.opacity = on ? 0.5 : 0;
  });
  return (
    <group>
      <instancedMesh ref={pole} args={[undefined, undefined, N]} frustumCulled={false}>
        <cylinderGeometry args={[1, 1, 1, 6]} />
        <meshLambertMaterial color="#3c3c40" />
      </instancedMesh>
      <instancedMesh ref={head} args={[undefined, undefined, N]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial ref={headMat} color={pal.accent} />
      </instancedMesh>
    </group>
  );
}

function SeasonFields({ world }: { world: SeasonWorld }) {
  const pal = world.def.pal;
  const CROPS = [pal.crown, pal.crown2, pal.plaza, pal.dirt];
  const ref = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    world.fields.forEach((f, i) => {
      const y = world.map.terrain(f.x, f.z);
      q.setFromAxisAngle(up, f.rot);
      m.compose(new THREE.Vector3(f.x, y + 0.16, f.z), q, new THREE.Vector3(f.w, 0.3, f.d));
      ref.current.setMatrixAt(i, m);
      ref.current.setColorAt(i, col.set(CROPS[f.crop % CROPS.length]));
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [world, pal]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(1, world.fields.length)]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial />
    </instancedMesh>
  );
}

function SeasonFlowers({ world }: { world: SeasonWorld }) {
  const COLORS = [0xf0d858, 0xe86a8a, 0xe8e8f0];
  const ref = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    world.flowers.forEach((f, i) => {
      const y = world.map.terrain(f.x, f.z);
      m.compose(new THREE.Vector3(f.x, y + 0.14, f.z), new THREE.Quaternion(), new THREE.Vector3(0.34 * f.s, 0.22 * f.s, 0.34 * f.s));
      ref.current.setMatrixAt(i, m);
      ref.current.setColorAt(i, col.set(COLORS[f.c % COLORS.length]));
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [world]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(1, world.flowers.length)]} frustumCulled={false}>
      <sphereGeometry args={[0.5, 5, 4]} />
      <meshLambertMaterial />
    </instancedMesh>
  );
}

function SeasonCamps({ world, clockRef }: { world: SeasonWorld; clockRef: React.MutableRefObject<number> }) {
  const pal = world.def.pal;
  const fire = useRef<THREE.Group>(null!);
  useFrame(() => {
    const n = nightFactor(clockRef.current);
    const flick = n > 0.3 ? 0.85 + Math.sin(performance.now() * 0.02) * 0.12 : 0.12;
    fire.current?.children.forEach((c) => {
      const mesh = c as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (mat?.opacity !== undefined) mat.opacity = flick;
    });
  });
  return (
    <group>
      {world.camps.map((cp, i) => {
        const y = world.map.terrain(cp.x, cp.z);
        return (
          <group key={i}>
            <mesh position={[cp.x, y + 0.2, cp.z]}>
              <cylinderGeometry args={[0.95, 1.1, 0.4, 8]} />
              <meshLambertMaterial color="#5c5c58" />
            </mesh>
            <mesh position={[cp.x, y + 0.55, cp.z]}>
              <sphereGeometry args={[0.42, 6, 5]} />
              <meshBasicMaterial color={pal.accent} transparent opacity={0.85} />
            </mesh>
            {cp.tents.map((t, k) => {
              const ty = world.map.terrain(cp.x + t.dx, cp.z + t.dz);
              return (
                <mesh key={k} position={[cp.x + t.dx, ty + 0.95 * t.s, cp.z + t.dz]} rotation-y={t.rot}>
                  <coneGeometry args={[1.55 * t.s, 1.9 * t.s, 5]} />
                  <meshLambertMaterial color={["#c46a3c", "#3c7858", "#7a6a9c"][t.c % 3]} />
                </mesh>
              );
            })}
            {cp.crates.map((cr, k) => {
              const cy = world.map.terrain(cp.x + cr.dx, cp.z + cr.dz);
              return (
                <mesh key={k} position={[cp.x + cr.dx, cy + 0.45, cp.z + cr.dz]} rotation-y={cr.rot}>
                  <boxGeometry args={[0.9, 0.9, 0.9]} />
                  <meshLambertMaterial color="#8a6a3c" />
                </mesh>
              );
            })}
            {cp.pole && (
              <mesh position={[cp.x + cp.pole.dx, y + 2.2, cp.z + cp.pole.dz]}>
                <cylinderGeometry args={[0.08, 0.08, 4.4, 5]} />
                <meshLambertMaterial color="#3c3c40" />
              </mesh>
            )}
          </group>
        );
      })}
      <group ref={fire} />
    </group>
  );
}

function SeasonPonds({ world }: { world: SeasonWorld }) {
  const pal = world.def.pal;
  return (
    <group>
      {world.ponds.map((pd, i) => {
        const y = world.map.terrain(pd.x, pd.z);
        return (
          <mesh key={i} position={[pd.x, y + 0.12, pd.z]} rotation-x={-Math.PI / 2}>
            <circleGeometry args={[pd.r, 26]} />
            <meshLambertMaterial color={pal.water} transparent opacity={0.92} />
          </mesh>
        );
      })}
    </group>
  );
}

function SeasonSigns({ world }: { world: SeasonWorld }) {
  const pal = world.def.pal;
  return (
    <group>
      {world.signs.map((s, i) => {
        const y = world.map.terrain(s.x, s.z);
        return (
          <group key={i} position={[s.x, y, s.z]} rotation-y={s.rot}>
            <mesh position={[0, 1.1, 0]}>
              <cylinderGeometry args={[0.09, 0.09, 2.2, 5]} />
              <meshLambertMaterial color="#4a3c2c" />
            </mesh>
            <mesh position={[0, 2.3, 0]}>
              <boxGeometry args={[1.7, 0.7, 0.12]} />
              <meshLambertMaterial color={pal.accent} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/* ---------------- 🚗 the season fleet (polyfork Retro Cars Kit) ----------------
 * Parked cars from world.cars, the cruising ring traffic, the car YOU drive,
 * bot-driven rides and mirrored remote cars — every body drawn from the kit's
 * parametric models (real-world scale, +Z nose, named wheel/steer parts we
 * spin every frame). Beams share one additive material so after-dark headlights
 * cost nothing extra. */

const seasonBeamMat = new THREE.MeshBasicMaterial({
  color: "#ffedb0", transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
  depthWrite: false, side: THREE.DoubleSide,
});
const SEASON_BEAM_LEN = 5.6;

interface SeasonCarRig {
  src: "park" | "traffic";
  i: number;
  t: number;
  obj: THREE.Group;
  wheels: THREE.Object3D[];
  steer: THREE.Object3D[];
  beams: THREE.Mesh[];
  spin: number;
  lastX: number;
  lastZ: number;
  y: number;
}

function SeasonCars({ world, engine, clockRef }: { world: SeasonWorld; engine: GameEngine; clockRef: React.MutableRefObject<number> }) {
  const terrain = world.map.terrain;
  const rigs = useMemo<SeasonCarRig[]>(() => {
    const out: SeasonCarRig[] = [];
    const build = (src: "park" | "traffic", i: number, t: number, c: number, x: number, z: number) => {
      const r = makeKitCar(t, c);
      if (!r) return;
      // 🔆 two headlight cones poking from the nose — parked cars keep them
      // folded (engine off), driven/traffic rides light them after dark
      const box = new THREE.Box3().setFromObject(r.obj);
      const nose = box.max.z;
      const beams: THREE.Mesh[] = [];
      const geo = new THREE.ConeGeometry(0.95, SEASON_BEAM_LEN, 10, 1, true);
      for (const s of [-1, 1]) {
        const cone = new THREE.Mesh(geo, seasonBeamMat);
        cone.rotation.x = -Math.PI / 2;
        cone.position.set(s * box.max.x * 0.6, 0.72, nose + SEASON_BEAM_LEN / 2 - 0.05);
        cone.visible = false;
        r.obj.add(cone);
        beams.push(cone);
      }
      out.push({ src, i, t, obj: r.obj, wheels: r.wheels, steer: r.steer, beams, spin: 0, lastX: x, lastZ: z, y: terrain(x, z) });
    };
    world.cars.forEach((c, i) => { if (isKitType(c.t)) build("park", i, c.t, c.c, c.x, c.z); });
    engine.traffic.forEach((t, i) => { if (isKitType(t.t)) build("traffic", i, t.t, t.c, t.x, t.z); });
    return out;
  }, [world, engine]);

  useFrame(({ camera }, dtRaw) => {
    const dt = Math.min(0.05, Math.max(0.001, dtRaw));
    const d = engine.drive;
    const nf = nightFactor(clockRef.current);
    seasonBeamMat.opacity = Math.max(0, nf - 0.14) * 0.42;
    for (const k of rigs) {
      let x: number, z: number, rot: number, steerA = 0, lit = false, driven = false;
      if (k.src === "park") {
        const c = world.cars[k.i];
        if (!c) continue;
        if (d && d.ci === k.i) {
          x = d.vx; z = d.vz; rot = d.vrot; steerA = d.steerVis; driven = true;
          k.spin = -d.spin;
          lit = nf > 0.14 && (d.lights ?? true);
        } else if (engine.botDriven.has(k.i)) {
          x = c.x; z = c.z; rot = c.rot; driven = true;
          k.spin += Math.hypot(c.x - k.lastX, c.z - k.lastZ) / kitWheelR(k.t);
          lit = nf > 0.14;
        } else if (engine.remoteDriven.has(k.i)) {
          const st = engine.remoteDriven.get(k.i)!;
          x = c.x; z = c.z; rot = c.rot; driven = true;
          k.spin += Math.hypot(c.x - k.lastX, c.z - k.lastZ) / kitWheelR(k.t);
          lit = st.lights && nf > 0.14;
        } else {
          x = c.x; z = c.z; rot = c.rot;
        }
      } else {
        const t = engine.traffic[k.i];
        if (!t) continue;
        x = t.x; z = t.z; rot = t.rot;
        k.spin += (t.spCur ?? t.sp) * t.r * dt / kitWheelR(k.t);
        lit = nf > 0.14;
      }
      k.lastX = x; k.lastZ = z;
      // 🏔️ the body rides the season terrain — eased tighter when driven so
      // rolling over the hills never leaves the wheels floating
      const gy = terrain(x, z);
      k.y += (gy - k.y) * Math.min(1, dt * (driven ? 14 : 7));
      k.obj.position.set(x, k.y, z);
      k.obj.rotation.y = rot;
      // 📉 distance cull — the big map's fog eats rides beyond the draw-in line,
      // and 100+ kit cars × ~6 meshes would still rasterise on the software GPU
      const dx = x - camera.position.x, dz = z - camera.position.z;
      const vis = driven || dx * dx + dz * dz < 560 * 560;
      if (k.obj.visible !== vis) k.obj.visible = vis;
      for (const w of k.wheels) w.rotation.x = k.spin;
      for (const s of k.steer) s.rotation.y = steerA;
      if (k.beams[0].visible !== lit) for (const b of k.beams) b.visible = lit;
    }
  });

  return (
    <group>
      {rigs.map((k, i) => <primitive object={k.obj} key={i} />)}
    </group>
  );
}

/* ---------------- kit GLB pieces ---------------- */

function SeasonGlbs({ world }: { world: SeasonWorld }) {
  const seasonId = world.seasonId;
  const [, bump] = useState(0);
  const mounted = useRef(false);
  // 🧊 LAZY SPAWN — the arena places ~230 kit pieces; cloning them ALL at mount
  // burst-loads the main thread on the 4 GB sandbox. Instead, pieces materialise
  // only when the camera comes within range (checked 3×/s; already-spawned clones
  // stay mounted — the static culler hides them beyond the fog line).
  const [spawned, setSpawned] = useState<Set<number>>(() => new Set());
  const camRef = useRef(new THREE.Vector3());
  useEffect(() => {
    mounted.current = true;
    preloadSeasonModels(seasonId, () => {
      if (mounted.current) bump((v) => v + 1);
    });
    return () => { mounted.current = false; };
  }, [seasonId]);
  useFrame(({ camera }) => {
    camRef.current.copy(camera.position);
    // 🐢 trickle — at most 3 kit pieces materialise per pass (3 passes/s), so
    // approaching a dense POI streams its props over ~a second instead of
    // cloning 40 models inside one frame on the 4 GB sandbox
    const inRange: number[] = [];
    world.glb.forEach((g, i) => {
      if (spawned.has(i)) return;
      const d2 = (g.x - camRef.current.x) ** 2 + (g.z - camRef.current.z) ** 2;
      if (d2 < 460 * 460) inRange.push(i);
    });
    if (inRange.length > 0) {
      const take = inRange.slice(0, 3);
      const next = new Set(spawned);
      take.forEach((i) => next.add(i));
      setSpawned(next);
    }
  });
  const TARGET_H: Record<string, number> = { building: 7.5, landmark: 11.5, tree: 5.2, prop: 1.9 };
  return (
    <group>
      {world.glb.map((g, i) => {
        if (!spawned.has(i)) return null;
        const size = seasonModelSize(seasonId, g.file);
        const ready = size.y > 1.01;
        const scale = ready ? TARGET_H[g.role] / Math.max(1, size.y) : 0.001;
        const obj = ready ? spawnSeasonModel(seasonId, g.file) : null;
        if (!obj) return null;
        enableGlbCulling(obj);
        return (
          <primitive key={i} object={obj} position={[g.x, g.h, g.z]} rotation-y={g.rot} scale={scale} />
        );
      })}
    </group>
  );
}

/* ---------------- rim mountains + boundary ---------------- */

function SeasonRim({ world }: { world: SeasonWorld }) {
  const pal = world.def.pal;
  // 🏔️ one merged ridged range from the shared mountainShapes builder — fluted
  // concave slopes, asymmetric flanks, off-centre twin summits and per-face
  // rock/snow colouring — instead of the old 6-sided cone spikes. Deterministic
  // per season id, so every client regrows the identical skyline.
  const geo = useMemo(() => {
    const R = world.map.wallR;
    const seed = (0x51ea50 ^ [...world.seasonId].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)) ^ 0x51515;
    const r = mulberry32(seed);
    // skyline scale — the tight S1 arena reads its range BIG; big maps cap a
    // little above the old cone fence (their fog hides anything taller anyway)
    const HS = Math.min(1.35, Math.max(0.9, R / 1000));
    // major summits — heights cluster by sector so some directions are huge
    // snowy massifs and others low shoulders, never a uniform spike fence.
    // S1 keeps every summit under the dropship's 160 u cruise altitude
    // (worst case: 0.91 apex fraction × 168 h ≈ 153 + jitter — 7 u of air).
    // WIDE bases make each major read as a massif, not an isoceles triangle.
    const majors: Peak[] = Array.from({ length: 28 }, (_, i) => {
      const a = (i / 28) * Math.PI * 2 + range(r, -0.06, 0.06);
      const cl = 0.5 + 0.5 * Math.sin(2 * a + 1.7) * Math.sin(3 * a + 0.6); // 0..1
      const h = (78 + cl * 80 + range(r, -8, 8)) * HS;
      const d = R + 95 + cl * 55 + range(r, -20, 20);
      const w = (110 + cl * 90 + range(r, -20, 20)) * Math.max(1, HS * 0.8);
      return {
        x: Math.cos(a) * d, z: Math.sin(a) * d, h, w,
        rot: range(r, 0, Math.PI * 2),
        sx: range(r, 0.78, 1.22), sz: range(r, 0.78, 1.22),
        ci: i % ROCK_COLS.length, tint: range(r, -0.045, 0.055),
        // winter grips snow from mid-slope (steep crags stay rocky); the rest
        // only dust the tops
        snow: pal.snow ? range(r, 0.26, 0.44) : h > 150 ? range(r, 0.55, 0.68) : range(r, 0.72, 0.9),
        seed: 11 + i * 3.17,
        k: range(r, 1.25, 1.85),
        skew: range(r, 0.14, 0.3),
        amp: [range(r, 0.18, 0.34), range(r, 0.1, 0.19), range(r, 0.05, 0.12)],
        ph: [range(r, 0, 6.28), range(r, 0, 6.28), range(r, 0, 6.28), range(r, 0, 6.28), range(r, 0, 6.28)],
        jit: range(r, 0.18, 0.32),
        topT: range(r, 0.6, 0.85),
        green: false,
      };
    });
    // shoulder peaks — hug the majors so the ring fuses into a CONNECTED
    // range (isolated cones is exactly the triangle look we killed)
    const shoulders: Peak[] = [];
    majors.forEach((m, i) => {
      const nSh = r() < 0.5 ? 3 : r() < 0.85 ? 2 : 1;
      for (let k = 0; k < nSh; k++) {
        const a = Math.atan2(m.z, m.x) + (k === 0 ? 1 : -1) * range(r, 0.012, 0.042);
        const d = Math.hypot(m.x, m.z) + range(r, -34, 42);
        const h = m.h * range(r, 0.5, 0.82);
        shoulders.push({
          x: Math.cos(a) * d, z: Math.sin(a) * d, h,
          w: m.w * range(r, 0.66, 1.0),
          rot: range(r, 0, Math.PI * 2),
          sx: range(r, 0.85, 1.18), sz: range(r, 0.85, 1.18),
          ci: (i + k + 1) % ROCK_COLS.length, tint: range(r, -0.04, 0.05),
          snow: pal.snow ? range(r, 0.3, 0.5) : h > 90 ? range(r, 0.62, 0.76) : range(r, 0.8, 0.95),
          seed: 71 + i * 7.7 + k * 2.9,
          k: range(r, 1.2, 1.7),
          skew: range(r, 0.1, 0.24),
          amp: [range(r, 0.15, 0.28), range(r, 0.09, 0.17), range(r, 0.04, 0.11)],
          ph: [range(r, 0, 6.28), range(r, 0, 6.28), range(r, 0, 6.28), range(r, 0, 6.28), range(r, 0, 6.28)],
          jit: range(r, 0.15, 0.26),
          topT: range(r, 0.62, 0.88),
          green: false,
        });
      }
    });
    // snow-dusted foothills — a DENSE overlapping band hugging the wall, so
    // the skyline never falls to nothing between massifs (always outside the
    // playable ring)
    const hills: Peak[] = Array.from({ length: 64 }, (_, i) => {
      const a = (i / 64) * Math.PI * 2 + range(r, -0.03, 0.03), d = R + range(r, 30, 95);
      return {
        x: Math.cos(a) * d, z: Math.sin(a) * d,
        h: range(r, 34, 58) * HS, w: range(r, 60, 100) * Math.max(1, HS * 0.7),
        rot: range(r, 0, Math.PI * 2),
        sx: range(r, 0.85, 1.2), sz: range(r, 0.85, 1.2),
        ci: i % HILL_COLS.length, tint: range(r, -0.05, 0.06),
        snow: pal.snow ? range(r, 0.45, 0.75) : 2,
        seed: 211 + i * 5.3,
        k: range(r, 0.5, 0.62),
        skew: range(r, 0.08, 0.18),
        amp: [range(r, 0.12, 0.22), range(r, 0.08, 0.16), range(r, 0.05, 0.1)],
        ph: [range(r, 0, 6.28), range(r, 0, 6.28), range(r, 0, 6.28), range(r, 0, 6.28), range(r, 0, 6.28)],
        jit: range(r, 0.16, 0.24),
        topT: range(r, 0.82, 0.92),
        green: !pal.snow,
      };
    });
    const peaks = [...majors, ...shoulders, ...hills];
    // base rings stay beyond the wall — the boundary clamps the player long
    // before the first slope
    clearPeaks(peaks, R + 34);
    return buildMountainGeometry(peaks, { snow: pal.snow });
  }, [world, pal.snow]);

  const mat = useMemo(() => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), []);
  return (
    <group>
      <mesh geometry={geo} material={mat} frustumCulled={false} />
      {/* the hard boundary band — matches the wall clamp at wallR */}
      <mesh position={[0, 6, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[world.map.wallR - 3, world.map.wallR + 4, 96, 1]} />
        <meshBasicMaterial color={pal.dirt} transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/* ---------------- POI name boards (billboards above plazas) ---------------- */

function SeasonPoiBoards({ world }: { world: SeasonWorld }) {
  const pal = world.def.pal;
  return (
    <group>
      {world.pois.map((p, i) => {
        const y = world.map.terrain(p.x, p.z);
        return (
          <mesh key={i} position={[p.x, y + 7.5, p.z]}>
            <sphereGeometry args={[0.3, 6, 5]} />
            <meshBasicMaterial color={pal.accent} />
          </mesh>
        );
      })}
    </group>
  );
}

/* ---------------- culler + root ---------------- */

function SeasonStaticCuller({ staticRef }: { staticRef: React.RefObject<THREE.Group | null> }) {
  useEffect(() => {
    registerCullRoot(staticRef.current, false, 2.6);
    return () => resetCullRoots();
  }, [staticRef]);
  useFrame((s, dtRaw) => {
    tickStaticCull(s.camera, Math.min(0.1, dtRaw));
  });
  return null;
}

export function SeasonWorldView({ clockRef, engine }: { clockRef: React.MutableRefObject<number>; engine: GameEngine }) {
  const world = engine.world as SeasonWorld;
  const staticRoot = useRef<THREE.Group>(null);
  const __scene = useThree((s) => s.scene);
  useEffect(() => {
    (window as unknown as { __scene?: THREE.Scene }).__scene = __scene;
    return () => { (window as unknown as { __scene?: THREE.Scene }).__scene = undefined; };
  }, [__scene]);
  return (
    <>
      <SeasonEnv clockRef={clockRef} pal={world.def.pal} />
      <SeasonGround world={world} />
      <SeasonRoads world={world} />
      <SeasonRim world={world} />
      <group ref={staticRoot}>
        <SeasonBuildings world={world} />
        <SeasonTrees world={world} />
        <SeasonGlbs world={world} />
        <SeasonRocks world={world} engine={engine} />
        <SeasonLamps world={world} clockRef={clockRef} />
        <SeasonFields world={world} />
        <SeasonFlowers world={world} />
        <SeasonCamps world={world} clockRef={clockRef} />
        <SeasonPonds world={world} />
        <SeasonSigns world={world} />
        <SeasonPoiBoards world={world} />
      </group>
      {/* 🚗 the fleet moves — parked rows, ring traffic, YOUR ride, bot & remote
          drivers. Outside the static cull root: the culler hides whole groups,
          which would fight a driven car that's always in view. */}
      <SeasonCars world={world} engine={engine} clockRef={clockRef} />
      <SeasonStaticCuller staticRef={staticRoot} />
    </>
  );
}
