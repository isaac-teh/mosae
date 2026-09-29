// Expo loads its own Figtree and Literata fonts; the render bundle imports
// fonts.css through Collage.tsx so both paths use the same collage component.
export { Collage } from "./CollageBase";
export type { CollageProps } from "./CollageBase";
