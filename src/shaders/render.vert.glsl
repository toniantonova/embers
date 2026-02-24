uniform sampler2D texturePosition;
uniform float uPointSize;
uniform float uTime;

varying vec2 vUV;

void main() {
    vUV = uv;
    vec4 pos = texture2D(texturePosition, uv);
    
    vec4 mvPosition = modelViewMatrix * vec4(pos.xyz, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    // Scale point size with perspective so near particles appear larger.
    // Factor of 30 keeps them at a reasonable pixel size (e.g. ~18px at distance 10).
    gl_PointSize = uPointSize * (30.0 / -mvPosition.z);
}
