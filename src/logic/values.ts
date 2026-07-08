// The 5-value logic system, matching CedarLogic's logic_values.h.
// (Plain const object rather than an enum so Node's native type
// stripping can run the sim core directly for tests.)
export const State = {
  ZERO: 0,
  ONE: 1,
  HI_Z: 2,
  CONFLICT: 3,
  UNKNOWN: 4,
} as const;

export type State = (typeof State)[keyof typeof State];
