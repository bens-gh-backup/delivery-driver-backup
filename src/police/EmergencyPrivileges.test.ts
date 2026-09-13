import { describe, expect, it } from "vitest";
import { policeInputForAmbulance } from "./EmergencyPrivileges";

describe("ambulance emergency privileges", () => {
  const rates = { speeding: 4, wrongSide: 3, sidewalk: 2, total: 9 };
  const severity = { speeding: .8, wrongSide: .7, sidewalk: .4, combined: .8 };
  it("removes speeding and wrong-way enforcement while preserving sidewalk driving", () => {
    expect(policeInputForAmbulance(rates,severity,true)).toEqual({
      rates:{speeding:0,wrongSide:0,sidewalk:2,total:2},
      severity:{speeding:0,wrongSide:0,sidewalk:.4,combined:.4},
    });
  });
  it("returns ordinary enforcement outside ambulance jobs", () => {
    expect(policeInputForAmbulance(rates,severity,false)).toEqual({rates,severity});
  });
});
