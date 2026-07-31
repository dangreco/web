import { bar, line, scatter } from "@pg/charts";

// Each call returns a disposer (it holds theme/resize observers); aggregate them
// so a re-Run drops the previous charts cleanly instead of leaking.
export default function main(_target: HTMLElement): () => void {
  const cleanups = [
    bar(
      { labels: ["Q1", "Q2", "Q3", "Q4"], values: [12, 19, 7, 23] },
      { title: "Revenue" },
    ),
    line(
      [[0, 1], [1, 4], [2, 9], [3, 16], [4, 25]],
      { title: "squares", color: "var(--syn-type)" },
    ),
    scatter(
      [[0, 0.8], [1, 2.1], [2, 3.7], [3, 3.9], [4, 5.2]],
      { title: "noisy" },
    ),
  ];
  return () => cleanups.forEach((c) => c());
}
