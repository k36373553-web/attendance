import base64, cv2, numpy as np
from fastapi import FastAPI
from pydantic import BaseModel
from insightface.app import FaceAnalysis
app = FastAPI()
fa = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"]); fa.prepare(ctx_id=-1, det_size=(640, 640))
def dec(b):
    return cv2.imdecode(np.frombuffer(base64.b64decode(b.split(",")[-1]), np.uint8), cv2.IMREAD_COLOR)
def quality(img, f):
    x1, y1, x2, y2 = map(int, f.bbox)
    if (x2 - x1) < 110: return "Move closer to the camera"
    if f.det_score < 0.7: return "Face not clear"
    g = cv2.cvtColor(img[max(0, y1):y2, max(0, x1):x2], cv2.COLOR_BGR2GRAY)
    if cv2.Laplacian(g, cv2.CV_64F).var() < 40: return "Image too blurry (or possible screen/print spoof)"
    if not 60 < g.mean() < 210: return "Bad lighting"
    if abs(f.pose[1]) > 35 or abs(f.pose[0]) > 30: return "Face the camera more directly"
class Req(BaseModel): image: str
class Multi(BaseModel): frames: list[str]
@app.post("/embed")
def embed(r: Req):
    img = dec(r.image)
    if img is None: return {"error": "Invalid image"}
    fs = fa.get(img)
    if len(fs) != 1: return {"error": "Exactly one face must be visible"}
    e = quality(img, fs[0])
    return {"error": e} if e else {"embedding": [float(v) for v in fs[0].normed_embedding]}
@app.post("/verify")
def verify(r: Multi):
    """Active liveness: a burst of frames where the user turns their head. Needs yaw spread + consistent identity."""
    if len(r.frames) < 6: return {"error": "Liveness check needs more frames"}
    items = []
    for fr in r.frames:
        img = dec(fr)
        fs = fa.get(img) if img is not None else []
        if len(fs) != 1: return {"error": "Exactly one face must be visible during the check"}
        items.append((img, fs[0]))
    yaws = [float(f.pose[1]) for _, f in items]
    if max(yaws) - min(yaws) < 18: return {"error": "Liveness failed: please turn your head slowly left and right"}
    ok = [(abs(f.pose[1]), i, f) for i, (img, f) in enumerate(items) if abs(f.pose[1]) < 20 and quality(img, f) is None]
    if not ok: return {"error": "No clear front-facing frame. Look straight at the camera first"}
    _, bi, best = min(ok, key=lambda t: t[0])
    for _, f in items:
        if float(np.dot(best.normed_embedding, f.normed_embedding)) < 0.3: return {"error": "Face changed during the check"}
    return {"embedding": [float(v) for v in best.normed_embedding]}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
