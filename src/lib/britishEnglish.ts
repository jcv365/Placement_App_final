import { generateStructuredJson } from "@/lib/aiJson";

const SPELLING_MAP: Record<string, string> = {
  // Original entries
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
  customize: "customise",
  optimize: "optimise",
  specialize: "specialise",
  realize: "realise",
  recognize: "recognise",
  apologize: "apologise",
  summarize: "summarise",
  utilize: "utilise",
  finalize: "finalise",
  authorize: "authorise",
  standardize: "standardise",
  categorize: "categorise",
  labor: "labour",
  neighbor: "neighbour",
  humor: "humour",
  rumor: "rumour",
  fiber: "fibre",
  liter: "litre",
  theater: "theatre",
  meter: "metre",
  gray: "grey",
  fulfill: "fulfil",
  enrollment: "enrolment",
  skillful: "skilful",
  // -ize → -ise
  digitize: "digitise",
  minimize: "minimise",
  maximize: "maximise",
  emphasize: "emphasise",
  visualize: "visualise",
  tokenize: "tokenise",
  virtualize: "virtualise",
  containerize: "containerise",
  modernize: "modernise",
  normalize: "normalise",
  synchronize: "synchronise",
  harmonize: "harmonise",
  mobilize: "mobilise",
  stabilize: "stabilise",
  initialize: "initialise",
  capitalize: "capitalise",
  digitalize: "digitalise",
  democratize: "democratise",
  characterize: "characterise",
  incentivize: "incentivise",
  institutionalize: "institutionalise",
  operationalize: "operationalise",
  rationalize: "rationalise",
  monetize: "monetise",
  localize: "localise",
  globalize: "globalise",
  prioritized: "prioritised",
  organized: "organised",
  recognized: "recognised",
  optimized: "optimised",
  specialized: "specialised",
  customized: "customised",
  // -or → -our
  flavor: "flavour",
  valor: "valour",
  odor: "odour",
  vigor: "vigour",
  endeavor: "endeavour",
  splendor: "splendour",
  candor: "candour",
  ardor: "ardour",
  glamor: "glamour",
  savior: "saviour",
  // -er → -re
  specter: "spectre",
  scepter: "sceptre",
  somber: "sombre",
  maneuver: "manoeuvre",
  // Double-consonant forms
  modeled: "modelled",
  fueled: "fuelled",
  labeled: "labelled",
  counseled: "counselled",
  counselor: "counsellor",
  leveled: "levelled",
  rivaled: "rivalled",
  signaled: "signalled",
  // Misc
  artifact: "artefact",
  aging: "ageing",
  ax: "axe",
  tire: "tyre",
  mold: "mould",
  draft: "draught",
  cozy: "cosy",
  skeptic: "sceptic",
  skeptical: "sceptical",
  skepticism: "scepticism",
  practice: "practise",
  offense: "offence",
  pretense: "pretence",
};

const WORD_REGEX = /\b[a-zA-Z]+\b/g;

function applySpellingMap(word: string): string {
  const lower = word.toLowerCase();
  const replacement = SPELLING_MAP[lower];
  if (!replacement) {
    return word;
  }
  if (word.toUpperCase() === word) {
    return replacement.toUpperCase();
  }
  if (word[0]?.toUpperCase() === word[0]) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

export function normaliseBritishEnglish(input: string): string {
  return input.replace(WORD_REGEX, applySpellingMap);
}

type SpellingCorrection = { corrected: string };

/**
 * Async variant: applies the static map first, then asks AI to catch any
 * remaining American spellings not in the map.
 */
export async function normaliseBritishEnglishAsync(
  input: string,
): Promise<string> {
  const afterMap = normaliseBritishEnglish(input);
  try {
    const result = await generateStructuredJson<SpellingCorrection>({
      systemPrompt:
        'You are a British English copy editor. Convert any remaining American English spellings to British English in the text. Return only the corrected text in JSON: { "corrected": "<text>" }. If no changes are needed, return the original text unchanged.',
      userPrompt: `Text: ${afterMap}`,
      maxTokens: Math.min(afterMap.length * 2 + 50, 2000),
      temperature: 0.1,
    });
    const corrected = result?.corrected?.trim();
    return corrected && corrected.length > 0 ? corrected : afterMap;
  } catch {
    return afterMap;
  }
}
