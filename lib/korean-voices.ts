export const SPEAKER_VOICES = {
  A: {
    id: "ko-KR-SunHiNeural",
    edgeName: "Microsoft Server Speech Text to Speech Voice (ko-KR, SunHiNeural)",
    name: "SunHi",
    label: "SunHi 女声",
  },
  B: {
    id: "ko-KR-InJoonNeural",
    edgeName: "Microsoft Server Speech Text to Speech Voice (ko-KR, InJoonNeural)",
    name: "InJoon",
    label: "InJoon 男声",
  },
} as const;

export type Speaker = keyof typeof SPEAKER_VOICES;
