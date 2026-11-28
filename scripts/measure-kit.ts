/* One-off: measure every construction-kit GLB (authored size + ground offset).
 * Run: bun scripts/measure-kit.ts */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { readdirSync } from "fs";
import { join } from "path";

const dir = join(process.cwd(), "public/models/construction");
const files = readdirSync(dir).filter((f) => f.endsWith(".glb")).sort();
const loader = new GLTFLoader();

for (const f of files) {
  const buf = await Bun.file(join(dir, f)).arrayBuffer();
  const gltf = await new Promise<any>((res, rej) => {
    try {
      loader.parse(buf, "", res, rej);
    } catch (e) {
      rej(e);
    }
  }).catch((e) => null);
  if (!gltf) {
    console.log(`${f}: PARSE FAILED`);
    continue;
  }
  const scene = gltf.scene as THREE.Group;
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  console.log(
    `${f.replace(".glb", "")}  |  w=${size.x.toFixed(2)} d=${size.z.toFixed(2)} h=${size.y.toFixed(2)}  minY=${box.min.y.toFixed(2)}`,
  );
}
