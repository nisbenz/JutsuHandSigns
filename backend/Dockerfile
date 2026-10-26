FROM python:3.12-slim

# OpenCV / MediaPipe runtime libraries.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libegl1 libgles2 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# The face landmarker model is gitignored, so fetch it at build time.
RUN mkdir -p models \
    && curl -fsSL -o models/face_landmarker.task \
       https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task

COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
