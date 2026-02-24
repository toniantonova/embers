// ═══════════════════════════════════════════════════════════════════════
// POSITION SHADER — Updates each particle's position every frame.
//
// This is the simplest of the GPGPU shaders. It reads the current
// position and velocity from their respective textures, then applies
// basic Euler integration: position += velocity * deltaTime.
//
// The w-component of position (selfPosition.w) is preserved as a
// per-particle random value used for effects like phase offsets.
// ═══════════════════════════════════════════════════════════════════════

// Delta time (seconds per frame), passed from ParticleSystem.update()
uniform float uDelta;

void main() {
    // Each pixel in this texture represents one particle.
    // gl_FragCoord gives us this pixel's position, and dividing by
    // resolution gives us the UV coordinate to look up our data.
    vec2 uv = gl_FragCoord.xy / resolution.xy;

    // Read current state from GPGPU textures
    vec4 selfPosition = texture2D(texturePosition, uv);
    vec4 selfVelocity = texture2D(textureVelocity, uv);

    vec3 position = selfPosition.xyz;
    vec3 velocity = selfVelocity.xyz;

    // Euler integration: move position by velocity * time step.
    // This is frame-rate independent because uDelta scales with
    // actual elapsed time between frames.
    position += velocity * uDelta;

    // Write updated position back. Preserve .w (per-particle random seed).
    gl_FragColor = vec4(position, selfPosition.w);
}

