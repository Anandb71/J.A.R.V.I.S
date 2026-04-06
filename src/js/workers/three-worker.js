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
let state = 'idle';
let audioLevel = 0;
let stressLevel = 0;
let tier = 'medium';
let config = TIER_CONFIG.medium;
let width = 1;
let height = 1;
let running = false;
let frameHandle = null;
let lastFrameTimes = [];
let fpsWarningCountdown = 0;
let targetColor = new THREE.Color('#00b4ff');
let currentColor = new THREE.Color('#00b4ff');
let targetScale = 1;
let currentScale = 1;
let targetSpread = 1;
let currentSpread = 1;
let time = 0;

self.onmessage = async (event) => {
  const message = event.data || {};
  if (message.type === 'init') {
    await init(message);
  } else if (message.type === 'set_state') {
    state = message.state || 'idle';
    syncState();
  } else if (message.type === 'set_audio_level') {
    audioLevel = Math.max(0, Math.min(1, Number(message.level) || 0));
    ensureRunning();
  } else if (message.type === 'set_stress_level') {
    stressLevel = Math.max(0, Math.min(1, Number(message.level) || 0));
    ensureRunning();
  } else if (message.type === 'resize') {
    resize(message.width, message.height);
  } else if (message.type === 'set_tier') {
    tier = message.tier in TIER_CONFIG ? message.tier : 'medium';
    rebuild(tier);
  }
};

async function init(message) {
  width = message.width || 1;
  height = message.height || 1;
  tier = message.tier in TIER_CONFIG ? message.tier : 'medium';
  config = TIER_CONFIG[tier];

  renderer = new THREE.WebGLRenderer({ canvas: message.canvas, antialias: tier !== 'low', alpha: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x050814, 6, 28);

  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(0.35, 0.1, 9.3);

  buildScene();
  postMessage({ type: 'ready' });
  ensureRunning();
}

function buildScene() {
  scene.clear();
  rings.forEach((ring) => scene.remove(ring));
  rings = [];
  suitArmorMaterials = [];

  sceneAmbientLight = new THREE.AmbientLight(0x86a8c9, 0.45);
  scene.add(sceneAmbientLight);

  sceneKeyLight = new THREE.DirectionalLight(0x8cc8ff, 0.9);
  sceneKeyLight.position.set(4.5, 6.5, 8.5);
  scene.add(sceneKeyLight);

  const orbGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array(config.orb * 3);
  const seeds = new Float32Array(config.orb);
  for (let i = 0; i < config.orb; i += 1) {
    const idx = i * 3;
    const u = Math.random() * Math.PI * 2;
    const v = Math.acos(2 * Math.random() - 1);
    const r = 2.1 + Math.random() * 0.35;
    positions[idx] = r * Math.sin(v) * Math.cos(u);
    positions[idx + 1] = r * Math.cos(v);
    positions[idx + 2] = r * Math.sin(v) * Math.sin(u);
    seeds[i] = Math.random();
  }
  orbGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  orbGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

  const orbVertex = `
    uniform float uTime;
    uniform float uScale;
    uniform float uSpread;
    uniform float uAudioLevel;
    attribute float aSeed;
    varying float vSeed;
    void main() {
      vSeed = aSeed;
      vec3 pos = position;
      float pulse = 1.0 + sin(uTime * 2.0 + aSeed * 6.2831) * 0.08;
      float audioPush = 1.0 + uAudioLevel * 0.28 * aSeed;
      pos *= uScale * uSpread * pulse * audioPush;
      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
      gl_PointSize = clamp(3.0 * (1.0 / -mvPosition.z) * 220.0, 1.5, 12.0);
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  const orbFragment = `
    uniform vec3 uColor;
    uniform float uTime;
    varying float vSeed;
    void main() {
      vec2 uv = gl_PointCoord - vec2(0.5);
      float dist = length(uv);
      if (dist > 0.5) discard;
      float fresnel = pow(1.0 - dist * 2.0, 2.5);
      float pulse = 0.9 + sin(uTime * 2.0 + vSeed * 12.0) * 0.1;
      float alpha = smoothstep(0.5, 0.08, dist) * fresnel * pulse;
      gl_FragColor = vec4(uColor * (0.65 + fresnel), alpha);
    }
  `;

  const orbMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uScale: { value: 1 },
      uSpread: { value: 1 },
      uAudioLevel: { value: 0 },
      uColor: { value: currentColor.clone() },
    },
    vertexShader: orbVertex,
    fragmentShader: orbFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  orb = new THREE.Points(orbGeometry, orbMaterial);
  orb.layers.enable(1);
  scene.add(orb);

  if (config.bloom) {
    const haloGeometry = new THREE.SphereGeometry(2.45, 32, 32);
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: 0x00b4ff,
      transparent: true,
      opacity: config.bloomStrength * 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    halo = new THREE.Mesh(haloGeometry, haloMaterial);
    halo.layers.enable(1);
    scene.add(halo);
  }

  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x00b4ff, transparent: true, opacity: 0.55, wireframe: true });
  for (let i = 0; i < config.rings; i += 1) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.5 + i * 0.28, 0.03, 10, 120), ringMaterial.clone());
    ring.rotation.x = i * 0.55;
    ring.rotation.y = i * 0.9;
    ring.layers.enable(1);
    rings.push(ring);
    scene.add(ring);
  }

  const ambGeometry = new THREE.BufferGeometry();
  const ambPositions = new Float32Array(config.ambient * 3);
  for (let i = 0; i < config.ambient; i += 1) {
    const idx = i * 3;
    ambPositions[idx] = (Math.random() - 0.5) * 16;
    ambPositions[idx + 1] = (Math.random() - 0.5) * 10;
    ambPositions[idx + 2] = (Math.random() - 0.5) * 16;
  }
  ambGeometry.setAttribute('position', new THREE.BufferAttribute(ambPositions, 3));
  ambient = new THREE.Points(ambGeometry, new THREE.PointsMaterial({ color: 0x7dcfff, size: 0.02, transparent: true, opacity: 0.6 }));
  scene.add(ambient);

  buildSuitAvatar();
}

function makeArmorMaterial(colorHex = 0x7b1f35) {
  const material = new THREE.MeshStandardMaterial({
    color: colorHex,
    metalness: 0.78,
    roughness: 0.36,
    emissive: 0x18070d,
    emissiveIntensity: 0.25,
  });
  suitArmorMaterials.push(material);
  return material;
}

function buildSuitAvatar() {
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
