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
let state = 'idle';
let audioLevel = 0;
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
  camera.position.set(0, 0, 9);

  buildScene();
  postMessage({ type: 'ready' });
  ensureRunning();
}

function buildScene() {
  scene.clear();
  rings.forEach((ring) => scene.remove(ring));
  rings = [];

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
  ensureRunning();
}

function ensureRunning() {
  if (running) return;
  running = true;
  lastFrameTimes = [];
  frameHandle = requestAnimationFrame(render);
}

function maybeStop() {
  if (state === 'idle' && audioLevel === 0 && Math.abs(currentScale - targetScale) < 0.01) {
    running = false;
    if (frameHandle) cancelAnimationFrame(frameHandle);
    frameHandle = null;
  }
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
  });

  if (ambient) {
    ambient.rotation.y += 0.0007;
  }
  if (halo) {
    halo.rotation.y += 0.0012;
    halo.scale.setScalar(1.0 + audioLevel * 0.06);
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
