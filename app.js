const socket = io();
const $ = id => document.getElementById(id);
let state = null, selected = null, myId = null;
function show(id){["home","lobby","game","results"].forEach(x=>$(x).classList.toggle("hidden",x!==id));}
function err(msg){$("error").textContent=msg||"";}
function emitAck(event,data={}){return new Promise(resolve=>socket.emit(event,data,resolve));}
$("create").onclick=async()=>{err("");const r=await emitAck("createRoom",{name:$("name").value});if(!r?.ok)err("Raum konnte nicht erstellt werden.");};
$("join").onclick=async()=>{err("");const r=await emitAck("joinRoom",{name:$("name").value,code:$("roomCode").value.trim()});if(!r?.ok)err(r?.error||"Beitritt fehlgeschlagen.");};
$("copy").onclick=()=>navigator.clipboard?.writeText(state?.code||"");
$("start").onclick=async()=>{const r=await emitAck("startGame");if(!r?.ok)alert(r?.error||"Start nicht möglich.");};
$("drawDeck").onclick=()=>socket.emit("draw",{source:"deck"});
$("drawDiscard").onclick=()=>socket.emit("draw",{source:"discard"});
$("discardDrawn").onclick=()=>socket.emit("discardDrawn");
$("nextRound").onclick=()=>socket.emit("newRound");
socket.on("connect",()=>myId=socket.id);
socket.on("state",s=>{state=s;render();});
function render(){
 if(!state)return;
 $("code").textContent=state.code;$("gameCode").textContent=state.code;
 const me=state.players.find(p=>p.id===myId);
 if(state.phase==="lobby"){
   show("lobby");$("lobbyPlayers").innerHTML=state.players.map(p=>`<div class="player">${esc(p.name)} ${p.id===state.host?"★":""}</div>`).join("");
   $("start").classList.toggle("hidden",state.host!==myId);$("start").disabled=state.players.length<2;return;
 }
 if(state.phase==="roundOver"||state.phase==="gameOver"){
   show("results");$("resultTitle").textContent=state.phase==="gameOver"?"Spiel beendet":"Rundenwertung";
   $("resultList").innerHTML=(state.roundResults||[]).sort((a,b)=>a.total-b.total).map((p,i)=>`<div class="resultrow"><b>${i+1}. ${esc(p.name)}</b><span>Runde: ${p.round} · Gesamt: ${p.total}</span></div>`).join("");
   $("nextRound").classList.toggle("hidden",state.phase==="gameOver"||state.host!==myId);return;
 }
 show("game");
 const active=state.currentPlayer===myId;
 $("turnInfo").textContent=active?"Du bist am Zug":`Am Zug: ${state.players[state.turn]?.name||"—"}`;
 $("deckInfo").textContent=`Nachziehkarten: ${state.deckCount}`;
 $("opponents").innerHTML=state.players.filter(p=>p.id!==myId).map(p=>`<div class="opponent ${p.id===state.currentPlayer?"active":""}"><b>${esc(p.name)}</b><small>${p.total} Gesamtpunkte</small><div>${p.cards.filter(c=>c&&c.revealed).length} aufgedeckt</div></div>`).join("");
 $("drawDiscard").textContent=state.discard??"?";
 $("drawDeck").disabled=!active||state.drawn!==null;
 $("drawDiscard").disabled=!active||state.drawn!==null;
 $("drawnBox").classList.toggle("hidden",state.drawn===null);
 if(state.drawn!==null)$("drawnCard").textContent=state.drawn;
 $("discardDrawn").disabled=!active||state.drawn===null||state.mustChoose;
 $("instruction").textContent=state.drawn===null?(active?"Ziehe eine Karte vom Nachzieh- oder Ablagestapel.":"Warte, bis du an der Reihe bist."):state.mustChoose?"Wähle eine deiner Karten zum Austauschen.":"Wähle eine Karte zum Austauschen oder lege die gezogene Karte ab, um eine verdeckte Karte aufzudecken.";
 $("myGrid").innerHTML=me.cards.map((c,i)=>c===null?`<div class="tile empty">—</div>`:`<button class="tile ${c.revealed?"revealed":""}" data-i="${i}">${c.revealed?c.value:"?"}</button>`).join("");
 $("myGrid").querySelectorAll("[data-i]").forEach(b=>b.onclick=()=>{if(!active||state.drawn===null)return;socket.emit("takeDrawn",{index:Number(b.dataset.i)});});
}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
