const SPELLING_MAP: Record<string, string> = {
  organization: "organisation",
  prioritize: "prioritise",
  program: "programme",
  color: "colour",
  behavior: "behaviour",
  analyze: "analyse",
  center: "centre",
  defense: "defence",
  traveled: "travelled",
  traveling: "travelling",
  canceled: "cancelled",
  modeling: "modelling",
  caliber: "calibre",
  catalog: "catalogue",
  dialog: "dialogue",
  favor: "favour",
  honor: "honour",
  license: "licence",
};

const WORD_REGEX = /\b[a-zA-Z]+\b/g;

export function normaliseBritishEnglish(input: string): string {
  return input.replace(WORD_REGEX, (word) => {
    const lower = word.toLowerCase();
    const replacement = SPELLING_MAP[lower];
    if (!replacement) {
      return word;
    }

    // Preserve original casing for simple title case and uppercase words.
    if (word.toUpperCase() === word) {
      return replacement.toUpperCase();
    }
    if (word[0]?.toUpperCase() === word[0]) {
      return replacement[0].toUpperCase() + replacement.slice(1);
    }
    return replacement;
  });
}
