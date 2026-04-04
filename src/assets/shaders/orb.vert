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
