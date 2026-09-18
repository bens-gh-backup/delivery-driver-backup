# Blender service buildings and pumps

Original low-poly assets integrated into all 14 gas stations (28 dispensers) and six repair shops in enhanced graphics. The models use the existing opaque, vertex-colored city renderer and static batches. Existing roadside/fascia GAS and REPAIR lettering is retained separately, using its existing shared textures.

- **Gas kiosk:** cream/teal frontage, recessed glazing and door, metal sills, a chamfered branded parapet and a small rear utility cabinet. The roof remains behind the pumps.
- **Gas dispenser:** rounded housing, two inset LCD faces, grade buttons, paired faceted hoses and nozzles, and the same compact drive-over base. Both faces still refuel from the existing pump center.
- **Repair shop:** open bay with dark guide rails, raised roller-door edge, clerestory windows, recessed tool cabinets, orange lower walls and a seamed metal roof with a small vent.

The render models do not create colliders. Gas placement, refueling radii, pump spacing/hitboxes, repair triggers, bay wall colliders, roads, services and building lots match the procedural version exactly.

## Files

`services.blend` contains the editable named meshes, vertex groups and review studio. `gas-station.glb` exports kiosk, roof and pump; `repair-shop.glb` exports shell and roof. `manifest.json` records dimensions/counts. `preview-studio.png`, `preview-pump.png` and `preview-repair.png` show Blender studio lighting; `preview-game-*.png` show the actual game, including the existing signs. The studio itself does not export.

`scripts/blender/prepare-services.mjs` at the repository root converts the GLBs into `src/world/assets/services.json` (133,819 bytes before compression). It checks opaque single-material meshes, applied transforms and the absence of textures, animation and lights; it also converts handedness and vertex colors. The game does not fetch GLBs or use a model-loader dependency. The complete app’s main bundle grew by about 13 KB gzipped for this batch.

| Asset | Triangles |
| --- | ---: |
| Kiosk body | 166 |
| Gas roof | 76 |
| One dispenser including base/hoses | 440 |
| Repair shell/interior | 310 |
| Repair roof/vent | 98 |
| Complete kiosk plus two dispensers | 1,122 |
| Complete repair shop | 408 |

These counts exclude existing ground paving and signs. At service integration, before the later full apartment rollout and new spacing, the combined city changed from 215,466 to **228,390 triangles** (+6.0%), with **112 static world meshes instead of 121** and no additional materials or textures. The old canopy/garage materials no longer require their own batches. That batch used a 230,000-triangle allocation. The later apartment rollout has its own updated totals and budget; the current ceiling is in `GAME_CONFIG.graphics.worldTriangleBudget`, and is not a measured FPS limit.

## Edit and regenerate

Run from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/blender/create_services.py
/Applications/Blender.app/Contents/MacOS/Blender --background assets/services/service-prototypes/services.blend --python scripts/blender/render_services.py
npm run assets:services
npm run assets:services:check
npm run build
```

The generator replaces only the named `Service Asset Studio` scene; preserve hand edits before rerunning it. Through Blender MCP/the Python console, set `SERVICE_OUTPUT` to the absolute output folder first. The generator exports objects with identity transforms before arranging the studio. For manual export, undo the studio positioning/apply the correct model-space coordinates: each kiosk/roof is centered on its building, the pump on its interaction center, and front is Blender -Y. Keep each `Service_*` node’s name, one opaque vertex-color material and the `Color` attribute. Update manifest counts after edits, then prepare the runtime JSON. Normals and game -Z frontage are converted once offline.

Keep the `.blend`, both GLBs, manifest, generator/preparer and generated JSON in backups. Normal builds use the JSON and never require Blender or regenerate the source artwork.

## Preserve the practical details

- Pump body collision remains 3 × 2.5 world units, rotated with the street; the bases/hoses do not add hitboxes. Do not widen the base or move the pump away from its shared gameplay center.
- The gas canopy dimensions/setback remain tied to `GAME_CONFIG.presentation.gasStation`; its height uses `presentation.serviceSigns.gasHeight`. Never move that roof over the refueling lanes/chase camera.
- The repair opening is 25 units wide. Tool cabinets are recessed into the existing back wall; no new obstacle occupies the bay. The red exterior forecourt still triggers repair.
- Glazing/display faces close real wall openings. Colored LCD rectangles tile a single face; they do not float above a backing panel. Cornices meet wall tops, roof seams share edges, and sign planes clear the outermost trim. Preserve those separations to avoid flickering.
- Every model is static and shares `city-flat-mat`; the normal chunk merger handles repeated assets. Do not split out materials/meshes for each hose, window, seam or paint color.

## Review status

Both families were integrated before the combined check, as requested. The production build and **19 focused checks** passed. A short browser check also compared exact world layout/colliders, refueled both faces of both pumps across road orientations, repaired from outside/inside each shop, checked for runtime errors and captured four review views. `integration-check.json` records the resource counts.

**No extended FPS/GPU benchmark or full-suite run was done for this batch.** The prior cab/apartment timing reports predate these additions. The smaller batch count is promising but does not by itself prove better frame times; profile the combined artwork together in the later performance pass.

`GAME_CONFIG.graphics.serviceModel` selects `blender` (default) or `procedural`. Use `/?debug&services=blender` and `/?debug&services=procedural` for visual comparisons; reload after changing mode. Original graphics mode retains the old service models. No progression reset is needed.

For the short combined check with external Playwright:

```sh
NODE_PATH=/tmp/gas-station-browser/node_modules BROWSER_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node scripts/check-blender-services.cjs
```
