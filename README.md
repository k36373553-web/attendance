# Growthora Face Attendance (core build)
Run 3 services: MongoDB, face-service (port 8000), backend (5000), frontend (5173).
1. face-service: Python 3.11 or 3.12 is required; Python 3.14 is not supported by the ONNX Runtime/InsightFace dependencies. On Windows, install Python 3.11 if `py -3.11` is unavailable:
   ```powershell
   py install 3.11
   cd face-service
   py -3.11 -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install --upgrade pip
   python -m pip install -r requirements.txt
   python -m uvicorn main:app --host 127.0.0.1 --port 8000
   ```
   In Command Prompt, activate with `.venv\Scripts\activate.bat` instead. On macOS/Linux, create the venv with `python3.11 -m venv .venv` and activate it with `source .venv/bin/activate` before installing requirements.
2. backend: `cd backend && cp .env.example .env && npm i && npm run seed && npm start`
3. frontend: `cd frontend && npm i && npm run dev` (camera needs https or localhost)
Office IP: open https://ifconfig.me on the office WiFi and put the IP in backend/.env ALLOWED_OFFICE_IPS (or Settings API). Restart the backend after changing .env. Local/private requests are checked against the backend machine's public egress IP, which supports the local Vite proxy setup. If the office public IP changes, update the allowlist.
Threshold: default cosine 0.45 (Settings). Raise for fewer false accepts, lower for fewer false rejects; tune with real staff photos.
Liveness: only a passive sharpness/texture heuristic. It is NOT robust anti-spoofing; add MiniFASNet before relying on it.

## V2 additions
- Liveness: attendance sends a burst of frames while the user turns their head; face-service (/verify) needs a yaw spread of 18+ degrees, a clear front frame and a consistent identity. Still no trained anti-spoof model (MiniFASNet), so a determined attacker with a video may pass. Treat as a deterrent plus audit log.
- Tokens: 15-minute access token + 7-day refresh token (auto-refresh in the frontend).
- Leave = past working day with no record; Absent = checked in but never checked out; Sundays excluded.
- Late alerts: admin bell updates live over Server-Sent Events.
- Tuning: `python face-service/tune.py people/` (folders per person, jpg photos); test: `python face-service/test_service.py face.jpg`.
