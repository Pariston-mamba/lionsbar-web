import random
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


MAX_HP = 5
HAND_SIZE = 5
MAX_PLAY_CARDS = 3

TABLE_RANKS = ["A", "K", "Q"]
JOKER = "Joker"


class GameState(Enum):
    WAITING = "waiting"
    PLAYING = "playing"
    ENDED = "ended"


@dataclass
class Claim:
    player_id: str
    actual_cards: list[str]
    claimed_rank: str
    claimed_count: int


@dataclass
class Player:
    player_id: str
    display_name: str
    hp: int = MAX_HP
    hand: list[str] = field(default_factory=list)
    is_alive: bool = True


class GameSession:
    def __init__(self, room_id: str):
        self.room_id = room_id
        self.players: list[Player] = []
        self.state = GameState.WAITING
        self.current_turn = 0
        self.last_claim: Optional[Claim] = None
        self.table_cards: list[str] = []
        self.deck: list[str] = []
        self.table_rank = random.choice(TABLE_RANKS)

    # 玩家加入
    def add_player(self, player_id: str, display_name: str):
        if self.state != GameState.WAITING:
            return False, "游戏已开始"

        if any(p.player_id == player_id for p in self.players):
            return False, "已加入"

        self.players.append(Player(player_id, display_name))
        return True, "加入成功"

    # 找玩家
    def get_player(self, player_id: str):
        return next((p for p in self.players if p.player_id == player_id), None)

    # 当前玩家
    def get_current_player(self):
        return self.players[self.current_turn]

    # 活着玩家
    def alive_players(self):
        return [p for p in self.players if p.is_alive]

    # 建牌库
    def build_deck(self):
        deck = TABLE_RANKS * 10 + [JOKER, JOKER]
        random.shuffle(deck)
        return deck

    # 发牌
    def deal_cards(self):
        self.deck = self.build_deck()

        for player in self.alive_players():
            player.hand = []

            for _ in range(HAND_SIZE):
                if self.deck:
                    player.hand.append(self.deck.pop())

    # 开始游戏
    def start_game(self):
        if len(self.players) < 2:
            return False, "至少需要2人"

        self.state = GameState.PLAYING
        random.shuffle(self.players)
        self.current_turn = 0
        self.reset_round()

        return True, "游戏开始"

    # 出牌
    def play_cards(self, player_id: str, card_indices: list[int]):
        player = self.get_player(player_id)

        if not player:
            return False, "玩家不存在"

        if self.get_current_player().player_id != player_id:
            return False, "还没轮到你"

        if not card_indices:
            return False, "请选牌"

        if len(card_indices) > MAX_PLAY_CARDS:
            return False, "最多3张"

        if any(i >= len(player.hand) for i in card_indices):
            return False, "无效牌"

        actual_cards = []

        for i in sorted(card_indices, reverse=True):
            actual_cards.append(player.hand.pop(i))

        self.table_cards.extend(actual_cards)

        self.last_claim = Claim(
            player_id=player_id,
            actual_cards=actual_cards,
            claimed_rank=self.table_rank,
            claimed_count=len(actual_cards)
        )

        self.advance_turn()

        return True, "出牌成功"

    # 是否说谎
    def check_lie(self):
        if not self.last_claim:
            return False

        for card in self.last_claim.actual_cards:
            if card != self.table_rank and card != JOKER:
                return True

        return False

    # 扣血
    def apply_damage(self, player_id: str):
        player = self.get_player(player_id)

        if not player:
            return

        player.hp -= 1

        if player.hp <= 0:
            player.is_alive = False
            player.hand = []

    # 胜者
    def check_winner(self):
        alive = self.alive_players()

        if len(alive) == 1:
            self.state = GameState.ENDED
            return alive[0]

        return None

    # 换人
    def advance_turn(self):
        if not self.players:
            return

        total = len(self.players)

        for _ in range(total):
            self.current_turn = (self.current_turn + 1) % total

            player = self.players[self.current_turn]

            if player.is_alive and len(player.hand) > 0:
                return

    # 重置回合
    def reset_round(self):
        self.last_claim = None
        self.table_cards = []
        self.table_rank = random.choice(TABLE_RANKS)
        self.deal_cards()

    # 给前端状态
    def get_state_for(self, player_id: str):
        player = self.get_player(player_id)

        return {
            "your_hand": player.hand if player else [],
            "your_hp": player.hp if player else 0,
            "turn": self.get_current_player().display_name,
            "table_rank": self.table_rank,
            "players": [
                {
                    "name": p.display_name,
                    "hp": p.hp,
                    "cards": len(p.hand),
                    "alive": p.is_alive
                }
                for p in self.players
            ]
        }
