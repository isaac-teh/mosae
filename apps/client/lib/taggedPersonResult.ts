export type TaggedPersonResult = {
  personId: string;
  name: string;
  momentCount: number;
  isMissed: boolean;
  sampleUri?: string;
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
