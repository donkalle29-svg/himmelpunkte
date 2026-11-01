const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static("public"));

const rooms = new Map();
const VALUES = [
  ...Array(5).fill(-2), ...Array(10).fill(-1), ...Array(15).fill(0),
  ...Array.from({length: 12}, (_, i) => Array(10).fill(i + 1)).flat()
];

function code() { return crypto.randomBytes(3).toString("hex").toUpperCase(); }
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function newDeck() { return shuffle([...VALUES]); }
function topDiscard(room) { return room.discard[room.discard.length - 1]; }
function score(player) {
  return player.cards.reduce((sum, c) => sum + (c.revealed ? c.value : 0), 0);
}
function removeTriples(player) {
  for (let col = 0; col < 4; col++) {
    const indexes = [col, col + 4, col + 8];
    const cards = indexes.map(i => player.cards[i]);
    if (cards.every(c => c.revealed) && cards.every(c => c.value === cards[0].value)) {
      indexes.sort((a,b) => b-a).forEach(i => player.cards.splice(i, 1));
      // Keep a 12-position grid by replacing removed cards with null.
      player.cards.splice(0, 0); // intentional no-op
      player.removed = (player.removed || 0) + 3;
      player.cards = player.cards.concat([null, null, null]);
    }
  }
}
function finishRound(room) {
  if (room.phase !== "playing") return;
  room.phase = "roundOver";
  const scores = room.players.map(p => score(p));
  const finisher = room.players.find(p => p.id === room.finisher);
  const min = Math.min(...scores);
  room.players.forEach((p, i) => {
    let points = scores[i];
    if (p.id === room.finisher && points !== min) points *= 2;
    p.total += points;
    p.lastRound = points;
  });
  room.roundResults = room.players.map(p => ({name:p.name, round: p.lastRound, total:p.total}));
  if (room.players.some(p => p.total >= 100)) room.phase = "gameOver";
}
function startRound(room) {
  const deck = newDeck();
  room.discard = [deck.pop()];
  room.players.forEach(p => {
    p.cards = Array.from({length:12}, (_,i) => ({value:deck.pop(), revealed:false}));
    p.removed = 0;
    p.lastRound = 0;
    const a = Math.floor(Math.random()*12), b = (a + 1 + Math.floor(Math.random()*11)) % 12;
    p.cards[a].revealed = true; p.cards[b].revealed = true;
  });
  // Highest sum of the two initially revealed cards starts.
  const sums = room.players.map(p => p.cards.filter(c=>c.revealed).reduce((s,c)=>s+c.value,0));
  room.turn = sums.indexOf(Math.max(...sums));
  room.deck = deck;
  room.phase = "playing";
  room.finisher = null;
  room.lastTurn = null;
  room.roundResults = null;
  room.drawn = null;
  room.mustChoose = false;
}
function nextTurn(room) {
  if (room.lastTurn === room.turn) {
    finishRound(room);
    return;
  }
  room.turn = (room.turn + 1) % room.players.length;
  room.drawn = null;
  room.mustChoose = false;
}
function publicState(room, socketId) {
  return {
    code: room.code, phase: room.phase,
    players: room.players.map(p => ({
      id:p.id, name:p.name, total:p.total,
      cards:p.cards.map(c => c ? (c.revealed || p.id === socketId ? {value:c.value, revealed:c.revealed} : {value:null, revealed:false}) : null),
      removed:p.removed || 0,
      lastRound:p.lastRound || 0
    })),
    turn: room.turn, currentPlayer: room.players[room.turn]?.id,
    discard: topDiscard(room), deckCount: room.deck?.length || 0,
    drawn: room.drawn, mustChoose: room.mustChoose,
    roundResults: room.roundResults,
    host: room.host
  };
}
function broadcast(room) {
  room.players.forEach(p => io.to(p.id).emit("state", publicState(room, p.id)));
}
function getRoom(socket) {
  const room = [...rooms.values()].find(r => r.players.some(p => p.id === socket.id));
  return room;
}
function checkEnd(room, player) {
  removeTriples(player);
  if (player.cards.every(c => !c || c.revealed)) {
    room.finisher = player.id;
    room.lastTurn = room.turn;
  }
}
function drawFromDeck(room) {
  if (!room.deck.length) {
    const top = room.discard.pop();
    room.deck = shuffle(room.discard);
    room.discard = [top];
  }
  return room.deck.pop();
}

