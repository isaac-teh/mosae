from pathlib import Path

from insightface.app import FaceAnalysis

FaceAnalysis(
    name="buffalo_l",
    allowed_modules=["detection", "recognition"],
    providers=["CPUExecutionProvider"],
).prepare(ctx_id=-1, det_size=(640, 640))

root = Path.home() / ".insightface" / "models" / "buffalo_l"
for model_file in root.iterdir():
    if model_file.name not in {"det_10g.onnx", "w600k_r50.onnx"}:
        model_file.unlink()
