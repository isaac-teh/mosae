import { GoogleGenAI } from "@google/genai";

export interface CurationResult {
  selectedMediaRefs: string[];
  pacing: string;
  template: string;
}

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function buildPrompt(storyText: string, mediaRefs: string[]): string {
  return [
    "You are directing a short personal film from a user's real photos/videos.",
    `The user described the story they want: "${storyText}"`,
    `Available media references: ${JSON.stringify(mediaRefs)}`,
    "Select which media to include, in what order, and choose a pacing and template.",
    'Respond with ONLY JSON matching: { "selectedMediaRefs": string[], "pacing": string, "template": string }',
  ].join("\n");
}

async function callGemini(storyText: string, mediaRefs: string[]): Promise<CurationResult> {
  const response = await client.models.generateContent({
    model: "gemini-2.5-flash",
    contents: buildPrompt(storyText, mediaRefs),
  });
  return JSON.parse(response.text) as CurationResult;
}

export async function curateStory(
  storyText: string,
  mediaRefs: string[]
): Promise<CurationResult> {
  try {
    return await callGemini(storyText, mediaRefs);
  } catch (firstError) {
    return await callGemini(storyText, mediaRefs);
  }
}
