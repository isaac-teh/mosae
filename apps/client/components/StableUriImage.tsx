import { useEffect, useRef, useState } from "react";
import { Image } from "react-native";

function storagePath(uri: string): string {
  try { return new URL(uri, "https://mosae.invalid").pathname; }
  catch { return uri.split(/[?#]/, 1)[0]; }
}

type Props = {
  uri: string;
  accessibilityLabel?: string;
  resizeMode?: "cover" | "contain" | "stretch" | "center";
  style?: any;
  onLoad?: (event: any) => void;
  className?: string;
  accessibilityIgnoresInvertColors?: boolean;
};

/** Keep the current pixels for a re-signed URL and preload genuinely new media. */
export function StableUriImage({ uri, accessibilityLabel, resizeMode = "cover", style, onLoad, className, accessibilityIgnoresInvertColors }: Props) {
  const [displayed, setDisplayed] = useState(uri);
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);

  useEffect(() => {
    if (storagePath(uri) === storagePath(displayed)) {
      pendingRef.current = null;
      setPending(null);
      return;
    }
    pendingRef.current = uri;
    setPending(uri);
  }, [uri, displayed]);

  return <>
    <Image
      source={{ uri: displayed }}
      accessibilityLabel={accessibilityLabel}
      accessibilityIgnoresInvertColors={accessibilityIgnoresInvertColors}
      resizeMode={resizeMode}
      onLoad={onLoad}
      style={style}
      className={className}
    />
    {pending ? <Image
      key={pending}
      source={{ uri: pending }}
      accessibilityLabel={accessibilityLabel}
      resizeMode={resizeMode}
      onLoad={() => {
        if (pendingRef.current !== pending) return;
        setDisplayed(pending);
        pendingRef.current = null;
        setPending(null);
        onLoad?.({});
      }}
      style={[style, { position: "absolute", opacity: 0 }]}
    /> : null}
  </>;
}
