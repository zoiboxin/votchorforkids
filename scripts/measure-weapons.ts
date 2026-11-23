/* weapon measurement — bounding box of each GLB in meters (Y-up) */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { readFileSync } from "node:fs";

const files = [
  "arming-sword-401972", "hand-axe-cee9e7", "jewelled-dagger-38f556",
  "spear-e9824e", "potion-bottle-099ad7",
];

const loader = new GLTFLoader();
for (const f of files) {
  const buf = readFileSync(`/home/z/my-project/public/models/weapons/${f}.glb`);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise((res, rej) => loader.parse(ab as ArrayBuffer, "", res, rej));
  const scene = gltf.scene;
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  console.log(
    `${f}:  size ${size.x.toFixed(3)} × ${size.y.toFixed(3)} × ${size.z.toFixed(3)}  ` +
    `min(${box.min.x.toFixed(2)},${box.min.y.toFixed(2)},${box.min.z.toFixed(2)}) ` +
    `max(${box.max.x.toFixed(2)},${box.max.y.toFixed(2)},${box.max.z.toFixed(2)}) ` +
    `center(${center.x.toFixed(2)},${center.y.toFixed(2)},${center.z.toFixed(2)})` +
    (gltf.animations?.length ? `  clips:${gltf.animations.map(a => a.name).join(",")}` : ""),
  );
}
