"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getStorageClient } from "@/lib/firebase/client";

export default function PickMemoryPage() {
  const [uploading, setUploading] = useState(false);
  const router = useRouter();

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);

    const refs: string[] = [];
    for (const file of Array.from(files)) {
      const storageRef = ref(getStorageClient(), `uploads/${Date.now()}-${file.name}`);
      await uploadBytes(storageRef, file);
      refs.push(await getDownloadURL(storageRef));
    }

    setUploading(false);
    const params = new URLSearchParams({ mediaRefs: JSON.stringify(refs) });
    router.push(`/tell-story?${params.toString()}`);
  }

  return (
    <main className="p-8">
      <h1 className="text-xl font-semibold">Pick the Memory</h1>
      <input
        type="file"
        multiple
        accept="image/*,video/*"
        disabled={uploading}
        onChange={(e) => handleFiles(e.target.files)}
      />
      {uploading && <p>Uploading...</p>}
    </main>
  );
}
