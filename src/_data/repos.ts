// Hand-picked repos for the homepage datasheet section. Metadata (stars,
// language, last-updated) is fetched live from GitHub at build time; the
// FEATURED list below controls only WHICH repos show and in what ORDER.

export interface Repo {
  name: string;
  description: string;
  href: string;
  language: string;
  languageColor: string;
  stars: number;
  updated: string; // human label, e.g. "Mar 2025"
  starsLabel: string; // e.g. "1.2k"
}

// ─────────────────────────────────────────────────────────────────────────
// Edit this list to change which repos appear on the homepage, and in what
// order. `repo` is "owner/name" (or just "name" for dangreco's own repos).
// `blurb` is optional — leave it out to use the repo's GitHub description.
// ─────────────────────────────────────────────────────────────────────────
const FEATURED: Array<{ repo: string; blurb?: string }> = [
  {
    repo: "unilux-uart",
    blurb:
      "Reverse-engineered UART protocol library for a smart thermostat, in C++23.",
  },
  {
    repo: "jean",
    blurb:
      "Computational-biology library for Rust: sequence alignment, genome annotation, and file I/O.",
  },
  {
    repo: "threedy",
    blurb: "Home Assistant card for live 3D-printer status and progress.",
  },
  {
    repo: "gnome-egpu",
    blurb: "eGPU switcher for GNOME, driven by udev rules.",
  },
  {
    repo: "ha-card-workbench",
    blurb:
      "Browser IDE for building and testing Home Assistant dashboard cards.",
  },
  {
    repo: "edgy",
    blurb: "Sobel edge detection implemented from scratch in Rust.",
  },
];

const USER = "dangreco";

// A few common languages; anything else gets a neutral dot.
const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Rust: "#dea584",
  Python: "#3572A5",
  C: "#555555",
  "C++": "#f34b7d",
  Go: "#00ADD8",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Nix: "#7e7eff",
  Haskell: "#5e5086",
  OCaml: "#3be133",
  Java: "#b07219",
};

function colorFor(language: string | null): string {
  if (!language) return "#8b8b8b";
  return LANGUAGE_COLORS[language] ?? "#8b8b8b";
}

function starsLabel(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

function updatedLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

// deno-lint-ignore no-explicit-any
function normalize(r: any): Repo {
  return {
    name: r.name,
    description: r.description ?? "",
    href: r.html_url,
    language: r.language ?? "n/a",
    languageColor: colorFor(r.language),
    stars: r.stargazers_count ?? 0,
    updated: updatedLabel(r.pushed_at ?? r.updated_at),
    starsLabel: starsLabel(r.stargazers_count ?? 0),
  };
}

// "owner/name" verbatim, or bare "name" → dangreco's own repo.
function resolveSlug(repo: string): string {
  return repo.includes("/") ? repo : `${USER}/${repo}`;
}

// Minimal entry so the page still builds if a repo can't be fetched (offline,
// rate-limited, renamed). Live numbers return on the next online build.
function fallbackRepo(slug: string, blurb?: string): Repo {
  const name = slug.split("/").pop() ?? slug;
  return {
    name,
    description: blurb ?? "",
    href: `https://github.com/${slug}`,
    language: "n/a",
    languageColor: colorFor(null),
    stars: 0,
    updated: "",
    starsLabel: starsLabel(0),
  };
}

async function fetchRepo(
  slug: string,
  blurb: string | undefined,
  headers: HeadersInit,
): Promise<Repo> {
  try {
    const res = await fetch(`https://api.github.com/repos/${slug}`, {
      headers,
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const repo = normalize(await res.json());
    // A hand-written blurb wins; otherwise keep GitHub's description.
    if (blurb) repo.description = blurb;
    return repo;
  } catch (err) {
    console.warn(
      `[repos] fetch failed for ${slug}, using fallback: ${
        err instanceof Error ? err.message : err
      }`,
    );
    return fallbackRepo(slug, blurb);
  }
}

async function load(): Promise<Repo[]> {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "User-Agent": "dangre.co-build",
  };
  const token = Deno.env.get("GITHUB_TOKEN");
  if (token) headers.Authorization = `Bearer ${token}`;

  // Fetch in parallel but keep FEATURED order.
  return await Promise.all(
    FEATURED.map(({ repo, blurb }) =>
      fetchRepo(resolveSlug(repo), blurb, headers)
    ),
  );
}

export default await load();
