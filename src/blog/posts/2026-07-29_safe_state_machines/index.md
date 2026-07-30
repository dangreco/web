---
title: Safe state machines with Effect.ts and XState
image: /assets/safe-state-machines/thumbnail.webp
tags:
  - post
---

Of all the theoretical concepts taught in my undergraduate computer science
program,
[finite state machines](https://en.wikipedia.org/wiki/Finite-state_machine)
(FSMs) are the one that has proved most useful in my professional work. At its
core, a FSM answers two questions:

1. What state you're in
2. What states you can go to

More formally, a FSM is defined as a quintuple
$\left( \Sigma, S, s_0, \delta, F \right)$, where:

- $\Sigma :=$ the input **alphabet**, the finite set of symbols the machine can
  be fed
- $S :=$ a finite, non-empty set of **states**
- $s_0 :=$ the **initial state**, where $s_0 \in S$
- $\delta :=$ the **transition function**, where
  $\delta : S \times \Sigma \rightarrow S$
- $F :=$ the possibly empty set of **terminal states**, where $F \subseteq S$

That's the same two questions written down. $S$ and $s_0$ answer _what state
you're in_, $\delta$ answers _what states you can go to_, $\Sigma$ names the
things that can happen, and $F$ says which states -- if any -- count as an
ending.

The detail worth pausing on is that $\delta$ is a **total** function: it is
defined for _every_ pair in $S \times \Sigma$, which means no event can arrive
without an answer for it. That property is the whole reason this post exists,
and it is the first thing a hand-rolled state machine throws away.

## An example

Imagine the transport controls on a media player -- the three buttons every
audio API has ever shipped. The player is stopped, playing, or paused, and the
only things we can do to it are $\texttt{PLAY}$, $\texttt{PAUSE}$, and
$\texttt{STOP}$. That is the entire machine, and there is nothing else to know
about it.

We can represent this as a FSM!

- $\Sigma := \lbrace \texttt{PLAY}, \texttt{PAUSE}, \texttt{STOP} \rbrace$
- $S := \lbrace \texttt{STOPPED}, \texttt{PLAYING}, \texttt{PAUSED} \rbrace$
- $s_0 := \texttt{STOPPED}$
- $F := \emptyset$

$F$ is empty because a player is an ongoing service -- it never _stops_, so no
state is an ending. $\texttt{STOPPED}$ looks like one, but we can always leave
it by playing again. Terminal states earn their keep when you want to ask "did
this input end up somewhere acceptable?" In this example, though, all states are
acceptable.

That leaves $\delta$:

| $\delta$           | $\texttt{PLAY}$    | $\texttt{PAUSE}$   | $\texttt{STOP}$    |
| ------------------ | ------------------ | ------------------ | ------------------ |
| $\texttt{STOPPED}$ | $\texttt{PLAYING}$ | $\texttt{STOPPED}$ | $\texttt{STOPPED}$ |
| $\texttt{PLAYING}$ | $\texttt{PLAYING}$ | $\texttt{PAUSED}$  | $\texttt{STOPPED}$ |
| $\texttt{PAUSED}$  | $\texttt{PLAYING}$ | $\texttt{PAUSED}$  | $\texttt{STOPPED}$ |

It looks more complicated than it is. The rows correspond to our **current
state**, and the values in each column tell us our **next state** (the value of
the column) if we encounter some **input** (the column).

For example, if we are $\texttt{PLAYING}$, the rules according to the table are:

- If we $\texttt{PLAY}$, we should keep $\texttt{PLAYING}$
- If we $\texttt{PAUSE}$, we should be $\texttt{PAUSED}$
- If we $\texttt{STOP}$, we should be $\texttt{STOPPED}$

This FSM can be represented visually with a flow chart, where each node is some
state $\left(s \in S \right)$ and each directed edge is a transition according
to our function $\delta : S \times \Sigma \rightarrow S$:

<div data-pg-embed snippet="00-player" code="hidden">
  <button data-send="PLAY">Play</button>
  <button data-send="PAUSE">Pause</button>
  <button data-send="STOP">Stop</button>
</div>

## Doing it by hand

Nine cells is not a lot to write down, and the first attempt usually doesn't try
to. It reaches for one boolean per thing that feels like a mode:

<div data-pg-embed snippet="01-player-by-hand"></div>

The first line of output is the problem. Our table says
$\delta \left( \texttt{STOPPED}, \texttt{PAUSE} \right) = \texttt{STOPPED}$ --
pausing a stopped player does nothing at all. What the code does instead is set
`isPaused` on a player that was never playing, leaving a pair of booleans that
names no state in $S$.

Nothing there is wrong in the sense the compiler cares about, and that's the
point. Two booleans admit $2^2 = 4$ combinations while $|S| = 3$, so one
combination is surplus before we write a single transition. We asked for three
states and built four!

That gap is where things get out of hand. Add buffering -- one more flag, one
more state we genuinely meant -- and the encoding admits $2^3 = 8$ combinations
for $|S| = 4$: four unnamed states, up from one. Each flag _doubles_ the space
of things that can be true while adding a single state we wanted, so the
nonsense grows as $2^k - |S|$ and the compiler stays quiet about all of it.

The fix for that particular disease is to stop spelling a state as a tuple of
independent flags and name it directly:

```typescript
type State = "stopped" | "playing" | "paused";

let state: State = "stopped";

function play() {
  switch (state) {
    case "stopped":
      state = "playing";
      break;
    case "paused":
      state = "playing";
      break;
      // "playing" is missing, and this still compiles.
  }
}
```

Now the representable states are exactly $S$ and the surplus is gone for good.
But look at what happened to $\delta$. It used to be a table we could read a row
at a time; it is now smeared across one function per symbol, and the property
that made the table worth trusting -- that _every_ pair in $S \times \Sigma$ has
an answer -- isn't written down anywhere any more. That missing `"playing"`
branch is a hole in $\delta$, and nothing reported it.

This growth is gentler than the boolean version, but it still runs the wrong
way. $\delta$ owes an answer for $|S| \times |\Sigma|$ pairs: nine for the
player. Add that buffering state and a $\texttt{SEEK}$ input and it's
$4 \times 4 = 16$, spread over four functions, each free to forget a state on
its own. The table grows at exactly the same rate -- the difference is that a
table with a hole in it looks like a table with a hole in it.

## Representing this in code with XState

Both attempts went wrong in the same place: $\delta$ stopped being a thing and
became a behaviour. [XState](https://stately.ai/docs/xstate) hands it back. A
machine is an object, the states are its keys, and each state carries its own
row of the table:

<div data-pg-embed snippet="02-player-machine">
  <button data-send="PLAY">Play</button>
  <button data-send="PAUSE">Pause</button>
  <button data-send="STOP">Stop</button>
</div>

Every part of the quintuple has somewhere to live:

- $S$ is the set of keys under `states`
- $s_0$ is `initial`
- $\Sigma$ is the event union handed to `setup({ types })`
- $\delta$ is the `on` block belonging to each state
- $F$ is the states marked `type: "final"` -- none here, so $F = \emptyset$

Two of those carry weight the hand-rolled versions could not. $\Sigma$ is a
type, so `actor.send({ type: "SEEK" })` doesn't compile -- the alphabet is
checked rather than hoped for. And $\delta$ is a single value, which is the only
reason the diagram exists: the picture is not an illustration of the machine, it
is rendered from it, by walking `states` and reading each `on`. Delete the
$\texttt{STOP}$ line from `paused`, run it again, and an edge disappears!

That leaves the count. Five transitions for nine cells, and the four that are
missing are exactly the self-loops. Leaving them out is deliberate: a state that
doesn't list an event refuses it. Refusing is how this machine spells "ignore
it", and it's a stronger claim than a self-loop -- no transition is taken at
all, so the state is never exited and re-entered, and anything we later attach
to entering it will not run. Press **Pause** while the player is stopped and the
diagram doesn't so much as flicker.

Which is the part worth keeping hold of. We did not gain the nine answers by
writing them out; we gained them by making $\delta$ a value again, so the four
we left out are a visible absence rather than a branch nobody wrote.

## Where the symbols come from

There is a question the quintuple never asks. $\delta$ is total over
$S \times \Sigma$, which is a promise about what to do with a symbol _once we
have it_ -- and nothing in $\left( \Sigma, S, s_0, \delta, F \right)$ says where
symbols come from or what it costs to produce one.

So far that has been free. The symbols came from three buttons, and a button
click cannot fail -- it either happened or it didn't, which is exactly why the
machine looked finished. Let $\texttt{PLAY}$ mean what it means in a real player
(open the stream, hand it to a decoder, start the clock), and the thing
producing our symbols becomes a function that can throw:

```typescript
async function play() {
  const stream = await openStream(trackId); // network: can reject
  await decoder.start(stream); //              codec: can throw
  actor.send({ type: "PLAY" });
}
```

Now there is no good place to put that `send`. Below the work, as above, and
there is a window where the reader has asked to play and the machine still says
$\texttt{STOPPED}$ -- so the button is live and a second press queues a second
stream. Above the work, and the machine announces $\texttt{PLAYING}$ before
anything is playing. Press **Play** below and watch which of those two the
optimistic version buys:

<div data-pg-embed snippet="03-player-throws">
  <button data-send="PLAY">Play</button>
  <button data-send="PAUSE">Pause</button>
  <button data-send="STOP">Stop</button>
  <p class="pg-log not-prose" data-log></p>
</div>

The diagram is wrong and stays wrong. It isn't a bug in $\delta$ -- $\delta$ was
never consulted, because the failure never became a symbol. Two booleans let us
reach a state that no element of $S$ named; a rejected promise is a _transition_
that no element of $\Sigma$ names. Same hole, one axis over. And note that the
machine did not _refuse_ the failure, which would at least have been an answer.
It never heard about it.

The FSM can be taught about this, and it should be. Add a $\texttt{LOADING}$
state, add $\texttt{OPENED}$ and $\texttt{FAILED}$ to $\Sigma$, and the lie
becomes unrepresentable: nothing can claim to be playing until the stream says
so. That is the formalism working. It is also $|S| \times |\Sigma|$ doing what
it does -- four states and five symbols is twenty answers owed, up from nine --
and every _further_ failure mode we care to distinguish is another symbol
multiplied across every state.

The arithmetic is fine; we signed up for it. What isn't fine is that nothing
made us do it. `openStream` has type `(id: string) => Promise<Stream>`, and that
type is silent about the 504, about the codec, about every other way it can end.
We named $S$ and we named $\Sigma$, and the failures are still anonymous -- so
the compiler cannot tell us we forgot $\texttt{FAILED}$, any more than it told
us about the missing `"playing"` branch.

There is a second thing that type is quiet about. If the reader presses **Stop**
while the stream is still opening, the work carries on and eventually reports
back -- and neither $\delta$ nor `openStream` knows the difference between "the
stream opened" and "the stream opened, but nobody wants it now".

What we're missing is a way to describe the work that produces symbols with the
same rigour we used on the machine: what it needs, what it yields, what it can
fail with, and whether it can be called off -- all in the type, where forgetting
one is a compile error rather than a silent hole. That is the gap
[Effect.ts](https://effect.website/) fills.

## A primer on Effect

Effect is a big library with a small idea at the bottom of it, and the small
idea is the only part we need. An `Effect<A, E, R>` is a _description_ of a
program: it yields an `A`, it can fail with an `E`, and it needs an `R` to run.
Building one runs nothing. It is a value, in the way a recipe is a value and a
cooked dinner is not.

Compare that to the thing we had. A `Promise<Stream>` is already running by the
time we are holding it, and it has exactly one type parameter: the happy one.
How it fails is not written down, because JavaScript has never had a way to
write it down -- `throws` is not part of a signature. Effect's middle parameter
is that missing half of the type.

<div data-pg-embed snippet="04-effect-basics"></div>

Two things in there are worth pointing at. The first is that `openStream` and
`program` are just definitions -- the retry policy and the error handling are
built by composing values, and the log line proves nothing has happened yet.
Nothing actually touches the world except the `Effect.runFork` line, at the
edge, once. That is the ordinary functional trade: keep the middle of the
program pure and push the effects out to a boundary you can point at.

The second is `Data.TaggedError`. It gives a failure a `_tag`, which makes the
ways a program can go wrong into a discriminated union -- something we can
enumerate, match on, and be told about when we miss a case. `Effect.catchTag`
takes one member out of that union, and until every member is handled the `E`
channel is not empty and the compiler will keep saying so.

Which is exactly the sentence the last section was missing. Our failures were
anonymous, and a symbol is nothing more than a name. Give the failures names and
they can be symbols!

## Errors as symbols

So let's do what we said. $\texttt{LOADING}$ joins $S$, $\texttt{OPENED}$ and
$\texttt{FAILED}$ join $\Sigma$, and the two channels of the Effect are wired to
the two new symbols:

```typescript
const load = openStream.pipe(
  Effect.andThen((stream) => Effect.sync(() => actor.send({ type: "OPENED" }))),
  Effect.catchTag(
    "StreamFailed",
    (error) =>
      Effect.sync(() =>
        actor.send({ type: "FAILED", reason: `HTTP ${error.status}` })
      ),
  ),
);
```

That is the whole integration, and the important part is what its type says.
`openStream` could fail with `StreamFailed`; `load` cannot fail at all. Handling
the tag emptied the error channel, so `load` has type `Effect<void, never>` --
there is no remaining way for this work to finish that the machine has not been
told about. $\delta$ was total over $S \times \Sigma$ all along; what changed is
that $\Sigma$ now covers everything that can actually happen!

<div data-pg-embed snippet="05-effective-player">
  <button data-send="PLAY">Play</button>
  <button data-send="PAUSE">Pause</button>
  <button data-send="STOP">Stop</button>
  <button data-send="RETRY">Retry</button>
  <p class="pg-log not-prose" data-log></p>
</div>

Press **Play**. The machine goes to $\texttt{LOADING}$ and _stays there_ -- it
no longer claims to be playing something that has not loaded. That first attempt
is rigged to fail, so a moment later the red node lights up, because
$\texttt{FAILED}$ arrived and $\delta$ had an answer for it. **Retry** goes
round again and succeeds. Nothing lies at any point, and no state in the diagram
is one we invented to hold a mistake.

Note where the HTTP status went. It is in `context`, not in the state: there is
one $\texttt{FAILED}$ state, not one per status code. States are for the shape
of the machine, context is for the data it carries -- the same split that
stopped two booleans from turning into four states.

The other silence is closed too. `Effect.runFork` hands back a fiber, so
pressing **Stop** while the stream is still opening interrupts it. The request
is called off rather than left to land later and be ignored, which means there
is no window where a stale success can arrive and argue with the state we are
now in.

## A player worth shipping

Three states was enough to make the argument, but not enough to be a player:
real ones stall in the middle of a track, seek, reach the end, and fail. Adding
those takes $S$ to seven and $\Sigma$ to ten:

<div data-pg-embed snippet="06-player-complex">
  <button data-send="PLAY">Play</button>
  <button data-send="PAUSE">Pause</button>
  <button data-send="SEEK">Seek</button>
  <button data-send="STALL">Stall</button>
  <button data-send="ENDED">End</button>
  <button data-send="STOP">Stop</button>
  <button data-send="RETRY">Retry</button>
  <p class="pg-log not-prose" data-log></p>
</div>

Seventy cells, eighteen of them written down. The other fifty-two are refusals,
and they are refusals we can see: the diagram has no edge for $\texttt{STALL}$
out of $\texttt{PAUSED}$ because a paused track cannot run out of buffer.

Notice a distinction that the boolean version could not have kept. Stalling and
pausing both stop the audio, and they are not the same thing -- one is the
network's fault and one is the listener's decision, they exit on different
symbols, and only one of them should light the play button back up. Two flags
would have smeared them into `!isPlaying` and left the difference in a comment.

At this size a second kind of hole opens up, though. It is no longer only
$\delta$ that owes an answer for every case: every state also has to say what
_work_ it sets in motion. Which is a total function from $S$ again, so it can be
written as one:

```typescript
const workFor: Record<PlayerValue, Effect.Effect<void>> = {
  stopped: Effect.void,
  loading: onOpened,
  playing: Effect.void,
  buffering: onRefilled,
  paused: Effect.void,
  ended: Effect.sync(() => say("track ended")),
  failed: Effect.sync(() => say(`failed: ${reason()}`)),
};
```

`Record<PlayerValue, ...>` demands every key, so adding an eighth state stops
this compiling until we have said what it starts. And `Effect.void`, "nothing at
all", is a perfectly good answer that we still had to write. That is the
self-loop lesson one layer out: the value of totality is not that every answer
is interesting, but that no answer is missing.

Being a table of values rather than a pile of callbacks is what makes it a table
at all, incidentally. An `Effect` is inert, so the work each state starts can
sit in a `Record` and be looked up -- which is only possible because building
one does nothing. Cancellation then falls out of the lookup: leaving a state
interrupts whatever that state started, so seeking away from a load does not
race with it.

## Where this pays off

Four moves, and each one turns a class of bug into a compile error. Name the
states, so nonsense combinations stop being representable. Do the same for the
symbols, so the events are checked rather than hoped for. Keep $\delta$ a value,
so the holes in it stay visible. Put the failure modes in the type, so they
become symbols and $\delta$ has to answer them.

A media player is a bad advertisement for all of this, because you can hold it
in your head. The technique starts paying at exactly the point where you cannot.

What I actually reach for it for at work is conditional form validation, which
is a state machine wearing a very convincing disguise. A form is `editing`, then
`validating`, then `invalid` or `submitting`, then `rejected` or `submitted`,
and the events are the things a person does to it. The boolean-soup failure mode
is endemic there: `isDirty`, `isValidating`, `hasErrors`, `isSubmitting`,
`submitFailed` is five flags and $2^5 = 32$ combinations, of which about six
mean anything, and "can this be submitted?" ends up as a conjunction that nobody
can audit and everybody is slightly afraid of.

Conditionals are where $\delta$ earns its keep. Which fields matter depends on
answers given earlier -- pick a business account and three new fields become
required, or pick a country and the postcode rule changes underneath you. As
guards on transitions, those rules are one object you can read top to bottom,
and a reviewer can be handed the diagram and asked whether it looks right. But
as `if` statements spread across change handlers, the rules do not exist in any
one place at all, and the only way to find out what the form does is to run it.

Then the async ones make it the previous problem exactly. Checking whether an
email is taken, whether an address resolves, whether a discount code is live:
all of them are functions that emit transition inputs and can fail, and their
failure modes are genuinely different. "This value is taken" and "the service is
down" want different states, different messages, and different retry behaviour.
Untyped, they collapse into one `catch` that puts a red border on a field and
tells the user to try again. Typed, they are separate symbols, and $\delta$ has
to have something to say about each of them.

And cancellation stops being an afterthought. Someone keeps typing while a
uniqueness check is in flight; the check for what they typed four keystrokes ago
resolves and paints an error for a value that no longer exists. That bug is
everywhere, and it is the same bug as a stale stream landing after **Stop**.
Fork the check, interrupt it when the field changes, and the stale answer never
arrives to argue.

None of which comes free. Both libraries have a real learning curve, and the
machine will try to become a god object if you let it -- the discipline is to
keep the shape in states and the data in context, and to stop when the shape is
described. A login form with two fields does not need any of this, and reaching
for it there is how the pattern earns a bad name.

But there is nothing new in it. It is the same quintuple from the top of this
post, taken literally instead of admiringly: a finite set of states, a finite
alphabet of things that can happen, and one function that has an answer for
every pair. The libraries are just the part that makes the compiler hold us to
it.