io.on("connection", socket => {
  socket.on("createRoom", ({name}, cb) => {
    const roomCode = code();
    const player = {id:socket.id, name:String(name||"Spieler").slice(0,18), total:0, cards:[]};
    const room = {code:roomCode, host:socket.id, players:[player], phase:"lobby"};
    rooms.set(roomCode, room);
    socket.join(roomCode);
    cb?.({ok:true, code:roomCode});
    broadcast(room);
  });
  socket.on("joinRoom", ({code:roomCode, name}, cb) => {
    const room = rooms.get(String(roomCode||"").toUpperCase());
    if (!room || room.phase !== "lobby" || room.players.length >= 8) return cb?.({ok:false, error:"Raum nicht gefunden oder bereits gestartet."});
    room.players.push({id:socket.id, name:String(name||"Spieler").slice(0,18), total:0, cards:[]});
    socket.join(room.code);
    cb?.({ok:true, code:room.code});
    broadcast(room);
  });
  socket.on("startGame", cb => {
    const room = getRoom(socket);
    if (!room || room.host !== socket.id || room.players.length < 2 || room.phase !== "lobby") return cb?.({ok:false,error:"Mindestens zwei Spieler werden benötigt."});
    startRound(room); broadcast(room); cb?.({ok:true});
  });
  socket.on("draw", ({source}, cb) => {
    const room = getRoom(socket);
    if (!room || room.phase !== "playing" || room.players[room.turn]?.id !== socket.id || room.drawn !== null) return cb?.({ok:false,error:"Du bist gerade nicht am Zug."});
    if (source === "discard") {
      room.drawn = room.discard.pop();
      room.mustChoose = true;
    } else {
      room.drawn = drawFromDeck(room);
      room.mustChoose = false;
    }
    broadcast(room); cb?.({ok:true});
  });
  socket.on("takeDrawn", ({index}, cb) => {
    const room = getRoom(socket), p = room?.players[room.turn];
    if (!room || room.phase !== "playing" || p?.id !== socket.id || room.drawn === null) return cb?.({ok:false,error:"Kein gezogener Wert."});
    if (!Number.isInteger(index) || index < 0 || index >= 12 || !p.cards[index]) return cb?.({ok:false,error:"Ungültige Karte."});
    p.cards[index] = {value:room.drawn, revealed:true};
    room.discard.push(room.drawn); room.drawn = null; room.mustChoose = false;
    checkEnd(room,p); if (room.lastTurn === null || room.turn !== room.lastTurn) nextTurn(room);
    broadcast(room); cb?.({ok:true});
  });
  socket.on("discardDrawn", cb => {
    const room = getRoom(socket), p = room?.players[room.turn];
    if (!room || room.phase !== "playing" || p?.id !== socket.id || room.drawn === null || room.mustChoose) return cb?.({ok:false,error:"Diese Karte muss getauscht werden."});
    room.discard.push(room.drawn); room.drawn = null;
    const hidden = p.cards.findIndex(c => c && !c.revealed);
    if (hidden === -1) return cb?.({ok:false,error:"Keine verdeckte Karte mehr vorhanden."});
    p.cards[hidden].revealed = true;
    checkEnd(room,p); if (room.lastTurn === null || room.turn !== room.lastTurn) nextTurn(room);
    broadcast(room); cb?.({ok:true});
  });
  socket.on("newRound", cb => {
    const room = getRoom(socket);
    if (!room || room.host !== socket.id || room.phase !== "roundOver") return cb?.({ok:false});
    startRound(room); broadcast(room); cb?.({ok:true});
  });
  socket.on("disconnect", () => {
    const room = getRoom(socket);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    if (!room.players.length) rooms.delete(room.code);
    else {
      if (room.host === socket.id) room.host = room.players[0].id;
      if (room.phase === "playing") room.phase = "paused";
      broadcast(room);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Himmelpunkte läuft auf Port ${PORT}`));
