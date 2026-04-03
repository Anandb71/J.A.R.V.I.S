void main() {
  float dist = length(gl_PointCoord - vec2(0.5));
  if (dist > 0.5) discard;
  float alpha = smoothstep(0.5, 0.1, dist);
  gl_FragColor = vec4(0.49, 0.81, 1.0, alpha * 0.6);
}
