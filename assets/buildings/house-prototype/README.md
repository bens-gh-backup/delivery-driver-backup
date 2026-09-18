# Neighborhood bungalow experiment

Editable source: `house.blend`. Four complete, opaque, flat-shaded models: one- and two-floor houses in each detail tier. Front is game-local -Z. All porch steps, gutters, chimney, railings, shutters and windows are part of the one mesh, not runtime attachments.

| Export | Complete triangles |
| --- | ---: |
| house-3k-1floor | 1,053 |
| house-3k-2floor | 1,449 |
| house-6k-1floor | 3,137 |
| house-6k-2floor | 4,233 |

“3k” and “6k” are ceilings, not polygon quotas. The higher tier adds siding bands, window mullions/sills, shutters, porch joinery, denser railings, downspouts and chimney courses. The lower tier preserves the silhouette and main architectural features. No textures, transparencies, interior rooms, dynamic shadows or imported lights are used in the game. Preview studio lights and cameras are excluded from exports.

Rebuild both neighborhood asset families in an isolated Blender process from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/blender/create_neighborhood.py -- --render
npm run assets:neighborhood
npm run assets:neighborhood:check
```

Omit `-- --render` to skip preview PNG generation. The authoring script rebuilds these generated `.blend` sources; copy a manually edited source before regenerating. `.blend`, GLB, manifest, script and prepared JSON all belong in backups. Only the prepared geometry ships in the game; normal builds require neither Blender nor a model loader.

`src/world/BlenderHouse.ts` selects floors from existing lot heights, fits the complete asset inside the original footprint, applies the four existing residential palettes, then hands it to the existing city chunk merger. Physics, front doors/paths, yards, fences, service reservations and house counts are unchanged. Nonuniform scaling uses inverse-scale normals.

Avoid placing glass over a full wall: these openings are actually cut out and inset. Roof slopes meet on shared edges. Transport pipe cross-sections through bends rather than swapping reference axes, which can twist downspout faces. Validate triangle winding/normals after export.

Selection and measurements: `design docs/Neighborhood asset performance.md`.
