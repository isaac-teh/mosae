export type TaggedPersonResult = {
  personId: string;
  name: string | null;
  momentCount: number;
  isMissed: boolean;
  shotIds?: string[];
  sampleUri?: string;
  sampleUris?: string[];
};

let pendingResult: TaggedPersonResult | null = null;

export function setTaggedPersonResult(result: TaggedPersonResult): void {
  pendingResult = result;
}

export function consumeTaggedPersonResult(): TaggedPersonResult | null {
  const result = pendingResult;
  pendingResult = null;
  return result;
}
