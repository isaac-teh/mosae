export async function submitStory(
  userId: string,
  storyText: string,
  mediaRefs: string[]
): Promise<{ planId: string }> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/curate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, storyText, mediaRefs }),
  });

  if (!res.ok) {
    throw new Error("curation_request_failed");
  }

  return res.json();
}
