import { assign, setup } from "xstate";
import type { SnapshotFrom } from "xstate";

export type PlayerEvent =
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "STOP" }
  | { type: "SEEK" }
  | { type: "STALL" }
  | { type: "ENDED" }
  | { type: "OPENED" }
  | { type: "RESUMED" }
  | { type: "FAILED"; reason: string }
  | { type: "RETRY" };

const toFailed = {
  target: "failed",
  actions: assign({
    reason: ({ event }: { event: { reason: string } }) => event.reason,
  }),
} as const;

export const player = setup({
  types: {} as {
    context: { reason: string | null };
    events: PlayerEvent;
  },
}).createMachine({
  id: "player",
  initial: "stopped",
  context: { reason: null },
  states: {
    stopped: { on: { PLAY: "loading" } },
    loading: { on: { OPENED: "playing", FAILED: toFailed, STOP: "stopped" } },
    playing: {
      on: {
        PAUSE: "paused",
        STOP: "stopped",
        // A stall is not a pause. Pausing is something the listener did.
        STALL: "buffering",
        SEEK: "loading",
        ENDED: "ended",
      },
    },
    buffering: { on: { RESUMED: "playing", STOP: "stopped" } },
    paused: { on: { PLAY: "playing", STOP: "stopped", SEEK: "loading" } },
    // Tags are what paint these two nodes green and red in the diagram.
    ended: { tags: ["complete"], on: { PLAY: "loading", STOP: "stopped" } },
    failed: { tags: ["error"], on: { RETRY: "loading", STOP: "stopped" } },
  },
});

export type PlayerValue = SnapshotFrom<typeof player>["value"];
