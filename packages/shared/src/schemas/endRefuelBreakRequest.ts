import { z } from "zod";

// Ending a break reports what's actually on board now — either as a delta
// ("N liters were added," read off the fuel truck) or an absolute level
// ("the tank now has N liters," read off a dipstick) — the dispatcher picks
// whichever matches how they actually measured it. Exactly one, not both:
// a plain union so the handler can tell which was meant from the shape
// alone, rather than guessing when both happen to be present.
export const endRefuelBreakRequestSchema = z.union([
  z.object({ fuelOnBoardL: z.number().min(0) }),
  z.object({ deltaL: z.number().min(0) }),
]);

export type EndRefuelBreakRequest = z.infer<typeof endRefuelBreakRequestSchema>;
