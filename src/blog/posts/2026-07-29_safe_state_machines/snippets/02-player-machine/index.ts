import { createActor, setup } from "xstate";
import { renderMachineFlow } from "@pg/flow";

type PlayerEvent = { type: "PLAY" } | { type: "PAUSE" } | { type: "STOP" };

// δ, as data. Each state carries its own row of the table, and the four cells
// that pointed back at their own row are simply absent: a state that does not
// list an event refuses it.
const player = setup({
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

export default function main(target: HTMLElement): () => void {
  const actor = createActor(player);

  // `renderMachineFlow` is this blog's diagram renderer, not part of XState. It
  // walks `states` and reads each `on` block, so every node and edge below comes
  // out of the machine above.
  const stop = renderMachineFlow(target, { machine: player, actor });

  const onClick = (event: Event) => {
    const type = (event.target as HTMLElement).dataset?.send;
    if (type === "PLAY" || type === "PAUSE" || type === "STOP") {
      actor.send({ type });
    }
  };
  target.addEventListener("click", onClick);

  return () => {
    target.removeEventListener("click", onClick);
    stop();
  };
}
