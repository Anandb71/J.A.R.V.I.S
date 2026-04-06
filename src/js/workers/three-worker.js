import * as THREE from '../../../node_modules/three/build/three.module.js';

const TIER_CONFIG = {
  high: { orb: 5000, ambient: 3000, bloom: true, bloomStrength: 0.6, rings: 3, minFps: 50 },
  medium: { orb: 3000, ambient: 1800, bloom: true, bloomStrength: 0.4, rings: 3, minFps: 35 },
  low: { orb: 1500, ambient: 800, bloom: false, bloomStrength: 0, rings: 2, minFps: 24 },
};

let renderer;
let scene;
let camera;
let orb;
let halo;
let rings = [];
let ambient;
let sceneAmbientLight;
let sceneKeyLight;
let suitGroup;
let suitCore;
let suitVisor;
let suitOutline;
let suitArmorMaterials = [];
function makeArmorMaterial(colorHex = 0x9b1e2e) {
let frameHandle = null;
let lastFrameTimes = [];
    metalness: 0.86,
    roughness: 0.29,
    emissive: 0x12050a,
    emissiveIntensity: 0.22,
let currentScale = 1;
let targetSpread = 1;
let currentSpread = 1;
let time = 0;

self.onmessage = async (event) => {

  const orbMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uScale: { value: 1 },
      uSpread: { value: 1 },
      uAudioLevel: { value: 0 },
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.35, 0.52), makeArmorMaterial(0xaa1f2c));
    },
    vertexShader: orbVertex,
    fragmentShader: orbFragment,
  const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.92, 0.12), makeArmorMaterial(0xc59b2e));
    depthWrite: false,
    blending: THREE.AdditiveBlending,

  const chestFrame = new THREE.Mesh(new THREE.BoxGeometry(0.93, 1.02, 0.07), makeArmorMaterial(0x8d1622));
  chestFrame.position.set(0, 0.46, 0.25);
  frame.add(chestFrame);
  });

    new THREE.CylinderGeometry(0.125, 0.125, 0.1, 28),
  orb.layers.enable(1);
  scene.add(orb);

      emissiveIntensity: 2.0,
    const haloGeometry = new THREE.SphereGeometry(2.45, 32, 32);
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: 0x00b4ff,
      transparent: true,
      opacity: config.bloomStrength * 0.35,
  suitCore.position.set(0, 0.46, 0.4);
      depthWrite: false,
    });
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.42, 0.44), makeArmorMaterial(0xa51d2b));
  helmet.position.set(0, 1.34, 0.03);
  frame.add(helmet);

  const faceplate = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.31, 0.09), makeArmorMaterial(0xd3ab3b));
  faceplate.position.set(0, 1.33, 0.25);
  frame.add(faceplate);

  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.06, 0.08), makeArmorMaterial(0x8d1622));
  brow.position.set(0, 1.46, 0.21);
  frame.add(brow);

  const jawL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.07), makeArmorMaterial(0xa51d2b));
  jawL.position.set(-0.16, 1.21, 0.22);
  frame.add(jawL);

  const jawR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.07), makeArmorMaterial(0xa51d2b));
  jawR.position.set(0.16, 1.21, 0.22);
  frame.add(jawR);

  suitVisor = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.04, 0.06),
    new THREE.MeshStandardMaterial({
      color: 0xb8edff,
      emissive: 0x8ce6ff,
      emissiveIntensity: 1.45,
      metalness: 0.12,
      roughness: 0.06,
    }),
  );
  suitVisor.position.set(0, 1.37, 0.29);
  frame.add(suitVisor);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.14, 14), makeArmorMaterial(0x6f121d));
  neck.position.set(0, 1.08, 0.02);
  frame.add(neck);

  const shoulderL = new THREE.Mesh(new THREE.SphereGeometry(0.23, 18, 16), makeArmorMaterial(0xaa1f2c));
  shoulderL.position.set(-0.57, 0.98, 0.03);
  frame.add(shoulderL);

  const shoulderR = new THREE.Mesh(new THREE.SphereGeometry(0.23, 18, 16), makeArmorMaterial(0xaa1f2c));
  shoulderR.position.set(0.57, 0.98, 0.03);
  frame.add(shoulderR);

  const shoulderCapL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.2), makeArmorMaterial(0xd3ab3b));
  shoulderCapL.position.set(-0.57, 1.02, 0.16);
  frame.add(shoulderCapL);

  const shoulderCapR = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.2), makeArmorMaterial(0xd3ab3b));
  shoulderCapR.position.set(0.57, 1.02, 0.16);
  frame.add(shoulderCapR);

  const upperArmGeo = new THREE.CapsuleGeometry(0.12, 0.45, 6, 12);
  const lowerArmGeo = new THREE.CapsuleGeometry(0.1, 0.42, 6, 12);

  const upperArmL = new THREE.Mesh(upperArmGeo, makeArmorMaterial(0xa51d2b));
  upperArmL.position.set(-0.71, 0.64, 0.03);
  upperArmL.rotation.z = 0.2;
  frame.add(upperArmL);

  const upperArmR = new THREE.Mesh(upperArmGeo, makeArmorMaterial(0xa51d2b));
  upperArmR.position.set(0.71, 0.64, 0.03);
  upperArmR.rotation.z = -0.2;
  frame.add(upperArmR);

  const lowerArmL = new THREE.Mesh(lowerArmGeo, makeArmorMaterial(0xd3ab3b));
  lowerArmL.position.set(-0.78, 0.23, 0.06);
  lowerArmL.rotation.z = 0.13;
  frame.add(lowerArmL);

  const lowerArmR = new THREE.Mesh(lowerArmGeo, makeArmorMaterial(0xd3ab3b));
  lowerArmR.position.set(0.78, 0.23, 0.06);
  lowerArmR.rotation.z = -0.13;
  frame.add(lowerArmR);

  const repulsorL = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.04, 14),
    new THREE.MeshStandardMaterial({ color: 0x83dcff, emissive: 0x4bcaff, emissiveIntensity: 1.1 }),
  );
  repulsorL.position.set(-0.84, 0.04, 0.14);
  repulsorL.rotation.z = Math.PI / 2;
  frame.add(repulsorL);

  const repulsorR = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.04, 14),
    new THREE.MeshStandardMaterial({ color: 0x83dcff, emissive: 0x4bcaff, emissiveIntensity: 1.1 }),
  );
  repulsorR.position.set(0.84, 0.04, 0.14);
  repulsorR.rotation.z = Math.PI / 2;
  frame.add(repulsorR);

  const hip = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.38, 0.42), makeArmorMaterial(0x8d1622));
  hip.position.set(0, -0.46, 0.0);
  frame.add(hip);

  const hipPlate = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.12, 0.1), makeArmorMaterial(0xd3ab3b));
  hipPlate.position.set(0, -0.31, 0.24);
  frame.add(hipPlate);

  const thighGeo = new THREE.CapsuleGeometry(0.15, 0.58, 6, 12);
  const shinGeo = new THREE.CapsuleGeometry(0.12, 0.52, 6, 12);

  const thighL = new THREE.Mesh(thighGeo, makeArmorMaterial(0xaa1f2c));
  thighL.position.set(-0.24, -0.95, 0.02);
  frame.add(thighL);

  const thighR = new THREE.Mesh(thighGeo, makeArmorMaterial(0xaa1f2c));
  thighR.position.set(0.24, -0.95, 0.02);
  frame.add(thighR);

  const shinL = new THREE.Mesh(shinGeo, makeArmorMaterial(0xd3ab3b));
  shinL.position.set(-0.24, -1.58, 0.07);
  frame.add(shinL);

  const shinR = new THREE.Mesh(shinGeo, makeArmorMaterial(0xd3ab3b));
  shinR.position.set(0.24, -1.58, 0.07);
  frame.add(shinR);

  const bootL = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.44), makeArmorMaterial(0x8d1622));
  bootL.position.set(-0.24, -1.98, 0.11);
  frame.add(bootL);

  const bootR = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.44), makeArmorMaterial(0x8d1622));
  bootR.position.set(0.24, -1.98, 0.11);
  frame.add(bootR);
    const mats = Array.isArray(srcMat) ? srcMat : [srcMat];
    const nextMats = mats.map((m) => {
      const next = m?.clone?.() || new THREE.MeshStandardMaterial();
      next.metalness = 0.78;
      next.roughness = 0.35;
      const base = meshCount % 3 === 0 ? tintB : tintA;
      if (next.color) next.color.lerp(base, 0.82);
      next.emissive = new THREE.Color('#1e0b12');
      next.emissiveIntensity = 0.24;
      suitArmorMaterials.push(next);
      meshCount += 1;
      return next;
    });
    node.material = Array.isArray(srcMat) ? nextMats : nextMats[0];
  });

  const bounds = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bounds.getSize(size);
  bounds.getCenter(center);

  const targetHeight = 3.7;
  const scale = size.y > 0 ? targetHeight / size.y : 1;
  model.scale.setScalar(scale);
  model.position.sub(center.multiplyScalar(scale));
  model.position.y = -0.2;
  model.position.z = 0.03;

  suitGroup = new THREE.Group();
  suitGroup.position.set(3.35, -1.2, -0.35);
  suitGroup.rotation.y = -0.4;
  suitGroup.scale.setScalar(1.08);
  suitGroup.add(model);

  suitCore = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 0.08, 24),
    new THREE.MeshStandardMaterial({
      color: 0x73d7ff,
      emissive: 0x2dbdff,
      emissiveIntensity: 1.3,
      metalness: 0.2,
      roughness: 0.12,
    }),
  );
  suitCore.rotation.x = Math.PI / 2;
  suitCore.position.set(0.02, 0.68, 0.38);
  suitGroup.add(suitCore);

  suitVisor = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.06, 0.07),
    new THREE.MeshStandardMaterial({
      color: 0x8ce1ff,
      emissive: 0x5dd3ff,
      emissiveIntensity: 1.05,
      metalness: 0.15,
      roughness: 0.08,
    }),
  );
  suitVisor.position.set(0.02, 1.82, 0.25);
  suitGroup.add(suitVisor);

  const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.45, 4.25, 1.1));
  suitOutline = new THREE.LineSegments(
    edgeGeo,
    new THREE.LineBasicMaterial({ color: 0x3bbaff, transparent: true, opacity: 0.24 }),
  );
  suitOutline.position.y = -0.2;
  suitGroup.add(suitOutline);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.98, 1.08, 0.1, 34),
    new THREE.MeshBasicMaterial({ color: 0x1b3852, transparent: true, opacity: 0.4 }),
  );
  base.position.set(0, -2.02, -0.08);
  suitGroup.add(base);

  scene.add(suitGroup);
}

