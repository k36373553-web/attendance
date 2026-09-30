"""Usage: python tune.py people/  (people/<name>/*.jpg, >=2 photos each, >=2 people). Prints FRR/FAR per threshold."""
import sys, os, glob, itertools, cv2, numpy as np
from insightface.app import FaceAnalysis
fa = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"]); fa.prepare(ctx_id=-1)
E = {}
for p in sorted(os.listdir(sys.argv[1])):
    E[p] = []
    for i in glob.glob(f"{sys.argv[1]}/{p}/*.jpg"):
        fs = fa.get(cv2.imread(i))
        if len(fs) == 1: E[p].append(fs[0].normed_embedding)
gen = np.array([a @ b for v in E.values() for a, b in itertools.combinations(v, 2)])
imp = np.array([a @ b for (_, u), (_, w) in itertools.combinations(E.items(), 2) for a in u for b in w])
print(f"genuine pairs={len(gen)} impostor pairs={len(imp)}")
for t in np.arange(0.25, 0.76, 0.05): print(f"threshold {t:.2f}  FRR={np.mean(gen < t):.3f}  FAR={np.mean(imp >= t):.3f}")
