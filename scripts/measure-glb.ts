/* one-off: measure GLB bounding boxes for graveyard kit placement calibration */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = "/home/z/my-project/public/models/graveyard";
const files = readdirSync(dir).filter((f) => f.endsWith(".glb"));

const loader = new GLTFLoader();
const parser = loader.parse.bind(loader) as unknown as (
  data: ArrayBuffer, path: string, onLoad: (g: { scene: THREE.Object3D }) => void, onError: (e: unknown) => void,
) => void;

let done = 0;
for (const f of files) {
  const buf = readFileSync(join(dir, f));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  parser(ab as ArrayBuffer, "", (gltf) => {
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    console.log(`${f}: w=${size.x.toFixed(2)} h=${size.y.toFixed(2)} d=${size.z.toFixed(2)} minY=${box.min.y.toFixed(2)}`);
    if (++done === files.length) process.exit(0);
  }, (e) => {
    console.log(`${f}: ERROR ${String(e).slice(0, 120)}`);
    if (++done === files.length) process.exit(0);
  });
}