function buildFallbackSuitAvatar() {
  suitGroup = new THREE.Group();
  suitGroup.position.set(3.45, -1.15, -0.35);
  suitGroup.rotation.y = -0.38;
  suitGroup.scale.setScalar(1.12);

  const frame = new THREE.Group();

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.35, 0.52), makeArmorMaterial(0x7a1f34));
  torso.position.y = 0.45;
  frame.add(torso);

  const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.88, 0.12), makeArmorMaterial(0x8f253f));
  chestPlate.position.set(0, 0.46, 0.31);
  frame.add(chestPlate);

  suitCore = new THREE.Mesh(
    new THREE.CylinderGeometry(0.135, 0.135, 0.09, 24),
    new THREE.MeshStandardMaterial({
      color: 0x67d3ff,
      emissive: 0x24b6ff,
      emissiveIntensity: 1.8,
      metalness: 0.25,
      roughness: 0.15,
    }),
  );
  suitCore.rotation.x = Math.PI / 2;
  suitCore.position.set(0, 0.46, 0.39);
  frame.add(suitCore);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.265, 24, 20), makeArmorMaterial(0x8c243f));
  head.position.set(0, 1.37, 0.02);
  frame.add(head);

  suitVisor = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.07, 0.08),
    new THREE.MeshStandardMaterial({
      color: 0x92dcff,
      emissive: 0x6bd6ff,
      emissiveIntensity: 1.2,
      metalness: 0.2,
      roughness: 0.08,
    }),
  );
  suitVisor.position.set(0, 1.41, 0.23);
  frame.add(suitVisor);

  const shoulderL = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), makeArmorMaterial(0x7b1f35));
  shoulderL.position.set(-0.57, 0.98, 0.03);
  frame.add(shoulderL);

  const shoulderR = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), makeArmorMaterial(0x7b1f35));
  shoulderR.position.set(0.57, 0.98, 0.03);
  frame.add(shoulderR);

  const upperArmGeo = new THREE.CapsuleGeometry(0.105, 0.45, 6, 12);
  const lowerArmGeo = new THREE.CapsuleGeometry(0.09, 0.4, 6, 12);

  const upperArmL = new THREE.Mesh(upperArmGeo, makeArmorMaterial(0x7b1f35));
  upperArmL.position.set(-0.69, 0.66, 0.03);
  upperArmL.rotation.z = 0.22;
  frame.add(upperArmL);

  const upperArmR = new THREE.Mesh(upperArmGeo, makeArmorMaterial(0x7b1f35));
  upperArmR.position.set(0.69, 0.66, 0.03);
  upperArmR.rotation.z = -0.22;
  frame.add(upperArmR);

  const lowerArmL = new THREE.Mesh(lowerArmGeo, makeArmorMaterial(0x8f253f));
  lowerArmL.position.set(-0.77, 0.24, 0.06);
  lowerArmL.rotation.z = 0.14;
  frame.add(lowerArmL);

  const lowerArmR = new THREE.Mesh(lowerArmGeo, makeArmorMaterial(0x8f253f));
  lowerArmR.position.set(0.77, 0.24, 0.06);
  lowerArmR.rotation.z = -0.14;
  frame.add(lowerArmR);

  const hip = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.38, 0.42), makeArmorMaterial(0x6e1a30));
  hip.position.set(0, -0.46, 0.0);
  frame.add(hip);

  const thighGeo = new THREE.CapsuleGeometry(0.145, 0.58, 6, 12);
  const shinGeo = new THREE.CapsuleGeometry(0.11, 0.52, 6, 12);

  const thighL = new THREE.Mesh(thighGeo, makeArmorMaterial(0x87213a));
  thighL.position.set(-0.24, -0.95, 0.02);
  frame.add(thighL);

  const thighR = new THREE.Mesh(thighGeo, makeArmorMaterial(0x87213a));
  thighR.position.set(0.24, -0.95, 0.02);
  frame.add(thighR);

  const shinL = new THREE.Mesh(shinGeo, makeArmorMaterial(0x9a2a46));
  shinL.position.set(-0.24, -1.58, 0.07);
  frame.add(shinL);

  const shinR = new THREE.Mesh(shinGeo, makeArmorMaterial(0x9a2a46));
  shinR.position.set(0.24, -1.58, 0.07);
  frame.add(shinR);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.98, 1.08, 0.1, 34),
    new THREE.MeshBasicMaterial({ color: 0x1b3852, transparent: true, opacity: 0.4 }),
  );
  base.position.set(0, -2.0, -0.08);
  frame.add(base);

  const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.35, 4.05, 0.9));
  suitOutline = new THREE.LineSegments(
    edgeGeo,
    new THREE.LineBasicMaterial({ color: 0x3bbaff, transparent: true, opacity: 0.24 }),
  );
  suitOutline.position.y = -0.2;

  suitGroup.add(frame);
  suitGroup.add(suitOutline);
  scene.add(suitGroup);
}

