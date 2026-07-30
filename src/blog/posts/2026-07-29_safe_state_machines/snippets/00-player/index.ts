import { createActor } from "xstate";
import { renderMachineFlow } from "@pg/flow";
import { player } from "./machine.ts";

export default function main(target: HTMLElement): () => void {
  const actor = createActor(player);
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
