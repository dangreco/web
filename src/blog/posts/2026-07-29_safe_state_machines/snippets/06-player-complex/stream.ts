import { Data, Duration, Effect } from "effect";

export class StreamFailed extends Data.TaggedError("StreamFailed")<{
  readonly status: number;
}> {}

let attempts = 0;

/** Fails the first time only, so the red path is reachable from the buttons. */
export const openStream: Effect.Effect<string, StreamFailed> = Effect.gen(
  function* () {
    yield* Effect.sleep(Duration.millis(700));
    attempts += 1;
    return attempts === 1
      ? yield* Effect.fail(new StreamFailed({ status: 504 }))
      : "stream#42";
  },
);

/** Refilling the buffer always works, it just takes a moment. */
export const refill: Effect.Effect<void> = Effect.sleep(Duration.millis(800));
