precision highp float;
varying vec3 vNormalW;
varying vec3 vPositionW;
varying vec2 vUv;
uniform vec3 uStarColor;
uniform float uTime;
uniform vec4 uLimb;
uniform int uActiveRegions;
uniform vec4 uSpotA;
uniform vec4 uSpotB;
uniform vec4 uSpotC;
const float PI = 3.141592653589793;
float nonlinearLD(float mu) {
  float mu12 = sqrt(max(mu, 0.0));
  float mu1 = mu;
  float mu32 = mu * sqrt(max(mu, 0.0));
  float mu2 = mu * mu;
  return max(1.0 - uLimb.x*(1.0-mu12) - uLimb.y*(1.0-mu1) - uLimb.z*(1.0-mu32) - uLimb.w*(1.0-mu2), 0.0);
}
vec3 lonLatToVec(float lon, float lat) { return normalize(vec3(cos(lat)*cos(lon), sin(lat), cos(lat)*sin(lon))); }
float spotMask(vec3 N, vec4 spot) {
  vec3 C = lonLatToVec(spot.x + 0.14*uTime, spot.y);
  float d = acos(clamp(dot(normalize(N), C), -1.0, 1.0));
  float m = smoothstep(spot.z, spot.z*0.72, d);
  return mix(1.0, 1.0 - spot.w, m);
}
float granulation(vec3 n) { return 0.96 + 0.035*(sin(42.0*n.x)+sin(37.0*n.y)+sin(31.0*n.z))/3.0; }
void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPositionW);
  float mu = clamp(dot(N,V),0.0,1.0);
  float active = 1.0;
  if (uActiveRegions == 1) { active *= spotMask(N,uSpotA); active *= spotMask(N,uSpotB); active *= spotMask(N,uSpotC); }
  float rim = pow(1.0-mu,2.1);
  vec3 photosphere = uStarColor * nonlinearLD(mu) * active * granulation(N);
  vec3 chromosphere = vec3(1.0,0.48,0.12) * rim * 0.22;
  gl_FragColor = vec4(photosphere + chromosphere, 1.0);
}
