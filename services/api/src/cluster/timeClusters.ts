export type Datable = { id: string; localTime: string | null; createdAt: number };
export type PartOfDay = "morning" | "afternoon" | "evening" | "night";

export type EventCluster = {
  id: string;
  /** 1-based position in date order; 0 for the undated event. */
  dayIndex: number;
  date: string | null;
  part: PartOfDay | "undated";
  label: string;
  startLocal: string | null;
  endLocal: string | null;
  assetIds: string[];
};

export const EVENT_GAP_MS = 3 * 60 * 60 * 1000;

/**
 * Local wall-clock strings are compared as if they were UTC. The zone is
 * irrelevant here: ordering and gaps only need one consistent axis, and the
 * calendar date has to stay the local one.
 */
const wall = (localTime: string): number => Date.parse(`${localTime}Z`);

export function partOfDay(hour: number): PartOfDay {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

type Dated = { id: string; localTime: string; ms: number };

export function clusterByTime(items: Datable[]): EventCluster[] {
  const dated: Dated[] = [];
  const undated: Datable[] = [];
  for (const item of items) {
    const ms = item.localTime === null ? Number.NaN : wall(item.localTime);
    if (Number.isNaN(ms)) undated.push(item);
    else dated.push({ id: item.id, localTime: item.localTime as string, ms });
  }
  dated.sort((a, b) => a.ms - b.ms || a.id.localeCompare(b.id));
  undated.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

  const groups: Dated[][] = [];
  for (const item of dated) {
    const current = groups.at(-1);
    const last = current?.at(-1);
    const sameDay = last !== undefined && item.localTime.slice(0, 10) === last.localTime.slice(0, 10);
    if (current && last && sameDay && item.ms - last.ms <= EVENT_GAP_MS) current.push(item);
    else groups.push([item]);
  }

  const dates = [...new Set(groups.map((group) => group[0].localTime.slice(0, 10)))];
  const events: EventCluster[] = groups.map((group, index) => {
    const date = group[0].localTime.slice(0, 10);
    const dayIndex = dates.indexOf(date) + 1;
    const middle = group[Math.floor(group.length / 2)];
    const part = partOfDay(Number(middle.localTime.slice(11, 13)));
    return {
      id: `e${String(index + 1).padStart(3, "0")}`,
      dayIndex,
      date,
      part,
      label: `Day ${dayIndex}, ${part}`,
      startLocal: group[0].localTime,
      endLocal: group[group.length - 1].localTime,
      assetIds: group.map((entry) => entry.id),
    };
  });

  if (undated.length > 0) {
    events.push({ id: "undated", dayIndex: 0, date: null, part: "undated", label: "Undated", startLocal: null, endLocal: null, assetIds: undated.map((entry) => entry.id) });
  }
  return events;
}
