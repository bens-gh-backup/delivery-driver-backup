# Suspect pursuit vehicle

Blender-authored opaque, vertex-colored low-poly vehicle. Runtime: **1792 triangles**, 2 mesh parts, budget 3000. Count includes the six-triangle ground shadow. Suspect count includes both people. No rigs, textures, exported studio objects or real-time lights.

Regenerate both editable `.blend`, `.glb`, budget manifests and studio previews from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/create_chase_vehicles.py
npm run assets:police
npm run assets:suspect
```

Verify source/runtime consistency with `npm run assets:suspect:check`. Ordinary builds use `src/vehicles/assets/suspect.json`; Blender is not needed to play/build. The importer shares the established cab coordinate conversion, fitted footprint and opaque flat shading. The source script derives its body tooling from `create_cab.py`; retain both scripts.

Keep badges, panels and light housings physically separated from their backing geometry to avoid depth flicker. Runtime mesh ownership is tested across repeated equip/restore cycles. See `design docs/Police chase implementation.md` for gameplay and budget context.
