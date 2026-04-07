import * as THREE from '../../../node_modules/three/build/three.module.js';
import { SVGLoader } from '../../../node_modules/three/examples/jsm/loaders/SVGLoader.js';

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
const MASK_SVG_URL = new URL('../../../superhero-mask-with-futuristic-design-for-coloring-and-crafting-projects-vector.svg', import.meta.url).href;

let renderer;
let scene;
let camera;
let orb;
let halo;
let rings = [];
let ambient;
let suitGroup;
let suitOutline;
let suitCore;
let suitVisor;
let suitMaterials = [];
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
  camera.position.set(0, 0, 9);

  buildScene();
  postMessage({ type: 'ready' });
  ensureRunning();
}

function buildScene() {
  scene.clear();
  rings.forEach((ring) => scene.remove(ring));
  rings = [];
  suitMaterials = [];

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

  buildSideMaskPanel();
}

function buildSideMaskPanel() {
  suitGroup = new THREE.Group();
  suitGroup.position.set(SUIT_BASE_X, SUIT_BASE_Y, SUIT_BASE_Z);
  suitGroup.rotation.y = SUIT_BASE_ROT_Y;
  suitGroup.scale.setScalar(SUIT_BASE_SCALE);

  const backplate = new THREE.Mesh(
    new THREE.PlaneGeometry(1.55, 2.25),
    new THREE.MeshBasicMaterial({
      color: 0x0b2034,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  backplate.position.set(0, 0.52, -0.02);
  suitGroup.add(backplate);

  suitCore = new THREE.Mesh(
    new THREE.RingGeometry(0.085, 0.13, 24),
    new THREE.MeshBasicMaterial({
      color: 0x7adfff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  suitCore.position.set(0, -0.12, 0.04);
  suitGroup.add(suitCore);

  suitVisor = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.05),
    new THREE.MeshBasicMaterial({
      color: 0xb9efff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  suitVisor.position.set(0, 0.82, 0.05);
  suitGroup.add(suitVisor);

  const edgeGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.55, 2.25));
  suitOutline = new THREE.LineSegments(
    edgeGeo,
    new THREE.LineBasicMaterial({ color: 0x3bbaff, transparent: true, opacity: 0.22 }),
  );
  suitOutline.position.set(0, 0.52, 0.06);
  suitGroup.add(suitOutline);

  scene.add(suitGroup);

  loadMaskSvgGeometry(MASK_SVG_URL)
    .then((svgGroup) => {
      if (!suitGroup) return;
      suitGroup.add(svgGroup);
    })
    .catch(() => {
      // keep backplate only if SVG cannot load
    });
}

async function loadMaskSvgGeometry(url) {
  const svgText = await fetch(url).then((res) => {
    if (!res.ok) throw new Error(`svg_fetch_${res.status}`);
    return res.text();
  });

  const loader = new SVGLoader();
  const data = loader.parse(svgText);
  const group = new THREE.Group();

  data.paths.forEach((path) => {
    const style = path.userData?.style || {};

    const shapes = SVGLoader.createShapes(path);
    shapes.forEach((shape) => {
      const fillMat = new THREE.MeshBasicMaterial({
        color: 0xff4568,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      suitMaterials.push(fillMat);
      const fillMesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), fillMat);
      group.add(fillMesh);
    });

    path.subPaths.forEach((subPath) => {
      const strokeGeometry = SVGLoader.pointsToStroke(subPath.getPoints(), style);
      if (!strokeGeometry) return;
      const strokeMat = new THREE.MeshBasicMaterial({
        color: 0xff3a5a,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      suitMaterials.push(strokeMat);
      group.add(new THREE.Mesh(strokeGeometry, strokeMat));
    });
  });

  const box = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxDim = Math.max(size.x, size.y, 1);
  const scale = 1.25 / maxDim;
  group.scale.setScalar(scale);
  group.position.set(-center.x * scale, -center.y * scale + 0.62, 0.05);
  group.rotation.z = Math.PI;

  return group;
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
    const pulse = 1 + Math.sin(time * (1.4 + stressLevel * 2.6)) * 0.018;
    suitGroup.scale.setScalar(SUIT_BASE_SCALE * pulse * (1 + audioLevel * 0.04));
    suitGroup.rotation.y = SUIT_BASE_ROT_Y + Math.sin(time * 0.42) * 0.04;

    if (state === 'speaking') {
      suitGroup.position.y = SUIT_BASE_Y + Math.sin(time * 2.0) * 0.03;
    } else {
      suitGroup.position.y += (SUIT_BASE_Y - suitGroup.position.y) * 0.12;
    }

    const calm = new THREE.Color('#38bfff');
    const alert = new THREE.Color('#ff3e64');
    const tint = calm.clone().lerp(alert, Math.min(1, stressLevel * 1.2));

    if (suitCore?.material) {
      suitCore.material.color.copy(tint);
      suitCore.material.opacity = 0.72 + stressLevel * 0.22 + audioLevel * 0.2;
      suitCore.rotation.z += 0.016 + stressLevel * 0.03;
    }

    if (suitVisor?.material) {
      suitVisor.material.color.copy(tint.clone().lerp(new THREE.Color('#ffffff'), 0.25));
      suitVisor.material.opacity = 0.62 + stressLevel * 0.25;
    }

    if (suitOutline?.material) {
      suitOutline.material.color.copy(tint);
      suitOutline.material.opacity = 0.12 + stressLevel * 0.25;
    }

    suitMaterials.forEach((mat, idx) => {
      mat.color.copy(tint.clone().lerp(new THREE.Color('#ffde6f'), idx % 2 ? 0.14 : 0.06));
      mat.opacity = Math.min(1, 0.2 + stressLevel * 0.55 + audioLevel * 0.2);
    });
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
