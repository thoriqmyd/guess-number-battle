const lobby = document.querySelector("#lobby");
const game = document.querySelector("#game");
const createForm = document.querySelector("#create-form");
const joinForm = document.querySelector("#join-form");
const secretForm = document.querySelector("#secret-form");
const guessForm = document.querySelector("#guess-form");
const choosePanel = document.querySelector("#choose-panel");
const guessPanel = document.querySelector("#guess-panel");
const resultPanel = document.querySelector("#result-panel");
const statusBanner = document.querySelector("#status-banner");
const toast = document.querySelector("#toast");

let socket = null;
let roomCode = null;
let playerId = null;
let playerName = null;
let gameStatus = "waiting";
let hasChosen = false;
let guessCount = 0;
let toastTimer = null;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function showGame() {
  lobby.classList.add("hidden");
  game.classList.remove("hidden");
  document.querySelector("#room-code-display").textContent = roomCode || "-----";
  document.querySelector("#you-name").textContent = playerName || "Kamu";
}

function showLobby() {
  game.classList.add("hidden");
  lobby.classList.remove("hidden");
  if (socket) {
    socket.onclose = null;
    socket.close();
  }
  socket = null;
  roomCode = null;
  playerId = null;
  playerName = null;
  localStorage.removeItem("guessBattleSession");
}

function connectAndSend(initialMessage) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.close();
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify(initialMessage));
  });

  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      showToast("Respons server tidak valid.");
      return;
    }
    handleMessage(message);
  });

  socket.addEventListener("close", () => {
    if (!game.classList.contains("hidden") && gameStatus !== "finished") {
      statusBanner.textContent = "Koneksi terputus. Coba muat ulang halaman untuk menyambung kembali.";
    }
  });

  socket.addEventListener("error", () => {
    showToast("Tidak bisa terhubung ke server. Pastikan backend sedang berjalan.");
  });
}

function handleMessage(message) {
  if (message.type === "error") {
    showToast(message.message || "Terjadi kesalahan.");
    return;
  }

  if (message.type === "joined") {
    roomCode = message.room_code;
    playerId = message.player_id;
    playerName = message.name;
    localStorage.setItem("guessBattleSession", JSON.stringify({
      room_code: roomCode,
      player_id: playerId,
      name: playerName
    }));
    showGame();
    showToast(`Berhasil masuk ke room ${roomCode}`);
    return;
  }

  if (message.type === "state") {
    updateState(message);
    return;
  }

  if (message.type === "notice") {
    statusBanner.textContent = message.message;
    return;
  }

  if (message.type === "guess_result") {
    const feedback = document.querySelector("#feedback");
    feedback.textContent = message.message;
    feedback.className = `feedback ${message.result === "correct" ? "correct" : message.result}`;
    addGuessHistory(message.guess, message.result);
    guessCount = message.your_guesses;
    document.querySelector("#you-guesses").textContent = String(guessCount);
    if (message.result === "correct") {
      showResult(true, "Kamu menang!", message.message);
    }
    return;
  }

  if (message.type === "opponent_won") {
    showResult(false, `${message.winner_name} menang!`, message.message);
  }
}

function updateState(state) {
  gameStatus = state.status;
  if (state.room_code) {
    roomCode = state.room_code;
    document.querySelector("#room-code-display").textContent = roomCode;
  }

  const you = state.you || {};
  const opponent = state.opponent;
  hasChosen = Boolean(you.has_chosen);

  document.querySelector("#you-name").textContent = you.name || playerName || "Kamu";
  document.querySelector("#you-guesses").textContent = String(you.guesses || 0);
  document.querySelector("#you-status").textContent = !you.connected
    ? "Terputus"
    : hasChosen ? "Angka rahasia terkunci" : "Memilih angka rahasia";

  document.querySelector("#opponent-name").textContent = opponent?.name || "Menunggu lawan";
  document.querySelector("#opponent-guesses").textContent = String(opponent?.guesses || 0);
  document.querySelector("#opponent-status").textContent = !opponent
    ? "Belum bergabung"
    : !opponent.connected ? "Terputus"
    : opponent.has_chosen ? "Angka rahasia terkunci" : "Memilih angka rahasia";

  if (state.status === "waiting") {
    statusBanner.textContent = opponent
      ? "Lawan bergabung! Silakan pilih angka rahasia."
      : "Bagikan kode room kepada temanmu dan tunggu lawan bergabung.";
  } else if (state.status === "choosing") {
    statusBanner.textContent = hasChosen
      ? "Angka kamu sudah terkunci. Menunggu lawan memilih angka."
      : "Lawan sudah di room. Pilih angka rahasiamu untuk memulai.";
  } else if (state.status === "playing") {
    statusBanner.textContent = "Battle dimulai! Tebak angka rahasia lawan.";
  } else if (state.status === "finished" && state.winner_name) {
    statusBanner.textContent = `Ronde selesai. Pemenang: ${state.winner_name}.`;
  }

  choosePanel.classList.toggle("hidden", hasChosen || state.status === "playing" || state.status === "finished");
  guessPanel.classList.toggle("hidden", state.status !== "playing");
  if (state.status === "finished" && !resultPanel.classList.contains("hidden")) {
    // Result content is set by the winning/losing message event.
  }
}

