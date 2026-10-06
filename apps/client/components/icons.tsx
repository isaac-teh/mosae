import Svg, { Circle, G, Path } from "react-native-svg";

type IconSpec = {
  width: number;
  height: number;
  d: string;
  fill: string;
  opacity?: number;
};

function icon({ width, height, d, fill, opacity }: IconSpec) {
  return function Icon() {
    return (
      <Svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        fill="none"
      >
        <G opacity={opacity}>
          <Path d={d} fill={fill} />
        </G>
      </Svg>
    );
  };
}

export const ArrowLeftIcon = icon({
  width: 13.3333,
  height: 13.3333,
  fill: "rgb(var(--color-ink-muted))",
  d: "M3.1875 7.5L7.85417 12.1667L6.66667 13.3333L0 6.66667L6.66667 0L7.85417 1.16667L3.1875 5.83333H13.3333V7.5H3.1875V7.5",
});
export const ArrowRightIcon = icon({
  width: 10.6667,
  height: 10.6667,
  fill: "white",
  d: "M8.11667 6H0V4.66667H8.11667L4.38333 0.933333L5.33333 0L10.6667 5.33333L5.33333 10.6667L4.38333 9.73333L8.11667 6V6",
});
export const CheckIcon = icon({
  width: 8.95,
  height: 6.825,
  fill: "white",
  d: "M3.25 6.825L0 3.575L1.125 2.45L3.25 4.575L7.825 0L8.95 1.125L3.25 6.825V6.825",
});
export const ChevronDownIcon = icon({
  width: 8,
  height: 4.93333,
  fill: "rgb(var(--color-ink-muted))",
  d: "M4 4.93333L0 0.933333L0.933333 0L4 3.06667L7.06667 0L8 0.933333L4 4.93333V4.93333",
});
export const ChipCheckIcon = icon({
  width: 10.1875,
  height: 7.51562,
  fill: "rgb(var(--color-action))",
  opacity: 0.7,
  d: "M3.5625 7.51562L0 3.95312L0.890625 3.0625L3.5625 5.73438L9.29688 0L10.1875 0.890625L3.5625 7.51562V7.51562",
});
export const MicIcon = icon({
  width: 10.5,
  height: 14.25,
  fill: "rgb(var(--color-accent))",
  d: "M5.25 9C4.625 9 4.09375 8.78125 3.65625 8.34375C3.21875 7.90625 3 7.375 3 6.75V2.25C3 1.625 3.21875 1.09375 3.65625 0.65625C4.09375 0.21875 4.625 0 5.25 0C5.875 0 6.40625 0.21875 6.84375 0.65625C7.28125 1.09375 7.5 1.625 7.5 2.25V6.75C7.5 7.375 7.28125 7.90625 6.84375 8.34375C6.40625 8.78125 5.875 9 5.25 9V9M5.25 4.5V4.5V4.5V4.5V4.5V4.5V4.5V4.5V4.5V4.5V4.5V4.5M4.5 14.25V11.9438C3.2 11.7688 2.125 11.1875 1.275 10.2C0.425 9.2125 0 8.0625 0 6.75H1.5C1.5 7.7875 1.86562 8.67187 2.59687 9.40312C3.32812 10.1344 4.2125 10.5 5.25 10.5C6.2875 10.5 7.17187 10.1344 7.90312 9.40312C8.63437 8.67187 9 7.7875 9 6.75H10.5C10.5 8.0625 10.075 9.2125 9.225 10.2C8.375 11.1875 7.3 11.7688 6 11.9438V14.25H4.5V14.25M5.25 7.5C5.4625 7.5 5.64063 7.42813 5.78438 7.28438C5.92813 7.14063 6 6.9625 6 6.75V2.25C6 2.0375 5.92813 1.85938 5.78438 1.71563C5.64063 1.57188 5.4625 1.5 5.25 1.5C5.0375 1.5 4.85937 1.57188 4.71562 1.71563C4.57187 1.85938 4.5 2.0375 4.5 2.25V6.75C4.5 6.9625 4.57187 7.14063 4.71562 7.28438C4.85937 7.42813 5.0375 7.5 5.25 7.5V7.5",
});
export const PlayIcon = icon({
  width: 4.58333,
  height: 5.83333,
  fill: "white",
  d: "M0 5.83333V0L4.58333 2.91667L0 5.83333V5.83333M0.833333 2.91667V2.91667V2.91667V2.91667V2.91667M0.833333 4.3125L3.02083 2.91667L0.833333 1.52083V4.3125V4.3125",
});
export const ShieldIcon = icon({
  width: 10.6667,
  height: 13.3333,
  fill: "rgb(var(--color-tile))",
  d: "M4.63333 9.03333L8.4 5.26667L7.45 4.31667L4.63333 7.13333L3.23333 5.73333L2.28333 6.68333L4.63333 9.03333V9.03333M5.33333 13.3333C3.78889 12.9444 2.51389 12.0583 1.50833 10.675C0.502778 9.29167 0 7.75556 0 6.06667V2L5.33333 0L10.6667 2V6.06667C10.6667 7.75556 10.1639 9.29167 9.15833 10.675C8.15278 12.0583 6.87778 12.9444 5.33333 13.3333V13.3333M5.33333 11.9333C6.48889 11.5667 7.44444 10.8333 8.2 9.73333C8.95556 8.63333 9.33333 7.41111 9.33333 6.06667V2.91667L5.33333 1.41667L1.33333 2.91667V6.06667C1.33333 7.41111 1.71111 8.63333 2.46667 9.73333C3.22222 10.8333 4.17778 11.5667 5.33333 11.9333V11.9333M5.33333 6.66667V6.66667V6.66667V6.66667V6.66667V6.66667V6.66667V6.66667V6.66667V6.66667",
});
export const SparklesIcon = icon({
  width: 18.3333,
  height: 18.3333,
  fill: "white",
  d: "M15 6.66667L13.9583 4.375L11.6667 3.33333L13.9583 2.29167L15 0L16.0417 2.29167L18.3333 3.33333L16.0417 4.375L15 6.66667V6.66667M15 18.3333L13.9583 16.0417L11.6667 15L13.9583 13.9583L15 11.6667L16.0417 13.9583L18.3333 15L16.0417 16.0417L15 18.3333V18.3333M6.66667 15.8333L4.58333 11.25L0 9.16667L4.58333 7.08333L6.66667 2.5L8.75 7.08333L13.3333 9.16667L8.75 11.25L6.66667 15.8333V15.8333M6.66667 11.7917L7.5 10L9.29167 9.16667L7.5 8.33333L6.66667 6.54167L5.83333 8.33333L4.04167 9.16667L5.83333 10L6.66667 11.7917V11.7917M6.66667 9.16667V9.16667V9.16667V9.16667V9.16667V9.16667V9.16667V9.16667V9.16667V9.16667",
});

