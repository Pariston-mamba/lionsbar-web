from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
import uvicorn
import os
import json
import uuid
from game import GameSession

app = FastAPI()

rooms = {}
connections = {}


class Room:
    def __init__(self, room_id):
        self.room_id = room_id
        self.game = GameSession(room_id)
        self.clients = {}  # player_id -> websocket

    async def broadcast_log(self, msg):
        dead = []

        for pid, ws in self.clients.items():
            try:
                await ws.send_text(json.dumps({
                    "type": "log",
                    "msg": msg
                }))
            except:
                dead.append(pid)

        for pid in dead:
            self.remove_player(pid)

    async def sync_state(self):
        dead = []

        for pid, ws in self.clients.items():
            try:
                state = self.game.get_state_for(pid)

                await ws.send_text(json.dumps({
                    "type": "state",
                    **state
                }))
            except:
                dead.append(pid)

        for pid in dead:
            self.remove_player(pid)

    def remove_player(self, player_id):
        if player_id in self.clients:
            del self.clients[player_id]

        self.game.players = [
            p for p in self.game.players
            if p.player_id != player_id
        ]


@app.get("/")
async def root():
    return FileResponse("static/index.html")


@app.get("/app.js")
async def app_js():
    return FileResponse("static/app.js")


@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    await websocket.accept()

    if room_id not in rooms:
        rooms[room_id] = Room(room_id)

    room = rooms[room_id]
    player_id = None

    try:
        while True:
            data = json.loads(await websocket.receive_text())
            action = data["type"]

            if action == "join":
                name = data["name"].strip()

                if not name:
                    continue

                # 防止同名重复加入
                existing = next(
                    (p for p in room.game.players if p.display_name == name),
                    None
                )

                if existing:
                    player_id = existing.player_id
                    room.clients[player_id] = websocket
                else:
                    player_id = str(uuid.uuid4())

                    ok, msg = room.game.add_player(player_id, name)

                    if not ok:
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "msg": msg
                        }))
                        continue

                    room.clients[player_id] = websocket

                connections[websocket] = player_id

                await room.broadcast_log(f"{name} 加入房间")
                await room.sync_state()

            elif action == "start":
                ok, msg = room.game.start_game()

                await room.broadcast_log(msg)
                await room.sync_state()

            elif action == "play":
                if not player_id:
                    continue

                card_index = data["index"]

                ok, msg = room.game.play_cards(
                    player_id,
                    [card_index]
                )

                await room.broadcast_log(msg)
                await room.sync_state()

            elif action == "challenge":
                if not room.game.last_claim:
                    continue

                liar = room.game.check_lie()

                if liar:
                    room.game.apply_damage(
                        room.game.last_claim.player_id
                    )
                    await room.broadcast_log("抓包成功！")
                else:
                    room.game.apply_damage(player_id)
                    await room.broadcast_log("质疑失败！")

                winner = room.game.check_winner()

                if winner:
                    await room.broadcast_log(
                        f"{winner.display_name} 胜利！"
                    )
                else:
                    room.game.reset_round()

                await room.sync_state()

    except WebSocketDisconnect:
        if player_id:
            room.remove_player(player_id)

        if not room.clients:
            del rooms[room_id]


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
