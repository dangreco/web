import { Data, Duration, Effect, Fiber, Schedule } from "effect";

// A failure with a name. This is the whole trick: the ways this can go wrong are
// values in a union, not an anonymous `throw` somewhere down the call stack.
class StreamFailed extends Data.TaggedError("StreamFailed")<{
  readonly status: number;
}> {}

let attempts = 0;

// A *description* of a program, not a running one. The type says all three
// things at once: it yields a string, it can fail with StreamFailed, and it
// needs nothing from its environment.
const openStream: Effect.Effect<string, StreamFailed> = Effect.gen(
  function* () {
    yield* Effect.sleep(Duration.millis(120));
    attempts += 1;
    console.log(`GET /track/42 (attempt ${attempts})`);
    return attempts < 3
      ? yield* Effect.fail(new StreamFailed({ status: 504 }))
      : "stream#42";
  },
);

// Still a description. Retrying and handling are just more description, built by
// composing values -- no request has been made yet.
const program = openStream.pipe(
  Effect.retry({
    schedule: Schedule.exponential(Duration.millis(40)),
    times: 3,
  }),
  Effect.tap((stream) => Effect.sync(() => console.log(`opened ${stream}`))),
  // Until StreamFailed is handled it stays in the error channel, and the
  // compiler keeps bringing it up. Handle it and the channel becomes `never`.
  Effect.catchTag(
    "StreamFailed",
    (error) =>
      Effect.sync(() => console.error(`gave up: HTTP ${error.status}`)),
  ),
);

export default function main(): () => void {
  console.log("nothing above has run");

  // The only line that touches the world.
  const fiber = Effect.runFork(program);

  return () => {
    Effect.runFork(Fiber.interrupt(fiber));
  };
}
