#!/usr/bin/env python3
"""Analyse the checked-in soundtrack library once and write its timing sidecar.

Requires the existing offline-analysis dependencies in poc/lyria/requirements.txt.
Pixabay source files stay in PIXABAY_MUSIC_DIR and are never copied by this script.
"""
import json
import os
from pathlib import Path

import librosa
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
MUSIC = ROOT / "services/api/fixtures/music"
LIBRARY = MUSIC / "library.json"
MANIFEST = MUSIC / "pixabay-manifest.json"
OUT = MUSIC / "music-analysis.json"
PIXABAY = Path(os.environ.get("PIXABAY_MUSIC_DIR", "/Users/isaacteh/mosae-music-import"))


def analyze(path: Path) -> dict:
    y, sr = librosa.load(path, sr=None, mono=True)
    duration = len(y) / sr
    tempo, frames = librosa.beat.beat_track(y=y, sr=sr, units="frames", trim=True)
    beats = librosa.frames_to_time(frames, sr=sr).tolist()
    # A stable pulse is needed for snapping. Reject transient/noisy estimates.
    intervals = np.diff(beats)
    regularity = float(np.std(intervals) / np.mean(intervals)) if len(intervals) >= 4 and np.mean(intervals) else 1.0
    bpm = float(np.asarray(tempo).reshape(-1)[0])
    pulse = len(beats) >= 12 and regularity < 0.16 and 50 <= bpm <= 210

    hop = 512
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=hop)[0]
    rms_times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)
    # Coarse 4-second windows yield interpretable energy sections and resist noise.
    sections = []
    for start in np.arange(0, duration, 4.0):
        end = min(duration, start + 4.0)
        mask = (rms_times >= start) & (rms_times < end)
        energy = float(np.mean(rms[mask])) if np.any(mask) else 0.0
        sections.append({"startSec": round(float(start), 3), "endSec": round(float(end), 3), "energy": round(energy, 4)})
    values = np.array([s["energy"] for s in sections])
    if len(values):
        low, high = np.quantile(values, [0.33, 0.67])
        for section in sections:
            section["level"] = "low" if section["energy"] <= low else "high" if section["energy"] >= high else "medium"

    # Detect a sustained drop relative to the body as the outro; otherwise use
    # the final 12 seconds. The ending marker is the last pulse near that tail.
    body = [s["energy"] for s in sections if s["startSec"] < duration * 0.75]
    body_level = float(np.median(body)) if body else 0.0
    candidates = [s["startSec"] for s in sections if s["startSec"] >= duration * 0.55 and s["energy"] < body_level * 0.72]
    outro = candidates[0] if candidates else max(0.0, duration - 12.0)

    # Downbeat phase is chosen from beat-synchronous onset strength, rather than
    # assuming beat zero is always the first bar. Bars are four-beat groups.
    if pulse:
        onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
        beat_frames = librosa.time_to_frames(np.asarray(beats), sr=sr, hop_length=hop)
        strengths = [float(onset[min(max(int(frame), 0), len(onset) - 1)]) for frame in beat_frames]
        phase = max(range(min(4, len(strengths))), key=lambda p: np.mean(strengths[p::4]))
        downbeats = beats[phase::4]
        downbeat_strength = strengths[phase::4]
    else:
        downbeats = []
        downbeat_strength = []
    tail_downbeats = [beat for beat in downbeats if beat <= outro]
    tail_beats = [beat for beat in beats if beat <= outro]
    last_downbeat = tail_downbeats[-1] if tail_downbeats else tail_beats[-1] if tail_beats else max(0.0, duration - 1.0)
    bars = [{"startSec": round(float(start), 3), "endSec": round(float(end), 3)} for start, end in zip(downbeats, downbeats[1:])]
    return {
        "durationSec": round(duration, 3),
        "bpm": round(bpm, 2),
        "hasPulse": pulse,
        "pulseRegularity": round(regularity, 4),
        "beatsSec": [round(float(t), 3) for t in beats] if pulse else [],
        "downbeatsSec": [round(float(t), 3) for t in downbeats],
        "downbeatStrength": [round(float(value), 4) for value in downbeat_strength],
        "bars": bars,
        "energySections": sections,
        "ending": {"lastStrongDownbeatSec": round(float(last_downbeat), 3), "outroStartSec": round(float(outro), 3)},
    }


def main() -> None:
    tracks = json.loads(LIBRARY.read_text())["tracks"]
    manifest = json.loads(MANIFEST.read_text())
    results = {}
    for track in tracks:
        if track["id"].startswith("pixabay-"):
            source = next((name for name, meta in manifest.items() if f"pixabay-{meta['sourceId']}" == track["id"]), None)
            if source is None:
                raise RuntimeError(f"No Pixabay source mapping for {track['id']}")
            audio = PIXABAY / source
        else:
            audio = MUSIC / track["file"]
        if not audio.is_file():
            raise FileNotFoundError(audio)
        print(f"Analysing {track['id']}", flush=True)
        results[track["id"]] = analyze(audio)
    OUT.write_text(json.dumps({"version": 1, "tracks": results}, indent=2) + "\n")
    print(f"Wrote {len(results)} track analyses to {OUT}")


if __name__ == "__main__":
    main()
