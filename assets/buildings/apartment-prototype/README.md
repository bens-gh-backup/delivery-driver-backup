# Blender apartment prototype

A modular downtown apartment with recessed sash windows, solid stone sills, a shallow projecting central bay, a mitered cornice, two striped storefront awnings and a separate apartment entrance. Four coordinated paint schemes: **Terracotta, Sage, Limestone and Slate**.

The default game uses this style for **all 219 ordinary downtown apartment buildings**, including corners and CAFE lots. Corner buildings get matching windows and storefronts on both streets. Cafe signs and the two hotel landmarks are retained; houses, parks and services keep their own models.

Wall-to-wall gaps now vary between **75% and 100% of the starter taxi width** (4.35–5.8 world units), with the same seeded variation on each reload. The lot planner applies the spacing to both geometry and colliders while preserving street alignment and service clearances. Existing visible fences and static collision sizing prevent driving through the gaps.

## Files and runtime cost

- `apartment.blend`: editable facade modules, four assembled color studies, and a separate preview studio.
- `apartment-kit.glb`: only the four facade modules. One opaque vertex-color material, no textures, lights or animations.
- `manifest.json`: color roles, four palettes and module dimensions.
- `preview-colors.png`: Blender studio view. Its lighting differs from the game.
- `preview-game.png` / `preview-before.png`: actual game comparison.
- `src/world/assets/apartment.json` at the repository root: generated runtime kit (about 6.4 KB before compression).

The model is assembled once during world generation, then merged into the city's existing material/chunk batches. Repeated floors use the same authored module; heights and widths adapt to existing lots. Colors are vertex colors, **not four additional materials**. The source GLB and Blender studio are not downloaded by the game, and ordinary builds require no Blender installation or model-loader dependency.

The four module triangle counts are 30 (upper bay), 50 (shop), 30 (entrance), and 12 (cornice segment). **These are not the triangle count of a whole building.** A complete apartment repeats the window bays and adds closed sides/roof. Before the later service-asset pass, the four-building trial added 2,572 world triangles, from 212,894 to 215,466 (+1.21%), with the same 121 world batches. Those are the apartment comparison’s historical counts, not the combined build’s totals. See `design docs/Blender apartment performance.md` for measured frame times and the larger rollout experiment.

## Regenerate and edit

Run from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/blender/create_apartment.py
/Applications/Blender.app/Contents/MacOS/Blender --background assets/buildings/apartment-prototype/apartment.blend --python scripts/blender/render_apartment.py
npm run assets:apartment
npm run assets:apartment:check
npm run build
```

The generator replaces the named `Apartment Prototype` scene; save a copy of hand edits before regenerating. Through the Blender console/MCP, set `APARTMENT_OUTPUT` to the absolute asset directory first. Normal development uses the prepared JSON and does not regenerate or overwrite the Blender file.

For manual edits, export only the four named `Apartment_*` modules with transforms applied and the original color-role palette. Keep them opaque and use the manifest's named role colors. Update the manifest triangle counts when geometry changes, then run `assets:apartment`. The preparer rejects incompatible materials, transformed nodes, textures and animation. Preserve the editable `.blend`, GLB, manifest, generator and prepared JSON in backups.

## Integration constraints

- Blender Z is up and -Y is the street-facing side. glTF uses Y up and +Z front. The offline adapter reflects Z for the game's local -Z facade convention and left-handed winding. Normals are recomputed after module placement/mitering.
- Windows are actual openings closed with opaque recessed glass. Wall panels end around the opening. Do not add full backing walls, overlapping glass decals or trim boxes with coincident surfaces.
- Cornice corners meet in mitered rings. Side overhangs are clamped to one-quarter of the adjacent alley clearance, including the smallest 0.5-unit gap.
- Alley/courtyard walls remain simple closed walls. Corner return facades reuse the same kit, with a flat profile under the existing mitered cornice; only the primary facade projects. Hotel landmarks retain their specialized design.
- Geometry is generated once, not per frame. Collision remains the existing simple footprint. Do not use facade triangles for physics.

## Compare and configure

`GAME_CONFIG.graphics.apartmentModel` in `src/game/config.ts` selects `all` (default), `pilot`, or `procedural`. `apartmentPilot` sets the block, facing and number of trial buildings. Modes are fixed when the world is built; reload after changing them.

- `/?debug&apartments=procedural`: previous buildings.
- `/?debug&apartments=pilot`: four-color trial.
- `/?debug&apartments=all`: the default full apartment streetscape, including corners and cafes.

Original graphics mode remains procedural. The developer switches do not change saves or progression. Use `scripts/check-apartments.cjs` for same-camera visual/structural checks and `scripts/benchmark-apartments.cjs` for full-simulation and facade-render measurements; both use optional external Playwright, not a shipped dependency.

## Full rollout review

`preview-rollout-row.png`, `preview-rollout-corner.png` and `preview-rollout-gap.png` show the current game. `rollout-check.json` records the lightweight comparison. With the new gaps and service models, the default city has **366,136 triangles and 112 static world meshes**, with no extra materials/textures compared with procedural apartments. The configured art ceilings are 380,000 for the world and 2,400 per building (including two-facade corners). This is a larger geometry allocation, not a measured FPS guarantee.

The production build and 23 focused layout/geometry checks passed. A browser review covered all three styles, identical world layout/colliders across style switches, street/corner views and a taxi attempting to drive through a gap. Extensive frame-time benchmarking remains deferred at the creator’s request. Earlier four-building timing results are historical.

Gap tuning is in `GAME_CONFIG.world.buildings.downtownGapMinTaxiWidths` and `downtownGapMaxTaxiWidths`. It uses the starter taxi's actual catalog width, so changing the currently equipped car never reshapes the city. No progression reset is required; reload the game to generate the updated streetscape.
