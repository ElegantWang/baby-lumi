// Loads the baked character asset (see tools/build-character.mjs).
import * as THREE from 'three';

const TYPES = {
  f32: Float32Array,
  i8: Int8Array,
  u8: Uint8Array,
  u16: Uint16Array,
  u32: Uint32Array,
};

/**
 * @returns {Promise<{geometry: THREE.BufferGeometry, header: any}>}
 */
export async function loadCharacter(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load ${url}: ${res.status}`);
  const buf = await res.arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x494d554c) throw new Error('not a Lumi mesh file');
  const headerLen = dv.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, headerLen)));
  const base = 8 + headerLen;

  const geometry = new THREE.BufferGeometry();
  for (const a of header.attributes) {
    const T = TYPES[a.type];
    const arr = new T(buf, base + a.offset, a.count * a.itemSize);
    geometry.setAttribute(a.name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
  }
  const IT = TYPES[header.index.type];
  geometry.setIndex(new THREE.BufferAttribute(new IT(buf, base + header.index.offset, header.index.count), 1));
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(...header.bbox.min).subScalar(0.15),
    new THREE.Vector3(...header.bbox.max).addScalar(0.15),
  );
  geometry.boundingSphere = new THREE.Sphere();
  geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);
  return { geometry, header };
}

/** Builds the THREE.Skeleton (identity rest orientation, world-aligned bones). */
export function buildSkeleton(header) {
  const bones = [];
  const byName = {};
  for (const b of header.bones) {
    const bone = new THREE.Bone();
    bone.name = b.name;
    bone.userData.rest = new THREE.Vector3(...b.pos); // rest position in model space
    bones.push(bone);
    byName[b.name] = bone;
  }
  header.bones.forEach((b, i) => {
    const bone = bones[i];
    if (b.parent) {
      const parent = byName[b.parent];
      parent.add(bone);
      bone.position.copy(bone.userData.rest).sub(parent.userData.rest);
    } else {
      bone.position.copy(bone.userData.rest);
    }
    bone.userData.restLocal = bone.position.clone();
  });
  const inverses = bones.map((bone) => new THREE.Matrix4().makeTranslation(-bone.userData.rest.x, -bone.userData.rest.y, -bone.userData.rest.z));
  const skeleton = new THREE.Skeleton(bones, inverses);
  return { skeleton, bones, byName, root: bones[0] };
}
