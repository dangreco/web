// The résumé is built and published by a separate repo, which drops a release
// manifest next to the artifacts in S3. Fetch it at build time so the page can
// show the live version, release date, file size, page count, and the real
// SHA-256 digests instead of just linking to checksums.txt.

const BASE = "https://dangreco-resume.s3.ca-central-1.amazonaws.com/production";

const PDF = "resume.en.pdf";
const SIGNATURE = "resume.en.pdf.asc";
const CHECKSUMS = "checksums.txt";

export interface ResumeArtifact {
  name: string;
  href: string;
  sizeBytes: number;
  sizeLabel: string; // human label, e.g. "64 KB"
  sha256: string;
  sha256Short: string; // first 24 chars, for display
}

export interface ResumeRelease {
  available: boolean; // false when the manifest could not be fetched
  version: string;
  releasedAt: string; // ISO; formatted in the template via the `date` filter
  commit: string;
  commitShort: string;
  pages: number;
  pagesLabel: string; // human label, e.g. "2 pages"
  pdf: ResumeArtifact;
  signature: ResumeArtifact;
  checksums: ResumeArtifact;
}

function href(name: string): string {
  return `${BASE}/${name}`;
}

function pagesLabel(pages: number): string {
  if (!pages) return "";
  return `${pages} page${pages === 1 ? "" : "s"}`;
}

function sizeLabel(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// The manifest is untyped at the wire; normalize it into a typed shape here and
// keep `any` confined to this boundary.
// deno-lint-ignore no-explicit-any
function findArtifact(manifest: any, name: string) {
  const artifacts: Array<{ name: string }> = manifest?.artifacts ?? [];
  return artifacts.find((a) => a.name === name) ?? null;
}

// deno-lint-ignore no-explicit-any
function normalize(a: any, name: string): ResumeArtifact {
  const sha256 = a?.sha256 ?? "";
  return {
    name,
    href: href(name),
    sizeBytes: a?.size_bytes ?? 0,
    sizeLabel: sizeLabel(a?.size_bytes ?? 0),
    sha256,
    sha256Short: sha256.slice(0, 24),
  };
}

// Enough for the page to keep working when the manifest is unreachable: the
// download and verification links still resolve, and the template hides the
// metadata it no longer has. Live values return on the next successful build.
function fallbackArtifact(name: string): ResumeArtifact {
  return normalize(null, name);
}

function fallback(): ResumeRelease {
  return {
    available: false,
    version: "",
    releasedAt: "",
    commit: "",
    commitShort: "",
    pages: 0,
    pagesLabel: "",
    pdf: fallbackArtifact(PDF),
    signature: fallbackArtifact(SIGNATURE),
    checksums: fallbackArtifact(CHECKSUMS),
  };
}

async function load(): Promise<ResumeRelease> {
  try {
    const res = await fetch(href("release.json"));
    if (!res.ok) throw new Error(`S3 ${res.status}`);
    const m = await res.json();
    const commit: string = m.commit ?? "";

    return {
      available: true,
      version: m.version ?? "",
      releasedAt: m.released_at ?? "",
      commit,
      commitShort: commit.slice(0, 7),
      pages: m.document?.pages ?? 0,
      pagesLabel: pagesLabel(m.document?.pages ?? 0),
      pdf: normalize(findArtifact(m, PDF), PDF),
      signature: normalize(findArtifact(m, SIGNATURE), SIGNATURE),
      checksums: normalize(findArtifact(m, CHECKSUMS), CHECKSUMS),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Deno reports a blocked host as `Requires net access to "<host>"`. Without
    // this hint a missing allowlist entry degrades to a green build with no
    // metadata, which is easy to ship without noticing.
    console.warn(
      `[resume] manifest fetch failed, using fallback: ${msg}${
        msg.includes("net access")
          ? ` — add ${
            new URL(BASE).host
          }:443 to permissions.lume.net in deno.json`
          : ""
      }`,
    );
    return fallback();
  }
}

export default await load();
