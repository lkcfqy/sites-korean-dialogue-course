import assert from "node:assert/strict";
import test from "node:test";
import {
  dialogueSoundNote,
  hangulSyllables,
} from "../lib/dialogue-pronunciation";

test("current word spelling keeps silent initial and compound final distinct", () => {
  assert.deepEqual(hangulSyllables("읽어요?"), [
    { text: "읽", initial: "ㅇ", vowel: "ㅣ", final: "ㄺ" },
    { text: "어", initial: "ㅇ", vowel: "ㅓ", final: "" },
    { text: "요", initial: "ㅇ", vowel: "ㅛ", final: "" },
  ]);
  assert.equal(hangulSyllables("English 123 🗣️").length, 0);
  assert.deepEqual(hangulSyllables("학교"), hangulSyllables("학교"));
});

test("sound hints do not extrapolate exact inflections to unrelated words", () => {
  assert.match(dialogueSoundNote("좋아요!")!, /조아요/);
  assert.equal(dialogueSoundNote("좋았어요"), undefined);
  assert.equal(dialogueSoundNote("똑같이"), undefined);
  assert.equal(dialogueSoundNote("좋.아요"), undefined);
  assert.match(dialogueSoundNote("학교에서")!, /학꾜/);
  assert.equal(dialogueSoundNote("대학교"), undefined);
});
