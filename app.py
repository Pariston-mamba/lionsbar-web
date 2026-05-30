import asyncio
import secrets
import string
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from game import MAX_HP, MAX_PLAY_CARDS, MAX_PLAYERS, GameSession, GameState

BASE_DIR = Path(__file__).resolve().parent
ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
ROOM_TTL_SECONDS = 60 * 60 * 6
MAX_LOG_LINES = 60

ERROR_TEXT = {
    "game_already_started": "游戏已经开始，不能中途加入。请用原本的浏览器重连。",
    "room_full": "房间已满，最多 6 人。",
    "already_joined": "你已经在房间里了。",
    "need_two_players": "至少需要 2 名玩家才能开始。",
    "already_started": "游戏已经开始。",
    "not_player": "你不是这个房间的玩家。",
    "not_your_turn": "还没轮到你。",
    "eliminated": "你已经出局。",
    "select_at_least_one": "请至少选择 1 张牌。",
    "max_cards": f"一次最多只能出 {MAX_PLAY_CARDS} 张牌。",
    "duplicate_card": "不能重复选择同一张牌。",
    "invalid_card_index": "牌的位置无效，请刷新后重试。",
    "bad_phase": "现在不能执行这个操作。",
    "bad_room": "找不到这个房间。",
    "bad_name": "请输入 1 到 16 个字符的名字。",
    "bad_token": "连接身份无效，请刷新页面重试。",
    "nothing_to_challenge": "现在没有可以质疑的出牌。",
}


class CreateRoomRequest(BaseModel):
    name: str | None = None


@dataclass
class ClientSocket:
    websocket: WebSocket
    token: str


@dataclass
class WebRoom:
    code: str
    session: GameSession = field(default_factory=lambda: GameSession(0, 0))
    phase: str = "lobby"
    allow_pass: bool = False
    owner_token: str | None = None
    token_to_player_id: dict[str, int] = field(default_factory=dict)
    player_id_to_token: dict[int, str] = field(default_factory=dict)
    connections: dict[str, set[WebSocket]] = field(default_factory=dict)
    log: list[dict[str, Any]] = field(default_factory=list)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    created_at: float = field(default_factory=time.time)
    last_seen_at: float = field(default_factory=time.time)

    def touch(self):
        self.last_seen_at = time.time()

    def connected_tokens(self) -> set[str]:
        return {token for token, sockets in self.connections.items() if sockets}

    def add_log(self, text: str, kind: str = "info", data: dict[str, Any] | None = None):
        self.log.append(
            {
                "time": int(time.time()),
                "kind": kind,
                "text": text,
                "data": data or {},
            }
        )
        if len(self.log) > MAX_LOG_LINES:
            self.log = self.log[-MAX_LOG_LINES:]


rooms: dict[str, WebRoom] = {}
rooms_lock = asyncio.Lock()
app = FastAPI(title="狮子酒吧 Web")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@app.get("/")
async def index():
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/api/health")
async def health():
    return {"ok": True, "rooms": len(rooms)}


@app.post("/api/rooms")
async def create_room(_: CreateRoomRequest):
    await cleanup_rooms()
    async with rooms_lock:
        code = make_room_code()
        while code in rooms:
            code = make_room_code()

        room = WebRoom(code=code)
        room.add_log("房间已创建。邀请朋友打开链接，输入名字后加入。", "system")
        rooms[code] = room
        return {"code": code, "url": f"/?room={code}"}


