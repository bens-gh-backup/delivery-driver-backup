# Curbside passenger prototype

One static Blender-authored mesh, **1,112 triangles / 2,070 exported vertices**, four clothing/skin palettes, one shared opaque runtime material, no textures or skeleton. At the default density there are eighteen waiting taxi passengers citywide (20,016 model triangles total), plus the separate injured-patient population, rendered as instances of four palette sources. A palette contributes a draw call only when its instances are visible.

The hailing arm has a conspicuous bent elbow and upright forearm, with an open palm beside/above the head. Never straighten it into a forward-pointing salute. Hair, nose, ears, jacket lapels, pockets, cuffs and shoes provide the detail; no floating icons or always-visible silhouettes are used. People neither walk nor block cars in this version. Clothing colors are visual variety, unrelated to passenger traits.

`passenger.blend` is editable. `passenger.glb` exports only the person; studio lights and camera are excluded. `manifest.json` defines the four palettes and named color roles. The runtime data is `src/passengers/assets/passenger.json`; Blender is not needed for ordinary builds. The person uses the taxi's world scale (10.2 / 4.98), with the feet placed at the shared sidewalk surface height.

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/blender/create_passenger.py
npm run assets:passenger
npm run assets:passenger:check
/Applications/Blender.app/Contents/MacOS/Blender --background assets/people/passenger-prototype/passenger.blend --python scripts/blender/render_passenger.py
```

Regeneration replaces this prototype, so preserve any manual edits first. When invoking the generator through Blender MCP, set `PASSENGER_OUTPUT` to this directory's absolute path. The offline adapter checks material, geometry and palette constraints and performs coordinate/color conversion once. Keep the source, GLB, manifest, generator and runtime JSON in backups.

`preview-studio.png` and `preview-palettes.png` are studio views. `preview-game.png` and `preview-driving.png` use the actual game lighting/camera. The gameplay rules, config settings and short performance comparison are in `design docs/Curbside taxi implementation.md`.
