"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PronunciationRecorder({
  focus,
  maxSeconds = 180,
  onBeforeStart,
}: {
  focus: string;
  maxSeconds?: number;
  onBeforeStart?: () => void;
}) {
  const [recording, setRecording] = useState(false),
    [url, setUrl] = useState(""),
    [message, setMessage] = useState("");
  const [extension, setExtension] = useState("webm");
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    objectUrl = useRef("");
  const alive = useRef(true),
    pending = useRef(false),
    chunks = useRef<Blob[]>([]);
  function stop() {
    if (timer.current) clearTimeout(timer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stop();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);
  async function start() {
    if (pending.current || recording) return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setMessage(
        "当前浏览器不能录音。可以用设备录音应用录下，再与示范逐句对照。",
      );
      return;
    }
    pending.current = true;
    onBeforeStart?.();
    setMessage("正在请求麦克风…");
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      if (!alive.current) {
        audioStream.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = audioStream;
      chunks.current = [];
      const media = new MediaRecorder(audioStream);
      recorder.current = media;
      setExtension(media.mimeType.includes("mp4") ? "mp4" : "webm");
      media.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      media.onstop = () => {
        if (timer.current) clearTimeout(timer.current);
        audioStream.getTracks().forEach((t) => t.stop());
        if (!alive.current) return;
        if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
        const blob = new Blob(chunks.current, {
          type: media.mimeType || "audio/webm",
        });
        if (!blob.size) {
          setMessage("没有录到声音，请检查麦克风后重试。");
          setRecording(false);
          return;
        }
        objectUrl.current = URL.createObjectURL(blob);
        setUrl(objectUrl.current);
        setRecording(false);
        setMessage("录音可以回听或下载，离开此练习后清除。");
      };
      media.start();
      setRecording(true);
      setMessage(`正在录音，最多 ${maxSeconds} 秒。用自己的话完成回应。`);
      timer.current = setTimeout(stop, maxSeconds * 1000);
    } catch {
      stream.current?.getTracks().forEach((track) => track.stop());
      if (alive.current)
        setMessage(
          "麦克风未能开启。可以检查浏览器授权，或用设备录音应用对照。",
        );
    } finally {
      pending.current = false;
    }
  }
  return (
    <div className="pronunciation-recorder">
      <h4>说一遍，听听自己</h4>
      <p>{focus}</p>
      <div className="exercise-actions">
        <Button variant="outline" onClick={recording ? stop : start}>
          {recording ? <Square size={17} /> : <Mic size={17} />}{" "}
          {recording ? "结束录音" : "开始录音"}
        </Button>
        {url && (
          <a href={url} download={`korean-pronunciation.${extension}`}>
            下载录音
          </a>
        )}
      </div>
      {url && <audio controls src={url} aria-label="播放自己的韩语录音" />}
      <p role="status">{message}</p>
      <p className="practice-tip">
        回听时检查意思是否说清、回应是否自然。也可以直接口述，不必录音。
      </p>
    </div>
  );
}
