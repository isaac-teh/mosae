"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { submitStory } from "@/lib/api";

export default function TellStoryPage() {
  return (
    <Suspense fallback={null}>
      <TellStoryForm />
    </Suspense>
  );
}

function TellStoryForm() {
  const [storyText, setStoryText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  async function handleSubmit() {
    setSubmitting(true);
    const mediaRefs = JSON.parse(searchParams.get("mediaRefs") ?? "[]");
    const { planId } = await submitStory("user-1", storyText, mediaRefs);
    setSubmitting(false);
    router.push(`/review-moments?planId=${planId}`);
  }

  return (
    <main className="p-8">
      <h1 className="text-xl font-semibold">Tell AI the Story</h1>
      <textarea
        className="w-full border p-2"
        value={storyText}
        onChange={(e) => setStoryText(e.target.value)}
        placeholder="Tell us about this memory..."
      />
      <button disabled={submitting} onClick={handleSubmit}>
        {submitting ? "Submitting..." : "Continue"}
      </button>
    </main>
  );
}
