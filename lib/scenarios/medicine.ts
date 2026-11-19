// =============================================================================
//  Scenario "Outbreak in Pavia" — content shown in the voting panel beside the
//  chat and used to label the admin results.
//
//  Keep it in sync with the student handout (Claude Doc) and with
//  docs/activity-medicine-dossier.md. This file is bundled to the browser:
//  it must contain NOTHING about the groups or their orientations.
//  It is NOT sent to the model (the options are named by the students).
// =============================================================================

export type OptionKey = "A" | "B" | "C" | "D";

export const OPTION_KEYS: OptionKey[] = ["A", "B", "C", "D"];

// A = lightest response … D = strongest: scored 1–4 in the results.
export function optionScore(key: OptionKey): number {
  return OPTION_KEYS.indexOf(key) + 1;
}

export type Choice = {
  id: string; // "1", "2a", …
  section: string; // decision heading the choice belongs to
  label: string; // short label (results, answer sheet)
  question: string;
  options: Record<OptionKey, string>;
};

export const SCENARIO = {
  title: "Outbreak in Pavia",
  when: "Thursday 3 December, 9:00 AM",
  lead:
    "Six people are in hospital in Pavia with severe atypical pneumonia, and avian influenza is the suspected cause. Your recommendations are due by 11:00 AM.",
  body:
    "Over the past 72 hours, all six patients were admitted to the city's main hospital. All are linked to the same poultry farm just outside Pavia: farm workers and people living on the premises. Rapid influenza tests are inconclusive, and a spillover of avian influenza A(H5N1) is suspected. The Mayor and the local health authority have convened the emergency management unit.",
  facts: [
    ["Cases", "6 hospitalised with severe atypical pneumonia, onset in the last 72 hours"],
    ["Common exposure", "The same poultry farm just outside Pavia"],
    ["Suspected pathogen", "Avian influenza A(H5N1); rapid tests inconclusive"],
    ["Laboratory confirmation", "From the national reference laboratory within 48 hours"],
    ["Human-to-human transmission", "No evidence so far"],
    ["This weekend (5–6 December)", "The city's open-air Christmas market opens, thousands of visitors expected"],
    ["Reliability of current information", "Moderate"],
  ] as [string, string][],
  context:
    "In recent years, some suspected-outbreak alerts in the region escalated into serious public-health events. Others proved to be false alarms, and their containment measures caused significant costs and disruption. Your decisions take effect as soon as they are announced.",
};

export const CHOICES: Choice[] = [
  {
    id: "1",
    section: "1. Alert",
    label: "1. Alert",
    question:
      "The rapid tests are ambiguous and laboratory confirmation is 48 hours away. What do you do now?",
    options: {
      A: "No alert: wait for laboratory confirmation, routine surveillance only",
      B: "Internal pre-alert: health services on standby, no public announcement",
      C: "Declare a suspected-outbreak alert and activate the emergency unit",
      D: "Declare the alert and immediately request regional and national support",
    },
  },
  {
    id: "2a",
    section: "2. Containment",
    label: "2a. Farm and exposed people",
    question: "What happens to the farm and to the people exposed to it?",
    options: {
      A: "No restrictions; exposed people are asked to report any symptoms",
      B: "Daily health checks on exposed people; the farm stays open under strict biosecurity",
      C: "Close the farm; home quarantine for workers and residents",
      D: "Close the farm, set up a 3 km restricted zone around it, and quarantine all contacts",
    },
  },
  {
    id: "2b",
    section: "2. Containment",
    label: "2b. Christmas market",
    question: "What happens to the opening of the Christmas market this weekend?",
    options: {
      A: "Opens as planned",
      B: "Opens with precautions (hand-hygiene points, information signs)",
      C: "Opens with restrictions (capacity limits, fewer days)",
      D: "Postponed",
    },
  },
  {
    id: "3",
    section: "3. Hospital",
    label: "3. Hospital",
    question: "How does the main hospital prepare for more suspected cases?",
    options: {
      A: "No changes: suspected cases go to standard isolation rooms",
      B: "A dedicated isolation area within the infectious-disease unit; scheduled surgery unchanged",
      C: "A dedicated isolation ward; part of the scheduled surgery postponed",
      D: "A whole department converted to suspected cases, all non-urgent surgery postponed, antivirals and protective equipment stocked up",
    },
  },
  {
    id: "4a",
    section: "4. Testing and communication",
    label: "4a. Testing",
    question: "Who do you test?",
    options: {
      A: "Only people with symptoms",
      B: "People with symptoms and their direct contacts",
      C: "Everyone with any exposure to the farm: workers, residents, suppliers, visitors",
      D: "The whole population living around the farm",
    },
  },
  {
    id: "4b",
    section: "4. Testing and communication",
    label: "4b. Communication",
    question: "What do you tell the public?",
    options: {
      A: "No public communication until laboratory confirmation",
      B: "Communication only to the people directly involved",
      C: "Public statement: situation under investigation, no measures for the public",
      D: "City-wide press conference by the Mayor, with recommendations to the population",
    },
  },
];

export const CHOICE_IDS = CHOICES.map((c) => c.id);

export const MAX_JUSTIFICATION = 2000;

export function isOptionKey(v: unknown): v is OptionKey {
  return typeof v === "string" && (OPTION_KEYS as string[]).includes(v);
}

export type TeamVote = { option: OptionKey | null; justification: string };
export type TeamVotes = Record<string, TeamVote>;
