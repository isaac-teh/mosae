import type { AgeBand, Cast, CastPerson, FaceRef, Interaction } from "./types.js";

const AGE_ORDER: Record<AgeBand, number> = {
  child: 0,
  teen: 1,
  adult: 2,
  senior: 3,
};

export function buildCast(input: {
  faces: FaceRef[];
  identities: Map<string, string>;
  interactions: Interaction[];
  source: Cast["source"];
}): Cast {
  const { faces, identities, interactions, source } = input;

  // 1. Ignore faces with prominence === "background" and faces absent from identities.
  const keptFaces = faces.filter(
    (f) => f.prominence !== "background" && identities.has(f.faceId),
  );

  if (keptFaces.length === 0) {
    return {
      people: [],
      core: [],
      focus: [],
      source,
    };
  }

  // Group kept faces by personId
  const facesByPerson = new Map<string, FaceRef[]>();
  const shotsByPerson = new Map<string, Set<string>>();
  const peopleShots = new Set<string>();

  for (const f of keptFaces) {
    const personId = identities.get(f.faceId)!;
    peopleShots.add(f.shotId);

    let pFaces = facesByPerson.get(personId);
    if (!pFaces) {
      pFaces = [];
      facesByPerson.set(personId, pFaces);
    }
    pFaces.push(f);

    let pShots = shotsByPerson.get(personId);
    if (!pShots) {
      pShots = new Set<string>();
      shotsByPerson.set(personId, pShots);
    }
    pShots.add(f.shotId);
  }

  // 2. Per person: faceIds, appearances, majority ageBand, initial confidence
  type PersonIntermediary = {
    personId: string;
    faceIds: string[];
    appearances: number;
    ageBand: AgeBand;
    splitVote: boolean;
    confidence: "high" | "low";
  };

  const personIntermediaries = new Map<string, PersonIntermediary>();

  for (const [personId, pFaces] of facesByPerson.entries()) {
    const faceIds = pFaces.map((f) => f.faceId);
    const appearances = shotsByPerson.get(personId)?.size ?? 0;

    const voteCounts: Partial<Record<AgeBand, number>> = {};
    let totalDefinedVotes = 0;

    for (const f of pFaces) {
      if (f.ageBand) {
        voteCounts[f.ageBand] = (voteCounts[f.ageBand] ?? 0) + 1;
        totalDefinedVotes++;
      }
    }

    let winningAgeBand: AgeBand = "adult";
    let winningVotes = 0;

    if (totalDefinedVotes === 0) {
      winningAgeBand = "adult";
      winningVotes = 0;
    } else {
      for (const band of Object.keys(AGE_ORDER) as AgeBand[]) {
        const count = voteCounts[band] ?? 0;
        if (count > winningVotes) {
          winningVotes = count;
          winningAgeBand = band;
        } else if (count === winningVotes && count > 0) {
          if (AGE_ORDER[band] > AGE_ORDER[winningAgeBand]) {
            winningAgeBand = band;
          }
        }
      }
    }

    // 6. Confidence is "low" when appearances < 2 or the winning ageBand holds 60% or less of that person's defined votes.
    const splitVote =
      totalDefinedVotes === 0 || winningVotes / totalDefinedVotes <= 0.6;
    const confidence: "high" | "low" =
      appearances < 2 || splitVote ? "low" : "high";

    personIntermediaries.set(personId, {
      personId,
      faceIds,
      appearances,
      ageBand: winningAgeBand,
      splitVote,
      confidence,
    });
  }

  // 3. peopleShots = distinct shotIds with at least one kept face.
  // A person is a core candidate when appearances / peopleShots.size >= 0.25.
  const coreCandidates: string[] = [];
  const totalPeopleShots = peopleShots.size;

  for (const [personId, info] of personIntermediaries.entries()) {
    if (totalPeopleShots > 0 && info.appearances / totalPeopleShots >= 0.25) {
      coreCandidates.push(personId);
    }
  }

  // Core = candidates that share at least one shot with another candidate. With exactly one candidate, core = that candidate.
  let core: string[] = [];
  if (coreCandidates.length === 1) {
    core = [coreCandidates[0]];
  } else if (coreCandidates.length > 1) {
    for (const p1 of coreCandidates) {
      const shots1 = shotsByPerson.get(p1)!;
      const sharesWithOther = coreCandidates.some((p2) => {
        if (p2 === p1) return false;
        const shots2 = shotsByPerson.get(p2)!;
        for (const s of shots1) {
          if (shots2.has(s)) return true;
        }
        return false;
      });
      if (sharesWithOther) {
        core.push(p1);
      }
    }
  }

  const coreSet = new Set(core);

  // 4. Role: core people with adult or senior -> "parent", core people with child or teen -> "child", everyone else -> "other".
  const people: CastPerson[] = [];

  for (const info of personIntermediaries.values()) {
    let role: "parent" | "child" | "other" = "other";
    const isCore = coreSet.has(info.personId);

    if (isCore) {
      if (info.ageBand === "adult" || info.ageBand === "senior") {
        role = "parent";
      } else if (info.ageBand === "child" || info.ageBand === "teen") {
        role = "child";
      }
    }

    people.push({
      personId: info.personId,
      ageBand: info.ageBand,
      role,
      appearances: info.appearances,
      faceIds: info.faceIds,
      confidence: info.confidence,
    });
  }

  // 5. Focus = the core children, or the whole core if there are none.
  const coreChildren = people
    .filter((p) => coreSet.has(p.personId) && p.role === "child")
    .map((p) => p.personId);

  const focus = coreChildren.length > 0 ? coreChildren : core;

  // 7. Interaction boost:
  // An interaction whose kind matches /carry|hold|hug/ between a core adult and a core child is evidence of a parent.
  // If a core adult has low confidence only because of a split vote and has such an interaction, raise them to "high".
  const coreChildSet = new Set(coreChildren);

  for (const p of people) {
    if (
      coreSet.has(p.personId) &&
      (p.ageBand === "adult" || p.ageBand === "senior") &&
      p.confidence === "low"
    ) {
      const info = personIntermediaries.get(p.personId)!;
      // "low confidence only because of a split vote" means appearances >= 2 and splitVote
      if (info.appearances >= 2 && info.splitVote) {
        const hasInteraction = interactions.some((interaction) => {
          if (!/carry|hold|hug/i.test(interaction.kind)) return false;
          const pFrom = identities.get(interaction.from);
          const pTo = identities.get(interaction.to);
          return (
            (pFrom === p.personId && pTo && coreChildSet.has(pTo)) ||
            (pTo === p.personId && pFrom && coreChildSet.has(pFrom))
          );
        });

        if (hasInteraction) {
          p.confidence = "high";
        }
      }
    }
  }

  return {
    people,
    core,
    focus,
    source,
  };
}
