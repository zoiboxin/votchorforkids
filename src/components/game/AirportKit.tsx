/**
 * ✈️ 7Nights International Airport — polyfork Airport Kit (GLB) scene parts.
 *
 * Every plane, helicopter and airport prop here is the REAL kit model from
 * https://polyfork.dev/kit/airport-43b137 (see src/lib/game/airportModels.ts),
 * replacing the old hand-built primitive bodies. Procedural pieces that the
 * kit doesn't cover (runway slab, painted markings, pad rings, tower cab,
 * gate house, pump house, supply lines) stay in WorldView's <Airport>.
 *
 * Orientation: the kit aircraft are authored fuselage-along-Z; MODEL_YAW turns
 * each one so placement rots behave like the old rigs (nose along +x, e.g.
 * AIRPORT.jet.rot = π parks nose-west). Tweak MODEL_YAW if a model faces the
 * wrong way after a catalog update.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { AIRPORT } from "@/lib/game/constants";
import {
  airportNode, onAirportModelsReady, spawnAirportModel,
  type AirportKind,
} from "@/lib/game/airportModels";

/** authored nose (+z) → +x so placement rots match the old procedural rigs */
const MODEL_YAW: Partial<Record<AirportKind, number>> = {
  helicopter: Math.PI / 2,
  bizjet: Math.PI / 2,
  cargo: Math.PI / 2,
  airliner: Math.PI / 2,
  widebody: Math.PI / 2,
  turboprop: Math.PI / 2,
  singleprop: Math.PI / 2,
  twinprop: Math.PI / 2,
};

/** spawn once per component + re-render when the GLB lands */
function useKitModel(kind: AirportKind) {
  const [spawn, setSpawn] = useState(() => spawnAirportModel(kind));
  useEffect(() => {
    if (spawn) return;
    return onAirportModelsReady(() => setSpawn(spawnAirportModel(kind)));
  }, [kind, spawn]);
  useFrame((_, dt) => { if (spawn?.mixer) spawn.mixer.update(dt); });
  return spawn;
}

/** generic grounded prop placement */
function KitProp({ kind, x, z, rot = 0, scale = 1, y = 0, extraYaw = 0 }: {
  kind: AirportKind; x: number; z: number; rot?: number; scale?: number; y?: number; extraYaw?: number;
}) {
  const spawn = useKitModel(kind);
  if (!spawn) return null;
  return (
    <primitive
      object={spawn.root}
      position={[x, y, z]}
      rotation-y={rot + (MODEL_YAW[kind] ?? 0) + extraYaw}
      scale={scale}
    />
  );
}

/* ---------------- parked fleet ---------------- */

/** helipad — procedural pad markings + the real kit helicopter, rotors live */
export function KitHelipad() {
  const spawn = useKitModel("helicopter");
  const main = useRef<THREE.Object3D | null>(null);
  const tail = useRef<THREE.Object3D | null>(null);
  useEffect(() => {
    if (!spawn) return;
    main.current = airportNode(spawn.root, "rotor-main");
    tail.current = airportNode(spawn.root, "rotor-tail");
  }, [spawn]);
  useFrame((_, dt) => {
    if (main.current) main.current.rotation.y += dt * 12;
    if (tail.current) tail.current.rotation.x += dt * 18;
  });
  const h = AIRPORT.helipad;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[h.x, 0.046, h.z]}><circleGeometry args={[h.r, 28]} /><meshLambertMaterial color="#3f4046" /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[h.x, 0.052, h.z]}><ringGeometry args={[h.r - 0.8, h.r - 0.4, 28]} /><meshBasicMaterial color="#f2c020" /></mesh>
      {[-1.1, 1.1].map((dx) => (
        <mesh key={dx} rotation-x={-Math.PI / 2} position={[h.x + dx, 0.054, h.z]}><planeGeometry args={[0.7, 3.2]} /><meshBasicMaterial color="#f5f5f0" /></mesh>
      ))}
      <mesh rotation-x={-Math.PI / 2} position={[h.x, 0.054, h.z]}><planeGeometry args={[1.7, 0.7]} /><meshBasicMaterial color="#f5f5f0" /></mesh>
      {spawn && (
        <primitive
          object={spawn.root}
          position={[AIRPORT.heli.x, 0, AIRPORT.heli.z]}
          rotation-y={AIRPORT.heli.rot + (MODEL_YAW.helicopter ?? 0)}
        />
      )}
    </group>
  );
}

/** freight-row fleet: cargo freighter, narrow-body airliner & regional
 *  turboprop parked nose-in on the east freight apron (kit real aircraft,
 *  slightly scaled to fit the runway/hangar corridor) */
