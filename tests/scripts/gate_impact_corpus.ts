import type { Case } from "./gate_impact_case.ts";
import { BASES } from "./gate_impact_corpus_base.ts";
import { CAUSES } from "./gate_impact_corpus_causes.ts";
import { SELECTION } from "./gate_impact_corpus_select.ts";
import { WIDENING } from "./gate_impact_corpus_widen.ts";

export type { Case };
export const CORPUS: Case[] = [...SELECTION, ...WIDENING, ...BASES, ...CAUSES];
