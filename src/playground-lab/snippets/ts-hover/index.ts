import { makeCounter } from "./counter.ts";

export default function main(_target: HTMLElement): void {
  const c = makeCounter(3);
  console.log("bumped to", c.bump(4));
}
