import { Data, Duration, Effect } from "effect";

export class StreamFailed extends Data.TaggedError("StreamFailed")<{
  readonly status: number;
}> {}

let attempts = 0;

/**
 * Fails the first time and opens after that, so both paths are reachable from
 * the buttons. The signature is the part that matters: `Effect<string,
 * StreamFailed>` cannot be run by anyone who has not said what to do about
 * StreamFailed.
 */
export const openStream: Effect.Effect<string, StreamFailed> = Effect.gen(
  function* () {
    // Long enough to press Stop while it is still in flight.
    yield* Effect.sleep(Duration.millis(900));
    attempts += 1;
    return attempts === 1
      ? yield* Effect.fail(new StreamFailed({ status: 504 }))
      : "stream#42";
  },
);
