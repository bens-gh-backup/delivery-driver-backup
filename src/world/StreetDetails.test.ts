import { describe, expect, it } from "vitest";
import { addPavementDetails, curbSegments, entranceApproach } from "./StreetDetails";
import { CityGeometry, type BuildingLot } from "./CityStyle";
import { vi } from "vitest";

describe("street detail placement", () => {
  it("reserves the actual doorway side for every building orientation", () => {
    const lot: BuildingLot = {x:100,z:200,width:20,depth:30,height:10,district:"residential",landmark:false,facing:0};
    const expected = [
      {x:100,z:178,halfX:3,halfZ:7}, {x:83,z:200,halfX:7,halfZ:3},
      {x:100,z:222,halfX:3,halfZ:7}, {x:117,z:200,halfX:7,halfZ:3},
    ];
    for (let facing=0;facing<4;facing++) expect(entranceApproach({...lot,facing})).toEqual(expected[facing]);
  });
  it("keeps pavement joints, gutters and grates clear of a service driveway", () => {
    const g = new CityGeometry();
    const faces = vi.spyOn(g, "face");
    addPavementDetails(g,0,0,50,[{x:0,z:-50,halfX:10,halfZ:12}],0);
    for (const [points] of faces.mock.calls) {
      const minX=Math.min(...points.map(p=>p[0])),maxX=Math.max(...points.map(p=>p[0]));
      const minZ=Math.min(...points.map(p=>p[2])),maxZ=Math.max(...points.map(p=>p[2]));
      expect(minX<10 && maxX>-10 && minZ<-38 && maxZ>-62).toBe(false);
    }
  });

  it("leaves continuous driveway openings even when service areas overlap or extend past a block", () => {
    expect(curbSegments(-50,50,[[10,20],[-70,-40],[15,30],[40,80]]))
      .toEqual([[-40,10],[30,40]]);
    expect(curbSegments(-50,50,[[-60,60]])).toEqual([]);
    expect(curbSegments(-50,50,[[60,80],[-80,-60]])).toEqual([[-50,50]]);
  });
});
