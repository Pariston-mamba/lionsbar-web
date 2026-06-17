const els = {
  connectionStatus: document.querySelector("#connectionStatus"),
  homeInviteBtn: document.querySelector("#homeInviteBtn"),
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
  inviteModal: document.querySelector("#inviteModal"),
  inviteBackdrop: document.querySelector("#inviteBackdrop"),
  closeInviteBtn: document.querySelector("#closeInviteBtn"),
  inviteQr: document.querySelector("#inviteQr"),
  inviteHint: document.querySelector("#inviteHint"),
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
  challengeBtn: document.querySelector("#challengeBtn"),
  passBtn: document.querySelector("#passBtn"),
  logList: document.querySelector("#logList"),
  toast: document.querySelector("#toast"),
  muteBtn: document.querySelector("#muteBtn"),
  lobbySettings: document.querySelector("#lobbySettings"),
  turnSecondsSeg: document.querySelector("#turnSecondsSeg"),
  turnTimer: document.querySelector("#turnTimer"),
  turnTimerNum: document.querySelector("#turnTimerNum"),
  actionBar: document.querySelector("#actionBar"),
  emoteToggle: document.querySelector("#emoteToggle"),
  emotePopover: document.querySelector("#emotePopover"),
  emoteLayer: document.querySelector("#emoteLayer"),
  chatFloatLayer: document.querySelector("#chatFloatLayer"),
  chatToggle: document.querySelector("#chatToggle"),
  chatBadge: document.querySelector("#chatBadge"),
  chatSheet: document.querySelector("#chatSheet"),
  chatClose: document.querySelector("#chatClose"),
  chatMsgs: document.querySelector("#chatMsgs"),
  chatForm: document.querySelector("#chatForm"),
  chatInput: document.querySelector("#chatInput"),
  soloBtn: document.querySelector("#soloBtn"),
};

let ws = null;
let roomCode = new URLSearchParams(location.search).get("room") || "";
let currentState = null;
let selected = new Set();
let reconnectTimer = null;
let heartbeatTimer = null;
let manualClose = false;
let inviteQr = null;
let inviteReturnFocus = null;
let reconnectAttempts = 0;
let lastMessageAt = 0;
let watchdogTimer = null;
let lastEventId = null;
let prevState = null;
let lastSeenChat = 0;
let lastChatLen = null;
let shakePid = null;
let shakeUntil = 0;
let audioCtx = null;
const timerState = { endsAt: null, total: 0, mine: false };
const EMOTES = ["😏", "🤨", "😎", "😱", "😭", "🤝", "🔥", "💀"];

const storage = {
  token: "lionsbar_token",
  name: "lionsbar_name",
  muted: "lionsbar_muted",
};

let muted = localStorage.getItem(storage.muted) === "1";

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

function ensureAudio() {
  if (muted) return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try {
      audioCtx = new Ctx();
    } catch (err) {
      audioCtx = null;
    }
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

function blip(freq, start, dur, type = "sine", gain = 0.08) {
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const env = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(env);
    env.connect(audioCtx.destination);
    const t = audioCtx.currentTime + start;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  } catch (err) {}
}

function playSound(kind) {
  if (muted || !ensureAudio()) return;
  if (kind === "yourturn") {
    blip(660, 0, 0.12, "triangle");
    blip(880, 0.12, 0.16, "triangle");
  } else if (kind === "play") {
    blip(420, 0, 0.08, "square", 0.05);
  } else if (kind === "lie") {
    blip(330, 0, 0.18, "sawtooth", 0.08);
    blip(196, 0.16, 0.34, "sawtooth", 0.09);
  } else if (kind === "honest") {
    blip(523, 0, 0.12, "sine");
    blip(784, 0.12, 0.18, "sine");
  } else if (kind === "win") {
    [523, 659, 784, 1047].forEach((f, i) => blip(f, i * 0.12, 0.22, "triangle", 0.08));
  } else if (kind === "pop") {
    blip(880, 0, 0.06, "sine", 0.05);
  }
}

