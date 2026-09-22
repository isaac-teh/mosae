import React from "react";
import { Composition, registerRoot, staticFile } from "remotion";
import { PhotoTable } from "./PhotoTable";

/**
 * THROWAWAY SPIKE ENTRY (2026-09-22). Kept out of index.tsx so the real
 * compositions are untouched. Render with the trip samples as the public dir:
 *
 *   MOSAE_REMOTION_PUBLIC_DIR=../../poc/gemini/samples/trip \
 *     npx remotion still src/spike.tsx PhotoTable out/photo-table.png --frame=120
 */

const CELLS = [
  "d05-kyoto-photo-1673978.jpg",
  "d05-kyoto-photo-26946364.jpg",
  "d05-kyoto-photo-30094291.jpg",
  "d06-kyoto-photo-31158397.jpg",
  "d06-kyoto-photo-35568183.jpg",
  "d07-kyoto-photo-5745824.jpg",
].map((file) => staticFile(file));


const Root = () => (
  <>
    <Composition
      id="PhotoTable"
      component={PhotoTable}
      defaultProps={{ cells: CELLS, landingFrames: 26, animate: true }}
      durationInFrames={150}
      fps={30}
      width={1080}
      height={1920}
    />
    <Composition
      id="PhotoTable4"
      component={PhotoTable}
      defaultProps={{ cells: CELLS.slice(0, 4), landingFrames: 26, animate: true }}
      durationInFrames={150}
      fps={30}
      width={1080}
      height={1920}
    />
  </>
);

registerRoot(Root);
