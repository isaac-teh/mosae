import { useRef, useState } from "react";

type Recognition = {
  lang: string;
  interimResults: boolean;
  onresult: (e: {
    results: ArrayLike<ArrayLike<{ transcript: string }>>;
  }) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};

function recognitionCtor(): (new () => Recognition) | undefined {
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<Recognition | null>(null);
  const supported = typeof window !== "undefined" && Boolean(recognitionCtor());
  function toggle() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = false;
    rec.onresult = (e) =>
      onText(
        Array.from(e.results)
          .map((r) => r[0].transcript)
          .join(" "),
      );
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }
  return { listening, supported, toggle };
}
