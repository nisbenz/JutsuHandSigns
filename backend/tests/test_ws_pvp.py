import base64

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

import main
from conftest import FixedDetector
from game.pvp import MAX_HP, PvpMatch

PLAYERS = [
    {"character": "naruto", "skills": ["Rasengan"]},
    {"character": "sasuke-uchiha", "skills": ["Chidori"]},
]


def frame_url():
    ok, buf = cv2.imencode(".jpg", np.zeros((120, 160, 3), dtype=np.uint8))
    return "data:image/jpeg;base64," + base64.b64encode(buf).decode("ascii")


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "_new_pvp_match", lambda players: PvpMatch(players, detector=FixedDetector()))
    with TestClient(main.app) as c:
        yield c


def test_start_and_frame(client):
    with client.websocket_connect("/ws/pvp") as ws:
        ws.send_json({"type": "start", "players": PLAYERS})
        assert ws.receive_json() == {"status": "started"}
        ws.send_json({"type": "frame", "image": frame_url()})
        msg = ws.receive_json()
        assert msg["status"] == "frame"
        assert msg["image"].startswith("data:image/jpeg;base64,")
        assert msg["state"]["stage"] == "countdown"
        assert [p["character"] for p in msg["state"]["players"]] == ["naruto", "sasuke-uchiha"]


@pytest.mark.parametrize("players", [
    PLAYERS[:1],
    PLAYERS * 2,
    [PLAYERS[0], {"character": "x", "skills": []}],
    [PLAYERS[0], {"skills": ["Rasengan"]}],
    "nope",
    None,
])
def test_bad_start(client, players):
    with client.websocket_connect("/ws/pvp") as ws:
        ws.send_json({"type": "start", "players": players})
        assert ws.receive_json() == {"status": "error", "message": "bad_start"}


def test_bad_image_keeps_socket_alive(client):
    with client.websocket_connect("/ws/pvp") as ws:
        ws.send_json({"type": "start", "players": PLAYERS})
        ws.receive_json()
        ws.send_json({"type": "frame", "image": "data:image/jpeg;base64,!!!notbase64"})
        assert ws.receive_json() == {"status": "error", "message": "bad_image"}
        ws.send_json({"type": "frame", "image": frame_url()})
        assert ws.receive_json()["status"] == "frame"


def test_rematch_resets(client, monkeypatch):
    with client.websocket_connect("/ws/pvp") as ws:
        ws.send_json({"type": "start", "players": PLAYERS})
        ws.receive_json()
        ws.send_json({"type": "frame", "image": frame_url()})
        ws.receive_json()
        ws.send_json({"type": "start", "players": PLAYERS})
        assert ws.receive_json() == {"status": "started"}
        ws.send_json({"type": "frame", "image": frame_url()})
        state = ws.receive_json()["state"]
        assert state["stage"] == "countdown"
        assert [p["hp"] for p in state["players"]] == [MAX_HP, MAX_HP]


def test_frames_before_start_are_ignored(client):
    with client.websocket_connect("/ws/pvp") as ws:
        ws.send_json({"type": "frame", "image": frame_url()})
        ws.send_json({"type": "start", "players": PLAYERS})
        assert ws.receive_json() == {"status": "started"}
