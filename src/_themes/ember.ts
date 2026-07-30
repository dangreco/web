// Bespoke "Ember" syntax palette, derived from the site's OKLCH design tokens so
// that shikiji-highlighted prose code and the CodeMirror playground share one
// scheme: vermilion keywords (the site accent), amber types, olive strings — an
// all-warm arc with no cool hues to fight the paper/ink/vermilion identity.
//
// Keep these hexes in sync with the --syn-* variables in src/styles.css, which
// colour the live editor. Values are generated from OKLCH so the light and dark
// variants are perceptually matched:
//   keyword = --accent verbatim   oklch(0.585 0.198 32) / oklch(0.7 0.185 38)
//   type    oklch(0.55 0.13 72)  / oklch(0.82 0.12 78)
//   string  oklch(0.5  0.11 115) / oklch(0.8  0.11 118)
//   number  oklch(0.55 0.15 50)  / oklch(0.8  0.14 55)
//   comment oklch(0.68 0.015 60) / oklch(0.52 0.015 85)

interface Palette {
  /** Default text: the site's --ink. */
  fg: string;
  /** Container background: the site's --panel (the .shiki CSS overrides it). */
  bg: string;
  /** Operators and punctuation: the site's --ink-mute. */
  mute: string;
  comment: string;
  keyword: string;
  str: string;
  num: string;
  type: string;
}

const LIGHT: Palette = {
  fg: "#18130e",
  bg: "#ece7de",
  mute: "#79736f",
  comment: "#a0968f",
  keyword: "#d83b21",
  str: "#626a09",
  num: "#b45000",
  type: "#9f6200",
};

const DARK: Palette = {
  fg: "#f4f1ec",
  bg: "#1e1a16",
  mute: "#83807a",
  comment: "#6d685f",
  keyword: "#fb6c3e",
  str: "#b7c874",
  num: "#ffa460",
  type: "#efba64",
};

// Identifiers — variables, functions and properties — deliberately have no rule
// and fall through to `editor.foreground`. That mirrors the playground editor,
// where `classHighlighter` leaves them on --ink, and keeps the accent scarce.
function build(name: string, type: "light" | "dark", p: Palette) {
  return {
    name,
    type,
    colors: {
      "editor.foreground": p.fg,
      "editor.background": p.bg,
    },
    tokenColors: [
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: { foreground: p.comment },
      },
      {
        scope: [
          "keyword",
          "keyword.control",
          "keyword.other",
          "keyword.operator.new",
          "keyword.operator.expression",
          "storage",
          "storage.type",
          "storage.modifier",
          "variable.language",
        ],
        settings: { foreground: p.keyword },
      },
      {
        scope: [
          "entity.name.type",
          "entity.name.class",
          "entity.name.namespace",
          "entity.other.inherited-class",
          "entity.name.function.macro",
          "entity.name.tag",
          "support.type",
          "support.type.primitive",
          "support.class",
        ],
        settings: { foreground: p.type },
      },
      {
        scope: [
          "string",
          "string.quoted",
          "string.template",
          "string.regexp",
          "punctuation.definition.string",
          "constant.character.escape",
        ],
        settings: { foreground: p.str },
      },
      {
        scope: [
          "constant.numeric",
          "constant.language",
          "constant.character",
          "constant.other",
          "support.constant",
        ],
        settings: { foreground: p.num },
      },
      // More specific than the bare `keyword` rule above, so operators stay
      // muted while control keywords keep the accent.
      {
        scope: [
          "keyword.operator",
          "punctuation",
          "punctuation.separator",
          "punctuation.terminator",
          "punctuation.accessor",
          "meta.brace",
        ],
        settings: { foreground: p.mute },
      },
      {
        scope: ["invalid", "invalid.illegal"],
        settings: { foreground: p.keyword },
      },
    ],
  };
}

export const emberLight = build("ember-light", "light", LIGHT);
export const emberDark = build("ember-dark", "dark", DARK);