function rebuild(nextTier) {
  config = TIER_CONFIG[nextTier];
  if (!renderer) return;
  buildScene();
  if (halo) {
    halo.material.opacity = config.bloom ? config.bloomStrength * 0.35 : 0;
  }
  ensureRunning();
}

function resize(nextWidth, nextHeight) {
  width = Math.max(1, nextWidth);
  height = Math.max(1, nextHeight);
  if (!renderer) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function syncState() {
  switch (state) {
    case 'listening':
      targetColor.set('#00b4ff');
      targetScale = 1.05;
      targetSpread = 1.05;
      break;
    case 'thinking':
      targetColor.set('#b44dff');
      targetScale = 1.1;
      targetSpread = 1.12;
      break;
    case 'speaking':
      targetColor.set('#00ff88');
      targetScale = 1.15;
      targetSpread = 1.08;
      break;
    case 'error':
      targetColor.set('#ff3366');
      targetScale = 0.95;
      targetSpread = 0.92;
      break;
    default:
      targetColor.set('#00b4ff');
      targetScale = 1.0;
      targetSpread = 1.0;
      break;
  }

  if (stressLevel >= 0.9) {
    targetColor.set('#ff3366');
  } else if (stressLevel >= 0.8) {
    targetColor.lerp(new THREE.Color('#35d6ff'), 0.55);
  }
  ensureRunning();
}

function ensureRunning() {
  if (running) return;
  running = true;
  lastFrameTimes = [];
  frameHandle = requestAnimationFrame(render);
}

function maybeStop() {
  // Keep the scene subtly animated at all times so the core never looks frozen.
}

function render(now) {
  if (!renderer) return;
  frameHandle = requestAnimationFrame(render);
  time = now / 1000;
  currentColor.lerp(targetColor, 0.06);
  currentScale += (targetScale - currentScale) * 0.08;
  currentSpread += (targetSpread - currentSpread) * 0.06;

  if (orb?.material?.uniforms) {
    orb.material.uniforms.uTime.value = time;
    orb.material.uniforms.uScale.value = currentScale;
    orb.material.uniforms.uSpread.value = currentSpread + audioLevel * 0.22;
    orb.material.uniforms.uAudioLevel.value = audioLevel;
    orb.material.uniforms.uColor.value.copy(currentColor);
  }

  rings.forEach((ring, index) => {
    ring.rotation.x += 0.003 + index * 0.0007;
    ring.rotation.y += 0.004 + index * 0.0005;
    ring.material.opacity = 0.35 + audioLevel * 0.35;
    if (stressLevel >= 0.92) {
      ring.material.color.set('#ff3366');
    } else if (stressLevel >= 0.8) {
      ring.material.color.set('#35d6ff');
    } else {
      ring.material.color.set('#00b4ff');
    }
  });

  if (ambient) {
    ambient.rotation.y += 0.0007;
  }
  if (halo) {
    halo.rotation.y += 0.0012;
    halo.scale.setScalar(1.0 + audioLevel * 0.06);
  }

  if (suitGroup) {
    const stressPulse = 1 + Math.sin(time * (1.6 + stressLevel * 3.2)) * 0.018;
    const breathing = 1 + Math.sin(time * 1.45) * 0.012;
    suitGroup.scale.setScalar(1.12 * stressPulse * breathing);
    suitGroup.rotation.y = -0.38 + Math.sin(time * 0.48) * 0.045;

    if (state === 'thinking') {
      suitGroup.rotation.z = Math.sin(time * 1.2) * 0.015;
    } else if (state === 'speaking') {
      suitGroup.position.y = -1.15 + Math.sin(time * 2.2) * 0.035;
    } else {
      suitGroup.position.y += (-1.15 - suitGroup.position.y) * 0.12;
      suitGroup.rotation.z *= 0.9;
    }

    const alertColor = new THREE.Color('#ff335c');
    const calmColor = new THREE.Color('#3bbaff');
    const blended = calmColor.clone().lerp(alertColor, Math.min(1, stressLevel * 1.25));

    if (suitCore?.material) {
      suitCore.material.color.copy(blended);
      suitCore.material.emissive.copy(blended);
      suitCore.material.emissiveIntensity = 1.25 + stressLevel * 1.8 + audioLevel * 0.4;
      suitCore.scale.setScalar(1 + audioLevel * 0.11 + stressLevel * 0.08);
      suitCore.rotation.z += 0.02 + stressLevel * 0.05;
    }

    if (suitVisor?.material) {
      suitVisor.material.color.copy(blended.clone().lerp(new THREE.Color('#ffffff'), 0.18));
      suitVisor.material.emissive.copy(blended);
      suitVisor.material.emissiveIntensity = 0.9 + stressLevel * 0.9;
    }

    suitArmorMaterials.forEach((material, idx) => {
      material.emissive.copy(blended.clone().multiplyScalar(0.18 + idx * 0.002));
      material.emissiveIntensity = 0.16 + stressLevel * 0.5;
      material.roughness = 0.36 + stressLevel * 0.16;
    });

    if (suitOutline?.material) {
      suitOutline.material.color.copy(blended);
      suitOutline.material.opacity = 0.16 + stressLevel * 0.3;
    }
  }

  renderer.render(scene, camera);

  trackFps(now);
  maybeStop();
}

function trackFps(now) {
  lastFrameTimes.push(now);
  while (lastFrameTimes.length > 60) lastFrameTimes.shift();
  if (lastFrameTimes.length < 10) return;
  const elapsed = lastFrameTimes[lastFrameTimes.length - 1] - lastFrameTimes[0];
  const fps = elapsed > 0 ? ((lastFrameTimes.length - 1) * 1000) / elapsed : 0;
  if (fps < config.minFps) {
    fpsWarningCountdown += 1;
    if (fpsWarningCountdown >= 180) {
      postMessage({ type: 'fps_warning', fps: Math.round(fps), tier });
      fpsWarningCountdown = 0;
    }
  } else {
    fpsWarningCountdown = 0;
  }
}
