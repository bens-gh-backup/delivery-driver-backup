import type { DrivingViolationRates, DrivingViolationSeverity } from "../game/types";

export function policeInputForAmbulance(
  rates: DrivingViolationRates,
  severity: DrivingViolationSeverity,
  active: boolean,
): { rates: DrivingViolationRates; severity: DrivingViolationSeverity } {
  if (!active) return { rates, severity };
  return {
    rates: { ...rates, speeding: 0, wrongSide: 0, total: rates.sidewalk },
    severity: { ...severity, speeding: 0, wrongSide: 0, combined: severity.sidewalk },
  };
}
