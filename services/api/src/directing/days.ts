// Day chapters follow the local calendar date already derived during ingest.
export type TripDay = { index: number; date: string | null; place: string | null; shotIds: string[] };
type DayShot = { id: string; day: string | null; localTime: string | null; place: string | null };

export function tripDays(shots: DayShot[]): TripDay[] {
  const byDate = new Map<string, DayShot[]>();
  const undated: DayShot[] = [];
  for (const shot of shots) {
    if (!shot.day) { undated.push(shot); continue; }
    byDate.set(shot.day, [...(byDate.get(shot.day) ?? []), shot]);
  }
  const days: TripDay[] = [...byDate.keys()].sort().map((date, i) => {
    const list = byDate.get(date)!.sort((a, b) => (a.localTime ?? "").localeCompare(b.localTime ?? ""));
    const counts = new Map<string, number>();
    for (const shot of list) if (shot.place) counts.set(shot.place, (counts.get(shot.place) ?? 0) + 1);
    const place = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
    return { index: i + 1, date, place, shotIds: list.map((shot) => shot.id) };
  });
  if (undated.length) days.push({ index: days.length + 1, date: null, place: null, shotIds: undated.map((shot) => shot.id) });
  return days;
}

export function daySummary(days: TripDay[]): string {
  const lines = days.map((day) => day.date === null
    ? `Undated: ${day.shotIds.join(", ")}`
    : `Day ${day.index}${day.place ? ` · ${day.place}` : ""}: ${day.shotIds.join(", ")}`);
  return `Build one chapter per day in this order, titled as given; undated photos go last.\n${lines.join("\n")}`;
}
