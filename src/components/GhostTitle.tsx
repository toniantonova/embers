/**
 * GhostTitle — Decorative cinematic text behind the particle canvas.
 *
 * Renders a static phrase that fades into the background with a slow
 * blur animation, creating an ethereal "watermark" effect behind the
 * particle visualization.
 */

export function GhostTitle() {
    return (
        <div className="ghost-title">
            <span className="ghost-title__text">very, very, fey, light</span>
        </div>
    );
}