@app.websocket("/ws/{room_code}")
async def websocket_room(websocket: WebSocket, room_code: str):
    code = normalize_room_code(room_code)
    await websocket.accept()

    room = rooms.get(code)
    if not room:
        await websocket.send_json({"type": "error", "message": ERROR_TEXT["bad_room"]})
        await websocket.close(code=4404)
        return

    token: str | None = None
    try:
        first = await websocket.receive_json()
        if first.get("type") != "join":
            await websocket.send_json({"type": "error", "message": "连接格式错误。"})
            await websocket.close(code=4400)
            return

        token = normalize_token(first.get("token"))
        name = normalize_name(first.get("name"))
        if not token:
            await websocket.send_json({"type": "error", "message": ERROR_TEXT["bad_token"]})
            await websocket.close(code=4401)
            return
        if not name:
            await websocket.send_json({"type": "error", "message": ERROR_TEXT["bad_name"]})
            await websocket.close(code=4400)
            return

        async with room.lock:
            ok, message = join_room(room, token, name)
            if not ok:
                await websocket.send_json({"type": "error", "message": message})
                await websocket.close(code=4409)
                return
            room.connections.setdefault(token, set()).add(websocket)
            room.touch()

        await broadcast_state(room)

        while True:
            payload = await websocket.receive_json()
            result_message = await handle_action(room, token, payload)
            if result_message:
                await websocket.send_json({"type": "toast", "message": result_message})
            await broadcast_state(room)

    except WebSocketDisconnect:
        pass
    finally:
        if token:
            async with room.lock:
                sockets = room.connections.get(token)
                if sockets and websocket in sockets:
                    sockets.remove(websocket)
                room.touch()
            await broadcast_state(room)


def make_room_code() -> str:
    return "".join(secrets.choice(ROOM_ALPHABET) for _ in range(4))


def normalize_room_code(value: str) -> str:
    return "".join(ch for ch in str(value or "").upper() if ch.isalnum())[:6]


def normalize_token(value: Any) -> str | None:
    text = str(value or "").strip()
    if 12 <= len(text) <= 80:
        return text
    return None


def normalize_name(value: Any) -> str | None:
    text = " ".join(str(value or "").strip().split())
    if 1 <= len(text) <= 16:
        return text
    return None


def new_player_id(room: WebRoom) -> int:
    existing = {player.discord_id for player in room.session.players}
    player_id = secrets.randbelow(2_000_000_000) + 1
    while player_id in existing:
        player_id = secrets.randbelow(2_000_000_000) + 1
    return player_id


def join_room(room: WebRoom, token: str, name: str) -> tuple[bool, str]:
    if token in room.token_to_player_id:
        player = room.session.get_player(room.token_to_player_id[token])
        if player and room.session.state == GameState.WAITING:
            player.display_name = name
        return True, "reconnected"

    player_id = new_player_id(room)
    ok, key = room.session.add_player(player_id, name)
    if not ok:
        return False, ERROR_TEXT.get(key, key)

    room.token_to_player_id[token] = player_id
    room.player_id_to_token[player_id] = token
    if not room.owner_token:
        room.owner_token = token
    room.add_log(f"{name} 加入了房间。", "join")
    return True, "joined"


async def handle_action(room: WebRoom, token: str, payload: dict[str, Any]) -> str | None:
    action = payload.get("type")
    if action == "ping":
        room.touch()
        return None

    async with room.lock:
        room.touch()
        player_id = room.token_to_player_id.get(token)
        player = room.session.get_player(player_id) if player_id else None
        if not player:
            return ERROR_TEXT["not_player"]

        if action == "start":
            return handle_start(room, player.display_name)
        if action == "play":
            indices = payload.get("indices")
            if not isinstance(indices, list):
                return "请选择要出的牌。"
            try:
                card_indices = [int(i) for i in indices]
            except (TypeError, ValueError):
                return ERROR_TEXT["invalid_card_index"]
            return handle_play(room, player_id, card_indices)
        if action == "challenge":
            return handle_challenge(room, player_id)
        if action == "pass":
            return handle_pass(room, player_id)
        if action == "rematch":
            return handle_rematch(room)

    return None


def handle_start(room: WebRoom, starter_name: str) -> str | None:
    ok, key = room.session.start_game()
    if not ok:
        return ERROR_TEXT.get(key, key)

    room.phase = "play"
    room.allow_pass = False
    current = room.session.get_current_player()
    room.add_log(
        f"{starter_name} 开始了游戏。本轮桌面牌是 {room.session.table_rank}，由 {current.display_name} 先出牌。",
        "system",
    )
    return None


