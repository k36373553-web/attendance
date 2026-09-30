"""Usage: python test_service.py face.jpg  (face-service must be running)"""
import sys, json, base64, urllib.request
b = "data:image/jpeg;base64," + base64.b64encode(open(sys.argv[1], "rb").read()).decode()
r = urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:8000/embed", json.dumps({"image": b}).encode(), {"Content-Type": "application/json"}))
d = json.load(r); print(d.get("error") or f"OK, embedding length {len(d['embedding'])}")
