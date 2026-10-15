import { describe, expect, it } from "vitest";
import { DirectorFlowSchema, FlowActionSchema } from "./flow.js";

describe("director flow transcript text", () => {
  it("accepts exact typed person and missed-person answers while retaining old flow compatibility", () => {
    const legacy = { revision: 0, story: { answer: null, storySummary: null, mentionedPeople: [] }, people: [] };
    expect(DirectorFlowSchema.parse(legacy)).toMatchObject(legacy);
    expect(FlowActionSchema.parse({ type: "person", personId: "p1", name: "Daughter", answerText: "My daughter" })).toMatchObject({ answerText: "My daughter" });
    expect(FlowActionSchema.parse({ type: "missed-people", answer: "Grandpa and Grandma", people: [{ personId: "g1", name: "Grandpa" }, { personId: "g2", name: "Grandma" }] })).toMatchObject({ answer: "Grandpa and Grandma" });
    expect(DirectorFlowSchema.parse({ ...legacy, people: [{ personId: "p1", name: "Daughter", role: "child", confirmed: true, skipped: false, answerText: "My daughter", manualShotAdds: [], manualShotRemoves: [], faceIds: [], mergedInto: null }], missedAnswer: "Grandpa and Grandma" })).toMatchObject({ missedAnswer: "Grandpa and Grandma", people: [{ answerText: "My daughter" }] });
  });

  it("persists typed turns made after people have been confirmed", () => {
    const legacy = { revision: 0, story: { answer: "Japan trip", storySummary: null, mentionedPeople: [] }, people: [] };
    const action = { type: "missed-clarification-turn", question: "Add Kara again", reply: "I'll keep the people as confirmed.", stage: "post-confirmation" };
    expect(FlowActionSchema.parse(action)).toEqual(action);
    expect(DirectorFlowSchema.parse({ ...legacy, missedClarifications: [{ question: action.question, reply: action.reply, stage: action.stage }] })).toMatchObject({ missedClarifications: [{ question: action.question, reply: action.reply, stage: action.stage }] });
  });
});
