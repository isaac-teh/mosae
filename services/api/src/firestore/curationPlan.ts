import { adminDb } from "../firebase/admin.js";

export interface CurationPlan {
  id: string;
  userId: string;
  storyText: string;
  selectedMediaRefs: string[];
  pacing: string;
  template: string;
  createdAt: number;
}

const COLLECTION = "curationPlans";

export async function saveCurationPlan(
  plan: Omit<CurationPlan, "id">
): Promise<string> {
  const docRef = adminDb.collection(COLLECTION).doc();
  await docRef.set(plan);
  return docRef.id;
}

export async function getCurationPlan(id: string): Promise<CurationPlan | null> {
  const snapshot = await adminDb.collection(COLLECTION).doc(id).get();
  if (!snapshot.exists) return null;
  return { id, ...(snapshot.data() as Omit<CurationPlan, "id">) };
}
