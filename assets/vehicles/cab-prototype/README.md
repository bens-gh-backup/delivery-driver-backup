# Blender cab

An original, fictional low-poly four-door taxi, authored in Blender and used by the game's **starter player vehicle**. Other purchased vehicles, the ambulance and traffic retain their existing models.

Open `cab.blend` to edit the model. `cab.glb` contains only the cab; the studio floor, camera, lights and other Blender scenes are excluded. Front, rear and side PNGs show studio lighting, which differs from the game's lighting. `preview-game.png` shows the integrated model in the actual city renderer.

## Geometry and rendering

| Metric | Previous starter car | Blender cab in game |
| --- | ---: | ---: |
| Triangles | 748 | 1,496 |
| Vertices | 1,070 | 2,966 |
| Meshes / material slots | 1 / 1 | 1 / 1 |
| Textures | 0 | 0 |

The source GLB has 1,490 triangles, 2,958 vertices and one primitive (116,632 bytes). The game adds an eight-vertex, six-triangle contact shadow inside the same mesh, keeping the result under the current 1,500-triangle player budget.

`prepare-cab.mjs` converts the exported geometry into the game's existing vertex-color format ahead of time. There is no runtime GLB loader, PBR material, transparent glass, studio light, Blender dependency or separate asset fetch. This intentionally uses the game's StandardMaterial lighting instead of importing the GLB's PBR roughness/metallic settings. The generated JSON ships with the game; the `.blend`, GLB and previews do not.

Actual route and repeated-asset measurements, limitations and repeat commands are documented in `design docs/Blender cab performance.md` at the repository root. Do not infer a universal asset budget from one machine's FPS.

## Edit, export and prepare

From the repository root (replace the Blender executable path if needed):

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/blender/create_cab.py
/Applications/Blender.app/Contents/MacOS/Blender --background assets/vehicles/cab-prototype/cab.blend --python scripts/blender/render_cab.py
npm run assets:cab
npm run assets:cab:check
npm run build
```

The generator writes `cab.blend`, `cab.glb` and `budget.json`. The second command renders three previews. Generation replaces the named `Cab Prototype` scene; preserve a copy before regenerating hand edits. After hand edits, export just the cab as one opaque, vertex-colored GLB with transforms applied, then run `npm run assets:cab`. Unsupported mesh/material/animation formats are rejected rather than silently imported incorrectly.

`npm run assets:cab` writes `src/vehicles/assets/cab.json`; `assets:cab:check` verifies it matches the GLB. Ordinary development/builds use that committed JSON and do not require Blender. Keep the `.blend`, GLB, generator and prepared JSON in backups. When running the generator through the Blender Python console/MCP, set `CAB_OUTPUT` to the absolute output directory first.

## Integration details

- Source dimensions are approximately 2.29 m wide (mirrors included), 4.98 m long and 1.912 m tall. `BlenderCabMesh.ts` fits the existing player width and length and preserves the model's height/length ratio. Tire contact is aligned with the road; handling, collision dimensions and player root position are unchanged.
- Blender: Z up, forward -Y. glTF: Y up, forward +Z. The offline adapter reflects X for Babylon's left-handed scene while retaining +Z forward and readable lettering; do not additionally reverse indices or rotate the model. It also converts linear glTF vertex colors to the convention used by the existing game material.
- Normals receive inverse-transpose scaling. The renderer creates the mesh only when equipping; no new per-frame model update is introduced.
- Wheels and lamps are static mesh parts. Existing NPC turn signals and ambulance flashers remain on their original models. Any future animated wheels/brake lamps need explicit integration rather than extra overlapping boxes.
- Checker stripes and door seams are body panels; glass has no painted body panel immediately behind it. Avoid nearly coplanar decals/backing faces that reintroduce flickering.
- The collider remains a separate simple shape. Never use the render triangles for vehicle collision detection.
- Named Blender vertex groups identify parts for editing. The model contains no external artwork, textures or fonts.

## Developer comparison

`GAME_CONFIG.graphics.playerCabModel` selects `blender` (default) or `procedural`. Open `/?debug&cab=procedural` and `/?debug&cab=blender` to compare just the starter model under the same enhanced city graphics. Original graphics mode also retains the original car. Switching models does not reset progression or change purchased vehicles.
