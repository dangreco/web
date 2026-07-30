import { assign, setup } from "xstate";

// Σ has grown. The two new symbols are the outcomes of opening a stream, which
// is the whole point: a failure is now something δ can be asked about.
export type PlayerEvent =
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "STOP" }
  | { type: "OPENED" }
  | { type: "FAILED"; reason: string }
  | { type: "RETRY" };

export const player = setup({
  types: {} as {
    // The reason rides in context, not in a state. There is one `failed` state,
    // not one per HTTP status.
    context: { reason: string | null };
    events: PlayerEvent;
  },
}).createMachine({
  id: "player",
  initial: "stopped",
  context: { reason: null },
  states: {
    stopped: { on: { PLAY: "loading" } },
    loading: {
      on: {
        OPENED: "playing",
        FAILED: {
          target: "failed",
          actions: assign({ reason: ({ event }) => event.reason }),
        },
        // Changing our mind while it is still opening is a legal move.
        STOP: "stopped",
      },
    },
    playing: { on: { PAUSE: "paused", STOP: "stopped" } },
    paused: { on: { PLAY: "playing", STOP: "stopped" } },
    // The tag is what paints this node red in the diagram.
    failed: { tags: ["error"], on: { RETRY: "loading", STOP: "stopped" } },
  },
});
