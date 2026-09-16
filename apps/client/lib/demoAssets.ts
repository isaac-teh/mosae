const assets: Record<string, number> = {
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
