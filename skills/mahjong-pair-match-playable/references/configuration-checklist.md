# Configuration Checklist

Use this after the user selects an included mode or describes a custom mechanic. Produce one consolidated confirmation table and wait for one approval before implementation. Do not split these decisions into the former eight-stage confirmation workflow.

## Confirmation table

Include every row below. Combine rows only when doing so remains equally explicit.

| Category | Confirm | Default when omitted |
| --- | --- | --- |
| Gameplay | Included mode name, or concise custom rules for selection, match, mismatch, movement/refill/layers, score, completion, and replay | Ask for route first; never silently force custom behavior into a template |
| Tile or item faces | Exact uploaded files, bundled set, or approved generation specification | Bundled Mahjong tile set |
| Background and board UI | Background, rack/grid/stack treatment, HUD, tutorial hand | Selected mode defaults |
| Animation and effects | Selection, mismatch, match motion, particles, shake, layer reveal | Selected mode defaults |
| Audio | BGM, click, match/break, error, volume treatment | Bundled audio; muted until first interaction |
| End card | Background, app icon, title/logo, CTA artwork and animation | Bundled end card, clearly labeled as default |
| Copy and locale | Game title, CTA text, disclaimer, language | Preserve supplied copy; otherwise bundled copy |
| Store destination | Exact production URL or clearly identified placeholder | Bundled placeholder; never imply it is production-ready |
| Delivery | Network, canvas size, orientation, file/ZIP requirement, size limit | AppLovin; responsive 360 × 640; one offline HTML under 5 MiB |

For every visual and audio resource, show one status:

- `用户上传`: identify the exact source path and its assigned role.
- `内置默认`: identify the bundled asset group that will be used.
- `待上传`: state what the user needs to provide and acceptable formats.
- `待生成`: include the exact prompt, dimensions, transparency, style, and quantity for approval.

Users may replace any proposed default by uploading their own resources before approving. Ask only for unresolved information that blocks a valid build. Once all blocking rows have a concrete treatment, ask for one approval of the entire table.

## AppLovin invariants

- Single HTML under 5 MiB with every image, audio file, font, and script embedded.
- No external resource requests.
- MRAID 2.0 store navigation. Never redirect on the first interaction.
- Audio starts muted and unlocks only after the first gameplay tap.
- Verify both portrait and landscape.
- Do not use WebGL unless required; if used, add initialization and context-loss fallbacks.

## Acceptance

- Initial state is gameplay, not the end card.
- Mismatch changes neither score nor board state.
- A match increments once and follows the selected mode's motion rule.
- Completion occurs only after the configured number of matches.
- End-card content and destination are exactly the approved values.
- No blocking console errors, external requests, or package-size violation.
