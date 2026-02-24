import './ReportPage.css';

export function ReportPage() {
    return (
        <div className="report-page">
            {/* BACK LINK */}
            <a href="/" className="report-back-link">Back to Embers</a>

            {/* HERO */}
            <header className="report-hero">
                <h2 className="report-hero__title">
                    Building a Speech to Visualization Instrument
                </h2>
                <p className="report-hero__subtitle">
                    A real time system that transforms spoken language into GPU accelerated
                    particle formations, translating what you say and how you say it into
                    living visual form.
                </p>
                <p className="report-hero__meta">
                    <strong>Toni Antonova</strong> · February 2026
                </p>
            </header>

            {/* Hero video */}
            <div className="report-hero-media">
                <img
                    src="/report-assets/milestone_recording.webp"
                    alt="Embers particles morphing from ring to quadruped shape in response to speech"
                />
            </div>

            {/* BODY */}
            <div className="report-body">

                {/* WHAT I BUILT */}
                <h2>What I Built</h2>

                <p>
                    Embers is a real time speech to visualization system. You speak into your
                    microphone, and <strong>16,384 GPU accelerated particles</strong> respond,
                    morphing into 3D shapes that represent what you said, flowing with physics
                    that reflect <em>how</em> you said it. The system extracts two concurrent
                    channels from speech:
                </p>

                <ul>
                    <li><strong>Semantics:</strong> entities, actions, concepts (<em>"horse"</em>, <em>"running"</em>, <em>"ocean"</em>)</li>
                    <li><strong>Prosody:</strong> arousal, tension, urgency, breathiness (<em>how</em> it's said)</li>
                </ul>

                <p>
                    These channels drive a single visual field: a particle system whose
                    parameters are derived from measurable inputs and whose internal state
                    (coherence, arousal, entropy) is <strong>explicit, tunable, and logged</strong>.
                    A goal is to have the system's behavior inspectable rather than a black box.
                </p>

                {/* THE RESEARCH */}
                <h2>The Research</h2>

                <p>
                    I started with deciding what would count as a <strong>meaningful mapping</strong>.
                    The prompt asks for sentiment, rhythm, emphasis. I treated "meaningful" as
                    "grounded enough that mappings are defensible, testable, and adjustable."
                </p>

                <p>
                    The idea that inspired me is that speech primes the viewer's perception.
                    You say the words. The shape confirms the subject. The motion confirms the
                    general quality of the action. The viewer's brain does the compositing. You
                    don't need the literal motion of running; you need the <em>feeling</em> of
                    running: fast, rhythmic, forward, expansive.
                </p>

                <p>
                    So the practical approach is a three tier verb handling system. This idea
                    guided my thinking throughout the project.
                </p>

                <p>
                    I looked at various papers across emotion psychology, animation and movement
                    research, computational vision, and emotions, and I anchored the mapping in
                    three interesting bodies of research.
                </p>

                <h3>How Emotions Become Particle Physics</h3>

                <p>
                    <strong>Laban Movement Analysis (LMA).</strong> Shafir et al. (2016)
                    experimentally validated specific movement qualities across 1,241 trials.
                    Weight (light to strong) maps to amplitude. Time (sustained to sudden) maps
                    to acceleration. Space (indirect to direct) maps inversely to turbulence.
                    Flow (bound to free) maps inversely to drag. These are experimentally
                    validated movement signatures translated into shader uniforms.
                </p>

                <p>
                    <strong>Color emotion research.</strong> Valdez &amp; Mehrabian (1994) showed
                    saturation is the strongest predictor of arousal (r=0.60) and brightness for
                    valence (r=0.69). Jonauskaite et al. (2020, N=4,598 across 30 nations)
                    confirmed near universal color emotion associations (r=.88). Every color
                    parameter has a citation.
                </p>

                <p>
                    <strong>Crossmodal correspondences.</strong> Spence (2011), Marks (1974),
                    Walker et al. (2010) established that pitch maps to brightness, loudness maps
                    to visual size, and spectral centroid maps to color warmth. These are cross
                    culturally robust and validated the core design principle:
                </p>

                <blockquote>
                    <strong>One audio feature, one visual dimension.</strong> No cross contamination.
                    Energy doesn't affect color. Tension doesn't affect size. When particles swirl
                    faster, you know it's because urgency increased, not some opaque feature
                    interaction.
                </blockquote>

                <h3>Emotion to Physics Translation</h3>

                <p>
                    Each emotion profile adjusts five physics parameters simultaneously, drawing
                    on the LMA framework:
                </p>

                <div className="emotion-grid">
                    <div className="emotion-card">
                        <div className="emotion-card__emoji">☀️</div>
                        <div className="emotion-card__name">Joy</div>
                        <div className="emotion-card__desc">
                            Spring ↑ · Drag ↓ · Noise ↓<br />
                            Light, bouncy, responsive
                        </div>
                    </div>
                    <div className="emotion-card">
                        <div className="emotion-card__emoji">🌧️</div>
                        <div className="emotion-card__name">Sadness</div>
                        <div className="emotion-card__desc">
                            Spring ↓ · Drag ↑ · Noise ↓<br />
                            Heavy, sluggish, dense
                        </div>
                    </div>
                    <div className="emotion-card">
                        <div className="emotion-card__emoji">🔥</div>
                        <div className="emotion-card__name">Anger</div>
                        <div className="emotion-card__desc">
                            Spring ↑ · Drag ↓ · Noise ↑<br />
                            Aggressive, chaotic, tense
                        </div>
                    </div>
                    <div className="emotion-card">
                        <div className="emotion-card__emoji">💨</div>
                        <div className="emotion-card__name">Fear</div>
                        <div className="emotion-card__desc">
                            Spring ↓ · Drag ↓ · Noise ↑<br />
                            Jittery, unstable, scattered
                        </div>
                    </div>
                </div>

                {/* ARCHITECTURE */}
                <h2>System Architecture</h2>

                <p>
                    I started out with 12 procedural shape embeddings and worked with those
                    for most of the project before moving on to the larger 3D generation models.
                    The core constraint: <strong>the system must feel instantaneous</strong>. A
                    person speaks, and the visualization must respond within the span of a breath.
                </p>

                <h3>The Two Tier Lookup System</h3>

                <p>
                    The architecture splits into a fast local path (Simple mode) and a
                    server powered path (Complex mode):
                </p>

                {/* Architecture diagram */}
                <div className="arch-diagram">
                    <div className="arch-tier arch-tier--client">
                        <div className="arch-tier__badge">Tier 1 · Simple (Client Side)</div>
                        <div className="arch-tier__latency">
                            Response: <strong>&lt;50ms</strong>, covers ~85% of inputs
                        </div>
                        <div className="arch-blocks">
                            <div className="arch-block">
                                <div className="arch-block__name">Verb Hash Table</div>
                                <div className="arch-block__detail">393 verbs · O(1) · &lt;1ms</div>
                            </div>
                            <div className="arch-block">
                                <div className="arch-block__name">MiniLM Embeddings</div>
                                <div className="arch-block__detail">Web Worker · ~10 to 20ms</div>
                            </div>
                            <div className="arch-block">
                                <div className="arch-block__name">Keyword Classifier</div>
                                <div className="arch-block__detail">~160 words · O(1) · &lt;1ms</div>
                            </div>
                        </div>
                    </div>

                    <div className="arch-arrow">↓ If no confident match</div>

                    <div className="arch-tier arch-tier--server">
                        <div className="arch-tier__badge">Tier 2 · Complex (Server Side)</div>
                        <div className="arch-tier__latency">
                            Response: <strong>~2 to 3.5s</strong>, long tail only
                        </div>
                        <div className="arch-blocks">
                            <div className="arch-block">
                                <div className="arch-block__name">SDXL Turbo</div>
                                <div className="arch-block__detail">Text to Image · ~1s</div>
                            </div>
                            <div className="arch-block">
                                <div className="arch-block__name">PartCrafter</div>
                                <div className="arch-block__detail">Image to Parts · ~0.5s</div>
                            </div>
                            <div className="arch-block">
                                <div className="arch-block__name">Cache Layer</div>
                                <div className="arch-block__detail">LRU + GCS · 74% hit rate</div>
                            </div>
                        </div>
                    </div>
                </div>

                <h3>Choosing the 3D Generation Model</h3>

                <p>
                    The server pipeline required choosing from a rapidly evolving landscape
                    of text to 3D models. The decisive capability
                    was <strong>part decomposition</strong>: getting pre labeled mesh parts
                    (head, body, legs, tail) in one forward pass, without a fragile segmentation
                    stage.
                </p>

                <table>
                    <thead>
                        <tr>
                            <th>Model</th>
                            <th>Speed</th>
                            <th>Part Decomposition</th>
                            <th>Decision</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>Point-E (OpenAI)</td>
                            <td>60 to 120s</td>
                            <td>❌ None</td>
                            <td>Too slow</td>
                        </tr>
                        <tr>
                            <td>TripoSR (Stability AI)</td>
                            <td>&lt;0.5s</td>
                            <td>❌ Monolithic</td>
                            <td>No parts</td>
                        </tr>
                        <tr>
                            <td>Hunyuan3D 2 Turbo</td>
                            <td>~1.5s</td>
                            <td>❌ Monolithic</td>
                            <td>Fallback path</td>
                        </tr>
                        <tr>
                            <td><strong>PartCrafter (NeurIPS '25)</strong></td>
                            <td><strong>~0.5s</strong></td>
                            <td><strong>✅ 2 to 16 parts</strong></td>
                            <td><strong>Primary ✓</strong></td>
                        </tr>
                    </tbody>
                </table>

                {/* Quadruped milestone */}
                <div className="report-figure">
                    <img
                        src="/report-assets/milestone_quadruped.png"
                        alt="Particles morphed into a quadruped shape from a spoken word"
                    />
                    <div className="report-figure__caption">
                        Particles converging into a quadruped formation after speaking "horse".
                        Spring forces pull 16,384 particles toward the labeled point cloud.
                    </div>
                </div>

                <h3>Technology Choices</h3>

                <table>
                    <thead>
                        <tr><th>Layer</th><th>Choice</th><th>Rationale</th></tr>
                    </thead>
                    <tbody>
                        <tr><td>Frontend</td><td>React 19 + TypeScript 5.9 + Vite 7.3</td><td>Current best in class. Strict types catch bugs at compile time.</td></tr>
                        <tr><td>3D Rendering</td><td>Three.js 0.183 + GPUComputationRenderer</td><td>16K particles fully GPU computed via WebGL2. No CPU per particle work.</td></tr>
                        <tr><td>Audio</td><td>Meyda 5.6.3 + Pitchy 4.1</td><td>6 psychoacoustic features from Meyda, plus pitch extraction from Pitchy.</td></tr>
                        <tr><td>NLP</td><td>compromise.js + Transformers.js (MiniLM)</td><td>Sub ms POS tagging + 23MB embedding model in Web Worker.</td></tr>
                        <tr><td>STT</td><td>Web Speech API + Deepgram Nova 3</td><td>Primary: browser native. Fallback: WebSocket to Deepgram for unreliable browsers.</td></tr>
                        <tr><td>Emotion</td><td>SER via ONNX (WebGPU/WASM)</td><td>Speech emotion recognition in a Web Worker. WebGPU first, WASM fallback.</td></tr>
                        <tr><td>Backend</td><td>FastAPI + Python 3.13</td><td>Protocol based interfaces, DI, Pydantic v2 validation.</td></tr>
                        <tr><td>Infra</td><td>Cloud Run + Terraform + Firebase Hosting</td><td>NVIDIA RTX PRO 6000 Blackwell GPU. Firebase serves frontend and proxies API.</td></tr>
                        <tr><td>Testing</td><td>Vitest + pytest</td><td>930+ tests (685 frontend, 248 server). Property based testing for numerical robustness.</td></tr>
                    </tbody>
                </table>

                {/* GPU PARTICLE PHYSICS */}
                <h2>GPU Particle Physics</h2>

                <p>
                    The particle system uses Three.js's <code>GPUComputationRenderer</code> to run
                    physics entirely on the GPU via WebGL2 fragment shaders. Two 128×128 floating point
                    textures store position and velocity for all 16,384 particles. Each frame, the GPU
                    reads both textures, computes forces, integrates, and writes back (ping pong rendering).
                    The CPU never touches individual particle data.
                </p>

                <h3>Five Force Composition</h3>

                <p>
                    The velocity shader composes five forces each frame, plus sentiment based
                    modulation from the Laban Movement Analysis framework:
                </p>

                <pre><code>{`// velocity.frag.glsl  Force composition (simplified)

// 1. Spring force: pull toward morph target
vec3 springForce = uSpringK * (targetPos - pos);

// 2. Curl noise: divergence free turbulence (fluid like motion)
vec3 noiseForce = uNoiseAmp * curlNoise(pos * uNoiseFreq + uTime * 0.1);

// 3. Drag: viscosity (prevents jitter, makes motion feel "heavy")
vec3 dragForce = -uDrag * vel;

// 4. Repulsion: scatter from cursor/touch
vec3 repulsionForce = computeRepulsion(pos, uPointerWorld, uRepulsionRadius);

// 5. Breathing: sinusoidal expansion/contraction (life like rhythm)
vec3 breathForce = normalize(pos) * uBreathingAmp * sin(uTime * uBreathingFreq);

// Compose all forces
vec3 totalForce = springForce + noiseForce + dragForce + repulsionForce + breathForce;
vec3 newVel = vel + totalForce * uDelta;`}</code></pre>

                <blockquote>
                    <strong>Why curl noise?</strong> Curl noise is divergence free (∇·(∇×F) = 0),
                    producing fluid like motion with coherent eddies rather than chaotic dust. This is
                    what creates the "liquid smoke" aesthetic: particles flow in closed loops like fluid
                    rather than scattering randomly.
                </blockquote>

                {/* Ring + scatter side-by-side */}
                <div className="report-figure-row">
                    <div>
                        <img
                            src="/report-assets/milestone_ring.png"
                            alt="Particles in ring formation with curl noise"
                        />
                        <div className="report-figure__caption">Idle ring state with curl noise only</div>
                    </div>
                    <div>
                        <img
                            src="/report-assets/milestone_scatter.png"
                            alt="Particles in scattered formation during high energy speech"
                        />
                        <div className="report-figure__caption">High energy speech with turbulence activated</div>
                    </div>
                </div>

                {/* AUDIO-TO-VISUAL MAPPING */}
                <h2>Audio to Visual Mapping</h2>

                <p>
                    Meyda extracts six psychoacoustic features from the microphone stream,
                    which I combine into seven perceptual dimensions. Pitchy adds pitch tracking.
                    Each drives a distinct visual dimension with no cross contamination.
                </p>

                <div className="feature-map">
                    <div className="feature-row">
                        <span>Feature</span>
                        <span>DSP Source</span>
                        <span>Visual Effect</span>
                    </div>
                    <div className="feature-row">
                        <span className="feature-row__name">Energy (RMS)</span>
                        <span className="feature-row__source">Root mean square amplitude</span>
                        <span className="feature-row__effect">Ring expansion + speed</span>
                    </div>
                    <div className="feature-row">
                        <span className="feature-row__name">Tension (Centroid)</span>
                        <span className="feature-row__source">Spectral center of mass</span>
                        <span className="feature-row__effect">Curl noise frequency + warmth</span>
                    </div>
                    <div className="feature-row">
                        <span className="feature-row__name">Urgency (RMS Δ)</span>
                        <span className="feature-row__source">Rate of amplitude change</span>
                        <span className="feature-row__effect">Turbulence / chaos</span>
                    </div>
                    <div className="feature-row">
                        <span className="feature-row__name">Breathiness</span>
                        <span className="feature-row__source">Zero crossing + flatness</span>
                        <span className="feature-row__effect">Drag reduction + Z spread</span>
                    </div>
                    <div className="feature-row">
                        <span className="feature-row__name">Texture (MFCC)</span>
                        <span className="feature-row__source">Cepstral coefficient variance</span>
                        <span className="feature-row__effect">Second noise octave</span>
                    </div>
                    <div className="feature-row">
                        <span className="feature-row__name">Rolloff</span>
                        <span className="feature-row__source">95% energy frequency</span>
                        <span className="feature-row__effect">Edge softness (crisp / soft)</span>
                    </div>
                    <div className="feature-row">
                        <span className="feature-row__name">Flatness</span>
                        <span className="feature-row__source">Spectral balance</span>
                        <span className="feature-row__effect">Base brightness</span>
                    </div>
                    <div className="feature-row">
                        <span className="feature-row__name">Pitch (F0)</span>
                        <span className="feature-row__source">McLeod Pitch Method via Pitchy</span>
                        <span className="feature-row__effect">Spring stiffness modulation</span>
                    </div>
                    <div className="feature-row">
                        <span className="feature-row__name">Pitch Deviation</span>
                        <span className="feature-row__source">Rate of pitch change</span>
                        <span className="feature-row__effect">Motion plan Y offset</span>
                    </div>
                </div>

                {/* Analysis panel milestone */}
                <div className="report-figure">
                    <img
                        src="/report-assets/milestone_active.png"
                        alt="Analysis panel showing live audio feature bars during speech"
                    />
                    <div className="report-figure__caption">
                        The AnalysisPanel showing real time audio features, STT status, and semantic
                        classification during live speech.
                    </div>
                </div>

                {/* SPEECH-TO-3D PIPELINE */}
                <h2>Speech to 3D: The Server Pipeline</h2>

                <p>
                    When a concept doesn't match the local shape library, the server generates a
                    fully labeled 3D point cloud. Two paths exist, with automatic fallback:
                </p>

                <pre><code>{`Primary Path (PartCrafter):
  Text to Image (SDXL Turbo)  >  BG Removal  >  PartCrafter  >  Poisson Sampling
        ~1.0s                      ~0.1s          ~0.5s           ~20ms
                                                             > 2,048 labeled points (~27KB)

Fallback Path (Hunyuan3D + Grounded SAM):
  SDXL Turbo > BG Removal > Hunyuan3D 2 Turbo > Grounded SAM 2 > Sample
    ~1.0s        ~0.1s           ~1.5s              ~0.3s         ~20ms
                                                          Total: ~3.5s`}</code></pre>

                <p>
                    The fallback pipeline uses Hunyuan3D 2 Turbo for mesh generation combined
                    with Grounded SAM 2 for part segmentation. I deployed and enabled this
                    fallback as a safety net for concepts where PartCrafter's part decomposition
                    doesn't produce clean results. The output is designed for minimal payload:
                    base64 encoded positions (24KB) + part IDs (2KB) + part names + bounding box.
                </p>

                <h3>Cache Effectiveness</h3>

                <pre><code>{`Cache Hit Rate Analysis (200 requests):
  Overall hit rate:     74.0%
    Memory hits:        89 (44.5%)  >  p50: 2.4ms
    Storage hits:       59 (29.5%)  >  p50: 94.6ms
    Cache misses:       52 (26.0%)  >  p50: 3,023.7ms

Cost Projection at Scale:
    100 users/day   > $0.78/month
  1,000 users/day   > $1.56/month
 10,000 users/day   > $3.90/month

Top uncached concepts: horse (6), okapi (5), cat (4), narwhal (3)
  Action: Add to pre generation list`}</code></pre>

                {/* PRODUCTION DEPLOYMENT */}
                <h2>Production Deployment</h2>

                <p>
                    Deploying to production was the hardest part of this project. The ML pipeline
                    requires a GPU for inference (SDXL Turbo, PartCrafter, Hunyuan3D, Grounded SAM),
                    and getting a GPU provisioned on Cloud Run turned out to be a significant
                    challenge.
                </p>

                <p>
                    I initially targeted NVIDIA L4 GPUs in us-east4, but the L4's 24GB VRAM was
                    insufficient for loading all four models simultaneously. Eager loading (keeping
                    all models in VRAM to avoid cold start latency) requires more memory than the
                    L4 could provide. I had to jump to a much bigger GPU.
                </p>

                <p>
                    The solution was the <strong>NVIDIA RTX PRO 6000 Blackwell</strong>, a new GPU
                    released in February 2026 and available in us-central1. This gave me 48GB of VRAM,
                    enough to hold all models in memory. The Cloud Run service is configured with
                    80Gi system memory, 20 vCPUs, and <code>containerConcurrency: 1</code> to prevent
                    GPU memory corruption from parallel requests.
                </p>

                <p>
                    The startup budget is generous by necessity: 120 second initial delay plus up
                    to 30 minutes for GCS weight sync and PyTorch model loading. Each model needs
                    to download weights from Google Cloud Storage on first boot, then load them
                    onto the GPU. With eager loading enabled, the container won't accept traffic
                    until the <code>/health/ready</code> endpoint confirms all models are loaded.
                </p>

                <h3>The Single GPU Concurrency Fix</h3>

                <p>
                    During production testing, I discovered that 10 out of 10 parallel requests to the
                    generation endpoint returned HTTP 500 with two distinct errors: <strong>"Already
                        borrowed"</strong> (PyTorch model accessed concurrently) and <strong>tensor
                            state corruption</strong> from shared buffers.
                </p>

                <p>
                    A deeper analysis revealed the infrastructure answer was better than the code
                    answer: our GPU quota was exactly <strong>1 GPU</strong>. Even with a mutex,
                    requests would serialize on the GPU anyway. Setting{' '}
                    <code>containerConcurrency: 1</code> in Cloud Run makes the concurrency scenario
                    impossible. If we ever get more GPU quota, additional GPUs mean additional
                    containers (each with its own GPU), not more requests per GPU. The fix scales correctly.
                </p>

                {/* SPEECH RECOGNITION */}
                <h3>Speech Recognition Architecture</h3>

                <p>
                    The speech to text pipeline uses a two tier fallback system:
                </p>

                <ol>
                    <li><strong>Web Speech API:</strong> used on Chrome and Edge where it works reliably. Free, zero setup, routes audio to Google/Apple cloud servers.</li>
                    <li><strong>Deepgram Nova 3 via WebSocket:</strong> fallback for Safari, iOS PWA, and browsers where Web Speech fails. Streams raw PCM audio over WebSocket. Cost: ~$0.0077/min.</li>
                    <li><strong>Text input fallback:</strong> if both speech paths fail, gracefully degrade to a text box.</li>
                </ol>

                <p>
                    Safari's Web Speech API has several confirmed bugs (iOS 15 through 18):
                    <code>isFinal</code> is sometimes never set to <code>true</code>, transcripts get
                    duplicated after speech ends, and PWA/homescreen mode silently fails. Detection
                    happens lazily on first mic tap, and the probe result is cached so we don't re test
                    on subsequent calls.
                </p>

                {/* MILESTONES */}
                <h2>Milestones</h2>

                <ol>
                    <li>GPU particle system with WebGL2 and curl noise physics</li>
                    <li>Audio reactivity via Meyda (6 psychoacoustic features driving shader uniforms)</li>
                    <li>Speech to text pipeline with Web Speech API</li>
                    <li>Keyword classifier with 12 procedural shape targets</li>
                    <li>15 parametric motion primitives in GLSL (oscillate, arc, spiral, wave, burst, etc.)</li>
                    <li>Motion plan system with 20 animation templates (locomotion, actions, transforms, emotions)</li>
                    <li>MiniLM embedding engine running in Web Worker for semantic similarity</li>
                    <li>Tier 1 lookup system: verb hash table (393 entries), keyword classifier, MiniLM fallback</li>
                    <li>Server pipeline: SDXL Turbo + PartCrafter for text to 3D generation</li>
                    <li>Sentiment driven movement via Laban Movement Analysis and Plutchik emotion wheel</li>
                    <li>Novel noun routing and Complex mode toggle</li>
                    <li>Speech Emotion Recognition (SER) via ONNX runtime in a Web Worker</li>
                    <li>WebSocket STT fallback using Deepgram Nova 3</li>
                    <li>Hunyuan3D + Grounded SAM 2 fallback pipeline deployed and enabled</li>
                    <li>Production hardening: rate limiting, structured logging, health checks, cache coalescing</li>
                    <li>Infrastructure switch from L4 to RTX PRO 6000 Blackwell (us-central1)</li>
                    <li>Firebase Hosting deployment with API proxy to Cloud Run</li>
                    <li>v3 speech to mesh pipeline with full phrase processing in Complex mode</li>
                    <li>Particle shape and physics improvements, mobile GPU compatibility</li>
                    <li>UI redesign: minimal pill switch mode toggle, collapsible analysis panel</li>
                </ol>

                {/* MILESTONE GALLERY */}
                <h2>Milestone Gallery</h2>

                <div className="report-figure-row">
                    <div>
                        <img
                            src="/report-assets/milestone_wave.png"
                            alt="Particles in wave formation"
                        />
                        <div className="report-figure__caption">Wave formation target</div>
                    </div>
                    <div>
                        <img
                            src="/report-assets/milestone_tuning_panel.png"
                            alt="Tuning panel with real time parameter sliders"
                        />
                        <div className="report-figure__caption">Real time tuning panel for physics parameters</div>
                    </div>
                </div>

                <div className="report-figure">
                    <img
                        src="/report-assets/milestone_audio_recording.webp"
                        alt="Audio pipeline milestone recording showing speech to text and audio reactivity"
                    />
                    <div className="report-figure__caption">
                        Audio pipeline milestone: STT + audio reactivity working end to end.
                    </div>
                </div>

                <div className="report-figure-row">
                    <div>
                        <img
                            src="/report-assets/04_audio_reactivity_after.png"
                            alt="Audio reactivity debug view"
                        />
                        <div className="report-figure__caption">Audio reactivity: feature bars responding to speech</div>
                    </div>
                    <div>
                        <img
                            src="/report-assets/06_pipeline_restored.png"
                            alt="Full pipeline restored after debugging"
                        />
                        <div className="report-figure__caption">Full pipeline restored after debugging session</div>
                    </div>
                </div>

                {/* FUTURE GOALS */}
                <h2>Future Goals</h2>

                <p>
                    A longer term vision is to build this into a <strong>research instrument</strong>:
                    a test harness where representational assumptions can be implemented, manipulated,
                    logged, and compared. The session logging infrastructure captures timestamped JSON
                    containing audio features (5x/second), workspace state (2x/second), transcript
                    events, semantic events, and system metrics.
                </p>

                <div className="report-callout report-callout--tbd">
                    <div className="report-callout__label">📊 Planned: Semantic Hit Rate Analysis</div>
                    <p style={{ margin: 0 }}>
                        Evaluate the percentage of utterances that produce confident shape matches across
                        all three Tier 1 subsystems. Measure coverage gaps: which semantic categories
                        (abstract nouns? compound phrases?) systematically fail?
                    </p>
                </div>

                <div className="report-callout report-callout--tbd">
                    <div className="report-callout__label">📊 Planned: Audio Feature Correlation Matrix</div>
                    <p style={{ margin: 0 }}>
                        Export continuous speech sessions and compute the cross correlation matrix for
                        all audio features. The design principle is one feature, one dimension, so
                        features should be minimally correlated.
                    </p>
                </div>

                <div className="report-callout report-callout--tbd">
                    <div className="report-callout__label">📊 Planned: Transition Smoothness Metrics</div>
                    <p style={{ margin: 0 }}>
                        Measure the timing of dissolution, mulling, and convergence phases during shape
                        transitions. Quantify convergence latency, overshoot, and persistence half life.
                    </p>
                </div>

                <div className="report-callout report-callout--tbd">
                    <div className="report-callout__label">📊 Planned: WebGPU Migration</div>
                    <p style={{ margin: 0 }}>
                        Migrate the particle rendering from WebGL2 fragment shaders to WebGPU compute
                        shaders. The GLSL maps almost 1:1 to WGSL. Payoff: larger particle counts (131K+),
                        proper compute random access, better memory management. SER already uses WebGPU
                        for ONNX inference, so the browser support story is improving.
                    </p>
                </div>

                {/* HONEST RETROSPECTIVE */}
                <h2>Honest Retrospective</h2>

                <p>
                    <strong>AFINN 165 for sentiment is a known limitation.</strong> It's a lightweight
                    baseline, not a serious affect model. Planned upgrade: GoEmotions class classifier
                    or a compact model trained on session logs (audio features to emotion labels). The
                    instrumentation to evaluate this is already in place.
                </p>

                <p>
                    <strong>CI/CD needs tightening.</strong> Cloud Build + Terraform works, but a
                    production grade pipeline would add PR checks, staging, canaries, and automated
                    test gates.
                </p>

                {/* REFERENCES */}
                <h2>Selected References</h2>

                <ol className="report-references">
                    <li>Shafir, T., et al. (2016). Emotion Regulation through Movement. <em>Frontiers in Psychology</em>, 6, 2030.</li>
                    <li>Valdez, P. &amp; Mehrabian, A. (1994). Effects of Color on Emotions. <em>J. Exp. Psych: General</em>, 123(4).</li>
                    <li>Jonauskaite, D., et al. (2020). Universal Patterns in Color Emotion Associations. <em>Psychological Science</em>, 31(10).</li>
                    <li>Spence, C. (2011). Crossmodal correspondences: A tutorial review. <em>Attention, Perception, &amp; Psychophysics</em>, 73.</li>
                    <li>Palmer, S.E., et al. (2013). Music color associations are mediated by emotion. <em>PNAS</em>, 110(22).</li>
                    <li>Bridson, R. (SIGGRAPH 2007). Curl noise for procedural fluid motion.</li>
                    <li>PartCrafter (NeurIPS 2025): Part Aware 3D Object Generation.</li>
                    <li>Hunyuan3D 2 (Tencent, 2025): High Resolution 3D Generation.</li>
                    <li>SDXL Turbo (Stability AI): Adversarial Diffusion Distillation.</li>
                    <li>Grounded SAM 2 (Meta): Segment Anything with Grounding.</li>
                    <li>compromise.js: Lightweight NLP for JavaScript.</li>
                    <li>MiniLM (Microsoft): Compressing Pre Trained Transformers.</li>
                </ol>

            </div>

            {/* FOOTER */}
            <footer className="report-footer">
                Built with React 19, Three.js, FastAPI, SDXL Turbo, and PartCrafter.
            </footer>
        </div>
    );
}
