"""Crossfade a one-minute excerpt from two independent outputs; report objective seam metrics."""
import librosa,numpy as np,soundfile as sf
from pathlib import Path
p=Path(__file__).parent/'out'
a,sr=librosa.load(p/'tender.mp3',sr=None,mono=True,duration=60)
b,sr2=librosa.load(p/'reflective.mp3',sr=None,mono=True,duration=60)
assert sr==sr2
n=sr*2
fade=np.linspace(0,1,n,endpoint=True)
y=np.concatenate([a[:-n],a[-n:]*(1-fade)+b[:n]*fade,b[n:]])
sf.write(p/'joined_demo.wav',y,sr)
join=58.0
# Compare equal 1-second windows immediately before and after fade ends (join at 59s).
center=59*sr
before=y[center-sr:center]
after=y[center:center+sr]
def rms_db(x): return 20*np.log10(np.sqrt(np.mean(x*x))+1e-12)
def centroid(x): return float(librosa.feature.spectral_centroid(y=x,sr=sr).mean())
print({'join_time_s':59,'crossfade_s':2,'rms_before_dbfs':round(rms_db(before),3),'rms_after_dbfs':round(rms_db(after),3),'level_delta_db':round(rms_db(after)-rms_db(before),3),'centroid_before_hz':round(centroid(before),1),'centroid_after_hz':round(centroid(after),1),'centroid_delta_hz':round(centroid(after)-centroid(before),1)})
