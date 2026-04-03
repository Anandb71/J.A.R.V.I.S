uniform float uTime;
void main() {
  vec3 pos = position;
  pos.x += sin(uTime * 0.4 + position.y) * 0.04;
  pos.y += cos(uTime * 0.35 + position.x) * 0.04;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = 1.5;
}
