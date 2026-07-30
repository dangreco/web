import { setup } from "xstate";

export type PlayerEvent =
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "STOP" };

export const player = setup({
  types: {} as { context: Record<string, never>; events: PlayerEvent },
}).createMachine({
  id: "player",
  initial: "stopped",
  context: {},
  // Five transitions for nine cells of δ. The four missing ones are the
  // self-loops from the table: a state that does not list an event refuses it,
  // which is how "ignore it" is spelled here. PAUSE on a stopped player is
  // neither an error nor a state change -- there is simply nothing to do.
  states: {
    stopped: { on: { PLAY: "playing" } },
    playing: { on: { PAUSE: "paused", STOP: "stopped" } },
    paused: { on: { PLAY: "playing", STOP: "stopped" } },
  },
});
