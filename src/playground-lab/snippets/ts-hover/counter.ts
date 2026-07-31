export interface Counter {
  value: number;
  bump(by: number): number;
}

export function makeCounter(start: number): Counter {
  let value = start;
  return { value, bump: (by) => (value += by) };
}
