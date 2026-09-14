import { Router } from "express";
import { curateStory } from "../gemini/curate.js";
import { saveCurationPlan } from "../firestore/curationPlan.js";

export const curateRouter = Router();

curateRouter.post("/", async (req, res) => {
  const { userId, storyText, mediaRefs } = req.body as {
    userId: string;
    storyText: string;
    mediaRefs: string[];
  };

  let curation;
  try {
    curation = await curateStory(storyText, mediaRefs);
  } catch {
    res.status(502).json({ error: "curation_failed" });
    return;
  }

  const planId = await saveCurationPlan({
    userId,
    storyText,
    selectedMediaRefs: curation.selectedMediaRefs,
    pacing: curation.pacing,
    template: curation.template,
    createdAt: Date.now(),
  });

  res.status(201).json({ planId });
});
