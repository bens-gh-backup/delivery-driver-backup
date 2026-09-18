# Injured passenger

Static low-poly person lying on their back, one bent knee, a hand over the abdomen and a white forehead bandage. No gore, skeleton, animation, texture or pedestrian collider. **1,012 triangles / 1,874 exported vertices**, four palettes, one shared opaque runtime material. Three patients are instantiated citywide by default (3,036 visible-model triangles before normal culling).

`patient.blend` is the editable source. `patient.glb` contains only the person; the studio is excluded. `manifest.json` stores color roles and palettes, and `src/passengers/assets/patient.json` is the preconverted game geometry. The inherited `sourceHeight` records the person's standing anatomical height; the exported bounds describe the actual lying pose. Patient and taxi passenger share the same world scale. The entire lying footprint clears the curb, buildings and service entrances.

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/blender/create_patient.py
npm run assets:patient
npm run assets:patient:check
```

Regeneration replaces this prototype; preserve hand edits first. Source, GLB, manifest, script and runtime JSON should travel together in backups. `preview-studio.png` shows the neutral asset; `preview-game.png` uses actual city lighting. See `design docs/Curbside ambulance implementation.md` for gameplay tuning.
