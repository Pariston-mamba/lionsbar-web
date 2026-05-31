const els = {
  connectionStatus: document.querySelector("#connectionStatus"),
  rulesBtn: document.querySelector("#rulesBtn"),
  manageBtn: document.querySelector("#manageBtn"),
  leaveRoomBtn: document.querySelector("#leaveRoomBtn"),
  rulesModal: document.querySelector("#rulesModal"),
  rulesBackdrop: document.querySelector("#rulesBackdrop"),
  closeRulesBtn: document.querySelector("#closeRulesBtn"),
  manageModal: document.querySelector("#manageModal"),
  manageBackdrop: document.querySelector("#manageBackdrop"),
  closeManageBtn: document.querySelector("#closeManageBtn"),
  managePlayersList: document.querySelector("#managePlayersList"),
  disbandRoomBtn: document.querySelector("#disbandRoomBtn"),
  homePanel: document.querySelector("#homePanel"),
  joinPanel: document.querySelector("#joinPanel"),
  gamePanel: document.querySelector("#gamePanel"),
  createRoomBtn: document.querySelector("#createRoomBtn"),
  roomInput: document.querySelector("#roomInput"),
  joinByCodeBtn: document.querySelector("#joinByCodeBtn"),
  roomCodeLabel: document.querySelector("#roomCodeLabel"),
  nameInput: document.querySelector("#nameInput"),
  enterRoomBtn: document.querySelector("#enterRoomBtn"),
  joinBackBtn: document.querySelector("#joinBackBtn"),
  copyLinkBtn: document.querySelector("#copyLinkBtn"),
  copyLinkBtn2: document.querySelector("#copyLinkBtn2"),
  gameRoomCode: document.querySelector("#gameRoomCode"),
  tableRank: document.querySelector("#tableRank"),
  tableCount: document.querySelector("#tableCount"),
  turnText: document.querySelector("#turnText"),
  claimBox: document.querySelector("#claimBox"),
  playersList: document.querySelector("#playersList"),
  startGameBtn: document.querySelector("#startGameBtn"),
  rematchBtn: document.querySelector("#rematchBtn"),
  handHint: document.querySelector("#handHint"),
  handCards: document.querySelector("#handCards"),
  playCardsBtn: document.querySelector("#playCardsBtn"),
  challengePanel: document.querySelector("#challengePanel"),
  challengeBtn: document.querySelector("#challengeBtn"),
  passBtn: document.querySelector("#passBtn"),
  logList: document.querySelector("#logList"),
  toast: document.querySelector("#toast"),
};

let ws = null;
let roomCode = new URLSearchParams(location.search).get("room") || "";
let currentState = null;
let selected = new Set();
let reconnectTimer = null;
let heartbeatTimer = null;
let manualClose = false;

const storage = {
  token: "lionsbar_token",
  name: "lionsbar_name",
};

function token() {
  let value = localStorage.getItem(storage.token);
  if (!value) {
    value = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    localStorage.setItem(storage.token, value);
  }
  return value;
}

function setStatus(text, mode = "") {
  els.connectionStatus.textContent = text;
  els.connectionStatus.className = `status ${mode}`.trim();
}

function showToast(message) {
  if (!message) return;
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.add("hidden"), 2600);
}

function openRules() {
  els.rulesModal.classList.remove("hidden");
  els.rulesModal.setAttribute("aria-hidden", "false");
  els.closeRulesBtn.focus();
}

function closeRules() {
  els.rulesModal.classList.add("hidden");
  els.rulesModal.setAttribute("aria-hidden", "true");
  els.rulesBtn.focus();
}

function openManage() {
  if (!currentState?.you?.isOwner) return;
  renderManage(currentState);
  els.manageModal.classList.remove("hidden");
  els.manageModal.setAttribute("aria-hidden", "false");
  els.closeManageBtn.focus();
}

function closeManage() {
  els.manageModal.classList.add("hidden");
  els.manageModal.setAttribute("aria-hidden", "true");
  els.manageBtn.focus();
}

