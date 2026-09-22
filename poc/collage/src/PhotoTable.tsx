import React from "react";
import { AbsoluteFill, Img, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * THROWAWAY SPIKE (2026-09-22). Six photos as physical prints scattered on a
 * table: white card with a heavy foot, a contact shadow plus an ambient one,
 * and a deterministic tilt.
 *
 * Nothing here is wired to the Timeline contract yet. If the look is right this
 * becomes the first entry in a layout vocabulary; if not, delete the file.
 *
 * Every random value is seeded, never Math.random(): the Player and the
 * renderer are separate processes, so an unseeded tilt would make the preview
 * and the downloaded file disagree.
 */

export type PhotoTableProps = {
  /** Public-dir relative paths, in reading order. Exactly six. */
  cells: string[];
  /**
   * Varies the scatter. Same seed plus same cells always produces the same
   * arrangement, which is what keeps the Player preview and the server render
   * identical; a new seed is how two generations of the same moments get two
   * different tables.
   */
  seed?: string;
  /** Card width as a fraction of canvas width. Bigger overlaps more and leaves less table. */
  cardWidth?: number;
  /**
   * How many frames this table is on screen. Inside a <Sequence> the video
   * config still reports the whole composition, so a clip must say how long it
   * runs or the drift is computed against the wrong span and barely moves.
   */
  spanFrames?: number;
  /** Frames the landing animation takes per card, staggered. */
  landingFrames?: number;
  /** Set false to see the settled arrangement with no entrance. */
  animate?: boolean;
};

/** The photo window inside the card is square; the card's foot is heavier. */
const PAD_SIDE = 0.035;
const PAD_FOOT = 0.14;

/**
 * One entry per supported cell count. Anchors sit closer together than a card is
 * wide, so cards tuck under each other. Four cells in 9:16 have room to scatter;
 * six are tight, which is why they get a narrower card by default.
 */
const LAYOUTS: Record<number, { columns: number[]; rows: number[]; cardWidth: number }> = {
  4: { columns: [0.315, 0.685], rows: [0.335, 0.665], cardWidth: 0.46 },
  6: { columns: [0.325, 0.675], rows: [0.25, 0.5, 0.75], cardWidth: 0.415 },
};

function layoutFor(count: number) {
  return LAYOUTS[count] ?? LAYOUTS[6];
}

/** Smallest gap allowed between a card's rotated bounding box and the frame edge. */
const EDGE_MARGIN = 0.015;

/**
 * The ambient drift applied to the whole table. The card clamp must reserve room
 * for it: the wrapper scales about centre and slides, so a card that is safe in
 * the static layout can still be carried off-frame. Keeping the numbers here,
 * used by both the clamp and the wrapper, stops the two getting out of step.
 */
const DRIFT = { push: 1.055, x: 0.016, y: 0.006 } as const;

/**
 * The range a card centre may occupy so that its rotated bounding box stays on
 * canvas through the whole drift. A point p maps to 0.5 + (p - 0.5) * push + d,
 * and the half-bound scales with push, so both are solved back through it.
 */
function safeRange(halfBound: number, drift: number): [number, number] {
  const scaled = halfBound * DRIFT.push;
  const low = 0.5 + (EDGE_MARGIN + scaled - 0.5 + drift) / DRIFT.push;
  const high = 0.5 + (0.5 - EDGE_MARGIN - scaled - drift) / DRIFT.push;
  return [low, high];
}

/** Keeps a seeded offset inside its safe range; a collapsed range centres the card. */
function clamp(value: number, low: number, high: number): number {
  if (low > high) return (low + high) / 2;
  return Math.min(Math.max(value, low), high);
}

/** Signed value in [-1, 1) from a seed. */
function jitter(seed: string): number {
  return random(seed) * 2 - 1;
}

function slot(index: number, key: string, columns: number[], rows: number[]) {
  const column = columns[index % columns.length];
  const row = rows[Math.floor(index / columns.length)];
  return {
    left: column + jitter(`${key}-x`) * 0.045,
    top: row + jitter(`${key}-y`) * 0.028,
    // Full range rather than a forced alternation: some cards sit nearly square,
    // one or two lean hard. Uniform magnitude is what read as mechanical.
    tilt: jitter(`${key}-r`) * 7.5,
    // Stacking order is seeded too, so it isn't always reading order on top.
    z: Math.floor(random(`${key}-z`) * 100),
  };
}

const Card: React.FC<{
  src: string;
  index: number;
  seed: string;
  columns: number[];
  rows: number[];
  cardW: number;
  landingFrames: number;
  animate: boolean;
}> = ({ src, index, seed, columns, rows, cardW, landingFrames, animate }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const raw = slot(index, `${seed}:${src}`, columns, rows);
  const { tilt, z } = raw;

  const cardWidth = width * cardW;
  const photoSide = cardWidth * (1 - PAD_SIDE * 2);
  const cardHeight = cardWidth * PAD_SIDE + photoSide + cardWidth * PAD_FOOT;

  // A seeded offset is only safe if every seed stays on canvas *through the drift*.
  // Clamp against the card's rotated bounding box, carried through the wrapper's
  // maximum push and slide. A five-seed sweep of the four-cell layout put two
  // cards over the left edge before this reserved room for the drift.
  const radians = (Math.abs(tilt) * Math.PI) / 180;
  const boundW = cardWidth * Math.cos(radians) + cardHeight * Math.sin(radians);
  const boundH = cardWidth * Math.sin(radians) + cardHeight * Math.cos(radians);
  const left = clamp(raw.left, ...safeRange(boundW / 2 / width, DRIFT.x));
  const top = clamp(raw.top, ...safeRange(boundH / 2 / height, DRIFT.y));

  // Cards land one after another, each settling with a little overshoot.
  const delay = index * Math.round(landingFrames * 0.45);
  const settle = animate
    ? spring({ frame: frame - delay, fps, config: { damping: 14, mass: 0.7 }, durationInFrames: landingFrames })
    : 1;

  const drop = interpolate(settle, [0, 1], [-0.06 * width, 0]);
  const scale = interpolate(settle, [0, 1], [1.08, 1]);
  const opacity = interpolate(settle, [0, 0.35], [0, 1], { extrapolateRight: "clamp" });
  // The shadow tightens as the card comes to rest on the table.
  const lift = 1 - settle;

  return (
    <div
      style={{
        position: "absolute",
        left: `${left * 100}%`,
        top: `${top * 100}%`,
        width: cardWidth,
        height: cardHeight,
        marginLeft: -cardWidth / 2,
        marginTop: -cardHeight / 2,
        transform: `translateY(${drop}px) rotate(${tilt}deg) scale(${scale})`,
        opacity,
        zIndex: z,
        background: "#fdfbf7",
        paddingTop: cardWidth * PAD_SIDE,
        paddingLeft: cardWidth * PAD_SIDE,
        paddingRight: cardWidth * PAD_SIDE,
        // Offset to the lower right, matching the light coming from upper left.
        boxShadow: [
          `${1 + lift * 4}px ${2 + lift * 10}px ${3 + lift * 12}px rgba(30,20,10,${0.34 - lift * 0.08})`,
          `${5 + lift * 22}px ${16 + lift * 60}px ${38 + lift * 70}px rgba(30,20,10,${0.26 + lift * 0.04})`,
        ].join(", "),
      }}
    >
      <Img
        src={src}
        style={{
          width: photoSide,
          height: photoSide,
          objectFit: "cover",
          display: "block",
          // A real print has a faint edge where the emulsion meets the border.
          boxShadow: "inset 0 0 0 1px rgba(30,22,14,0.14)",
        }}
      />
    </div>
  );
};

/**
 * A wood surface. The grain is four repeating gradients whose periods (11, 37, 79,
 * 173) share no common factor and whose angles differ by a degree or two, so the
 * pattern does not visibly repeat across a 1080px frame the way one layer did.
 * Two soft blotches break it up again at the scale of the whole table.
 */
const TABLE = [
  "radial-gradient(75% 55% at 32% 26%, rgba(255,238,205,0.20) 0%, rgba(0,0,0,0) 60%)",
  "radial-gradient(110% 85% at 50% 45%, rgba(0,0,0,0) 35%, rgba(24,14,6,0.42) 100%)",
  "radial-gradient(38% 26% at 74% 18%, rgba(58,34,14,0.20) 0%, rgba(0,0,0,0) 100%)",
  "radial-gradient(45% 30% at 18% 78%, rgba(150,112,74,0.18) 0%, rgba(0,0,0,0) 100%)",
  "repeating-linear-gradient(93deg, rgba(0,0,0,0.045) 0px, rgba(0,0,0,0) 3px, rgba(255,226,183,0.03) 6px, rgba(0,0,0,0) 11px)",
  "repeating-linear-gradient(91.5deg, rgba(0,0,0,0.04) 0px, rgba(0,0,0,0) 14px, rgba(255,226,183,0.025) 22px, rgba(0,0,0,0) 37px)",
  "repeating-linear-gradient(94deg, rgba(0,0,0,0.055) 0px, rgba(0,0,0,0) 27px, rgba(0,0,0,0.04) 44px, rgba(0,0,0,0) 79px)",
  "repeating-linear-gradient(92deg, rgba(20,10,2,0.05) 0px, rgba(0,0,0,0) 61px, rgba(150,112,74,0.045) 104px, rgba(0,0,0,0) 173px)",
  "linear-gradient(163deg, #96704a 0%, #7d5a3a 45%, #5f422a 100%)",
].join(", ");

export const PhotoTable: React.FC<PhotoTableProps> = ({
  cells,
  seed = "",
  cardWidth,
  spanFrames,
  landingFrames = 26,
  animate = true,
}) => {
  const frame = useCurrentFrame();
  const config = useVideoConfig();
  const durationInFrames = spanFrames ?? config.durationInFrames;
  const layout = layoutFor(cells.length);
  const cardW = cardWidth ?? layout.cardWidth;

  // The settled arrangement must keep moving or the shot dies on screen. A slow
  // push plus a little sideways drift runs under the whole clip.
  const t = durationInFrames > 1 ? frame / (durationInFrames - 1) : 0;
  const push = interpolate(t, [0, 1], [1, DRIFT.push]);
  const driftX = interpolate(t, [0, 1], [0, -DRIFT.x]) * 100;
  const driftY = interpolate(t, [0, 1], [DRIFT.y, -DRIFT.y]) * 100;

  return (
    <AbsoluteFill style={{ background: TABLE, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${push}) translate(${driftX}%, ${driftY}%)` }}>
        {cells.map((src, index) => (
          <Card
            key={src}
            src={src}
            index={index}
            seed={seed}
            columns={layout.columns}
            rows={layout.rows}
            cardW={cardW}
            landingFrames={landingFrames}
            animate={animate}
          />
        ))}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