export function KitFreightFleet() {
  return (
    <group>
      <KitProp kind="cargo" x={AIRPORT.cargo.x} z={AIRPORT.cargo.z} rot={AIRPORT.cargo.rot} scale={0.55} />
      <KitProp kind="airliner" x={AIRPORT.airliner.x} z={AIRPORT.airliner.z} rot={AIRPORT.airliner.rot} scale={0.62} />
      <KitProp kind="turboprop" x={AIRPORT.turboprop.x} z={AIRPORT.turboprop.z} rot={AIRPORT.turboprop.rot} scale={0.68} />
    </group>
  );
}

/** west grass light aircraft: business jet (apron), twin-piston & single-prop */
export function KitLightAircraft() {
  return (
    <group>
      <KitProp kind="bizjet" x={AIRPORT.jet.x} z={AIRPORT.jet.z} rot={AIRPORT.jet.rot} />
      <KitProp kind="twinprop" x={AIRPORT.piston.x} z={AIRPORT.piston.z} rot={AIRPORT.piston.rot} />
      <KitProp kind="singleprop" x={AIRPORT.singleprop.x} z={AIRPORT.singleprop.z} rot={AIRPORT.singleprop.rot} />
    </group>
  );
}

/* ---------------- terminal strip ---------------- */

/** open-air departures strip along the terminal glass — all real kit props:
 *  check-in kiosks, queue stanchion run, x-ray conveyor, security arch,
 *  passport booth, taxi-rank sign and a flight attendant idling by the door */
export function KitTerminal() {
  return (
    <group>
      {AIRPORT.kiosks.map((k, i) => (
        <KitProp key={i} kind="kiosk" x={k.x} z={k.z} rot={Math.PI} />
      ))}
      <KitProp kind="stanchions" x={AIRPORT.stanchions[0].x} z={(AIRPORT.stanchions[0].z + AIRPORT.stanchions[2].z) / 2} rot={Math.PI / 2} />
      <KitProp kind="xray" x={AIRPORT.xray.x} z={AIRPORT.xray.z} />
      <KitProp kind="arch" x={AIRPORT.arch.x} z={AIRPORT.arch.z} />
      <KitProp kind="passport" x={AIRPORT.passport.x} z={AIRPORT.passport.z} />
      <KitProp kind="taxiSign" x={AIRPORT.taxiSign.x} z={AIRPORT.taxiSign.z} rot={Math.PI} />
      <KitProp kind="attendant" x={AIRPORT.terminal.x + 3.5} z={AIRPORT.terminal.z - AIRPORT.terminal.d - 2.9} rot={Math.PI} />
    </group>
  );
}

/* ---------------- apron service ---------------- */

/** ground power units behind each airliner slot, container dollies, the spare
 *  engine on its transport stand and the wheeled fire extinguisher */
export function KitService() {
  return (
    <group>
      {AIRPORT.gpus.map((g, i) => (
        <KitProp key={i} kind="gpu" x={g.x} z={g.z} rot={Math.PI / 2} />
      ))}
      {AIRPORT.dollies.map((d, i) => (
        <KitProp key={i} kind="dolly" x={d.x} z={d.z} rot={i * 0.55 - 0.4} />
      ))}
      <KitProp kind="spareEngine" x={AIRPORT.spareEngine.x} z={AIRPORT.spareEngine.z} rot={-0.5} />
      <KitProp kind="extinguisher" x={AIRPORT.extinguisher.x} z={AIRPORT.extinguisher.z} rot={0.4} />
    </group>
  );
}

/** lifting barrier at the apron gate — the kit's housing + boom, raising and
 *  lowering on a loop so kids can time their run past it (gate house is
 *  procedural in <Airport>) */
export function KitBarrier() {
  const spawn = useKitModel("barrierArm");
  const boom = useRef<THREE.Object3D | null>(null);
  useEffect(() => {
    if (!spawn) return;
    boom.current = airportNode(spawn.root, "boom");
  }, [spawn]);
  useFrame((s) => {
    if (!boom.current) return;
    const c = s.clock.elapsedTime % 8;
    boom.current.rotation.z = c < 3.4 ? 1.25 : c < 4.2 ? 1.25 - ((c - 3.4) / 0.8) * 1.25 : 0;
  });
  if (!spawn) return null;
  return (
    <primitive
      object={spawn.root}
      position={[AIRPORT.gate.x + 5, 0, AIRPORT.gate.z]}
      rotation-y={Math.PI / 2}
      scale={1.15}
    />
  );
}

/** fuel farm — three real kit tanks (supply line + pump house stay procedural
 *  in <Airport>) */
export function KitFuelTanks() {
  return (
    <group>
      {AIRPORT.fuelTanks.map((t, i) => (
        <KitProp key={i} kind="fuelTank" x={t.x} z={t.z} scale={0.45} />
      ))}
    </group>
  );
}

/* ---------------- runway furniture ---------------- */

/** approach lighting bar — kit light frames ladder the extended centreline
 *  before the west threshold, with a 3-unit crossbar at the 300m mark.
 *  Kept clear of the ring highway's airport bypass (which passes ~10m west). */
