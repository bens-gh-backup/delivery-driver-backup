import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import { addServiceFascia, serviceSignMaterial } from "./ServiceSigns";

describe("service signs", () => {
  it("separates all four lettering faces from their backing, retaining normal occlusion", () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const material = serviceSignMaterial(scene, "GAS");
    const faces = addServiceFascia(scene, "sign", 100, 10, -200, 34, 24, 22, 4, material);
    // Tiny near-coplanar offsets caused flickering with the long-range driving camera.
    for (const face of faces) {
      face.computeWorldMatrix(true);
      const bounds = face.getBoundingInfo().boundingBox;
      expect(bounds.maximumWorld.z < -212.5 || bounds.minimumWorld.z > -187.5
        || bounds.maximumWorld.x < 82.5 || bounds.minimumWorld.x > 117.5).toBe(true);
      expect(face.material).toBe(material);
    }
    expect(material.disableDepthWrite).toBe(false);
    expect(material.zOffset).toBeLessThan(0);
    scene.dispose(); engine.dispose();
  });
});