def handle_play(room: WebRoom, player_id: int, indices: list[int]) -> str | None:
    if room.session.state != GameState.PLAYING or room.phase != "play":
        return ERROR_TEXT["bad_phase"]
    if room.session.get_current_player().discord_id != player_id:
        return ERROR_TEXT["not_your_turn"]

    ok, key = room.session.play_cards(player_id, indices)
    if not ok:
        return ERROR_TEXT.get(key, key)

    claim = room.session.last_claim
    player = room.session.get_player(player_id)
    room.add_log(
        f"{player.display_name} 打出了 {claim.claimed_count} 张牌，声称全是 {claim.claimed_rank}。",
        "play",
    )

    contenders = room.session.other_players_with_cards(claim.player_id)
    if not contenders:
        room.add_log("其他玩家都没有手牌，本轮结束，重新发牌。", "system")
        room.session.reset_round()
        room.phase = "play"
        room.allow_pass = False
        current = room.session.get_current_player()
        room.add_log(f"新一轮开始，桌面牌是 {room.session.table_rank}。轮到 {current.display_name}。", "system")
        return None

    room.phase = "challenge"
    if len(contenders) == 1:
        forced = contenders[0]
        room.session.set_current_player(forced.discord_id)
        room.allow_pass = False
        room.add_log(f"{forced.display_name} 是唯一还有手牌的玩家，必须质疑。", "system")
        return None

    room.session.advance_turn(skip_empty=True)
    challenger = room.session.get_current_player()
    room.allow_pass = True
    room.add_log(f"轮到 {challenger.display_name}：可以质疑，也可以放行并继续出牌。", "system")
    return None


def handle_pass(room: WebRoom, player_id: int) -> str | None:
    if room.session.state != GameState.PLAYING or room.phase != "challenge":
        return ERROR_TEXT["bad_phase"]
    if room.session.get_current_player().discord_id != player_id:
        return ERROR_TEXT["not_your_turn"]
    if not room.allow_pass:
        return "你现在必须质疑，不能放行。"

    player = room.session.get_player(player_id)
    room.phase = "play"
    room.allow_pass = False
    room.add_log(f"{player.display_name} 选择放行。现在由 {player.display_name} 出牌。", "pass")
    return None


def handle_challenge(room: WebRoom, player_id: int) -> str | None:
    if room.session.state != GameState.PLAYING or room.phase != "challenge":
        return ERROR_TEXT["bad_phase"]
    if room.session.get_current_player().discord_id != player_id:
        return ERROR_TEXT["not_your_turn"]

    claim = room.session.last_claim
    if not claim:
        return ERROR_TEXT["nothing_to_challenge"]

    challenger = room.session.get_player(player_id)
    claimer = room.session.get_player(claim.player_id)
    is_lying = room.session.check_lie()
    loser_id = claim.player_id if is_lying else player_id
    loser = room.session.get_player(loser_id)
    cards = "、".join(claim.actual_cards)
    verdict = "质疑成功" if is_lying else "质疑失败"

    room.add_log(
        f"{challenger.display_name} 质疑了 {claimer.display_name}。翻开：{cards}。{verdict}，{loser.display_name} 失去 1 点生命。",
        "reveal",
        {
            "cards": claim.actual_cards,
            "claimedRank": claim.claimed_rank,
            "isLying": is_lying,
            "loserId": loser_id,
        },
    )

    loser, eliminated = room.session.apply_damage(loser_id)
    if eliminated:
        room.add_log(f"{loser.display_name} 出局。", "eliminated")

    winner = room.session.check_winner()
    if winner:
        room.phase = "ended"
        room.allow_pass = False
        room.add_log(f"游戏结束，{winner.display_name} 获胜！", "winner")
        return None

    if loser.is_alive:
        room.session.set_current_player(loser.discord_id)
    else:
        room.session.advance_turn(skip_empty=False)

    room.session.reset_round()
    room.phase = "play"
    room.allow_pass = False
    current = room.session.get_current_player()
    room.add_log(f"新一轮开始，桌面牌是 {room.session.table_rank}。轮到 {current.display_name}。", "system")
    return None


