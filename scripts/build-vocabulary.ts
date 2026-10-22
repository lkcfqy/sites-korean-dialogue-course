// Vocabulary is compiled together with the curriculum to preserve daily ordering.
// Rebuilding from surface forms would discard the authoritative lexical source.
import words from '../data/vocabulary.json';
import { dialogues } from '../data/course';
const assigned = new Set(dialogues.flatMap((d) => d.vocabulary));
if (assigned.size !== words.length || words.some((w) => !assigned.has(w.ko))) throw new Error('Run scripts/build-curriculum.py; vocabulary allocation is inconsistent.');
console.log(`${words.length} distinct headwords; every word is assigned to exactly one introduction lesson. Rebuild with scripts/build-curriculum.py (see README).`);
