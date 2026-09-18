# Blender ambulance

White and teal ambulance with a distinct cab, a taller patient compartment, opaque windows, wheel arches, side medical emblems, split rear doors, steps, mirrors, grille and a red/blue light bar. The windows and large stripes tile the body surfaces instead of overlapping coplanar faces.

**1,422 source triangles / 1,428 runtime triangles**, including six triangles for the contact shadow. Three exported parts: `AmbulanceBody`, `EmergencyRed`, `EmergencyBlue`. One opaque vertex-color material in the source; the game uses one body material and two emissive lens materials (three draw calls). No textures, PBR loader, real-time light sources, rigs or animation. Both lenses remain physically visible; emission changes only at each flash transition.

`ambulance.blend` is editable, `ambulance.glb` exports only those three parts, and `budget.json` records the source budget. `src/vehicles/assets/ambulance.json` contains the offline converted geometry. All parts use the body's shared bounds/transform, preserving light placement. Rendering fits the existing ambulance footprint; collision still uses the original simple vehicle body. Original graphics retain the procedural fallback.

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/blender/create_ambulance.py
npm run assets:ambulance
npm run assets:ambulance:check
```

Regeneration replaces the prototype; preserve manual edits first. Runtime builds do not require Blender. Keep source, export, generator, converter and runtime data in backups. `preview-studio.png`, `preview-game.png` and `preview-driving.png` show source and actual game views. Camera framing lives in `camera.ambulance`; vehicle stats and mission tuning remain in `ambulanceDriver`.