function buzz(pattern) {
  if (muted || !navigator.vibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch (err) {}
}

function setMute(on) {
  muted = on;
  localStorage.setItem(storage.muted, on ? "1" : "0");
  els.muteBtn.textContent = on ? "🔇" : "🔊";
  if (!on) ensureAudio();
}

function buildEmotePopover() {
  if (els.emotePopover.dataset.ready) return;
  EMOTES.forEach((emoji) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = emoji;
    btn.addEventListener("click", () => {
      send({ type: "emote", emote: emoji });
      closeEmote();
    });
    els.emotePopover.append(btn);
  });
  els.emotePopover.dataset.ready = "1";
}

function toggleEmote() {
  buildEmotePopover();
  if (els.emotePopover.classList.contains("hidden")) closeChat();
  els.emotePopover.classList.toggle("hidden");
}

function closeEmote() {
  els.emotePopover.classList.add("hidden");
}

function renderChat(state) {
  const chat = state.chat || [];
  els.chatMsgs.innerHTML = "";
  if (!chat.length) {
    const empty = document.createElement("p");
    empty.className = "chat-empty";
    empty.textContent = "还没有人说话，来打个招呼吧。";
    els.chatMsgs.append(empty);
  } else {
    chat.forEach((m) => {
      const row = document.createElement("div");
      row.className = "chat-msg" + (state.you && m.name === state.you.name ? " mine" : "");
      const who = document.createElement("span");
      who.className = "who";
      who.textContent = m.name;
      row.append(who, document.createTextNode(m.text));
      els.chatMsgs.append(row);
    });
  }
  // 抽屜關閉時，別人發的新訊息飄幾秒浮層（重連一次補很多則就不飄，避免洗版）
  if (
    lastChatLen !== null &&
    chat.length > lastChatLen &&
    chat.length - lastChatLen <= 3 &&
    els.chatSheet.classList.contains("hidden")
  ) {
    chat
      .slice(lastChatLen)
      .filter((m) => !(state.you && m.name === state.you.name))
      .slice(-2)
      .forEach((m) => showChatFloat(m.name, m.text));
  }
  lastChatLen = chat.length;
  if (els.chatSheet.classList.contains("hidden")) {
    els.chatBadge.classList.toggle("hidden", chat.length <= lastSeenChat);
  } else {
    lastSeenChat = chat.length;
    els.chatBadge.classList.add("hidden");
    els.chatMsgs.scrollTop = els.chatMsgs.scrollHeight;
  }
}

function openChat() {
  closeEmote();
  els.chatSheet.classList.remove("hidden");
  lastSeenChat = (currentState && currentState.chat ? currentState.chat : []).length;
  if (currentState) renderChat(currentState);
  els.chatBadge.classList.add("hidden");
}

function closeChat() {
  els.chatSheet.classList.add("hidden");
}

function toggleChat() {
  if (els.chatSheet.classList.contains("hidden")) openChat();
  else closeChat();
}

function sendChat() {
  const text = els.chatInput.value.trim();
  if (!text) return;
  send({ type: "chat", text });
  els.chatInput.value = "";
}

function showChatFloat(name, text) {
  const shown = text.length > 16 ? text.slice(0, 16) + "…" : text;
  const fly = document.createElement("div");
  fly.className = "chat-float";
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = `${name}：`;
  fly.append(who, document.createTextNode(shown));
  els.chatFloatLayer.append(fly);
  window.setTimeout(() => fly.remove(), 3000);
}

function showFlyingEmote(name, emoji) {
  const fly = document.createElement("div");
  fly.className = "emote-fly";
  fly.style.left = `${8 + Math.random() * 72}%`;
  const em = document.createElement("div");
  em.className = "emoji";
  em.textContent = emoji;
  const who = document.createElement("div");
  who.className = "who";
  who.textContent = name;
  fly.append(em, who);
  els.emoteLayer.append(fly);
  window.setTimeout(() => fly.remove(), 2300);
  playSound("pop");
}

