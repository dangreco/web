// Scroll-spy for the post table of contents. The active section is marked by a
// single absolutely-positioned bar per list rather than a class on each entry:
// moving one box is cheaper than restyling every row, and it gives the
// transition something continuous to travel along.

// Matches the headings' scroll-margin-top (5.5rem), so the section that a TOC
// jump lands on is the section the bar claims.
const OFFSET = 88;

interface TocView {
  root: HTMLElement;
  marker: HTMLElement;
  links: Map<string, HTMLElement>;
}

const headings = Array.from(
  document.querySelectorAll<HTMLElement>(".prose h2[id]"),
);

const views: TocView[] = Array.from(
  document.querySelectorAll<HTMLElement>("[data-toc]"),
).flatMap((root) => {
  const marker = root.querySelector<HTMLElement>("[data-toc-marker]");
  if (!marker) return [];

  const links = new Map<string, HTMLElement>();
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
    links.set(decodeURIComponent(link.hash.slice(1)), link);
  }

  return [{ root, marker, links }];
});

function currentId(): string | undefined {
  const first = headings[0];
  const last = headings[headings.length - 1];
  if (!first) return undefined;

  // The final section is often too short to ever cross the offset line, so the
  // bottom of the page claims it outright.
  const atBottom = globalThis.innerHeight + globalThis.scrollY >=
    document.documentElement.scrollHeight - 2;
  if (atBottom) return last.id;

  let active = first.id;
  for (const heading of headings) {
    if (heading.getBoundingClientRect().top > OFFSET + 1) break;
    active = heading.id;
  }
  return active;
}

function render(id: string | undefined): void {
  for (const { root, marker, links } of views) {
    for (const link of links.values()) link.removeAttribute("aria-current");

    const active = id ? links.get(id) : undefined;

    // A collapsed <details> has no geometry to measure; leave the bar hidden
    // until the disclosure opens and fires its toggle.
    if (!active || root.getBoundingClientRect().height === 0) {
      marker.removeAttribute("data-active");
      continue;
    }

    active.setAttribute("aria-current", "true");
    marker.style.transform = `translateY(${active.offsetTop}px)`;
    marker.style.height = `${active.offsetHeight}px`;
    marker.setAttribute("data-active", "");
  }
}

let queued = false;
function schedule(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    render(currentId());
  });
}

if (headings.length && views.length) {
  globalThis.addEventListener("scroll", schedule, { passive: true });
  globalThis.addEventListener("resize", schedule);
  for (const { root } of views) {
    root.closest("details")?.addEventListener("toggle", schedule);
  }
  schedule();
}
