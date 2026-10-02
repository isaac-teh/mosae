const assets: Record<string, number> = {
  "collage-botanical-scrapbook": require("../assets/collage-library/botanical-scrapbook.jpg"),
  "collage-botanical-scrapbook-wide": require("../assets/collage-library/botanical-scrapbook-wide.jpg"),
  "collage-nine-photo-grid": require("../assets/collage-library/nine-photo-grid.jpg"),
  "collage-nine-photo-grid-wide": require("../assets/collage-library/nine-photo-grid-wide.jpg"),
  "collage-travel-mosaic": require("../assets/collage-library/travel-mosaic.jpg"),
  "collage-travel-mosaic-wide": require("../assets/collage-library/travel-mosaic-wide.jpg"),
  "collage-travel-story": require("../assets/collage-library/travel-story.jpg"),
  "collage-travel-story-wide": require("../assets/collage-library/travel-story-wide.jpg"),

  "collage-photo-table": require("../assets/collage-library/photo-table.jpg"),
  "collage-torn-paper": require("../assets/collage-library/torn-paper.jpg"),
  "collage-polaroid-garland": require("../assets/collage-library/polaroid-garland.jpg"),
  "collage-postcard-stack": require("../assets/collage-library/postcard-stack.jpg"),
  "collage-route-map": require("../assets/collage-library/route-map.jpg"),

  "music-acoustic-demo": require("../assets/demo/music-acoustic-demo.mp3"),
  "music-piano-demo": require("../assets/demo/music-piano-demo.mp3"),
  "birthday-song": require("../assets/demo/figma/review-moments/imgMeiClappingAtBirthdayCakeWithParents.png"),
  "strawberry-mochi": require("../assets/demo/figma/review-moments/imgMeiEatingStrawberryMochi.png"),
  "torii-gates": require("../assets/demo/figma/review-moments/imgFatherCarryingDaughterOnShouldersInKy.png"),
  "yanaka-dusk": require("../assets/demo/figma/review-moments/imgFamilyStrollingInLanternStreetInTokyo.png"),
  // No arcade-specific photo; closest is lantern street stroll
  "giggling-arcade": require("../assets/demo/figma/curated-timeline/imgFamilyStrollingDownLanternStreetInTok.png"),
  "kyoto-mochi": require("../assets/demo/figma/curated-timeline/imgMeiTastingStrawberrySweet.png"),
  "create-cover": require("../assets/demo/figma/create/imgAb6AXuAall8O0Yq3WnnKjK7QxDPg90EcH7Rso.png"),
  // TODO(figma): replace when exported
  "film-poster": require("../assets/demo/figma/review-moments/imgMeiClappingAtBirthdayCakeWithParents.png"),
  // TODO(figma): replace when exported
  "save-poster": require("../assets/demo/figma/review-moments/imgMeiClappingAtBirthdayCakeWithParents.png"),
  // TODO(figma): replace when exported
  "archive-print": require("../assets/demo/figma/review-moments/imgMeiClappingAtBirthdayCakeWithParents.png"),
  "timeline-lantern-stroll": require("../assets/demo/figma/curated-timeline/imgFamilyStrollingDownLanternStreetInTok.png"),
  "timeline-strawberry": require("../assets/demo/figma/curated-timeline/imgMeiTastingStrawberrySweet.png"),
  "timeline-birthday": require("../assets/demo/figma/curated-timeline/imgMeiLaughingAtBirthdayCakeWithParents.png"),
  "timeline-torii": require("../assets/demo/figma/curated-timeline/imgFatherCarryingDaughterOnShouldersInKy.png"),
};

export function demoImage(key: string): number {
  const asset = assets[key];
  if (asset === undefined) {
    throw new Error(`Unknown demo asset key: ${key}`);
  }
  return asset;
}