function showReveal(ev, state) {
  // 揭牌不再彈全螢幕，改成讓掉血玩家的名條左右震動（renderPlayers 會在重發牌後續抖）
  shakePid = ev.loserId;
  shakeUntil = Date.now() + 700;
  const row = els.playersList.querySelector(`[data-pid="${ev.loserId}"]`);
  if (row) row.classList.add("hp-shake");

  try {
    playSound(ev.isLying ? "lie" : "honest");
    if (state?.you?.id && ev.loserId === state.you.id) buzz([80, 60, 160]);
    else buzz(40);
  } catch (err) {}
}

function tickTimer() {
  if (timerState.endsAt == null) return;
  const remain = Math.max(0, timerState.endsAt - Date.now());
  const frac = timerState.total ? remain / timerState.total : 0;
  els.turnTimer.style.setProperty("--frac", frac.toFixed(3));
  els.turnTimerNum.textContent = String(Math.ceil(remain / 1000));
  els.turnTimer.classList.toggle("mine", timerState.mine);
  els.turnTimer.classList.toggle("low", remain <= 10000);
}

window.setInterval(() => {
  if (timerState.endsAt != null && !els.turnTimer.classList.contains("hidden")) tickTimer();
}, 250);

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

function homeUrl() {
  return `${location.origin}/`;
}

