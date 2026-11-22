/* one-off: measure hospital kit GLBs — bbox, vertex colours, meshes, clips */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = "/home/z/my-project/public/models/hospital";
const files = readdirSync(dir).filter((f) => f.endsWith(".glb"));

const loader = new GLTFLoader();
const parser = loader.parse.bind(loader) as unknown as (
  data: ArrayBuffer, path: string, onLoad: (g: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }) => void, onError: (e: unknown) => void,
) => void;

let done = 0;
for (const f of files) {
  const buf = readFileSync(join(dir, f));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  parser(ab as ArrayBuffer, "", (gltf) => {
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    let meshes = 0, tris = 0, vcol = 0, mats = new Set<string>();
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      meshes++;
      const pos = m.geometry.getAttribute("position");
      tris += pos ? pos.count / 3 : 0;
      if (m.geometry.getAttribute("color")) vcol++;
      const mat = m.material as THREE.Material & { color?: THREE.Color; map?: unknown };
      if (mat) mats.add(`${mat.type}${mat.color ? ":" + mat.color.getHexString() : ""}${mat.map ? ":map" : ""}`);
    });
    const clips = gltf.animations.map((c) => c.name).join(",");
    console.log(
      `${f}: w=${size.x.toFixed(2)} h=${size.y.toFixed(2)} d=${size.z.toFixed(2)} minY=${box.min.y.toFixed(2)} meshes=${meshes} tris=${tris} vcol=${vcol}/${meshes} mats=[${[...mats].join(" | ")}]${clips ? " clips=" + clips : ""}`,
    );
    if (++done === files.length) process.exit(0);
  }, (e) => {
    console.log(`${f}: ERROR ${String(e).slice(0, 120)}`);
    if (++done === files.length) process.exit(0);
  });
}