function normalizeRoom(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function roomUrl() {
  return `${location.origin}/?room=${roomCode}`;
}

function route() {
  roomCode = normalizeRoom(roomCode);
  if (!roomCode) {
    els.homePanel.classList.remove("hidden");
    els.joinPanel.classList.add("hidden");
    els.gamePanel.classList.add("hidden");
    els.manageBtn.classList.add("hidden");
    els.leaveRoomBtn.classList.add("hidden");
    return;
  }

  els.homePanel.classList.add("hidden");
  els.joinPanel.classList.remove("hidden");
  els.gamePanel.classList.add("hidden");
  els.manageBtn.classList.add("hidden");
  els.leaveRoomBtn.classList.add("hidden");
  els.roomCodeLabel.textContent = roomCode;
  els.nameInput.value = localStorage.getItem(storage.name) || "";
}

function returnToHome(message = "") {
  manualClose = true;
  stopHeartbeat();
  window.clearTimeout(reconnectTimer);
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  ws = null;
  currentState = null;
  selected.clear();
  closeManageQuietly();
  roomCode = "";
  history.replaceState(null, "", "/");
  route();
  setStatus("未连接", "");
  showToast(message);
}

function closeManageQuietly() {
  els.manageModal.classList.add("hidden");
  els.manageModal.setAttribute("aria-hidden", "true");
}

async function createRoom() {
  els.createRoomBtn.disabled = true;
  try {
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error("创建房间失败");
    const data = await res.json();
    roomCode = data.code;
    history.replaceState(null, "", `/?room=${roomCode}`);
    route();
  } catch (err) {
    showToast(err.message);
  } finally {
    els.createRoomBtn.disabled = false;
  }
}

function connect() {
  const name = els.nameInput.value.trim();
  if (!name) {
    showToast("请输入名字。");
    return;
  }

  localStorage.setItem(storage.name, name);
  manualClose = false;
  selected.clear();
  setStatus("连接中", "");

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}/ws/${roomCode}`);

  ws.addEventListener("open", () => {
    setStatus("已连接", "online");
    send({ type: "join", token: token(), name });
    startHeartbeat();
  });

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "state") {
      currentState = msg;
      render(msg);
    } else if (msg.type === "room_closed") {
      returnToHome(msg.message || "房间已解散。");
    } else if (msg.type === "kicked") {
      returnToHome(msg.message || "你已被移出房间。");
    } else if (msg.type === "toast" || msg.type === "error") {
      showToast(msg.message);
    }
  });

  ws.addEventListener("close", () => {
    stopHeartbeat();
    setStatus("重连中", "offline");
    if (!manualClose) scheduleReconnect();
  });

  ws.addEventListener("error", () => {
    setStatus("连接异常", "offline");
  });
}

function scheduleReconnect() {
  window.clearTimeout(reconnectTimer);
  reconnectTimer = window.setTimeout(() => {
    if (roomCode && localStorage.getItem(storage.name)) connect();
  }, 1600);
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = window.setInterval(() => send({ type: "ping" }), 20000);
}

function stopHeartbeat() {
  window.clearInterval(heartbeatTimer);
}

function send(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showToast("连接尚未恢复，请稍等。");
    return;
  }
  ws.send(JSON.stringify(payload));
}

function render(state) {
  els.joinPanel.classList.add("hidden");
  els.gamePanel.classList.remove("hidden");
  els.gameRoomCode.textContent = state.room.code;
  els.tableRank.textContent = state.room.tableRank;
  els.tableCount.textContent = state.room.tableCount;

  renderTurn(state);
  renderClaim(state);
  renderPlayers(state);
  renderHand(state);
  renderActions(state);
  renderTopActions(state);
  renderLog(state);
  if (!els.manageModal.classList.contains("hidden")) renderManage(state);
}

function renderTopActions(state) {
  const inRoom = Boolean(state.you?.id);
  els.manageBtn.classList.toggle("hidden", !state.you?.isOwner);
  els.leaveRoomBtn.classList.toggle("hidden", !inRoom);
}

function renderTurn(state) {
  const room = state.room;
  if (room.state === "waiting") {
    els.turnText.textContent = `等待玩家加入，当前 ${state.players.length} / ${room.maxPlayers} 人。`;
  } else if (room.state === "ended") {
    els.turnText.textContent = state.you.isOwner
      ? `游戏结束，${room.winner || "胜利者"} 获胜。可以再来一局。`
      : `游戏结束，${room.winner || "胜利者"} 获胜。等待房主开始下一局。`;
  } else if (room.phase === "challenge") {
    els.turnText.textContent = `轮到 ${room.currentPlayerName} 决定是否质疑。`;
  } else {
    els.turnText.textContent = `轮到 ${room.currentPlayerName} 出牌，必须声称是 ${room.tableRank}。`;
  }
}

function renderClaim(state) {
  const claim = state.room.claim;
  if (!claim) {
    els.claimBox.classList.add("hidden");
    els.claimBox.textContent = "";
    return;
  }
  els.claimBox.classList.remove("hidden");
  els.claimBox.textContent = `${claim.playerName} 刚打出 ${claim.claimedCount} 张，声称是 ${claim.claimedRank}。`;
}

function renderPlayers(state) {
  els.playersList.innerHTML = "";
  state.players.forEach((player) => {
    const row = document.createElement("div");
    row.className = `player ${player.current ? "current" : ""} ${player.alive ? "" : "dead"}`;

    const left = document.createElement("div");
    const name = document.createElement("div");
    name.className = "player-name";
    name.append(document.createTextNode(`${player.name}${player.id === state.you.id ? "（你）" : ""}`));
    if (player.isOwner) {
      const badge = document.createElement("span");
      badge.className = "owner-badge";
      badge.textContent = "房主";
      name.append(badge);
    }
    const meta = document.createElement("div");
    meta.className = "player-meta";
    meta.textContent = `${player.alive ? `${player.cardCount} 张手牌` : "已出局"} · ${player.connected ? "在线" : "离线"}`;
    left.append(name, meta);

    const hearts = document.createElement("div");
    hearts.className = "hearts";
    hearts.textContent = "♥".repeat(Math.max(player.hp, 0)) + "♡".repeat(Math.max(player.maxHp - player.hp, 0));
    row.append(left, hearts);
    els.playersList.append(row);
  });
}

function renderHand(state) {
  els.handCards.innerHTML = "";
  const canPlay = state.room.state === "playing" && state.room.phase === "play" && state.you.current && state.you.alive;
  const max = state.room.maxPlayCards;
  els.handHint.textContent = canPlay ? `选择 1-${max} 张` : "只有你能看到";

  state.you.hand.forEach((card, index) => {
    const btn = document.createElement("button");
    btn.className = `card ${selected.has(index) ? "selected" : ""}`;
    btn.textContent = card;
    btn.disabled = !canPlay;
    btn.addEventListener("click", () => {
      if (selected.has(index)) {
        selected.delete(index);
      } else if (selected.size < max) {
        selected.add(index);
      } else {
        showToast(`最多只能选择 ${max} 张。`);
      }
      renderHand(currentState);
    });
    els.handCards.append(btn);
  });

  if (!state.you.hand.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "本轮没有手牌。";
    els.handCards.append(empty);
  }

  els.playCardsBtn.classList.toggle("hidden", !canPlay);
  els.playCardsBtn.disabled = selected.size === 0;
}

function renderActions(state) {
  const room = state.room;
  const canStart = room.state === "waiting" && state.players.length >= 2 && state.you.isOwner;
  els.startGameBtn.classList.toggle("hidden", room.state !== "waiting" || !state.you.isOwner);
  els.startGameBtn.disabled = !canStart;
  els.rematchBtn.classList.toggle("hidden", room.state !== "ended" || !state.you.isOwner);

  const canChallenge = room.state === "playing" && room.phase === "challenge" && state.you.current && state.you.alive;
  els.challengePanel.classList.toggle("hidden", !canChallenge);
  els.passBtn.classList.toggle("hidden", !room.allowPass);
}

function renderManage(state) {
  els.managePlayersList.innerHTML = "";
  state.players.forEach((player) => {
    const row = document.createElement("div");
    row.className = "manage-row";

    const info = document.createElement("div");
    const name = document.createElement("div");
    name.className = "player-name";
    name.textContent = `${player.name}${player.id === state.you.id ? "（你）" : ""}${player.isOwner ? " · 房主" : ""}`;
    const meta = document.createElement("div");
    meta.className = "player-meta";
    meta.textContent = `${player.connected ? "在线" : "离线"} · ${player.alive ? "游戏中" : "已出局"}`;
    info.append(name, meta);

    const kickBtn = document.createElement("button");
    kickBtn.className = "danger small";
    kickBtn.type = "button";
    kickBtn.textContent = "移除";
    kickBtn.disabled = player.id === state.you.id || !player.token;
    kickBtn.addEventListener("click", () => {
      if (!window.confirm(`确定要移除 ${player.name} 吗？`)) return;
      send({ type: "kick", targetToken: player.token });
    });

    row.append(info, kickBtn);
    els.managePlayersList.append(row);
  });
}

function renderLog(state) {
  els.logList.innerHTML = "";
  [...state.log].reverse().forEach((line) => {
    const item = document.createElement("div");
    item.className = `log-line ${line.kind || ""}`;
    item.textContent = line.text;
    els.logList.append(item);
  });
}

function copyLink() {
  navigator.clipboard.writeText(roomUrl()).then(
    () => showToast("链接已复制。"),
    () => showToast(roomUrl()),
  );
}

function leaveRoom() {
  if (!currentState?.you?.id) returnToHome();
  if (!window.confirm("确定要退出房间吗？")) return;
  send({ type: "leave" });
  window.setTimeout(() => returnToHome("已退出房间。"), 120);
}

function disbandRoom() {
  if (!currentState?.you?.isOwner) return;
  if (!window.confirm("确定要解散房间吗？所有玩家都会返回首页。")) return;
  send({ type: "disband" });
}

els.createRoomBtn.addEventListener("click", createRoom);
els.joinByCodeBtn.addEventListener("click", () => {
  const code = normalizeRoom(els.roomInput.value);
  if (!code) return showToast("请输入房间代码。");
  roomCode = code;
  history.replaceState(null, "", `/?room=${roomCode}`);
  route();
});
els.enterRoomBtn.addEventListener("click", connect);
els.copyLinkBtn.addEventListener("click", copyLink);
els.copyLinkBtn2.addEventListener("click", copyLink);
els.joinBackBtn.addEventListener("click", () => returnToHome());
els.rulesBtn.addEventListener("click", openRules);
els.closeRulesBtn.addEventListener("click", closeRules);
els.rulesBackdrop.addEventListener("click", closeRules);
els.manageBtn.addEventListener("click", openManage);
els.closeManageBtn.addEventListener("click", closeManage);
els.manageBackdrop.addEventListener("click", closeManage);
els.leaveRoomBtn.addEventListener("click", leaveRoom);
els.disbandRoomBtn.addEventListener("click", disbandRoom);
els.startGameBtn.addEventListener("click", () => send({ type: "start" }));
els.playCardsBtn.addEventListener("click", () => {
  const indices = [...selected].sort((a, b) => a - b);
  selected.clear();
  send({ type: "play", indices });
});
els.challengeBtn.addEventListener("click", () => send({ type: "challenge" }));
els.passBtn.addEventListener("click", () => send({ type: "pass" }));
els.rematchBtn.addEventListener("click", () => send({ type: "rematch" }));
els.nameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") connect();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.rulesModal.classList.contains("hidden")) {
    closeRules();
  } else if (event.key === "Escape" && !els.manageModal.classList.contains("hidden")) {
    closeManage();
  }
});

route();
setStatus("未连接");
