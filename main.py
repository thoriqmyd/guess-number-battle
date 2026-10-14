import asyncio
import json
import random
import re
import secrets
import string
from dataclasses import dataclass, field
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="Guess Battle")
app.mount("/static", StaticFiles(directory="static"), name="static")

ROOM_CODE_LENGTH = 5
MIN_NUMBER = 1
MAX_NUMBER = 100


@dataclass
class Player:
    player_id: str
    name: str
    websocket: Optional[WebSocket] = None
    secret_number: Optional[int] = None
    guesses: int = 0
    connected: bool = False


@dataclass
class Room:
    code: str
    players: dict[str, Player] = field(default_factory=dict)
    status: str = "waiting"  # waiting, choosing, playing, finished
    winner_id: Optional[str] = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


rooms: dict[str, Room] = {}


@app.get("/")
async def index():
    return FileResponse("static/index.html")


def make_room_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    while True:
        code = "".join(secrets.choice(alphabet) for _ in range(ROOM_CODE_LENGTH))
        if code not in rooms:
            return code


def safe_name(value) -> str:
    if not isinstance(value, str):
        return "Player"
    name = " ".join(value.strip().split())[:18]
    return name or "Player"


def valid_number(value) -> Optional[int]:
    # bool is a subclass of int in Python, so explicitly reject it.
    if isinstance(value, bool):
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    if str(value).strip() != str(number):
        return None
    if MIN_NUMBER <= number <= MAX_NUMBER:
        return number
    return None


async def send_json(player: Player, payload: dict):
    ws = player.websocket
    if ws is not None and player.connected:
        try:
            await ws.send_text(json.dumps(payload))
        except Exception:
            # Disconnect cleanup is handled by the WebSocket loop.
            pass


def opponent_of(room: Room, player_id: str) -> Optional[Player]:
    for pid, player in room.players.items():
        if pid != player_id:
            return player
    return None


async def broadcast_state(room: Room):
    for pid, player in list(room.players.items()):
        opponent = opponent_of(room, pid)
        await send_json(player, {
            "type": "state",
            "room_code": room.code,
            "status": room.status,
            "you": {
                "id": player.player_id,
                "name": player.name,
                "has_chosen": player.secret_number is not None,
                "guesses": player.guesses,
                "connected": player.connected,
            },
            "opponent": None if opponent is None else {
                "name": opponent.name,
                "has_chosen": opponent.secret_number is not None,
                "guesses": opponent.guesses,
                "connected": opponent.connected,
            },
            "winner_name": (
                room.players[room.winner_id].name
                if room.winner_id in room.players else None
            ),
            "is_winner": room.winner_id == pid if room.winner_id else False,
        })


