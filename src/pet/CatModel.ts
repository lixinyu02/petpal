import * as THREE from 'three';

export type CatAction = 'idle' | 'walk' | 'pet' | 'eat' | 'sleep' | 'jump';
export interface CatState { action: CatAction; lookX: number; lookY: number; speed: number; reducedMotion?: boolean }
export interface CatModel {
  /** Feet rest at y=0; the face points toward +Z. The short ears reach approximately y=2.5. */
  group: THREE.Group;
  update(tSeconds: number, state: CatState): void;
  dispose(): void;
}

const clamp = THREE.MathUtils.clamp;
const mix = THREE.MathUtils.lerp;
const smooth = (a: number, b: number, value: number) => {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** A single procedural character, with a persistent joint rig and no external image/model assets. */
export function createCatModel(): CatModel {
  const group = new THREE.Group();
  group.name = 'PetPal — companion kitten';
  const rig = new THREE.Group();
  group.add(rig);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  let disposed = false;

  const geometry = <T extends THREE.BufferGeometry>(value: T): T => { geometries.add(value); return value; };
  const material = <T extends THREE.Material>(value: T): T => { materials.add(value); return value; };
  const standard = (color: THREE.ColorRepresentation, options: THREE.MeshStandardMaterialParameters = {}) =>
    material(new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, ...options }));
  const sphereGeometry = geometry(new THREE.SphereGeometry(1, 40, 28));
  const cream = standard('#fff0d6');
  const orange = standard('#e5a676');
  const warmWhite = standard('#fff6e5');
  const innerEar = standard('#e8a094', { roughness: 0.92 });
  const pink = standard('#df8c83', { roughness: 0.68 });
  const darkMouth = standard('#784b3b', { roughness: 0.85 });
  const whiskerMaterial = standard('#f3ddbd', { transparent: true, opacity: 0.86, roughness: 0.75 });
  const green = standard('#557866', { roughness: 0.76 });
  const greenEdge = standard('#6e8e75', { roughness: 0.74 });
  const gold = material(new THREE.MeshPhysicalMaterial({ color: '#dfad45', roughness: 0.25, metalness: 0.72, clearcoat: 0.45, clearcoatRoughness: 0.18 }));
  const eyeHighlight = material(new THREE.MeshBasicMaterial({ color: '#fffef5', toneMapped: false }));

  function mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, position: number[] = [0, 0, 0], scale: number[] = [1, 1, 1]) {
    const result = new THREE.Mesh(geo, mat);
    result.position.set(position[0], position[1], position[2]);
    result.scale.set(scale[0], scale[1], scale[2]);
    result.castShadow = true;
    result.receiveShadow = true;
    parent.add(result);
    return result;
  }
  function oval(parent: THREE.Object3D, mat: THREE.Material, position: number[], scale: number[]) {
    return mesh(parent, sphereGeometry, mat, position, scale);
  }
  function stroke(parent: THREE.Object3D, points: number[][], radius: number, mat: THREE.Material, segments = 24) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p as [number, number, number])));
    return mesh(parent, geometry(new THREE.TubeGeometry(curve, segments, radius, 6, false)), mat);
  }

  // UV-mapped cream blaze, cheeks, tabby forehead strokes, and low-contrast fur grain.
  // Generated once; the same texture stays attached through every animation.
  function makeFurTexture(kind: 'head' | 'body'): THREE.DataTexture {
    const width = 512, height = 256;
    const pixels = new Uint8Array(width * height * 4);
    let seed = 71921;
    for (let yPixel = 0; yPixel < height; yPixel++) {
      const theta = (1 - yPixel / (height - 1)) * Math.PI;
      const y = Math.cos(theta), ring = Math.sin(theta);
      for (let xPixel = 0; xPixel < width; xPixel++) {
        const phi = xPixel / (width - 1) * Math.PI * 2;
        const x = -Math.cos(phi) * ring, z = Math.sin(phi) * ring;
        const front = smooth(0.1, 0.7, z);
        let white = 0, stripe = 0;
        if (kind === 'head') {
          const cheeks = smooth(0.18, -0.2, y) * front;
          const blaze = smooth(0.2, 0.025, Math.abs(x) + Math.max(0, y) * 0.06) * smooth(0.87, 0.38, y) * front;
          white = Math.max(cheeks, blaze * 0.96);
          const forehead = smooth(0.22, 0.43, y) * smooth(0.98, 0.84, y) * smooth(0.05, 0.6, z);
          for (const offset of [-0.3, 0, 0.3]) {
            const lineX = offset * (0.84 + y * 0.22) + Math.sin(y * 7 + offset * 5) * 0.034;
            stripe = Math.max(stripe, smooth(0.047, 0.006, Math.abs(x - lineX)) * forehead);
          }
          stripe = Math.max(stripe, smooth(0.83, 0.97, Math.sin(phi * 8 + y * 5)) * (1 - front) * 0.7);
        } else {
          white = front * smooth(0.55, 0.15, Math.abs(x)) * smooth(0.94, 0.55, y);
          stripe = smooth(0.6, 0.97, Math.sin(y * 17 + phi * 2 + Math.sin(phi * 3))) * (1 - front * 0.85) * 0.58;
        }
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        const grain = ((seed >>> 0) / 4294967295 - 0.5) * 6;
        const base = [237, 177, 131], whiteColor = [255, 242, 224], stripeColor = [199, 124, 79];
        const index = (yPixel * width + xPixel) * 4;
        for (let c = 0; c < 3; c++) {
          const coat = mix(base[c], stripeColor[c], stripe * 0.66);
          pixels[index + c] = clamp(mix(coat, whiteColor[c], white) + grain, 0, 255);
        }
        pixels[index + 3] = 255;
      }
    }
    const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    textures.add(texture);
    return texture;
  }
  const headFur = standard('#ffffff', { map: makeFurTexture('head'), roughness: 0.9 });
  const bodyFur = standard('#ffffff', { map: makeFurTexture('body'), roughness: 0.92 });

  const body = new THREE.Group();
  body.name = 'breathing torso';
  body.position.set(0, 0.7, -0.05);
  rig.add(body);
  const bodyShape = geometry(new THREE.SphereGeometry(1, 48, 36));
  const bodyPositions = bodyShape.attributes.position;
  for (let i = 0; i < bodyPositions.count; i++) {
    const y = bodyPositions.getY(i);
    bodyPositions.setX(i, bodyPositions.getX(i) * (1 - Math.max(0, y) * 0.28));
    bodyPositions.setZ(i, bodyPositions.getZ(i) * (1 + Math.max(0, -y) * 0.09));
  }
  bodyShape.computeVertexNormals();
  mesh(body, bodyShape, bodyFur, [0, 0, 0], [0.495, 0.565, 0.425]);

  const head = new THREE.Group();
  head.name = 'head and facial expression rig';
  head.position.set(0, 1.55, 0.19);
  rig.add(head);
  const headRadius = { x: 0.88, y: 0.665, z: 0.555 };
  const cheekWidth = (y: number) => 1 + Math.exp(-Math.pow((y + 0.26) / 0.45, 2)) * 0.11;
  const muzzleDepth = (x: number, y: number, z: number) => {
    const left = Math.exp(-Math.pow((x + 0.23) / 0.28, 2) - Math.pow((y + 0.31) / 0.26, 2));
    const right = Math.exp(-Math.pow((x - 0.23) / 0.28, 2) - Math.pow((y + 0.31) / 0.26, 2));
    return Math.pow(Math.max(0, z), 4) * (left + right) * 0.07;
  };
  // Both the eyelids and eye surfaces use this exact head surface, avoiding detached eye patches.
  const faceSurface = (x: number, y: number) => {
    const sy = y / (headRadius.y * (y < 0 ? 0.98 : 1));
    const sx = x / (headRadius.x * cheekWidth(sy));
    const sz = Math.sqrt(Math.max(0.005, 1 - sx * sx - sy * sy));
    return (sz + muzzleDepth(sx, sy, sz)) * headRadius.z;
  };
  const headShape = geometry(new THREE.SphereGeometry(1, 64, 44));
  const headPositions = headShape.attributes.position;
  for (let i = 0; i < headPositions.count; i++) {
    const x = headPositions.getX(i), y = headPositions.getY(i), z = headPositions.getZ(i);
    // Broad lower cheeks and a shorter muzzle, with a gently flattened rear skull.
    headPositions.setXYZ(i, x * cheekWidth(y), y * (y < 0 ? 0.98 : 1),
      z < 0 ? z * 0.94 : z + muzzleDepth(x, y, z));
  }
  headShape.computeVertexNormals();
  mesh(head, headShape, headFur, [0, 0, 0], [headRadius.x, headRadius.y, headRadius.z]);

  function earOutline() {
    const shape = new THREE.Shape();
    shape.moveTo(-0.26, -0.025);
    shape.bezierCurveTo(-0.245, 0.12, -0.09, 0.405, -0.015, 0.438);
    shape.bezierCurveTo(0.048, 0.452, 0.224, 0.115, 0.265, -0.025);
    shape.bezierCurveTo(0.14, -0.078, -0.13, -0.08, -0.26, -0.025);
    return shape;
  }
  const outerEarGeometry = geometry(new THREE.ExtrudeGeometry(earOutline(), { depth: 0.07, bevelEnabled: true, bevelSegments: 4, steps: 1, bevelSize: 0.029, bevelThickness: 0.035, curveSegments: 18 }));
  const earInsideGeometry = geometry(new THREE.ExtrudeGeometry(earOutline(), { depth: 0.014, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.018, bevelThickness: 0.014, curveSegments: 16 }));
  const ears = [-1, 1].map(side => {
    const pivot = new THREE.Group();
    pivot.name = side < 0 ? 'left ear' : 'right ear';
    pivot.position.set(side * 0.58, 0.42, -0.085);
    pivot.rotation.z = side * -0.3;
    head.add(pivot);
    mesh(pivot, outerEarGeometry, orange);
    const inside = mesh(pivot, earInsideGeometry, innerEar, [0, 0.025, 0.112], [0.67, 0.7, 0.7]);
    inside.castShadow = false;
    oval(pivot, cream, [0, 0.005, 0.10], [0.17, 0.055, 0.045]);
    for (let i = 0; i < 3; i++) {
      stroke(pivot, [[-0.1 + i * 0.07, 0.008, 0.15], [-0.09 + i * 0.07, 0.08 + i % 2 * 0.016, 0.15]], 0.006, warmWhite, 6);
    }
    return { pivot, side };
  });

  function eyeTexture() {
    const size = 128, data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const nx = x / (size - 1) * 2 - 1, ny = y / (size - 1) * 2 - 1;
      const iris = [86, 48, 25];
      const pupil = smooth(1.04, 0.89, Math.sqrt((nx / 0.61) ** 2 + ((ny - 0.045) / 0.76) ** 2));
      const rim = smooth(0.78, 1, Math.hypot(nx, ny));
      const light = 0.85 + (1 - ny) * 0.14;
      for (let c = 0; c < 3; c++) data[(y * size + x) * 4 + c] = mix(iris[c] * light, [15, 12, 10][c], Math.max(pupil, rim * 0.72));
      data[(y * size + x) * 4 + 3] = 255;
    }
    const map = new THREE.DataTexture(data, size, size);
    map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearFilter; map.needsUpdate = true;
    textures.add(map);
    return map;
  }
  const eyes = [-1, 1].map(side => {
    const cx = side * 0.323, cy = 0.045, rx = 0.203, ry = 0.221;
    const vertices: number[] = [], uvs: number[] = [], indices: number[] = [];
    const rings = 12, steps = 48;
    for (let ring = 0; ring <= rings; ring++) for (let step = 0; step <= steps; step++) {
      const radius = ring / rings, angle = step / steps * Math.PI * 2;
      const dx = Math.cos(angle) * radius, dy = Math.sin(angle) * radius;
      const x = cx + rx * dx, y = cy + ry * dy;
      vertices.push(x - cx, y - cy, faceSurface(x, y) + 0.009 + (1 - radius * radius) * 0.027);
      uvs.push((dx + 1) / 2, (dy + 1) / 2);
      if (ring < rings && step < steps) {
        const a = ring * (steps + 1) + step, b = a + 1, d = a + steps + 1, c = d + 1;
        indices.push(a, d, c, a, c, b);
      }
    }
    const eyeGeometry = geometry(new THREE.BufferGeometry());
    eyeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    eyeGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    eyeGeometry.setIndex(indices); eyeGeometry.computeVertexNormals();
    const map = eyeTexture();
    const eyeMaterial = material(new THREE.MeshPhysicalMaterial({ map, roughness: 0.105, clearcoat: 1, clearcoatRoughness: 0.035 }));
    const open = new THREE.Group();
    open.position.set(cx, cy, 0);
    head.add(open);
    const surface = mesh(open, eyeGeometry, eyeMaterial);
    surface.castShadow = false;
    const gaze = new THREE.Group();
    open.add(gaze);
    const glint = oval(gaze, eyeHighlight, [-0.055, 0.073, faceSurface(cx - 0.055, cy + 0.073) + 0.04], [0.036, 0.044, 0.006]);
    glint.castShadow = false;
    const smallGlint = oval(gaze, eyeHighlight, [0.064, -0.055, faceSurface(cx + 0.064, cy - 0.055) + 0.038], [0.016, 0.018, 0.005]);
    smallGlint.castShadow = false;
    const closedMaterial = standard('#68472e', { transparent: true, opacity: 0, depthWrite: false });
    const lidPoints = [[-0.175, -0.014], [-0.09, 0.023], [0, 0.04], [0.09, 0.023], [0.175, -0.014]]
      .map(([x, y]) => [cx + x, cy + y, faceSurface(cx + x, cy + y) + 0.008]);
    const closed = stroke(head, lidPoints, 0.01, closedMaterial);
    closed.castShadow = false;
    return { open, gaze, map, closedMaterial };
  });

  const noseShape = new THREE.Shape();
  noseShape.moveTo(-0.066, 0.026);
  noseShape.bezierCurveTo(-0.033, 0.052, 0.035, 0.052, 0.067, 0.026);
  noseShape.bezierCurveTo(0.065, -0.007, 0.018, -0.043, 0, -0.049);
  noseShape.bezierCurveTo(-0.02, -0.042, -0.066, -0.007, -0.066, 0.026);
  const noseGeo = geometry(new THREE.ExtrudeGeometry(noseShape, { depth: 0.017, bevelEnabled: true, bevelSize: 0.007, bevelThickness: 0.009, bevelSegments: 3, curveSegments: 12 }));
  const noseZ = faceSurface(0, -0.135) + 0.009;
  mesh(head, noseGeo, pink, [0, -0.135, noseZ]);
  oval(head, standard('#f6c0aa', { roughness: 0.6 }), [-0.018, -0.114, noseZ + 0.029], [0.014, 0.006, 0.004]);
  const mouth = new THREE.Group();
  head.add(mouth);
  const mouthSurface = (points: number[][]) => points.map(([x, y]) => [x, y, faceSurface(x, y) + 0.006]);
  stroke(mouth, mouthSurface([[0, -0.179], [0, -0.215], [-0.036, -0.239], [-0.085, -0.22]]), 0.0065, darkMouth, 18);
  stroke(mouth, mouthSurface([[0, -0.215], [0.036, -0.239], [0.085, -0.22]]), 0.0065, darkMouth, 18);
  const eatingMouth = oval(head, darkMouth, [0, -0.236, faceSurface(0, -0.236) + 0.008], [0.023, 0.002, 0.006]);
  const whiskers = [-1, 1].map(side => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.375, -0.18, faceSurface(side * 0.375, -0.18) + 0.009);
    head.add(pivot);
    for (let i = 0; i < 3; i++) {
      const tilt = (i - 1) * 0.08;
      stroke(pivot, [[0, tilt * 0.25, 0], [side * 0.24, tilt * 0.7 + 0.018, 0.009], [side * 0.62, tilt, -0.075]], 0.0045, whiskerMaterial, 18);
      const freckleX = side * (0.27 + i % 2 * 0.045), freckleY = -0.185 - i * 0.032;
      oval(head, darkMouth, [freckleX, freckleY, faceSurface(freckleX, freckleY) + 0.005], [0.006, 0.005, 0.003]);
    }
    return { pivot, side };
  });

  const collar = new THREE.Group();
  collar.position.set(0, 0.99, 0);
  rig.add(collar);
  const band = mesh(collar, geometry(new THREE.CylinderGeometry(0.417, 0.428, 0.09, 64, 1, true)), green);
  band.scale.z = 0.91;
  for (const y of [-0.044, 0.044]) {
    const seam = mesh(collar, geometry(new THREE.TorusGeometry(0.422, 0.01, 7, 64)), greenEdge, [0, y, 0]);
    seam.rotation.x = Math.PI / 2;
    seam.scale.y = 0.91;
  }
  const bell = new THREE.Group();
  bell.position.set(0, -0.065, 0.397);
  collar.add(bell);
  mesh(bell, geometry(new THREE.TorusGeometry(0.046, 0.013, 8, 24)), gold, [0, 0, 0.012]);
  oval(bell, gold, [0, -0.093, 0.027], [0.12, 0.116, 0.102]);
  stroke(bell, [[-0.076, -0.11, 0.099], [-0.045, -0.13, 0.124], [0.025, -0.134, 0.128], [0.069, -0.11, 0.108]], 0.009, darkMouth, 18);
  oval(bell, darkMouth, [0, -0.12, 0.13], [0.016, 0.018, 0.007]);

  const forelegGeo = geometry(new THREE.LatheGeometry([
    new THREE.Vector2(0, -0.58), new THREE.Vector2(0.095, -0.57),
    new THREE.Vector2(0.13, -0.51), new THREE.Vector2(0.139, -0.42),
    new THREE.Vector2(0.131, -0.27), new THREE.Vector2(0.15, -0.1),
    new THREE.Vector2(0.164, 0.035), new THREE.Vector2(0.11, 0.13), new THREE.Vector2(0, 0.16),
  ], 40));
  const pawGeo = geometry(new THREE.SphereGeometry(1, 40, 24));
  for (let i = 0; i < pawGeo.attributes.position.count; i++) {
    const p = pawGeo.attributes.position;
    p.setZ(i, p.getZ(i) + Math.pow(Math.max(0, p.getZ(i)), 3) * Math.cos(p.getX(i) * Math.PI * 3) * 0.045);
  }
  pawGeo.computeVertexNormals();
  const legs: { pivot: THREE.Group; ankle: THREE.Group; paw: THREE.Group; front: boolean; side: number; baseY: number; pawY: number; phase: number }[] = [];
  for (const front of [false, true]) {
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      const baseY = front ? 0.695 : 0.48;
      pivot.position.set(side * (front ? 0.305 : 0.395), baseY, front ? 0.3 : -0.2);
      pivot.name = `${front ? 'front' : 'rear'} ${side < 0 ? 'left' : 'right'} leg`;
      rig.add(pivot);
      if (front) mesh(pivot, forelegGeo, cream, [0, 0, 0.025]);
      else oval(pivot, bodyFur, [0, -0.085, 0], [0.217, 0.25, 0.233]);
      const ankle = new THREE.Group();
      ankle.position.y = front ? -0.36 : -0.235;
      pivot.add(ankle);
      if (!front) oval(ankle, cream, [0, -0.045, 0.022], [0.14, 0.14, 0.17]);
      const paw = new THREE.Group();
      const pawY = front ? -0.2 : -0.12;
      paw.position.set(0, pawY, front ? 0.095 : 0.08);
      ankle.add(paw);
      mesh(paw, pawGeo, cream, [0, 0, 0], [front ? 0.174 : 0.181, front ? 0.135 : 0.125, 0.221]);
      for (const toe of [-1, 1]) {
        stroke(paw, [[toe * 0.055, 0.063, 0.177], [toe * 0.056, 0.023, 0.217]], 0.0023, standard('#dbc3a3'), 7);
      }
      // A four-beat walk: rear left, front left, rear right, front right.
      legs.push({ pivot, ankle, paw, front, side, baseY, pawY, phase: (side < 0 ? 0 : 0.5) + (front ? 0.25 : 0) });
    }
  }

  // A tapered, striped skinned tube: the tail bends continuously between seven joints.
  const tail = new THREE.Group();
  tail.name = 'continuous skinned tail';
  tail.position.set(0.37, 0.49, -0.315);
  tail.scale.set(0.93, 0.88, 0.92);
  rig.add(tail);
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.31, 0.035, -0.065),
    new THREE.Vector3(0.56, 0.3, -0.005), new THREE.Vector3(0.58, 0.7, 0.11),
    new THREE.Vector3(0.43, 0.925, 0.18), new THREE.Vector3(0.235, 0.9, 0.2),
  ]);
  const tailSegments = 72, radialSegments = 12, boneCount = 7;
  const tailGeo = geometry(new THREE.TubeGeometry(tailCurve, tailSegments, 0.12, radialSegments, false));
  const tailPosition = tailGeo.attributes.position;
  const skinIndices: number[] = [], skinWeights: number[] = [], colors: number[] = [];
  const tailColor = new THREE.Color(), baseTail = new THREE.Color('#e5a571'), stripeTail = new THREE.Color('#c68756'), tipTail = new THREE.Color('#fff0d6');
  for (let i = 0; i < tailPosition.count; i++) {
    const t = Math.floor(i / (radialSegments + 1)) / tailSegments;
    const center = tailCurve.getPointAt(t);
    const taper = mix(1.28, 0.52, Math.pow(t, 1.8));
    tailPosition.setXYZ(i, center.x + (tailPosition.getX(i) - center.x) * taper,
      center.y + (tailPosition.getY(i) - center.y) * taper, center.z + (tailPosition.getZ(i) - center.z) * taper);
    const boneFloat = t * (boneCount - 1), boneIndex = Math.min(Math.floor(boneFloat), boneCount - 2), blend = boneFloat - boneIndex;
    skinIndices.push(boneIndex, boneIndex + 1, 0, 0);
    skinWeights.push(1 - blend, blend, 0, 0);
    tailColor.copy(baseTail).lerp(stripeTail, smooth(0.35, 0.85, Math.sin(t * Math.PI * 11)) * 0.65).lerp(tipTail, smooth(0.86, 0.98, t));
    colors.push(tailColor.r, tailColor.g, tailColor.b);
  }
  tailGeo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  tailGeo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  tailGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  tailGeo.computeVertexNormals();
  const tailMesh = new THREE.SkinnedMesh(tailGeo, standard('#ffffff', { vertexColors: true }));
  const bones: THREE.Bone[] = [];
  for (let i = 0; i < boneCount; i++) {
    const bone = new THREE.Bone();
    const current = tailCurve.getPointAt(i / (boneCount - 1));
    bone.position.copy(i ? current.sub(tailCurve.getPointAt((i - 1) / (boneCount - 1))) : current);
    if (i) bones[i - 1].add(bone);
    bones.push(bone);
  }
  tailMesh.add(bones[0]);
  const skeleton = new THREE.Skeleton(bones);
  skeletons.add(skeleton);
  tailMesh.bind(skeleton);
  tailMesh.castShadow = true;
  tailMesh.receiveShadow = true;
  tailMesh.frustumCulled = false;
  tail.add(tailMesh);
  const tailTip = oval(bones[boneCount - 1], cream, [0, 0, 0], [0.063, 0.063, 0.063]);
  tailTip.castShadow = true;

  const weights: Record<CatAction, number> = { idle: 1, walk: 0, pet: 0, eat: 0, sleep: 0, jump: 0 };
  const footCenter = new THREE.Vector3(), footUp = new THREE.Vector3();
  const footOrientation = new THREE.Quaternion();
  let lastTime: number | null = null, previousAction: CatAction = 'idle', actionStart = 0;
  let gazeX = 0, gazeY = 0, walkClock = 0;

  function update(tSeconds: number, state: CatState) {
    if (disposed) return;
    const t = Number.isFinite(tSeconds) ? tSeconds : 0;
    const dt = lastTime === null ? 1 / 60 : clamp(t - lastTime, 0, 0.1);
    lastTime = t;
    const action = state.action in weights ? state.action : 'idle';
    if (action !== previousAction) { actionStart = t; previousAction = action; }
    const blend = 1 - Math.exp(-dt * 8);
    for (const key of Object.keys(weights) as CatAction[]) weights[key] = mix(weights[key], key === action ? 1 : 0, blend);
    const { walk, pet, eat, sleep, jump } = weights;
    const ambientMotion = state.reducedMotion ? 0 : 1;
    const interactionMotion = state.reducedMotion ? 0.25 : 1;
    const lookBlend = 1 - Math.exp(-dt * 6);
    gazeX = mix(gazeX, clamp(Number.isFinite(state.lookX) ? state.lookX : 0, -1, 1), lookBlend);
    gazeY = mix(gazeY, clamp(Number.isFinite(state.lookY) ? state.lookY : 0, -1, 1), lookBlend);
    const speed = clamp(Number.isFinite(state.speed) ? state.speed : 1, 0, 2.5);
    walkClock += dt * (3.5 + speed * 3.4);
    const breath = Math.sin(t * (sleep > 0.5 ? 1.65 : 2.1)) * ambientMotion;
    const step = Math.sin(walkClock);
    const jumpPhase = ((t - actionStart) % 1.35) / 1.35;
    const flight = clamp((jumpPhase - 0.15) / 0.64, 0, 1);
    const airborne = Math.pow(Math.max(0, Math.sin(flight * Math.PI)), 1.25);
    const crouch = jumpPhase < 0.15 ? Math.sin(jumpPhase / 0.15 * Math.PI) : jumpPhase > 0.79 ? Math.sin((jumpPhase - 0.79) / 0.21 * Math.PI) * 0.55 : 0;
    rig.position.y = (airborne * 0.54 * jump + Math.abs(step) * 0.009 * walk) * interactionMotion;
    rig.rotation.z = Math.sin(walkClock) * 0.009 * walk * interactionMotion;

    body.position.y = 0.7 + walk * 0.12 - sleep * 0.135 - eat * 0.04 - crouch * jump * 0.07 + breath * 0.006;
    body.scale.set(1 + sleep * 0.115 + crouch * jump * 0.075, 1 + walk * 0.28 - sleep * 0.23 + breath * 0.012 - crouch * jump * 0.095 + airborne * jump * 0.07, 1 + sleep * 0.12 - walk * 0.12);
    // Unfold the seated pear-shaped torso along the spine when walking.
    body.rotation.x = walk * 1.3;
    head.position.set(sleep * 0.13, 1.55 + breath * 0.012 - sleep * 0.72 - eat * 0.69 - walk * 0.22 - crouch * jump * 0.08,
      0.19 + sleep * 0.19 + eat * 0.26 + walk * 0.45);
    head.rotation.set(eat * (0.68 + Math.sin(t * 8.5) * 0.022) + sleep * 0.13 + walk * 0.035 - pet * 0.045 - gazeY * 0.105 * (1 - sleep),
      gazeX * 0.19 * (1 - sleep) + pet * Math.sin(t * 1.5) * 0.045,
      pet * Math.sin(t * 1.8) * 0.075 * interactionMotion + sleep * 0.15 + Math.sin(t * 0.83) * 0.012 * (1 - sleep) * ambientMotion);
    head.scale.set(1 + crouch * jump * 0.015, 1 - crouch * jump * 0.026, 1);

    const blinkClock = t % 5.1;
    const blink = ambientMotion * (Math.exp(-Math.pow((blinkClock - 4.6) / 0.075, 2)) * 0.995
      + Math.exp(-Math.pow((blinkClock - 4.88) / 0.065, 2)) * 0.68);
    const eyeClosure = clamp(Math.max(blink, sleep, pet * (0.91 + Math.sin(t * 1.7) * 0.07)), 0, 1);
    for (const eye of eyes) {
      eye.open.scale.y = Math.max(0.012, 1 - eyeClosure);
      eye.open.visible = eyeClosure < 0.992;
      eye.gaze.position.set(gazeX * 0.028 * (1 - sleep), gazeY * 0.026 * (1 - sleep), 0);
      eye.map.offset.set(-gazeX * 0.032 * (1 - sleep), -gazeY * 0.032 * (1 - sleep));
      eye.closedMaterial.opacity = smooth(0.62, 0.98, eyeClosure);
    }
    mouth.scale.y = 1 + Math.sin(t * 13) * eat * 0.055;
    eatingMouth.scale.y = 0.002 + eat * (0.009 + Math.sin(t * 13) * 0.007);
    for (const ear of ears) {
      const twitch = Math.pow(Math.max(0, Math.sin(t * 0.91 + ear.side * 1.7)), 18);
      ear.pivot.rotation.z = ear.side * (-0.3 - pet * 0.025 + sleep * 0.045 + twitch * 0.04 * (1 - sleep) * ambientMotion);
      ear.pivot.rotation.x = sleep * 0.1 + Math.sin(t * 1.13 + ear.side) * 0.015 * ambientMotion;
    }
    for (const whisker of whiskers) whisker.pivot.rotation.z = whisker.side * (Math.sin(t * 2.2) * 0.018 * ambientMotion + pet * 0.025 - eat * 0.014);

    for (const leg of legs) {
      const phase = (walkClock / (Math.PI * 2) + leg.phase) % 1;
      const stance = 0.64;
      const swingProgress = clamp((phase - stance) / (1 - stance), 0, 1);
      const stride = (0.15 + speed * 0.035) * interactionMotion;
      const travel = phase < stance ? 0.5 - phase / stance : smooth(0, 1, swingProgress) - 0.5;
      const lift = Math.sin(swingProgress * Math.PI) * 0.055 * interactionMotion;
      const walkX = leg.side * 0.29;
      const walkY = leg.front ? 0.65 : 0.625;
      const walkZ = leg.front ? 0.46 : -0.48;
      const upper = leg.front ? 0.36 : 0.385;
      const lowerY = leg.front ? 0.2 : 0.145;
      const lowerZ = leg.front ? 0.095 : 0.08;
      const lower = Math.hypot(lowerY, lowerZ);
      const soleHeight = leg.front ? 0.135 : 0.125;
      // Solve each planted paw at floor height, cancelling the subtle torso bob/roll.
      const footY = (soleHeight + lift - rig.position.y - walkX * Math.sin(rig.rotation.z)) / Math.cos(rig.rotation.z);
      const down = walkY - footY;
      const forward = lowerZ + travel * stride;
      const knee = (leg.front ? 1 : -1) * Math.acos(clamp((down * down + forward * forward - upper * upper - lower * lower) / (2 * upper * lower), -1, 1));
      const hip = -(Math.atan2(forward, down) - Math.atan2(lower * Math.sin(knee), upper + lower * Math.cos(knee)));
      const ankle = Math.atan2(lowerZ, lowerY) - knee;
      const restingHip = sleep * (leg.front ? -0.72 : 0.48) + airborne * jump * (leg.front ? -0.22 : 0.27);
      leg.pivot.rotation.x = hip * walk + restingHip;
      leg.pivot.rotation.z = leg.side * sleep * (leg.front ? 0.22 : -0.12);
      leg.pivot.position.set(mix(leg.side * (leg.front ? 0.305 : 0.395), walkX, walk),
        mix(leg.baseY, walkY, walk) + sleep * (leg.front ? -0.124 : -0.005), mix(leg.front ? 0.3 : -0.2, walkZ, walk));
      leg.ankle.position.y = mix(leg.front ? -0.36 : -0.235, -upper, walk);
      leg.ankle.rotation.x = ankle * walk + sleep * (leg.front ? 0.46 : -0.25);
      leg.paw.rotation.x = -(hip + ankle) * walk - restingHip * 0.27;
      leg.paw.rotation.z = -rig.rotation.z * walk;
      leg.paw.position.y = mix(leg.pawY, -lowerY, walk) + pet * (leg.front ? Math.max(0, Math.sin(t * 4.2 + leg.side)) * 0.017 : 0);
      if (walk > 0) {
        // Joint interpolation can lengthen the leg while rising from the sitting pose.
        // Keep its rounded sole above the floor throughout that transition as well.
        footCenter.copy(leg.paw.position).applyEuler(leg.ankle.rotation).add(leg.ankle.position)
          .applyEuler(leg.pivot.rotation).add(leg.pivot.position).applyEuler(rig.rotation).add(rig.position);
        footOrientation.copy(rig.quaternion).multiply(leg.pivot.quaternion).multiply(leg.ankle.quaternion).multiply(leg.paw.quaternion).invert();
        footUp.set(0, 1, 0).applyQuaternion(footOrientation);
        const soleRadius = Math.hypot(footUp.x * (leg.front ? 0.174 : 0.181), footUp.y * soleHeight, footUp.z * 0.231);
        leg.pivot.position.y += Math.max(0, soleRadius - footCenter.y) / Math.cos(rig.rotation.z);
      }
    }
    collar.position.set(0, 0.99 - walk * 0.01 - sleep * 0.24 - eat * 0.13 + breath * 0.006 - crouch * jump * 0.05, walk * 0.44);
    collar.rotation.x = walk * 0.9;
    collar.rotation.z = pet * Math.sin(t * 1.8) * 0.018;
    collar.scale.set(1 + sleep * 0.05, 1, 1);
    bell.rotation.x = Math.sin(t * 3.8) * 0.04 * ambientMotion + (step * walk * 0.19 + jump * Math.sin(t * 8) * 0.16) * interactionMotion;
    bell.rotation.z = Math.sin(t * 2.7) * pet * 0.09;
    tail.position.set(0.37 - walk * 0.14, 0.49 + walk * 0.39 - sleep * 0.15, -0.315 - walk * 0.335);
    tail.rotation.y = sleep * 0.6 + Math.sin(t * 0.73) * 0.085 * (1 - sleep) * ambientMotion;
    for (let i = 0; i < bones.length; i++) {
      const influence = i / (bones.length - 1);
      bones[i].rotation.z = -sleep * (i === 0 ? 0.45 : 0.085) + Math.sin(t * (1.25 + pet * 0.9) - i * 0.43) * (0.035 + influence * 0.028) * (1 - sleep * 0.88) * ambientMotion;
      bones[i].rotation.x = Math.sin(t * 1.05 - i * 0.4) * 0.027 * (1 - sleep) * ambientMotion + walk * step * 0.027 * interactionMotion;
      bones[i].rotation.y = sleep * influence * 0.055 + pet * Math.sin(t * 2.2 - i * 0.35) * 0.025 * interactionMotion;
    }
  }

  update(0, { action: 'idle', lookX: 0, lookY: 0, speed: 0 });
  group.updateMatrixWorld(true);

  return {
    group,
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const skeleton of skeletons) skeleton.dispose();
      for (const texture of textures) texture.dispose();
      for (const geo of geometries) geo.dispose();
      for (const mat of materials) mat.dispose();
      group.clear();
    },
  };
}
