import { setup } from "xstate";

export type PlayerEvent =
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "STOP" };

// The same machine as the last section, unchanged. Nothing in here knows that
// opening a stream is work, or that the work can fail.
export const player = setup({
  types: {} as { context: Record<string, never>; events: PlayerEvent },
}).createMachine({
  id: "player",
  initial: "stopped",
  context: {},
  states: {
    stopped: { on: { PLAY: "playing" } },
    playing: { on: { PAUSE: "paused", STOP: "stopped" } },
    paused: { on: { PLAY: "playing", STOP: "stopped" } },
  },
});