export function SettingsIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" accessibilityLabel="Settings">
      <Path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2m14.51-6.01-1.42 1.42M7.41 16.59l-1.42 1.42m12.02 0-1.42-1.42M7.41 7.41 5.99 5.99" stroke="rgb(var(--color-ink))" strokeWidth={1.7} strokeLinecap="round" />
      <Circle cx={12} cy={12} r={6.5} stroke="rgb(var(--color-ink))" strokeWidth={1.7} />
      <Circle cx={12} cy={12} r={2.25} stroke="rgb(var(--color-ink))" strokeWidth={1.7} />
    </Svg>
  );
}

function HistoryArrow({ direction, disabled = false }: { direction: "undo" | "redo"; disabled?: boolean }) {
  const color = disabled ? "rgb(var(--color-ink-muted))" : "rgb(var(--color-on-screen))";
  const mirror = direction === "redo" ? "translate(24 0) scale(-1 1)" : undefined;
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <G transform={mirror}>
        <Path d="M21 12 C21 6.3 16.8 2.8 12 2.8 C6 2.8 2.8 7 2.8 12 C2.8 14.2 3.4 16.4 5 18.3" stroke={color} strokeWidth={2} strokeLinecap="round" />
        <Path d="M10.5 11.5 L5 18.3 L12.5 18.8" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
      </G>
    </Svg>
  );
}

export const UndoIcon = ({ disabled = false }: { disabled?: boolean }) => <HistoryArrow direction="undo" disabled={disabled} />;
export const RedoIcon = ({ disabled = false }: { disabled?: boolean }) => <HistoryArrow direction="redo" disabled={disabled} />;