async def websocket_handler(websocket: WebSocket):
    await websocket.accept()
    player_id = None
    room = None

    try:
        first_raw = await websocket.receive_text()
        try:
            first = json.loads(first_raw)
        except json.JSONDecodeError:
            await websocket.send_text(json.dumps({"type": "error", "message": "Pesan tidak valid."}))
            await websocket.close()
            return

        action = first.get("type")
        name = safe_name(first.get("name"))

        if action == "create":
            code = make_room_code()
            player_id = secrets.token_urlsafe(18)
            room = Room(code=code)
            player = Player(player_id=player_id, name=name, websocket=websocket, connected=True)
            room.players[player_id] = player
            rooms[code] = room

        elif action == "join":
            code = str(first.get("room_code", "")).strip().upper()
            room = rooms.get(code)
            if room is None:
                await websocket.send_text(json.dumps({"type": "error", "message": "Room tidak ditemukan. Periksa kodenya."}))
                await websocket.close()
                return
            async with room.lock:
                if len(room.players) >= 2:
                    await websocket.send_text(json.dumps({"type": "error", "message": "Room sudah penuh."}))
                    await websocket.close()
                    return
                if room.status not in ("waiting", "choosing"):
                    await websocket.send_text(json.dumps({"type": "error", "message": "Permainan di room ini sudah dimulai."}))
                    await websocket.close()
                    return
                player_id = secrets.token_urlsafe(18)
                room.players[player_id] = Player(
                    player_id=player_id, name=name, websocket=websocket, connected=True
                )

        elif action == "reconnect":
            code = str(first.get("room_code", "")).strip().upper()
            candidate_id = first.get("player_id")
            room = rooms.get(code)
            if room is None or not isinstance(candidate_id, str) or candidate_id not in room.players:
                await websocket.send_text(json.dumps({"type": "error", "message": "Sesi room tidak ditemukan. Buat room baru atau gabung lagi."}))
                await websocket.close()
                return
            player_id = candidate_id
            async with room.lock:
                player = room.players[player_id]
                player.websocket = websocket
                player.connected = True

        else:
            await websocket.send_text(json.dumps({"type": "error", "message": "Aksi awal tidak dikenal."}))
            await websocket.close()
            return

        player = room.players[player_id]
        await send_json(player, {
            "type": "joined",
            "room_code": room.code,
            "player_id": player_id,
            "name": player.name,
        })
        await broadcast_state(room)

        while True:
            raw = await websocket.receive_text()
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                await send_json(player, {"type": "error", "message": "Format pesan tidak valid."})
                continue

            message_type = message.get("type")
            async with room.lock:
                # A stale socket from before a reconnect must not control this player.
                if player.websocket is not websocket:
                    await websocket.close()
                    return

                if message_type == "choose_number":
                    number = valid_number(message.get("number"))
                    if number is None:
                        await send_json(player, {
                            "type": "error",
                            "message": f"Pilih bilangan bulat dari {MIN_NUMBER} sampai {MAX_NUMBER}.",
                        })
                        continue
                    if room.status == "finished":
                        await send_json(player, {"type": "error", "message": "Ronde sudah selesai. Buat room baru untuk bermain lagi."})
                        continue
                    if room.status == "playing":
                        await send_json(player, {"type": "error", "message": "Angka rahasia sudah dikunci."})
                        continue

                    player.secret_number = number
                    if len(room.players) == 2 and all(p.secret_number is not None for p in room.players.values()):
                        room.status = "playing"
                        for p in room.players.values():
                            await send_json(p, {"type": "notice", "message": "Kedua angka sudah dipilih. Battle dimulai!"})
                    else:
                        room.status = "choosing"
                        await send_json(player, {"type": "notice", "message": "Angka rahasia tersimpan. Menunggu lawan memilih angka."})
                    await broadcast_state(room)

                elif message_type == "guess":
                    number = valid_number(message.get("number"))
                    if number is None:
                        await send_json(player, {
                            "type": "error",
                            "message": f"Masukkan bilangan bulat dari {MIN_NUMBER} sampai {MAX_NUMBER}.",
                        })
                        continue
                    if room.status != "playing":
                        await send_json(player, {"type": "error", "message": "Game belum dimulai atau sudah selesai."})
                        continue
                    if room.winner_id is not None:
                        await send_json(player, {"type": "error", "message": "Ronde sudah selesai."})
                        continue

                    opponent = opponent_of(room, player_id)
                    if opponent is None or opponent.secret_number is None:
                        await send_json(player, {"type": "error", "message": "Angka lawan belum tersedia."})
                        continue

                    player.guesses += 1
                    if number == opponent.secret_number:
                        room.winner_id = player_id
                        room.status = "finished"
                        await send_json(player, {
                            "type": "guess_result",
                            "result": "correct",
                            "guess": number,
                            "message": "Tepat! Kamu memenangkan Guess Battle!",
                            "your_guesses": player.guesses,
                        })
                        await send_json(opponent, {
                            "type": "opponent_won",
                            "winner_name": player.name,
                            "message": f"{player.name} berhasil menebak angka kamu lebih dulu.",
                        })
                    elif number < opponent.secret_number:
                        await send_json(player, {
                            "type": "guess_result",
                            "result": "low",
                            "guess": number,
                            "message": "Terlalu kecil. Coba angka yang lebih tinggi.",
                            "your_guesses": player.guesses,
                        })
                    else:
                        await send_json(player, {
                            "type": "guess_result",
                            "result": "high",
                            "guess": number,
                            "message": "Terlalu besar. Coba angka yang lebih rendah.",
                            "your_guesses": player.guesses,
                        })
                    await broadcast_state(room)

                elif message_type == "ping":
                    await send_json(player, {"type": "pong"})

                else:
                    await send_json(player, {"type": "error", "message": "Perintah tidak dikenal."})

    except WebSocketDisconnect:
        pass
    except Exception:
        # Avoid leaking internal exception details to the browser.
        pass
    finally:
        if room is not None and player_id is not None:
            async with room.lock:
                player = room.players.get(player_id)
                if player is not None and player.websocket is websocket:
                    player.connected = False
                    player.websocket = None
                    await broadcast_state(room)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket_handler(websocket)
