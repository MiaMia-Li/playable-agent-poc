# Mahjong templates

Each mode owns `assets/templates/<mode>/config.json`. The three Canvas modes use
`assets/starter/src/playable.template.html`; `perspective_3d` owns its bundled
Three.js/WebGL `playable.template.html`.

Only the selected mode is included in a build workspace. Public preview copies
remain under `public/playable-templates/`. Independent Cocos and Laya source games
and their provenance are maintained in their own Skills.
