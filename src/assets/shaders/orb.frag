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
