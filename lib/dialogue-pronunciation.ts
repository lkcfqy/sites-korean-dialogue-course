const initials = Array.from("ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ");
const vowels = Array.from("ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ");
const finals = [
  "",
  ...Array.from("ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"),
];

export type HangulSyllable = {
  text: string;
  initial: string;
  vowel: string;
  final: string;
};

// Written blocks only: decomposing letters is not a pronunciation conversion.
export function hangulSyllables(text: string): HangulSyllable[] {
  return Array.from(text.normalize("NFC")).flatMap((letter) => {
    const offset = letter.codePointAt(0)! - 0xac00;
    if (offset < 0 || offset >= 11172) return [];
    return [
      {
        text: letter,
        initial: initials[Math.floor(offset / 588)],
        vowel: vowels[Math.floor((offset % 588) / 28)],
        final: finals[offset % 28],
      },
    ];
  });
}

const notes: Record<string, string> = {
  밥을: "밥을 读作 [바블]：밥 的收音 ㅂ 接到助词 을 的开头。拼写仍保留 밥 + 을。",
  같이: "같이 读作 [가치]：这里 ㅌ 与 이 相接发生腭化。不能把所有后接 이 的词一律套用。",
  좋아요: "좋아요 读作 [조아요]：ㅎ 在这个词形中不另发音。拼写仍保留 좋아요。",
  읽어요:
    "읽어요 读作 [일거요]：双收音 ㄺ 中的 ㄱ 连到后面的 어。不能照单独读 읽 的方式逐字块读。",
};

export function dialogueSoundNote(text: string): string | undefined {
  const form = text
    .normalize("NFC")
    .replace(/^[\s.,!?…“”‘’"'()]+|[\s.,!?…“”‘’"'()]+$/g, "");
  if (/^학교(?:에|에서|는|가|를|도|로|까지|부터)?$/.test(form))
    return "학교 一词读作 [학꾜]：ㄱ 收音后，교 的 ㄱ 变成紧音 ㄲ。后接助词时，再听当前整句的连接与节奏。";
  return notes[form];
}
