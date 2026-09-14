import { Router, type RequestHandler } from "express";
import { requireUser } from "../auth/requireUser.js";
import { curateStory } from "../gemini/curate.js";
import { saveCurationPlan } from "../firestore/curationPlan.js";

export function curateRouter(auth: RequestHandler = requireUser()): Router {
const router = Router();
router.use(auth);

router.post("/", async (req, res) => {
  const { storyText, mediaRefs } = req.body as {
    storyText: string;
    mediaRefs: string[];
  };

  let curation;
  try {
    curation = await curateStory(storyText, mediaRefs);
  } catch (error) {
    console.error("curation failed", error);
    res.status(502).json({ error: "curation_failed" });
    return;
  }

  const planId = await saveCurationPlan({
    userId: res.locals.userId,
    storyText,
    selectedMediaRefs: curation.selectedMediaRefs,
    pacing: curation.pacing,
    template: curation.template,
    createdAt: Date.now(),
  });

  res.status(201).json({ planId });
});
return router;
}
