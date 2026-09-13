import { GAME_CONFIG } from "../game/config";
import { PassengerType } from "../game/types";
import { pickWeighted } from "../utils/math";

export const PASSENGER_ARCHETYPES = {
  timid: { type: PassengerType.Timid, name: "Timid", text: "Must drive below 50 mph" },
  hurried: { type: PassengerType.Hurried, name: "Hurried", text: "Must drive above 25 mph" },
  lawful: { type: PassengerType.Lawful, name: "Lawful", text: "Must stop for red lights" },
  careful: { type: PassengerType.Careful, name: "Careful", text: "No U-turns" },
  shady: { type: PassengerType.Shady, name: "Shady", text: "Extra $40 if police observe no violations; pursuit forfeits all tips" },
  thrillSeeker: { type: PassengerType.ThrillSeeker, name: "Thrill-seeker", text: "Extra $50 per yellow intersection" },
  mechanic: { type: PassengerType.Mechanic, name: "Mechanic", text: "Free car repair for waived fare" },
  lawyer: { type: PassengerType.Lawyer, name: "Lawyer", text: "No fines if arrested" },
  offDutyCop: { type: PassengerType.OffDutyCop, name: "Off-duty cop", text: "Get Out of Jail Free card if you earn five stars" },
  carSalesman: { type: PassengerType.CarSalesman, name: "Car Salesman", text: "$100 off next car purchase" },
  millionaire: { type: PassengerType.Millionaire, name: "Millionaire", text: "3x higher tip, but lower ratings" },
  serviceWorker: { type: PassengerType.ServiceWorker, name: "Fellow service worker", text: "1/2 tip, but much higher ratings" },
  offGrid: { type: PassengerType.OffGrid, name: "Off-grid", text: "Extra $30 tip if you stop at a gas station" },
  compulsive: { type: PassengerType.Compulsive, name: "Compulsive", text: "Extra $30 tip for no left turns or U-turns" },
  drivingInstructor: { type: PassengerType.DrivingInstructor, name: "Driving Instructor", text: "No fare or tip; earn a free upgrade with 4+ stars" },
  psychopath: { type: PassengerType.Psychopath, name: "Psychopath", text: "Extra $200 tip for escaping a pursuit (once per ride)" },
  runningOnFumes: { type: PassengerType.RunningOnFumes, name: "Running on Fumes", text: "Extra $50 tip if fuel is below 50% at drop-off" },
  demolitionDerbyFan: { type: PassengerType.DemolitionDerbyFan, name: "Demolition Derby Fan", text: "Extra $80 tip if damage is above 30% at drop-off" },
  normal: { type: PassengerType.Normal, name: "", text: "" },
} as const;

const byType = new Map<PassengerType, { name: string; text: string }>(
  Object.values(PASSENGER_ARCHETYPES).map((definition) => [definition.type, definition]),
);

export function passengerArchetype(type: PassengerType): { name: string; text: string } {
  return byType.get(type) ?? { name: type, text: "" };
}

export function pickPassengerType(rng: () => number): PassengerType {
  return PASSENGER_ARCHETYPES[pickWeighted(rng, GAME_CONFIG.ride.archetypes.weights)].type;
}

/** Applied to the offer once so quotes, payouts and starting-tip deductions agree. */
export function passengerFareMultiplier(type: PassengerType): number {
  const fares = GAME_CONFIG.ride.archetypes.fareMultipliers;
  switch (type) {
    case PassengerType.Timid: return fares.timid;
    case PassengerType.Hurried: return fares.hurried;
    case PassengerType.Lawful: return fares.lawful;
    case PassengerType.Careful: return fares.careful;
    case PassengerType.DrivingInstructor: return 0;
    default: return 1;
  }
}
