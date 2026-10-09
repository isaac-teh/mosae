import { Pressable, Text, View } from "react-native";
import type { ReactNode } from "react";
import { StableUriImage } from "../StableUriImage";

type MomentTileProps = {
  label: string;
  reason?: string;
  source?: { uri: string };
  state?: "default" | "selected" | "peak" | "excluded";
  selected?: boolean;
  clip?: boolean;
  duration?: string;
  badge?: string;
  onPress?: () => void;
  disabled?: boolean;
  children?: ReactNode;
  showCaption?: boolean;
  role?: "button" | "checkbox";
  className?: string;
};

export function MomentTile({ label, reason, source, state = "default", selected, clip = false, duration, badge, onPress, disabled = false, children, showCaption = true, role = "button", className = "" }: MomentTileProps) {
  const active = selected ?? (state === "selected" || state === "peak");
  const peak = state === "peak";
  const excluded = state === "excluded";
  const tileLabel = [label, reason, active ? "Selected" : "", excluded ? "Left out" : ""].filter(Boolean).join(", ");
  return (
    <View className={`w-full max-w-[200px] flex-col gap-2 ${className}`}>
      <Pressable
        accessibilityRole={role}
        accessibilityLabel={tileLabel}
        accessibilityState={{ selected: active, disabled }}
        role={role}
        aria-label={tileLabel}
        aria-pressed={role === "button" ? active : undefined}
        aria-checked={role === "checkbox" ? active : undefined}
        aria-disabled={disabled}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => ({ opacity: pressed && !disabled ? 0.84 : undefined, transform: [{ scale: pressed && !disabled ? 0.97 : 1 }] })}
        className={`relative aspect-square min-h-11 overflow-hidden rounded-md bg-surface-sunken active:bg-action-pressed active:scale-[0.97] ${active ? "border-[3px] border-surface" : "border-0"} ${peak ? "ring-[3px] ring-accent" : ""} ${excluded ? "opacity-[0.55]" : ""}`}
      >
        {source ? <StableUriImage uri={source.uri} accessibilityLabel={label} resizeMode="cover" className="absolute inset-0 h-full w-full" /> : <View className="absolute inset-0 bg-tile/30" />}
        {children}
        {excluded ? <View className="absolute inset-0 bg-ink/10" /> : null}
        {clip && duration ? <Text className="absolute bottom-2 left-2 rounded-pill bg-scrim/60 px-2 py-0.5 text-caption font-sans-medium text-on-screen">{duration}</Text> : null}
        {badge ? <Text className="absolute bottom-2 right-2 rounded-pill bg-action px-2 py-0.5 text-caption font-sans-medium text-on-action">{badge}</Text> : null}
        {active ? <View accessibilityLabel="Selected" className="absolute right-2 top-2 h-6 w-6 items-center justify-center rounded-sm bg-action"><Text className="text-label font-sans-semibold text-on-action">✓</Text></View> : null}
        {peak ? <Text className="absolute left-2 top-2 rounded-pill bg-accent px-2 py-0.5 text-caption font-sans-medium text-on-accent">Peak moment</Text> : null}
        {excluded ? <Text className="absolute left-2 top-2 rounded-pill bg-surface-raised px-2 py-0.5 text-caption font-sans-medium text-ink">Left out</Text> : null}
      </Pressable>
      {showCaption ? <Text className="text-label font-sans-medium text-ink">{label}</Text> : null}
      {reason ? <Text className="text-caption font-sans text-ink-muted">{reason}</Text> : null}
    </View>
  );
}