function addGuessHistory(number, result) {
  const list = document.querySelector("#guess-history");
  const item = document.createElement("li");
  const label = result === "correct" ? "Benar" : result === "low" ? "Terlalu kecil" : "Terlalu besar";
  item.textContent = `${number} · ${label}`;
  list.prepend(item);
}

function showResult(won, title, copy) {
  gameStatus = "finished";
  choosePanel.classList.add("hidden");
  guessPanel.classList.add("hidden");
  resultPanel.classList.remove("hidden");
  document.querySelector("#result-title").textContent = title;
  document.querySelector("#result-copy").textContent = copy;
  document.querySelector(".trophy").textContent = won ? "★" : "✦";
  statusBanner.textContent = "Ronde selesai.";
}

function readNumber(input) {
  const value = input.value.trim();
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 100) return null;
  return number;
}

createForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = document.querySelector("#create-name").value.trim();
  if (!name) return showToast("Masukkan nama terlebih dahulu.");
  playerName = name;
  connectAndSend({ type: "create", name });
});

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = document.querySelector("#join-name").value.trim();
  const code = document.querySelector("#room-code").value.trim().toUpperCase();
  if (!name) return showToast("Masukkan nama terlebih dahulu.");
  if (!/^[A-Z0-9]{5}$/.test(code)) return showToast("Kode room harus terdiri dari 5 huruf/angka.");
  playerName = name;
  connectAndSend({ type: "join", name, room_code: code });
});

secretForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.querySelector("#secret-number");
  const number = readNumber(input);
  if (number === null) return showToast("Masukkan bilangan bulat dari 1 sampai 100.");
  if (socket?.readyState !== WebSocket.OPEN) return showToast("Koneksi belum tersambung.");
  socket.send(JSON.stringify({ type: "choose_number", number }));
  input.value = "";
  input.disabled = true;
  secretForm.querySelector("button").disabled = true;
  document.querySelector("#secret-note").textContent = "Angka dikirim ke server. Menunggu lawan...";
});

guessForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.querySelector("#guess-number");
  const number = readNumber(input);
  if (number === null) return showToast("Masukkan bilangan bulat dari 1 sampai 100.");
  if (socket?.readyState !== WebSocket.OPEN) return showToast("Koneksi belum tersambung.");
  socket.send(JSON.stringify({ type: "guess", number }));
  input.value = "";
  input.focus();
});

document.querySelector("#copy-room").addEventListener("click", async () => {
  if (!roomCode) return;
  try {
    await navigator.clipboard.writeText(roomCode);
    showToast("Kode room berhasil disalin.");
  } catch {
    showToast(`Kode room kamu: ${roomCode}`);
  }
});

document.querySelector("#leave-room").addEventListener("click", () => {
  showLobby();
  showToast("Kamu keluar dari tampilan room.");
});

document.querySelector("#new-game").addEventListener("click", () => {
  showLobby();
  document.querySelector("#create-form").reset();
  document.querySelector("#join-form").reset();
  document.querySelector("#secret-number").disabled = false;
  document.querySelector("#secret-form button").disabled = false;
  document.querySelector("#feedback").textContent = "Petunjuk akan muncul di sini.";
  document.querySelector("#feedback").className = "feedback";
  document.querySelector("#guess-history").replaceChildren();
  document.querySelector("#result-panel").classList.add("hidden");
});

// Restore the same room/player identity after a page refresh.
try {
  const saved = JSON.parse(localStorage.getItem("guessBattleSession") || "null");
  if (saved?.room_code && saved?.player_id && saved?.name) {
    playerName = saved.name;
    connectAndSend({
      type: "reconnect",
      room_code: saved.room_code,
      player_id: saved.player_id,
      name: saved.name
    });
  }
} catch {
  localStorage.removeItem("guessBattleSession");
}
