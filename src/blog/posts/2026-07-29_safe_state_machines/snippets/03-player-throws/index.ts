import { createActor } from "xstate";
import { renderMachineFlow } from "@pg/flow";
import { player } from "./machine.ts";

const delay = (ms: number) => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

// Rigged to fail so the disagreement is easy to see. A real one is a fetch and a
// decoder, and its type -- Promise<Stream> -- says nothing about either failing.
async function openStream(): Promise<never> {
  await delay(400);
  throw new Error("504 from the audio host");
}

export default function main(target: HTMLElement): () => void {
  const actor = createActor(player);
  const stop = renderMachineFlow(target, { machine: player, actor });

  const log = target.querySelector<HTMLElement>("[data-log]");
  const say = (line: string) => {
    if (log) log.textContent = line;
  };

  const onClick = async (event: Event) => {
    const type = (event.target as HTMLElement).dataset?.send;
    if (type !== "PLAY" && type !== "PAUSE" && type !== "STOP") return;

    if (type !== "PLAY") {
      actor.send({ type });
      say(`${type} -> ${String(actor.getSnapshot().value)}`);
      return;
    }

    // Optimistic: the machine moves now, the actual work starts after.
    actor.send({ type: "PLAY" });
    say("opening stream...");
    try {
      await openStream();
      say("stream open");
    } catch (error) {
      // There is nowhere for this to go. Σ has no symbol for it, so δ is never
      // consulted and the diagram goes on claiming the machine is playing.
      const reason = error instanceof Error ? error.message : String(error);
      say(
        `${reason} -- but the machine still says ${
          String(actor.getSnapshot().value)
        }`,
      );
    }
  };
  target.addEventListener("click", onClick);

  return () => {
    target.removeEventListener("click", onClick);
    stop();
  };
}