function normalizeRoom(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function roomUrl() {
  return `${location.origin}/?room=${roomCode}`;
}

function buildQr(url) {
  els.inviteQr.innerHTML = "";
  if (!window.QRCodeStyling) {
    const fallback = document.createElement("a");
    fallback.href = url;
    fallback.textContent = url;
    fallback.className = "invite-link";
    els.inviteQr.append(fallback);
    return;
  }

  inviteQr = new QRCodeStyling({
    width: 236,
    height: 236,
    type: "svg",
    data: url,
    image: "/static/avatar.png?v=20260603-1",
    margin: 10,
    qrOptions: {
      errorCorrectionLevel: "H",
    },
    imageOptions: {
      crossOrigin: "anonymous",
      hideBackgroundDots: true,
      imageSize: 0.22,
      margin: 6,
    },
    dotsOptions: {
      color: "#24211d",
      type: "rounded",
    },
    cornersSquareOptions: {
      color: "#0f766e",
      type: "extra-rounded",
    },
    cornersDotOptions: {
      color: "#0b5f59",
      type: "dot",
    },
    backgroundOptions: {
      color: "#fffdf8",
    },
  });
  inviteQr.append(els.inviteQr);
}

function openInvite(url, hint, trigger) {
  inviteReturnFocus = trigger || document.activeElement;
  buildQr(url);
  els.inviteHint.textContent = hint;
  els.inviteModal.classList.remove("hidden");
  els.inviteModal.setAttribute("aria-hidden", "false");
  els.closeInviteBtn.focus();
}

function closeInvite() {
  els.inviteModal.classList.add("hidden");
  els.inviteModal.setAttribute("aria-hidden", "true");
  if (inviteReturnFocus) inviteReturnFocus.focus();
}

function copyText(text) {
  return navigator.clipboard.writeText(text).then(
    () => showToast("链接已复制。"),
    () => showToast(text),
  );
}

function route() {
  roomCode = normalizeRoom(roomCode);
  if (!roomCode) {
    els.homePanel.classList.remove("hidden");
    els.joinPanel.classList.add("hidden");
    els.gamePanel.classList.add("hidden");
    els.homeInviteBtn.classList.remove("hidden");
    els.manageBtn.classList.add("hidden");
    els.leaveRoomBtn.classList.add("hidden");
    return;
  }

  els.homePanel.classList.add("hidden");
  els.joinPanel.classList.remove("hidden");
  els.gamePanel.classList.add("hidden");
  els.homeInviteBtn.classList.add("hidden");
  els.manageBtn.classList.add("hidden");
  els.leaveRoomBtn.classList.add("hidden");
  els.roomCodeLabel.textContent = roomCode;
  els.nameInput.value = localStorage.getItem(storage.name) || "";
}

function returnToHome(message = "") {
  manualClose = true;
  stopHeartbeat();
  stopWatchdog();
  window.clearTimeout(reconnectTimer);
  reconnectAttempts = 0;
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  ws = null;
  currentState = null;
  prevState = null;
  lastEventId = null;
  timerState.endsAt = null;
  selected.clear();
  closeManageQuietly();
  closeInviteQuietly();
  closeEmote();
  closeChat();
  lastSeenChat = 0;
  lastChatLen = null;
  els.chatBadge.classList.add("hidden");
  els.actionBar.classList.add("hidden");
  els.turnTimer.classList.add("hidden");
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

function closeInviteQuietly() {
  els.inviteModal.classList.add("hidden");
  els.inviteModal.setAttribute("aria-hidden", "true");
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
  // 已經有連線（連線中或已連上）就不要再開一條，避免手機重複點「进入房间」開出兩條 socket
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

  localStorage.setItem(storage.name, name);
  manualClose = false;
  selected.clear();
  ensureAudio();
  setStatus("连接中", "");

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}/ws/${roomCode}`);

  ws.addEventListener("open", () => {
    reconnectAttempts = 0;
    lastMessageAt = Date.now();
    setStatus("已连接", "online");
    send({ type: "join", token: token(), name });
    startHeartbeat();
    startWatchdog();
  });

  ws.addEventListener("message", (event) => {
    lastMessageAt = Date.now();
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (err) {
      return;
    }
    if (msg.type === "state") {
      currentState = msg;
      render(msg);
    } else if (msg.type === "emote") {
      showFlyingEmote(msg.name, msg.emote);
    } else if (msg.type === "pong") {
      // keep-alive acknowledged
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
    stopWatchdog();
    if (manualClose) return;
    setStatus("重连中", "offline");
    scheduleReconnect();
  });

  ws.addEventListener("error", () => {
    setStatus("连接异常", "offline");
  });
}

function scheduleReconnect() {
  window.clearTimeout(reconnectTimer);
  reconnectAttempts += 1;
  const base = Math.min(800 * 2 ** (reconnectAttempts - 1), 12000);
  const delay = base + Math.floor(Math.random() * 400);
  setStatus(`重连中 (${reconnectAttempts})`, "offline");
  reconnectTimer = window.setTimeout(() => {
    if (roomCode && localStorage.getItem(storage.name)) connect();
  }, delay);
}

function startWatchdog() {
  stopWatchdog();
  watchdogTimer = window.setInterval(() => {
    if (manualClose || !ws) return;
    if (ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastMessageAt > 30000) {
      try {
        ws.close();
      } catch (err) {}
    }
  }, 5000);
}

function stopWatchdog() {
  window.clearInterval(watchdogTimer);
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

  els.actionBar.classList.remove("hidden");

  renderTurn(state);
  renderClaim(state);
  renderPlayers(state);
  renderHand(state);
  renderActions(state);
  renderTopActions(state);
  renderLobbySettings(state);
  renderTimerState(state);
  renderLog(state);
  renderChat(state);
  renderEvent(state);
  handleStateSounds(prevState, state);
  if (!els.manageModal.classList.contains("hidden")) renderManage(state);
  prevState = state;
}

function renderTopActions(state) {
  const inRoom = Boolean(state.you?.id);
  els.homeInviteBtn.classList.add("hidden");
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
    row.dataset.pid = player.id;
    if (player.id === shakePid && Date.now() < shakeUntil) row.classList.add("hp-shake");

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
  els.challengeBtn.classList.toggle("hidden", !canChallenge);
  els.passBtn.classList.toggle("hidden", !(canChallenge && room.allowPass));
}

function renderLobbySettings(state) {
  const show = state.room.state === "waiting" && state.you.isOwner;
  els.lobbySettings.classList.toggle("hidden", !show);
  if (!show) return;
  const secs = state.room.turnSeconds || 0;
  els.turnSecondsSeg.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.secs) === secs);
  });
}

function renderTimerState(state) {
  const ms = state.room.turnRemainingMs;
  if (ms == null) {
    timerState.endsAt = null;
    els.turnTimer.classList.add("hidden");
    return;
  }
  timerState.endsAt = Date.now() + ms;
  timerState.total = (state.room.turnSeconds || 30) * 1000;
  timerState.mine = Boolean(state.you.current && state.you.alive);
  els.turnTimer.classList.remove("hidden");
  tickTimer();
}

function renderEvent(state) {
  const ev = state.event;
  if (!ev) return;
  if (lastEventId === null) {
    lastEventId = ev.id;
    return;
  }
  if (ev.id <= lastEventId) return;
  lastEventId = ev.id;
  if (ev.type === "reveal") showReveal(ev, state);
}

function handleStateSounds(prev, cur) {
  if (!prev) return;
  const wasMyTurn = Boolean(prev.you && prev.you.current && prev.room && prev.room.state === "playing");
  const isMyTurn = Boolean(cur.you && cur.you.current && cur.room.state === "playing");
  if (isMyTurn && !wasMyTurn) {
    playSound("yourturn");
    buzz(120);
  }

  const before = prev.room && prev.room.claim;
  const now = cur.room && cur.room.claim;
  const claimChanged =
    now && (!before || before.playerId !== now.playerId || before.claimedCount !== now.claimedCount);
  if (claimChanged && cur.you && now.playerId !== cur.you.id) playSound("play");

  if (cur.room.state === "ended" && prev.room && prev.room.state !== "ended") {
    playSound("win");
    if (cur.room.winner && cur.you && cur.you.name === cur.room.winner) buzz([60, 40, 60, 40, 140]);
  }
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
  const url = roomUrl();
  copyText(url);
  openInvite(url, "可扫码加入", document.activeElement);
}

function inviteHome() {
  const url = homeUrl();
  copyText(url);
  openInvite(url, "可扫码打开", els.homeInviteBtn);
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
els.homeInviteBtn.addEventListener("click", inviteHome);
els.copyLinkBtn.addEventListener("click", copyLink);
els.copyLinkBtn2.addEventListener("click", copyLink);
els.joinBackBtn.addEventListener("click", () => returnToHome());
els.rulesBtn.addEventListener("click", openRules);
els.closeRulesBtn.addEventListener("click", closeRules);
els.rulesBackdrop.addEventListener("click", closeRules);
els.manageBtn.addEventListener("click", openManage);
els.closeManageBtn.addEventListener("click", closeManage);
els.manageBackdrop.addEventListener("click", closeManage);
els.closeInviteBtn.addEventListener("click", closeInvite);
els.inviteBackdrop.addEventListener("click", closeInvite);
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
  if (event.key !== "Escape") return;
  if (!els.emotePopover.classList.contains("hidden")) {
    closeEmote();
  } else if (!els.chatSheet.classList.contains("hidden")) {
    closeChat();
  } else if (!els.inviteModal.classList.contains("hidden")) {
    closeInvite();
  } else if (!els.rulesModal.classList.contains("hidden")) {
    closeRules();
  } else if (!els.manageModal.classList.contains("hidden")) {
    closeManage();
  }
});

els.muteBtn.addEventListener("click", () => setMute(!muted));
els.soloBtn.addEventListener("click", () => {
  location.href = "/static/lionsbar-demo.html";
});
els.emoteToggle.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleEmote();
});
els.chatToggle.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleChat();
});
els.chatClose.addEventListener("click", closeChat);
els.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendChat();
});
els.turnSecondsSeg.querySelectorAll(".seg-btn").forEach((btn) => {
  btn.addEventListener("click", () => send({ type: "config", turnSeconds: Number(btn.dataset.secs) }));
});
document.addEventListener("click", (event) => {
  if (els.emotePopover.classList.contains("hidden")) return;
  if (els.emotePopover.contains(event.target) || event.target === els.emoteToggle) return;
  closeEmote();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (manualClose || !roomCode || !localStorage.getItem(storage.name)) return;
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    reconnectAttempts = 0;
    window.clearTimeout(reconnectTimer);
    connect();
  } else if (ws.readyState === WebSocket.OPEN) {
    send({ type: "ping" });
  }
});

setMute(muted);
route();
setStatus("未连接");