def handle_rematch(room: WebRoom) -> str | None:
    if room.session.state == GameState.PLAYING and room.phase != "ended":
        return "游戏进行中，不能直接重开。"

    previous = [
        (token, player.display_name)
        for token, player_id in room.token_to_player_id.items()
        if (player := room.session.get_player(player_id))
    ]
    room.session = GameSession(0, 0)
    room.phase = "lobby"
    room.allow_pass = False
    room.token_to_player_id.clear()
    room.player_id_to_token.clear()

    for token, name in previous:
        player_id = new_player_id(room)
        room.session.add_player(player_id, name)
        room.token_to_player_id[token] = player_id
        room.player_id_to_token[player_id] = token

    room.add_log("已回到大厅，可以重新开始。", "system")
    return None


async def broadcast_state(room: WebRoom):
    dead: list[tuple[str, WebSocket]] = []
    for token, sockets in list(room.connections.items()):
        for websocket in list(sockets):
            try:
                await websocket.send_json(build_state(room, token))
            except RuntimeError:
                dead.append((token, websocket))
            except Exception:
                dead.append((token, websocket))

    if dead:
        async with room.lock:
            for token, websocket in dead:
                room.connections.get(token, set()).discard(websocket)


def build_state(room: WebRoom, token: str) -> dict[str, Any]:
    session = room.session
    player_id = room.token_to_player_id.get(token)
    me = session.get_player(player_id) if player_id else None
    current = session.get_current_player() if session.players and session.state == GameState.PLAYING else None
    connected = room.connected_tokens()

    claim = None
    if session.last_claim:
        claimer = session.get_player(session.last_claim.player_id)
        claim = {
            "playerId": session.last_claim.player_id,
            "playerName": claimer.display_name if claimer else "未知玩家",
            "claimedRank": session.last_claim.claimed_rank,
            "claimedCount": session.last_claim.claimed_count,
        }

    winner = None
    if session.state == GameState.ENDED:
        alive = session.alive_players()
        winner = alive[0].display_name if alive else None

    players = []
    for player in session.players:
        player_token = room.player_id_to_token.get(player.discord_id)
        players.append(
            {
                "id": player.discord_id,
                "name": player.display_name,
                "hp": player.hp,
                "maxHp": MAX_HP,
                "alive": player.is_alive,
                "cardCount": len(player.hand),
                "connected": bool(player_token and player_token in connected),
                "current": bool(current and current.discord_id == player.discord_id),
            }
        )

    return {
        "type": "state",
        "room": {
            "code": room.code,
            "state": session.state.value,
            "phase": room.phase,
            "tableRank": session.table_rank,
            "tableCount": len(session.table_cards),
            "allowPass": room.allow_pass,
            "maxPlayCards": MAX_PLAY_CARDS,
            "maxPlayers": MAX_PLAYERS,
            "winner": winner,
            "claim": claim,
            "currentPlayerId": current.discord_id if current else None,
            "currentPlayerName": current.display_name if current else None,
        },
        "you": {
            "id": me.discord_id if me else None,
            "name": me.display_name if me else None,
            "hp": me.hp if me else None,
            "alive": me.is_alive if me else False,
            "hand": list(me.hand) if me else [],
            "current": bool(me and current and me.discord_id == current.discord_id),
        },
        "players": players,
        "log": room.log[-MAX_LOG_LINES:],
    }


async def cleanup_rooms():
    cutoff = time.time() - ROOM_TTL_SECONDS
    async with rooms_lock:
        for code, room in list(rooms.items()):
            has_connections = any(room.connections.values())
            if not has_connections and room.last_seen_at < cutoff:
                del rooms[code]
