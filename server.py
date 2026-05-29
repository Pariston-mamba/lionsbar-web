from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
import uvicorn
import os
import json
import random

app = FastAPI()
rooms = {}


class Player:
    def __init__(self, name, ws):
        self.name = name
        self.ws = ws
        self.hand = []
        self.hp = 3


class Room:
    def __init__(self):
        self.players = []
        self.turn = 0
        self.started = False
        self.last_play = None
        self.deck = ["A", "K", "Q"] * 6

    def deal(self):
        random.shuffle(self.deck)
        for p in self.players:
            p.hand = [self.deck.pop() for _ in range(3)]

    async def broadcast(self, msg):
        dead = []

        for p in self.players:
            try:
                await p.ws.send_text(json.dumps(msg))
            except:
                dead.append(p)

        for p in dead:
            self.players.remove(p)

    async def send_state(self):
        for i, p in enumerate(self.players):
            await p.ws.send_text(json.dumps({
                "type": "state",
                "your_hand": p.hand,
                "your_hp": p.hp,
                "turn": self.players[self.turn].name,
                "players": [
                    {
                        "name": x.name,
                        "hp": x.hp,
                        "cards": len(x.hand)
                    }
                    for x in self.players
                ]
            }))


@app.get("/")
async def root():
    return FileResponse("static/index.html")


@app.get("/app.js")
async def js():
    return FileResponse("static/app.js")


@app.websocket("/ws/{room_id}")
async def ws(websocket: WebSocket, room_id: str):
    await websocket.accept()

    if room_id not in rooms:
        rooms[room_id] = Room()

    room = rooms[room_id]
    player = None

    try:
        while True:
            data = json.loads(await websocket.receive_text())

            if data["type"] == "join":
                player = Player(data["name"], websocket)
                room.players.append(player)

                await room.broadcast({
                    "type": "log",
                    "msg": f"{player.name} 加入房间"
                })

            elif data["type"] == "start":
                room.started = True
                room.deal()
                await room.broadcast({
                    "type": "log",
                    "msg": "游戏开始"
                })
                await room.send_state()

            elif data["type"] == "play":
                if room.players[room.turn] != player:
                    continue

                card = data["card"]

                if card in player.hand:
                    player.hand.remove(card)

                    room.last_play = {
                        "player": player,
                        "card": card
                    }

                    await room.broadcast({
                        "type": "log",
                        "msg": f"{player.name} 出了一张牌"
                    })

                    room.turn = (room.turn + 1) % len(room.players)
                    await room.send_state()

            elif data["type"] == "challenge":
                if room.last_play:
                    liar = random.choice([True, False])

                    if liar:
                        room.last_play["player"].hp -= 1
                        msg = f"{room.last_play['player'].name} 被抓包！扣1血"
                    else:
                        player.hp -= 1
                        msg = f"{player.name} 质疑失败！扣1血"

                    await room.broadcast({
                        "type": "log",
                        "msg": msg
                    })

                    await room.send_state()

    except WebSocketDisconnect:
        if player and player in room.players:
            room.players.remove(player)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
