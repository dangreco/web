import { createActor } from "xstate";
import { Effect, Fiber } from "effect";
import { renderMachineFlow } from "@pg/flow";
import { player } from "./machine.ts";
import { openStream } from "./stream.ts";

export default function main(target: HTMLElement): () => void {
  const actor = createActor(player);
  const stop = renderMachineFlow(target, { machine: player, actor });

  const log = target.querySelector<HTMLElement>("[data-log]");
  const say = (line: string) => {
    if (log) log.textContent = line;
  };

  // Both outcomes become symbols the machine already knows. Once StreamFailed is
  // handled the error channel is `never` -- there is no longer a way for this
  // work to finish that δ has not been asked about.
  const load = openStream.pipe(
    Effect.andThen((stream) =>
      Effect.sync(() => {
        say(`opened ${stream}`);
        actor.send({ type: "OPENED" });
      })
    ),
    Effect.catchTag("StreamFailed", (error) =>
      Effect.sync(() => {
        say(`HTTP ${error.status} -- reported as FAILED`);
        actor.send({ type: "FAILED", reason: `HTTP ${error.status}` });
      })),
  );

  let fiber: Fiber.RuntimeFiber<void, never> | null = null;
  const callOff = () => {
    if (!fiber) return;
    Effect.runFork(Fiber.interrupt(fiber));
    fiber = null;
  };

  const onClick = (event: Event) => {
    const type = (event.target as HTMLElement).dataset?.send;
    if (
      type !== "PLAY" && type !== "PAUSE" && type !== "STOP" && type !== "RETRY"
    ) return;

    const before = actor.getSnapshot().value;
    actor.send({ type });
    const after = actor.getSnapshot().value;

    if (after === before) {
      say(`${type} refused in ${String(before)}`);
      return;
    }
    if (after === "loading") {
      say("opening stream...");
      fiber = Effect.runFork(load);
    }
    // Leaving `loading` by pressing Stop calls the request off -- the
    // cancellation the last section had no way to express.
    if (after === "stopped") {
      callOff();
      say("stopped, request cancelled");
    }
  };
  target.addEventListener("click", onClick);

  return () => {
    target.removeEventListener("click", onClick);
    callOff();
    stop();
  };
}
