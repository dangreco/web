import { createActor } from "xstate";
import { Effect, Fiber } from "effect";
import { renderMachineFlow } from "@pg/flow";
import { player, type PlayerValue } from "./machine.ts";
import { openStream, refill } from "./stream.ts";

const SENDABLE = [
  "PLAY",
  "PAUSE",
  "STOP",
  "SEEK",
  "STALL",
  "ENDED",
  "RETRY",
] as const;

const isSendable = (
  value: string | undefined,
): value is typeof SENDABLE[number] =>
  SENDABLE.some((allowed) => allowed === value);

export default function main(target: HTMLElement): () => void {
  const actor = createActor(player);

  const log = target.querySelector<HTMLElement>("[data-log]");
  const say = (line: string) => {
    if (log) log.textContent = line;
  };

  const onOpened = openStream.pipe(
    Effect.andThen((stream) =>
      Effect.sync(() => {
        say(`opened ${stream}`);
        actor.send({ type: "OPENED" });
      })
    ),
    Effect.catchTag(
      "StreamFailed",
      (error) =>
        Effect.sync(() =>
          actor.send({ type: "FAILED", reason: `HTTP ${error.status}` })
        ),
    ),
  );

  const onRefilled = refill.pipe(
    Effect.andThen(Effect.sync(() => {
      say("buffer refilled");
      actor.send({ type: "RESUMED" });
    })),
  );

  // The work each state sets in motion: a total function from S, all over again.
  // `Record` demands every key, so adding a state to the machine stops this
  // compiling until we have said what it starts -- including when the honest
  // answer is "nothing at all".
  const workFor: Record<PlayerValue, Effect.Effect<void>> = {
    stopped: Effect.void,
    loading: onOpened,
    playing: Effect.void,
    buffering: onRefilled,
    paused: Effect.void,
    ended: Effect.sync(() => say("track ended")),
    failed: Effect.sync(() =>
      say(`failed: ${actor.getSnapshot().context.reason}`)
    ),
  };

  let current: PlayerValue | null = null;
  let fiber: Fiber.RuntimeFiber<void, never> | null = null;

  // Subscribed before the diagram starts the actor, so the initial state is seen.
  const subscription = actor.subscribe((snapshot) => {
    if (snapshot.value === current) return;
    current = snapshot.value;
    // Leaving a state calls off whatever that state had started.
    if (fiber) Effect.runFork(Fiber.interrupt(fiber));
    fiber = Effect.runFork(workFor[snapshot.value]);
  });

  const stop = renderMachineFlow(target, { machine: player, actor });

  const onClick = (event: Event) => {
    const type = (event.target as HTMLElement).dataset?.send;
    if (!isSendable(type)) return;
    const before = actor.getSnapshot().value;
    actor.send({ type });
    if (actor.getSnapshot().value === before) {
      say(`${type} refused in ${String(before)}`);
    }
  };
  target.addEventListener("click", onClick);

  return () => {
    target.removeEventListener("click", onClick);
    if (fiber) Effect.runFork(Fiber.interrupt(fiber));
    subscription.unsubscribe();
    stop();
  };
}
