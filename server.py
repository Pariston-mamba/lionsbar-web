from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
import uvicorn
import os
import json

app = FastAPI()

# 儲存所有房間
rooms = {}


class Room:
    def __init__(self):
        self.players = []

    async def broadcast(self, message):
        disconnected = []

        for player in self.players:
            try:
                await player.send_text(json.dumps(message))
            except:
                disconnected.append(player)

        for player in disconnected:
            if player in self.players:
                self.players.remove(player)


@app.get("/")
async def get():
    with open("index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())


@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    await websocket.accept()

    if room_id not in rooms:
        rooms[room_id] = Room()

    room = rooms[room_id]
    room.players.append(websocket)

    await room.broadcast({
        "type": "system",
        "message": f"玩家加入，目前 {len(room.players)} 人"
    })

    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)

            if msg["type"] == "chat":
                await room.broadcast({
                    "type": "chat",
                    "message": msg["message"]
                })

            elif msg["type"] == "play":
                await room.broadcast({
                    "type": "play",
                    "player": msg["player"],
                    "card": msg["card"]
                })

            elif msg["type"] == "challenge":
                await room.broadcast({
                    "type": "challenge",
                    "player": msg["player"]
                })

    except WebSocketDisconnect:
        if websocket in room.players:
            room.players.remove(websocket)

        await room.broadcast({
            "type": "system",
            "message": f"玩家離開，目前 {len(room.players)} 人"
        })

        if len(room.players) == 0:
            del rooms[room_id]


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=port
    )
