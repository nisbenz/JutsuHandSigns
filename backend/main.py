import base64
import binascii
import os

import cv2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from captures import save_capture
from game.pvp import FakeDuelDetector, PvpMatch
from game.session import JutsuSession
from match import best_match
from traits import extract_traits

app = FastAPI(title="Which Shinobi Are You? - matching backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


def _decode_frame(data_url: str):
    try:
        b64data = data_url.split(",", 1)[1] if "," in data_url else data_url
        raw = base64.b64decode(b64data)
    except (binascii.Error, ValueError):
        return None
    if not raw:
        return None
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img


@app.websocket("/ws/match")
async def ws_match(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            message = await websocket.receive_json()
            if message.get("type") != "frame":
                continue

            try:
                image = _decode_frame(message.get("image", ""))
                if image is None:
                    await websocket.send_json({"status": "error", "message": "bad_image"})
                    continue

                traits = extract_traits(image)
                if not traits.get("detected"):
                    save_capture(image, traits, match=None)
                    await websocket.send_json({"status": "no_face"})
                    continue

                match = best_match(traits)
                save_capture(image, traits, match=match)
                await websocket.send_json({"status": "ok", "character": match})
            except Exception as exc:  # keep the socket alive on a bad frame
                print("frame processing error:", repr(exc))
                await websocket.send_json({"status": "error", "message": "processing_failed"})
    except WebSocketDisconnect:
        pass


def _encode_frame(image) -> str:
    ok, buf = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 80])
    if not ok:
        return ""
    return "data:image/jpeg;base64," + base64.b64encode(buf).decode("ascii")


@app.websocket("/ws/jutsu")
async def ws_jutsu(websocket: WebSocket):
    await websocket.accept()
    session = None
    try:
        while True:
            message = await websocket.receive_json()
            msg_type = message.get("type")

            if msg_type == "start":
                if session is not None:
                    session.close()
                session = JutsuSession(message.get("skill", "Rasengan"))
                await websocket.send_json({"status": "started"})
                continue

            if msg_type != "frame" or session is None:
                continue

            try:
                image = _decode_frame(message.get("image", ""))
                if image is None:
                    await websocket.send_json({"status": "error", "message": "bad_image"})
                    continue

                annotated, state = session.process_frame(image)
                await websocket.send_json({
                    "status": "frame",
                    "image": _encode_frame(annotated),
                    "state": state,
                })
            except Exception as exc:
                print("jutsu frame processing error:", repr(exc))
                await websocket.send_json({"status": "error", "message": "processing_failed"})
    except WebSocketDisconnect:
        pass
    finally:
        if session is not None:
            session.close()


# Dev only: a scripted detector that "performs" each player's signs, so the
# duel UI can be driven in a browser with nobody in front of the camera.
PVP_FAKE_DETECTOR = os.environ.get("PVP_FAKE_DETECTOR") == "1"


def _valid_pvp_players(players):
    if not isinstance(players, list) or len(players) != 2:
        return False
    for p in players:
        if not isinstance(p, dict) or not isinstance(p.get("character"), str):
            return False
        skills = p.get("skills")
        if not isinstance(skills, list) or not skills or not all(isinstance(s, str) and s for s in skills):
            return False
    return True


def _new_pvp_match(players):
    return PvpMatch(players, detector=FakeDuelDetector() if PVP_FAKE_DETECTOR else None)


@app.websocket("/ws/pvp")
async def ws_pvp(websocket: WebSocket):
    await websocket.accept()
    match = None
    try:
        while True:
            message = await websocket.receive_json()
            msg_type = message.get("type")

            if msg_type == "start":  # also used for rematch
                players = message.get("players")
                if not _valid_pvp_players(players):
                    await websocket.send_json({"status": "error", "message": "bad_start"})
                    continue
                if match is not None:
                    match.close()
                match = _new_pvp_match(players)
                await websocket.send_json({"status": "started"})
                continue

            if msg_type != "frame" or match is None:
                continue

            try:
                image = _decode_frame(message.get("image", ""))
                if image is None:
                    await websocket.send_json({"status": "error", "message": "bad_image"})
                    continue

                annotated, state = match.process_frame(image)
                await websocket.send_json({
                    "status": "frame",
                    "image": _encode_frame(annotated),
                    "state": state,
                })
            except Exception as exc:
                print("pvp frame processing error:", repr(exc))
                await websocket.send_json({"status": "error", "message": "processing_failed"})
    except WebSocketDisconnect:
        pass
    finally:
        if match is not None:
            match.close()
