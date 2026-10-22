"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { DialoguePlayer } from "@/lib/dialogue-player";

export type { PlaybackItem } from "@/lib/dialogue-player";

export function useKoreanPlayer() {
  const [player] = useState(() => new DialoguePlayer());
  const state = useSyncExternalStore(
    player.subscribe,
    player.getSnapshot,
    player.getServerSnapshot,
  );
  useEffect(() => () => player.dispose(), [player]);

  return {
    activeId: state.activeId,
    status: state.status,
    playing: state.playing,
    play: player.play,
    stop: player.stop,
  };
}
