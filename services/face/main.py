import base64
import os
import time
from contextlib import asynccontextmanager

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from insightface.app import FaceAnalysis

MODEL_VERSION = "arcface-buffalo_l-v1"
started = time.perf_counter()
model = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    model = FaceAnalysis(name="buffalo_l", allowed_modules=["detection", "recognition"], providers=["CPUExecutionProvider"])
    model.prepare(ctx_id=-1, det_size=(640, 640))
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/health")
def health():
    return {"ok": model is not None, "model": MODEL_VERSION, "uptimeSeconds": round(time.perf_counter() - started, 2)}


@app.post("/v1/faces")
async def faces(request: Request):
    raw = await request.body()
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(413, "image_too_large")
    image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(400, "invalid_image")
    height, width = image.shape[:2]
    output = []
    for face in model.get(image):
        x0, y0, x1, y1 = face.bbox.tolist()
        box = [max(0, y0 / height), max(0, x0 / width), min(1, y1 / height), min(1, x1 / width)]
        vector = np.asarray(face.normed_embedding, dtype=np.float32)
        vector /= max(float(np.linalg.norm(vector)), 1e-12)
        output.append({"bbox": box, "detScore": float(face.det_score), "embedding": vector.tolist()})
    return JSONResponse({"modelVersion": MODEL_VERSION, "width": width, "height": height, "faces": output})
