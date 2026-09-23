import type { ImageSourcePropType } from "react-native";
import { demoImage } from "./demoAssets";

/** Proposal thumbnails/posters are URIs; the fixture repository uses bundled keys. */
export function storyImage(key: string): ImageSourcePropType {
  if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(key)) return { uri: key };
  return key ? demoImage(key) : {};
}
