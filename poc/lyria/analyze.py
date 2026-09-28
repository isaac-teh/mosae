"""Measure encoded duration and beat timing in generated MP3s using librosa."""
import json,sys,librosa,numpy as np
from pathlib import Path
p=Path(__file__).parent/'out'
rows=[]
for f in sorted(p.glob('*.mp3')):
 try:
  y,sr=librosa.load(f,sr=None,mono=True)
  tempo,frames=librosa.beat.beat_track(y=y,sr=sr,units='frames')
  times=librosa.frames_to_time(frames,sr=sr)
  intervals=np.diff(times)
  rows.append({'file':f.name,'duration_s':round(len(y)/sr,3),'sample_rate':sr,'beats':len(times),'beat_positions_s':[round(float(t),4) for t in times],'bpm_estimate':round(float(np.asarray(tempo).reshape(-1)[0]),2),'interval_mean_s':round(float(intervals.mean()),4) if len(intervals) else None,'interval_std_s':round(float(intervals.std()),4) if len(intervals) else None,'join_delta_dbfs':None})
 except Exception as e: rows.append({'file':f.name,'error':str(e)})
print(json.dumps(rows,indent=2))
(p/'analysis.json').write_text(json.dumps(rows,indent=2))
