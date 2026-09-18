# Optional 3D runtime

The confirmed `rendering-plan.json` is authoritative: renderer is canvas2d, threejs
or template; physics is none, rapier or template. Do not substitute 2D simulation for
confirmed Three.js / Rapier. Historical builds without a plan may select from the
Requirement Brief and applicable Gameplay Blueprint / Visual Spec. A renderer change
allows replacing the old rendering implementation while preserving gameplay and assets.

## Build

The host prepares pinned dependencies before the agent starts for a confirmed 3D build.
Use the build command from the task workspace (prepare is only needed for manual use):

```sh
node assets/starter/work/bundle-playable.mjs prepare three
node assets/starter/work/bundle-playable.mjs build work/game.js work/shell.html output.html
```

Preparation installs pinned Three.js 0.165.0 and esbuild 0.25.12 under work/.playable-deps.
Network is needed during preparation only. Reuse that directory for subsequent builds.
Use `prepare three-physics` for Rapier 0.17.3 compat (embedded WASM), or `prepare 2d` for esbuild alone.
If preparation fails, fix the build environment; do not substitute runtime CDN imports.

Write an HTML shell containing the viewport, styles, canvas, UI and exactly one
`<!-- PLAYABLE_SCRIPT -->` marker, preferably after all canvas, HUD and CTA elements.
The bundler defers the entire module bundle until DOMContentLoaded when needed, so
top-level DOM queries cannot race HTML parsing. For hand-written HTML without this
bundler, give the entire startup path the same DOM-ready guard; inline `defer` does not do this. Write game code as ES modules:

```js
import * as THREE from 'three'
import textureUrl from './texture.webp'
// Only if the gameplay needs rigid-body simulation:
// import RAPIER from '@dimforge/rapier3d-compat'
// async function main() { await RAPIER.init(); /* create world and game */ }
// void main() // no top-level await in the IIFE bundle
```

The bundler embeds imported images, audio, fonts, GLB and WASM as data URLs, bundles
JavaScript and preserves dependency licenses. Unused dependencies are not included.
Use Three.js addons via `three/addons/...`. Use self-contained GLB models; external
glTF textures/buffers, decoder URLs, workers and strings passed to loaders are not
automatically embedded. Import resource files and pass the resulting data URLs to
loaders. Inline shell CSS and its resources yourself. Do not use CDN URLs, import maps,
runtime bare imports or remote fonts. The bundle report is work/bundle-report.json.

## Implementation and acceptance

Three.js supplies rendering, not game rules or rigid-body physics. Add Rapier only for
collision, stacking or other mechanics that need it. Simple animation can use transforms.
Build scenes from approved uploaded models/textures or procedural geometry; do not assume
3D models exist and do not reuse Reference Keyframes as textures.

Implement resize (renderer and camera), pointer coordinates from the canvas bounds,
bounded pixel ratio and a render loop. Keep physics on a bounded fixed timestep and
copy body transforms to meshes when using Rapier. Preserve mute, CTA and read-only
window.__PLAYABLE__ contracts; expose real gameplay state, not synthetic passing flags.

After packaging, run test-freeform-playable.mjs and the shared browser acceptance runner.
When browser acceptance is enabled, write `work/scenario.mjs`; rendering and physics
checks are part of that same acceptance run. When the host disables validation, skip
browser checks and repairs; rendering is recorded as not verified. The protected runner instruments WebGL drawing and Rapier WASM exports
before the game starts. For Rapier, use actual `world.contactPair(a, b, manifold => ...)`
and `manifold.numContacts()` / `numSolverContacts()` when processing or inspecting
contacts; your acceptance scenario must perform a real gameplay input and observe a
subsequent collision and its gameplay effect. Engine steps and positive contact queries
must occur in the real game, not in a separate test world. A fake __PLAYABLE__ flag does
not satisfy engine evidence. Keep animation/physics progressing during acceptance.
Use the normal acceptance repair policy; there is no additional 3D-specific retry loop.

The browser scenario must verify WebGL renders a visible scene, actual gameplay input
changes engine state, the confirmed ending, and portrait/landscape rendering. Inspect
screenshots for camera framing and lighting. Check network and console errors, including
model/texture/WASM initialization. A successful bundle alone is not gameplay acceptance.

References: https://threejs.org/manual/en/installation.html,
https://esbuild.github.io/api/, https://rapier.rs/docs/user_guides/javascript/getting_started_js/

## Uploaded GLB models

`asset-manifest.json` identifies approved GLB files by `mimeType: model/gltf-binary`
and includes `model` counts (meshes, triangles, textures, animations). Match filenames
against `sources[].treatment` for their assigned gameplay roles. These are actual
meshes with UVs and embedded textures, not image evidence. Load the supplied models
instead of recreating their appearance with planes or substituting generic geometry.

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import modelUrl from '../user-assets/models/ASSET_ID-model.glb'
// Use the exact workspacePath from the manifest, not this example filename.
const loader = new GLTFLoader()
async function loadModel() {
  const gltf = await loader.loadAsync(modelUrl)
  scene.add(gltf.scene)
  // Inspect bounds, center/pivot and orientation before scaling or cloning.
}
```

Upload and packaging reject external files, Draco, Meshopt, KTX2/Basis decoders and
sparse accessors in this initial version. Use uncompressed, self-contained GLB 2.0.
Do not set DRACOLoader decoder paths, KTX2 transcoders or remote workers. The bundler
validates every imported GLB and embeds it as a model/gltf-binary data URL. Never use
literal filesystem paths at runtime. The 4 MiB upload limit applies per asset;
base64 and engine code count toward the separate confirmed delivery size budget.

For repeated static models, clone the scene and share geometries/materials. Use
SkeletonUtils.clone for skinned models and AnimationMixer if animation is needed.
Physics is independent of file format. Display objects, static environments and authored
animation do not automatically need Rapier. For confirmed physics interactions, choose
colliders from the geometry and gameplay role rather than assuming boxes or cylinders. Imported GLB does
not automatically define Rapier bodies. Preserve original embedded material colors;
provide scene lights and check texture orientation and camera framing visually.
During browser acceptance, verify the loaded models are visible and that a real
interaction moves the expected body and produces the expected collision. Verify
there are no failed model/texture requests and all required resources work offline.


The `models` resource slot is generic across all game types. A file may be a character,
prop, vehicle, environment or complete scene. Inspect its actual nodes, transforms,
bounds, skins, morph targets and animation clip names before integrating it. Retain
hierarchy and local transforms; center via a parent group if root motion must survive.
Never hardcode reference-game shapes, filenames, dimensions or animation names.
Use `resources.models.treatment` / the corresponding manifest source to identify each
file's role and desired behavior. Uploaded models in older slots remain supported.