export function KitApproachLights() {
  const xs = [218, 212];
  return (
    <group>
      {xs.map((x) => (
        <KitProp key={x} kind="approachBar" x={x} z={AIRPORT.rz} rot={Math.PI / 2} scale={1.3} />
      ))}
      {[295.6, 300, 304.4].map((z) => (
        <KitProp key={z} kind="approachBar" x={206} z={z} rot={Math.PI / 2} scale={1.3} />
      ))}
    </group>
  );
}

/** PAPI — four precision path indicator units on the touchdown-zone shoulder */
export function KitPapi() {
  return (
    <group>
      {[0, 1, 2, 3].map((i) => (
        <KitProp key={i} kind="papi" x={AIRPORT.rx0 + 9 + i * 3} z={AIRPORT.rz + 11} rot={-Math.PI / 2} />
      ))}
    </group>
  );
}

/** runway guard lights — alternating flashing ambers flanking the taxiway */
export function KitGuardLights() {
  const a = useRef<THREE.Group>(null!);
  const b = useRef<THREE.Group>(null!);
  useFrame((s) => {
    const on = Math.sin(s.clock.elapsedTime * 7) > 0;
    if (a.current) a.current.visible = on;
    if (b.current) b.current.visible = !on;
  });
  return (
    <group>
      <group ref={a}>
        <KitProp kind="guardLight" x={AIRPORT.rx0 - 20} z={AIRPORT.rz + 9.6} rot={Math.PI} />
      </group>
      <group ref={b}>
        <KitProp kind="guardLight" x={AIRPORT.rx0 - 1} z={AIRPORT.rz + 9.6} rot={Math.PI} />
      </group>
    </group>
  );
}

/** runway distance-remaining boards on the shoulder */
export function KitDistanceBoards() {
  return (
    <group>
      {AIRPORT.boards.map((b) => (
        <KitProp key={b.x} kind="board" x={b.x} z={AIRPORT.rz + 9.8} rot={Math.PI} scale={1.4} />
      ))}
    </group>
  );
}

/* ---------------- beacon, windsock & VOR ---------------- */

/** rotating airport beacon on the tower roof — the kit model with a live
 *  spinning head (procedural radar bar stays in <Airport>) */
export function KitBeacon() {
  const spawn = useKitModel("beacon");
  const head = useRef<THREE.Object3D | null>(null);
  useEffect(() => {
    if (!spawn) return;
    head.current = airportNode(spawn.root, "beacon-head");
  }, [spawn]);
  useFrame((_, dt) => { if (head.current) head.current.rotation.y += dt * 2.6; });
  if (!spawn) return null;
  return (
    <primitive
      object={spawn.root}
      position={[AIRPORT.tower.x, AIRPORT.tower.h + 4.9, AIRPORT.tower.z]}
      scale={0.62}
    />
  );
}

/** windsock on the south lawn beside the helipad — kit mast + sock, the sock
 *  sways with the breeze via its swivel node */
export function KitWindsock() {
  const spawn = useKitModel("windsock");
  const sway = useRef<THREE.Object3D | null>(null);
  useEffect(() => {
    if (!spawn) return;
    sway.current = airportNode(spawn.root, "sway") ?? airportNode(spawn.root, "swivel");
  }, [spawn]);
  useFrame((s) => {
    if (sway.current) sway.current.rotation.y = Math.sin(s.clock.elapsedTime * 0.8) * 0.5;
  });
  if (!spawn) return null;
  return <primitive object={spawn.root} position={[AIRPORT.windsock.x, 0, AIRPORT.windsock.z]} />;
}

/** VOR navigation beacon on its grass pad NE of the runway (pad stays
 *  procedural in <Airport>) */
export function KitVor() {
  return <KitProp kind="vor" x={AIRPORT.vor.x} z={AIRPORT.vor.z} scale={0.62} />;
}

/* ---------------- flying fleet ---------------- */

/** one bot plane — the kit narrow-body airliner (scaled to the apron slots).
 *  The engine still drives position/heading/pitch on the parent group in
 *  <Planes>; this rig only contributes the model plus the list of gear/door
 *  nodes that get tucked away the moment the wheels leave the tarmac. */
export function KitBotPlane({ onGear }: { onGear: (nodes: THREE.Object3D[] | null) => void }) {
  const spawn = useKitModel("airliner");
  const gearNodes = useMemo(() => {
    if (!spawn) return null;
    const out: THREE.Object3D[] = [];
    spawn.root.traverse((o) => {
      if (/gear|wheel|door|bay/i.test(o.name)) out.push(o);
    });
    return out;
  }, [spawn]);
  useEffect(() => {
    onGear(gearNodes);
    return () => onGear(null);
  }, [gearNodes, onGear]);
  if (!spawn) return null;
  return (
    <primitive object={spawn.root} rotation-y={MODEL_YAW.airliner ?? 0} scale={0.55} />
  );
}
