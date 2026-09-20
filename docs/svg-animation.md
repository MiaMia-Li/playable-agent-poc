# Playable SVG animation

Playable Studio accepts self-contained `.svg` resources up to 4 MiB, including
SMIL and CSS animation. Upload from the home page or conversation composer, or
directly into the background, effects, tile-face or end-card resource field.
Existing unoptimized image previews preserve declarative animation.

Composer uploads use `animationEffects`. State the desired role in the message,
for example: “Use water.svg as a looping background in portrait and landscape.”
The Requirement Brief and Confirmation Proposal retain the resource's actual slot
and describe its background role in the treatment. SVGs are not sent as Reference
Images to the raster image-analysis APIs. SVG files inside imported ZIP/RAR
packages are also available to confirmed visual resource slots.

Builds receive `references/svg-animation.md` and the shared
`assets/starter/work/svg-animation.mjs` helper. The helper renders an embedded SVG
data URL in an isolated image layer under a transparent game canvas. It uses
proportional cover, observes container size, and optionally switches between
supplied portrait and landscape compositions. A single-source resize does not
reset the animation. Background layers do not intercept input.

Replacing a Canvas pattern's source alone does not animate it. When adapting an
existing HTML, the build must remove the active runtime's opaque background draw
and enable alpha when first creating its context. No renderer or gameplay change
is required. Every asset remains embedded in the final offline HTML.

SVG previews execute neither uploaded scripts nor external resources in image
mode. Direct navigation to the asset endpoint also receives a sandbox CSP.
Script-driven SVG and externally linked fonts/images are not supported; use
declarative animation and embedded dependencies. Proportional cover may crop
decorative edges at different screen ratios.

Regression coverage includes upload byte preservation, MIME fallback, separation
from reference screenshots, content-response isolation, ZIP resource discovery,
offline bundling, source continuity on resize, orientation switching and cleanup.
Browser acceptance must additionally observe changing background pixels, viewport
coverage and working gameplay after rotation in the final generated HTML.
