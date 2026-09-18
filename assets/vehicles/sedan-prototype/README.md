# Everyday sedan experiment

Editable source: `sedan.blend`. A restrained older sedan, with shaped panels, rolled wheel arches, opaque glazing, supported mirrors, chamfered tires, bumpers and a grille. The high tier adds wheel hardware, finer curves, brightwork, hood creases and wipers. No cabin interior or animated wheels.

| Export | Complete mesh triangles | Including both existing signal overlays |
| --- | ---: | ---: |
| sedan-3k | 2,266 | 2,314 |
| sedan-6k | 4,978 | 5,026 |

Budgets include the baked six-triangle contact shadow and all lens geometry. The game retains its two shared indicator prototypes; ordinarily only one side blinks. No new per-car materials, lights or textures. Each of the four existing traffic paints has one shared prototype, and all matching civilian clones reuse its geometry.

Coordinates are game +Z forward, +Y up, width 5.4, length 9.4. The traffic root stays at Y=1; the tire bottoms are at local -.99 and the shadow at -.975. Lamp boxes match `vehicleLightLayout(5.4,9.4,1.5,side,front)` exactly. Their height remains fixed when the configured car footprint changes, as in the existing signal system. Keep brake/tail reds synchronized with `TAILLIGHT_COLOR`.

Rebuild:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/blender/create_neighborhood.py -- --render
npm run assets:neighborhood
npm run assets:neighborhood:check
```

The script regenerates both houses and sedans. Preserve a copy before making manual Blender edits. Retain editable sources, exports, manifest and generated runtime JSON in backups. Preview lights/cameras stay out of the export; normal game builds need no Blender or runtime loader.

Ordinary civilian traffic only: police, racers, suspect, player taxi and ambulance keep their existing models/physics. `graphics.trafficModel` or `?debug&traffic=procedural|blender3k|blender6k` changes the comparison at scene construction. See `design docs/Neighborhood asset performance.md`.
