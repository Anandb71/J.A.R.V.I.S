import * as THREE from '../../../node_modules/three/build/three.module.js';

const TIER_CONFIG = {
  high: { orb: 5000, ambient: 3000, bloom: true, bloomStrength: 0.6, rings: 3, minFps: 50 },
  medium: { orb: 3000, ambient: 1800, bloom: true, bloomStrength: 0.4, rings: 3, minFps: 35 },
  low: { orb: 1500, ambient: 800, bloom: false, bloomStrength: 0, rings: 2, minFps: 24 },
};

const SUIT_BASE_X = 2.9;
const SUIT_BASE_Y = -1.04;
const SUIT_BASE_Z = -0.24;
const SUIT_BASE_ROT_Y = -0.28;
const SUIT_BASE_SCALE = 1.2;
const HELMET_ASSET_URL = new URL('../../assets/iron-mask.svg', import.meta.url).href;

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
let suitMaskPlane;
let suitMaskMaterial;
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

function createFallbackHelmetTexture() {
  const canvas = new OffscreenCanvas(512, 512);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const tiny = new OffscreenCanvas(2, 2);
    return new THREE.CanvasTexture(tiny);
  }
  ctx.clearRect(0, 0, 512, 512);
  ctx.strokeStyle = '#c8f1ff';
  ctx.lineWidth = 12;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(126, 96);
  ctx.lineTo(186, 52);
  ctx.lineTo(326, 52);
  ctx.lineTo(386, 96);
  ctx.lineTo(368, 284);
  ctx.lineTo(304, 382);
  ctx.lineTo(208, 382);
  ctx.lineTo(144, 284);
  ctx.closePath();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(176, 220);
  ctx.lineTo(232, 210);
  ctx.moveTo(336, 220);
  ctx.lineTo(280, 210);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(184, 336);
  ctx.lineTo(228, 304);
  ctx.lineTo(284, 304);
  ctx.lineTo(328, 336);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function loadHelmetTexture(url) {
  return new Promise((resolve, reject) => {
    const loader = new THREE.ImageBitmapLoader();
    loader.load(
      url,
      (imageBitmap) => {
        const texture = new THREE.Texture(imageBitmap);
        texture.needsUpdate = true;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = false;
        resolve(texture);
      },
      undefined,
      reject,
    );
  });
}

function buildSuitAvatar() {
  suitGroup = new THREE.Group();
  suitGroup.position.set(SUIT_BASE_X, SUIT_BASE_Y, SUIT_BASE_Z);
  suitGroup.rotation.y = SUIT_BASE_ROT_Y;
  suitGroup.scale.setScalar(SUIT_BASE_SCALE);

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(1.75, 2.2),
    new THREE.MeshBasicMaterial({
      color: 0x08192a,
      transparent: true,
      opacity: 0.52,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  plate.position.set(0, 0.42, -0.02);
  suitGroup.add(plate);

  suitMaskMaterial = new THREE.MeshBasicMaterial({
    map: createFallbackHelmetTexture(),
    color: 0xff3a5c,
    transparent: true,
    opacity: 0.88,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  suitMaskPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.48, 1.48), suitMaskMaterial);
  suitMaskPlane.position.set(0, 0.63, 0.04);
  suitGroup.add(suitMaskPlane);

  suitCore = new THREE.Mesh(
    new THREE.RingGeometry(0.09, 0.135, 24),
    new THREE.MeshStandardMaterial({
      color: 0x67d3ff,
      emissive: 0x24b6ff,
      emissiveIntensity: 1.8,
      metalness: 0.25,
      roughness: 0.15,
    }),
  );
  suitCore.position.set(0, -0.12, 0.03);
  suitGroup.add(suitCore);

  suitVisor = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.05),
    new THREE.MeshStandardMaterial({
      color: 0xbceeff,
      emissive: 0x89e7ff,
      emissiveIntensity: 1.45,
      metalness: 0.2,
      roughness: 0.08,
    }),
  );
  suitVisor.position.set(0, 0.8, 0.055);
  suitGroup.add(suitVisor);

  const edgeGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.75, 2.2));
  suitOutline = new THREE.LineSegments(
    edgeGeo,
    new THREE.LineBasicMaterial({ color: 0x3bbaff, transparent: true, opacity: 0.24 }),
  );
  suitOutline.position.set(0, 0.42, 0.06);
  suitGroup.add(suitOutline);
  scene.add(suitGroup);

  loadHelmetTexture(HELMET_ASSET_URL)
    .then((tex) => {
      if (!suitMaskMaterial) return;
      if (suitMaskMaterial.map) suitMaskMaterial.map.dispose();
      suitMaskMaterial.map = tex;
      suitMaskMaterial.needsUpdate = true;
    })
    .catch(() => {
      // Fallback texture is already applied.
    });
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
    suitGroup.scale.setScalar(SUIT_BASE_SCALE * stressPulse * breathing);
    suitGroup.rotation.y = SUIT_BASE_ROT_Y + Math.sin(time * 0.48) * 0.045;

    if (state === 'thinking') {
      suitGroup.rotation.z = Math.sin(time * 1.2) * 0.015;
    } else if (state === 'speaking') {
      suitGroup.position.y = SUIT_BASE_Y + Math.sin(time * 2.2) * 0.035;
    } else {
      suitGroup.position.y += (SUIT_BASE_Y - suitGroup.position.y) * 0.12;
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

    if (suitMaskMaterial) {
      const maskColor = new THREE.Color('#ff3a5c').lerp(new THREE.Color('#ffd266'), Math.min(1, stressLevel * 0.55));
      suitMaskMaterial.color.copy(maskColor);
      suitMaskMaterial.opacity = 0.72 + audioLevel * 0.22 + stressLevel * 0.14;
    }

    if (suitMaskPlane) {
      suitMaskPlane.rotation.z = Math.sin(time * 0.9) * 0.04;
      suitMaskPlane.scale.setScalar(1 + audioLevel * 0.05 + stressLevel * 0.04);
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
