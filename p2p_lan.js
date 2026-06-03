/* eslint-disable no-alert */
/* global RTCPeerConnection */

// Serverless hotspot multiplayer (no Node/server).
// Uses WebRTC data channels + manual copy/paste codes for signaling.
//
// This file provides a Socket.IO-like shim used by the game's existing "online mode".
// The game calls window.__LAN_P2P_IO__() to get a "socket" with .emit/.on/.once/.disconnect.

(function () {
  "use strict";

  // -------------------------
  // Minimal event emitter
  // -------------------------
  function Emitter() {
    this._handlers = Object.create(null);
    this.connected = true;
  }
  Emitter.prototype.on = function (ev, fn) {
    (this._handlers[ev] || (this._handlers[ev] = [])).push({ fn, once: false });
    return this;
  };
  Emitter.prototype.once = function (ev, fn) {
    (this._handlers[ev] || (this._handlers[ev] = [])).push({ fn, once: true });
    return this;
  };
  Emitter.prototype._emitLocal = function (ev, data) {
    var arr = this._handlers[ev];
    if (!arr || !arr.length) return;
    this._handlers[ev] = arr.filter(function (h) {
      try {
        h.fn(data);
      } catch (e) {
        // ignore handler errors
      }
      return !h.once;
    });
  };

  // -------------------------
  // UI helpers (simple modal)
  // -------------------------
  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        if (k === "style") Object.assign(node.style, props.style);
        else if (k === "className") node.className = props.className;
        else if (k === "text") node.textContent = props.text;
        else node.setAttribute(k, props[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (typeof c === "string") node.appendChild(document.createTextNode(c));
      else if (c) node.appendChild(c);
    });
    return node;
  }

  function showModal(title, bodyNodes) {
    var overlay = el("div", {
      style: {
        position: "fixed",
        inset: "0",
        background: "rgba(0,0,0,0.75)",
        zIndex: "999999",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      },
    });
    var card = el("div", {
      style: {
        width: "min(720px, 100%)",
        background: "#111827",
        color: "#fff",
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: "12px",
        padding: "16px",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      },
    });
    var h = el("div", { style: { fontWeight: "700", fontSize: "18px", marginBottom: "10px" }, text: title });
    var closeBtn = el(
      "button",
      {
        style: {
          position: "absolute",
          right: "22px",
          top: "18px",
          background: "transparent",
          border: "1px solid rgba(255,255,255,0.2)",
          color: "#fff",
          borderRadius: "8px",
          padding: "6px 10px",
          cursor: "pointer",
        },
        text: "Close",
      },
      []
    );
    closeBtn.onclick = function () {
      overlay.remove();
    };
    card.style.position = "relative";
    card.appendChild(h);
    card.appendChild(closeBtn);
    (bodyNodes || []).forEach(function (n) {
      card.appendChild(n);
    });
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    return overlay;
  }

  function encode(obj) {
    var json = JSON.stringify(obj);
    var b64 = btoa(unescape(encodeURIComponent(json)));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function decode(str) {
    var b64 = String(str || "").trim().replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    var json = decodeURIComponent(escape(atob(b64)));
    return JSON.parse(json);
  }

  function randRoomId() {
    return Math.random().toString(36).slice(2, 7).toUpperCase();
  }

  function waitIceComplete(pc) {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise(function (resolve) {
      function done() {
        if (pc.iceGatheringState === "complete") {
          pc.removeEventListener("icegatheringstatechange", done);
          resolve();
        }
      }
      pc.addEventListener("icegatheringstatechange", done);
      // safety
      setTimeout(resolve, 2500);
    });
  }

  // -------------------------
  // Game engine (copied from bundle; edited to match patched behavior)
  // -------------------------
  // NOTE: kept compact on purpose; it must match the client logic.
  var Jh={petty_thief:2,guard:6,ship_worker:2,swordsman:2,cannon:2,merchant:2,sailor:1,captain:1,spy:2,pirate:1},Rt={petty_thief:0,guard:1,ship_worker:2,swordsman:3,spy:4,cannon:5,merchant:6,sailor:7,captain:8,pirate:9},Te={petty_thief:"ছিচকে চোর",guard:"পাহারাদার",ship_worker:"জাহাজ কর্মচারী",swordsman:"তলোয়ারবাজ",spy:"গুপ্তচর",cannon:"কামান চালক",merchant:"বণিক",sailor:"নাবিক",captain:"ক্যাপ্টেন",pirate:"জলদস্যু"};function em(e){var n=e.slice();for(var i=n.length-1;i>0;i--){var r=Math.floor(Math.random()*(i+1)),l=n[i];n[i]=n[r];n[r]=l}return n}function iw(){var e=[];for(var n in Jh)for(var i=0;i<Jh[n];i++)e.push(n);return e}function Kj(e){return{2:7,3:5,4:4,5:3,6:3}[e]||3}function Wd(e){return e.indexOf("captain")!==-1&&(e.indexOf("cannon")!==-1||e.indexOf("sailor")!==-1)}function Ya(e){return e.filter(function(n){return!n.isEliminated})}function zt(e,n){return Object.assign({},e,{log:[n].concat(e.log).slice(0,40)})}function tm(e){return e.filter(function(n){return n.isHuman}).length>1}function Qj(e){var n=e.length,i=em(iw()),r=i.pop(),l=e.map(function(p,y){return{id:y,name:p.name,isHuman:p.isHuman,hand:[i.pop()],discardPile:[],tokens:0,isEliminated:!1,isProtected:!1,playedThiefThisRound:!1}}),c=l[0].isHuman,f=tm(l);return{phase:"playing",playStep:c&&f?"pass_device":"start_turn",players:l,deck:i,hiddenCard:r,currentPlayerIndex:0,cardBeingPlayed:null,targetPlayerIndex:null,guessedCardId:null,merchantOptions:null,peekCard:null,resultMessage:"",round:1,tokensToWin:Kj(n),log:["রাউন্ড ১ শুরু!"],isOnline:!1}}function gc(e,n){var i=Ya(e.players);return["guard","ship_worker","swordsman","cannon","sailor"].indexOf(n)!==-1?i.filter(function(l){return n==="cannon"?!0:l.id!==e.currentPlayerIndex&&!l.isProtected}).map(function(l){return l.id}):[]}function ur(e,n,i){return e.map(function(r,l){if(l!==n)return r;var c=r.hand;return Object.assign({},r,{isEliminated:!0,hand:[],discardPile:i?[].concat(r.discardPile,[i]).concat(c):r.discardPile.concat(c)})})}
  function Ji(e,n){var i=e.players[e.currentPlayerIndex],r=i.hand[n],l=i.hand.filter(function(m,p){return p!==n});var c=e.players.map(function(m,p){return p===e.currentPlayerIndex?Object.assign({},m,{hand:l,discardPile:m.discardPile.concat([r])}):m}),f=Object.assign({},e,{players:c,cardBeingPlayed:r});if(r==="pirate")return c=ur(c,e.currentPlayerIndex),f=zt(Object.assign({},f,{players:c}),i.name+" জলদস্যু খেলেছেন এবং বাদ পড়েছেন!"),Il(f);var h=gc(f,r);if(r==="spy")return c=f.players.map(function(m,p){return p===e.currentPlayerIndex?Object.assign({},m,{isProtected:!0}):m}),f=zt(Object.assign({},f,{players:c,resultMessage:i.name+" পরবর্তী পালা পর্যন্ত সুরক্ষিত।"}),i.name+" গুপ্তচর খেলেছেন — সুরক্ষিত!"),Object.assign({},f,{playStep:"show_result"});if(r==="captain")return f=zt(Object.assign({},f,{resultMessage:i.name+" ক্যাপ্টেন খেলেছেন — কোনো প্রভাব নেই।"}),i.name+" ক্যাপ্টেন খেলেছেন।"),Object.assign({},f,{playStep:"show_result"});if(r==="petty_thief")return c=f.players.map(function(m,p){return p===e.currentPlayerIndex?Object.assign({},m,{playedThiefThisRound:!0}):m}),f=zt(Object.assign({},f,{players:c,resultMessage:i.name+" ছিচকে চোর খেলেছেন — এই রাউন্ডে একমাত্র ছিচকে চোর হলে এবং টিকে থাকলে বোনাস টোকেন পাবেন!"}),i.name+" ছিচকে চোর খেলেছেন।"),Object.assign({},f,{playStep:"show_result"});if(r==="merchant"){var m=f.deck.slice(),p=[];m.length>0&&p.push(m.pop()),m.length>0&&p.push(m.pop());var y=l.concat(p);return f=Object.assign({},f,{deck:m,merchantOptions:y}),i.isHuman?Object.assign({},f,{playStep:"merchant_select"}):Jj(f)}return h.length===0&&["guard","ship_worker","swordsman","sailor"].indexOf(r)!==-1?(f=zt(Object.assign({},f,{resultMessage:"কোনো বৈধ লক্ষ্য নেই — "+Te[r]+" এর কোনো প্রভাব নেই।"}),i.name+" "+Te[r]+" খেলেছেন — কোনো লক্ষ্য নেই।"),Object.assign({},f,{playStep:"show_result"})):(["guard","ship_worker","swordsman","cannon","sailor"].indexOf(r)!==-1?i.isHuman?Object.assign({},f,{playStep:"select_target"}):e3(f,h):Il(f))}
  function rw(e,n){var i=e.cardBeingPlayed,r=Object.assign({},e,{targetPlayerIndex:n});if(i==="guard")return r.players[r.currentPlayerIndex].isHuman?Object.assign({},r,{playStep:"select_guess"}):lw(r,n);if(i==="ship_worker"){var l=r.players[n],c=l.hand[0]||null,f=r.players[r.currentPlayerIndex].name+" "+l.name+"-এর কার্ড দেখেছেন।";return zt(Object.assign({},r,{peekCard:c,resultMessage:l.name+"-এর হাতে আছে: "+(c?Te[c]:"???"),playStep:"peek_result"}),f)}return i==="swordsman"?Zj(r,n):i==="cannon"?Ij(r,n):i==="sailor"?Wj(r,n):Il(r)}
  function aw(e,n){var i=e.players[e.targetPlayerIndex],r=e.players[e.currentPlayerIndex],l=e.players,c="";return i.hand.length>0&&i.hand[0]===n?(l=ur(l,i.id),c=r.name+" "+Te[n]+" অনুমান করেছেন — সঠিক! "+i.name+" বাদ পড়েছেন!"):c=r.name+" "+Te[n]+" অনুমান করেছেন — ভুল। "+i.name+" নিরাপদ।",Object.assign({},zt(Object.assign({},e,{players:l,guessedCardId:n,resultMessage:c}),c),{playStep:"show_result"})}
  // Swordsman compare (patched: do not reveal cards)
  function Zj(e,n){var i=e.players[e.currentPlayerIndex],r=e.players[n],l=i.hand[0],c=r.hand[0],f=l?Rt[l]:-1,h=c?Rt[c]:-1,m=e.players,p="";return f>h?(m=ur(m,n),p=i.name+" বনাম "+r.name+" — "+r.name+" হেরেছেন!"):h>f?(m=ur(m,e.currentPlayerIndex),p=i.name+" বনাম "+r.name+" — "+i.name+" হেরেছেন!"):p=i.name+" বনাম "+r.name+" — টাই! কেউ বাদ পড়েননি।",Object.assign({},e,{players:m,resultMessage:p,playStep:"show_result"})}
  function Ij(e,n){var i=e.players[e.currentPlayerIndex],r=e.players[n],l=e.players,c=e.deck.slice(),f="";if(r.isProtected&&n!==e.currentPlayerIndex)f=r.name+" সুরক্ষিত — কামান চালকের কোনো প্রভাব নেই!";else{var m=r.hand[0],p=m==="pirate";if(c.length>0){var y=c.pop();p?(l=ur(l,n,m),f=i.name+" "+r.name+"-এর উপর কামান চালিয়েছেন — তিনি জলদস্যু ডিসকার্ড করে বাদ পড়েছেন!"):(l=l.map(function(g,b){return b===n?Object.assign({},g,{hand:[y],discardPile:m?g.discardPile.concat([m]):g.discardPile}):g}),f=i.name+" "+r.name+"-এর উপর কামান চালিয়েছেন — "+(m?Te[m]:"?")+" ডিসকার্ড করে নতুন কার্ড নিয়েছেন।")}else f=i.name+" "+r.name+"-এর উপর কামান চালিয়েছেন — ডেক খালি! নতুন কার্ড নেই।",p?(l=ur(l,n,m),f+=" "+r.name+" জলদস্যু ডিসকার্ড করে বাদ পড়েছেন!"):l=l.map(function(y,g){return g===n?Object.assign({},y,{hand:[],discardPile:m?y.discardPile.concat([m]):y.discardPile}):y})}return Object.assign({},zt(Object.assign({},e,{players:l,deck:c,resultMessage:f}),f),{playStep:"show_result"})}
  function Wj(e,n){var i=e.players[e.currentPlayerIndex],r=e.players[n],l=i.hand,c=r.hand,f=e.players.map(function(p,y){return y===e.currentPlayerIndex?Object.assign({},p,{hand:c}):y===n?Object.assign({},p,{hand:l}):p}),h=i.name+" "+r.name+"-এর সাথে হাত বদল করেছেন!";return Object.assign({},zt(Object.assign({},e,{players:f,resultMessage:h}),h),{playStep:"show_result"})}
  function Jj(e){var n=e.merchantOptions,i=n.reduce(function(l,c){return Rt[l]>=Rt[c]?l:c}),r=n.indexOf(i);return ow(e,r)}
  function ow(e,n){var i=e.merchantOptions,r=i[n],l=i.filter(function(y,g){return g!==n}),c=em(l.concat(e.deck)),f=e.players.map(function(y,g){return g===e.currentPlayerIndex?Object.assign({},y,{hand:[r]}):y}),m=e.players[e.currentPlayerIndex].name+" বণিক ব্যবহার করে একটি কার্ড রেখেছেন।";return Object.assign({},zt(Object.assign({},e,{players:f,deck:c,merchantOptions:null,resultMessage:m}),m),{playStep:"show_result"})}
  function e3(e,n){var i=n[Math.floor(Math.random()*n.length)],r=Object.assign({},e,{targetPlayerIndex:i});return e.cardBeingPlayed==="guard"?lw(r,i):rw(r,i)}
  function lw(e,n){var i=["ship_worker","swordsman","cannon","merchant","sailor","captain","spy","pirate","petty_thief"],r=i[Math.floor(Math.random()*i.length)];return aw(Object.assign({},e,{targetPlayerIndex:n}),r)}
  function nm(e){var n=Ya(e.players);if(n.length===1)return mx(e,n[0].id);if(e.deck.length===0){var i=n.reduce(function(r,l){var c=r.hand[0]?Rt[r.hand[0]]:-1,f=l.hand[0]?Rt[l.hand[0]]:-1;return c>=f?r:l});return mx(e,i.id)}return e}
  function mx(e,n){var i=e.players.filter(function(y){return y.playedThiefThisRound&&!y.isEliminated}),r=e.players.map(function(y){return y.id===n?Object.assign({},y,{tokens:y.tokens+1}):y}),l="";if(i.length===1&&i[0].id===n)l=" "+e.players[n].name+" ছিচকে চোরের জন্য বোনাস টোকেনও পেয়েছেন!",r=r.map(function(y){return y.id===n?Object.assign({},y,{tokens:y.tokens+1}):y});else if(i.length===1){var c=i[0];l=" "+c.name+" ছিচকে চোরের জন্য বোনাস টোকেন পেয়েছেন!",r=r.map(function(g){return g.id===c.id?Object.assign({},g,{tokens:g.tokens+1}):g})}var f=(e.players[n]&&e.players[n].name?e.players[n].name:"কেউ একজন")+" রাউন্ড জিতেছেন!"+l,h=r.map(function(y){return Object.assign({},y,{tokens:y.tokens})}),m=h.find(function(y){return y.tokens>=e.tokensToWin}),p=zt(Object.assign({},e,{players:h,resultMessage:f}),f);return m?Object.assign({},p,{phase:"game_end",resultMessage:m.name+" "+m.tokens+" টোকেন দিয়ে গেম জিতেছেন!"}):Object.assign({},p,{phase:"round_end"})}
  function n3(e){if(Ya(e.players).length<=1)return nm(e);var i=(e.currentPlayerIndex+1)%e.players.length;for(;e.players[i].isEliminated;)i=(i+1)%e.players.length;var r=e.players[i],l=tm(e.players),c=r.isHuman&&l&&!e.isOnline?"pass_device":"start_turn";return Object.assign({},e,{currentPlayerIndex:i,playStep:c})}
  function Il(e){var n=nm(e);return n.phase!=="playing"?n:n3(n)}
  function s3(e){return Object.assign({},e,{playStep:"start_turn"})}
  function i3(e,n){var i=em(iw()),r=i.pop(),l=e.players.map(function(p){return Object.assign({},p,{isEliminated:!1,isProtected:!1,hand:[i.pop()],discardPile:[],playedThiefThisRound:!1})}),c=l[n],f=tm(l),h=c.isHuman&&f&&!e.isOnline?"pass_device":"start_turn",m=e.round+1;return Object.assign({},e,{phase:"playing",playStep:h,players:l,deck:i,hiddenCard:r,currentPlayerIndex:n,cardBeingPlayed:null,targetPlayerIndex:null,guessedCardId:null,merchantOptions:null,peekCard:null,resultMessage:"",round:m,log:["রাউন্ড "+m+" শুরু!"].concat(e.log)})}

  // -------------------------
  // Socket-like shim using P2P
  // -------------------------
  var socket = new Emitter();
  var role = null; // "host" | "client"
  var roomId = null;
  var playerId = null;
  var playerName = null;

  var hostPeers = []; // host only: [{pc, dc, playerId}]
  var clientPc = null; // client only
  var clientDc = null; // client only

  var gameState = null; // host authoritative
  var lobbyNames = []; // host authoritative

  function broadcastEvent(ev, data) {
    // host -> all peers + self
    socket._emitLocal(ev, data);
    hostPeers.forEach(function (p) {
      if (p.dc && p.dc.readyState === "open") {
        p.dc.send(JSON.stringify({ t: "event", e: ev, d: data }));
      }
    });
  }

  function sendToHost(msg) {
    if (clientDc && clientDc.readyState === "open") clientDc.send(JSON.stringify(msg));
  }

  function applyAcknowledge(state) {
    if (!state) return state;
    if (state.phase === "round_end") {
      // choose the player with highest tokens as next round starter (best-effort)
      var best = 0;
      for (var i = 1; i < state.players.length; i++) {
        if ((state.players[i].tokens || 0) > (state.players[best].tokens || 0)) best = i;
      }
      return i3(state, best);
    }
    if (state.phase === "game_end") return state;
    switch (state.playStep) {
      case "pass_device":
        return s3(state);
      case "start_turn":
        // draw card
        return (function $j(e){var n=e.currentPlayerIndex;var i=e.players.map(function(h,m){return m===n&&h.isProtected?Object.assign({},h,{isProtected:!1}):h});if(e.deck.length===0)return nm(Object.assign({},e,{players:i}));var r=e.deck.slice(),l=r.pop();i=i.map(function(h,m){return m===n?Object.assign({},h,{hand:h.hand.concat([l])}):h});var c=i[n],f=c.isHuman?"select_card":"ai_turn";return zt(Object.assign({},e,{deck:r,players:i,cardBeingPlayed:null,targetPlayerIndex:null,guessedCardId:null,merchantOptions:null,peekCard:null,resultMessage:"",playStep:f}),c.name+"-এর পালা।")})(state);
      case "ai_turn":
        return (function o3(e){var r3=["guard","ship_worker","swordsman","cannon","sailor"],a3=["guard","ship_worker","swordsman","cannon","merchant","sailor","spy","captain","petty_thief"];var i=e.players[e.currentPlayerIndex].hand;if(Wd(i))return Ji(e,i.indexOf("captain"));for(var ai=0;ai<a3.length;ai++){var l=a3[ai],c=i.indexOf(l);if(c!==-1){if(r3.indexOf(l)!==-1){if(gc(e,l).length>0||l==="cannon")return Ji(e,c)}else return Ji(e,c)}}var r=i.reduce(function(l,c,f){if(c==="pirate")return l;var h=Rt[c];return h<l.val?{idx:f,val:h}:l},{idx:0,val:1/0});return Ji(e,r.val===1/0?0:r.idx)})(state);
      case "show_result":
      case "peek_result":
      default:
        return Il(state);
    }
  }

  function applyGameAction(state, payload) {
    switch (payload.action) {
      case "play_card":
        return Ji(state, payload.cardIndex);
      case "select_target":
        return rw(state, payload.targetId);
      case "guard_guess":
        return aw(state, payload.cardId);
      case "merchant_select":
        return ow(state, payload.keepIndex);
      case "acknowledge":
        return applyAcknowledge(state);
      default:
        return state;
    }
  }

  async function createHostPeerFromOffer(offerObj) {
    var pc = new RTCPeerConnection({ iceServers: [] });
    var dc = pc.createDataChannel("data");
    dc.onmessage = function (ev) {
      try {
        var msg = JSON.parse(ev.data);
        if (msg.t === "action") {
          // client -> host
          handleHostIncomingAction(msg.payload);
        }
      } catch (e) {}
    };
    dc.onopen = function () {
      // nothing
    };
    await pc.setRemoteDescription(offerObj);
    var answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitIceComplete(pc);
    return { pc: pc, dc: dc, answer: pc.localDescription };
  }

  function handleHostIncomingAction(payload) {
    if (!gameState) return;
    if (payload.playerId !== gameState.currentPlayerIndex) return;
    try {
      gameState = applyGameAction(gameState, payload);
      gameState = Object.assign({}, gameState, { isOnline: true });
      broadcastEvent("game_action_ack", { state: gameState });
    } catch (e) {
      broadcastEvent("error", "ত্রুটি");
    }
  }

  function updateLobbyAndBroadcast() {
    broadcastEvent("lobby_update", { players: lobbyNames.slice() });
  }

  // Host UI: add players via paste offer -> create answer -> give back
  function hostShowAddPlayerDialog() {
    var offerInput = el("textarea", {
      style: { width: "100%", height: "110px", marginTop: "8px", fontFamily: "monospace" },
      placeholder: "Paste player's JOIN CODE here…",
    });
    var outBox = el("textarea", {
      style: { width: "100%", height: "110px", marginTop: "8px", fontFamily: "monospace" },
      placeholder: "Answer code will appear here…",
      readOnly: true,
    });
    var btn = el(
      "button",
      {
        style: {
          marginTop: "10px",
          padding: "10px 12px",
          borderRadius: "10px",
          border: "1px solid rgba(255,255,255,0.2)",
          background: "#2563eb",
          color: "#fff",
          fontWeight: "700",
          cursor: "pointer",
        },
        text: "Generate ANSWER code",
      },
      []
    );
    btn.onclick = async function () {
      try {
        var obj = decode(offerInput.value);
        if (!obj || !obj.sdp) throw new Error("bad");
        var res = await createHostPeerFromOffer(obj);

        // assign player
        var pid = lobbyNames.length; // host is 0
        hostPeers.push({ pc: res.pc, dc: res.dc, playerId: pid });

        // send assign once datachannel open
        res.dc.onopen = function () {
          try {
            res.dc.send(JSON.stringify({ t: "assign", roomId: roomId, playerId: pid }));
            // after assign, send latest lobby and state (if started)
            res.dc.send(JSON.stringify({ t: "event", e: "lobby_update", d: { players: lobbyNames.slice() } }));
            if (gameState) res.dc.send(JSON.stringify({ t: "event", e: "game_state", d: { state: gameState } }));
          } catch (e) {}
        };

        outBox.value = encode(res.answer);
        updateLobbyAndBroadcast();
      } catch (e) {
        alert("Invalid JOIN CODE");
      }
    };

    showModal("Host: add player (copy/paste)", [
      el("div", { style: { fontSize: "14px", opacity: "0.9" } }, [
        "Step: Ask the player to send you their JOIN CODE. Paste it, generate ANSWER, then send ANSWER back.",
      ]),
      offerInput,
      btn,
      el("div", { style: { marginTop: "10px", fontSize: "13px", opacity: "0.85" }, text: "ANSWER CODE (send to that player):" }),
      outBox,
    ]);
  }

  async function clientCreateOfferAndShowDialog() {
    var pc = new RTCPeerConnection({ iceServers: [] });
    var dc = pc.createDataChannel("data");
    clientPc = pc;
    clientDc = dc;

    dc.onmessage = function (ev) {
      try {
        var msg = JSON.parse(ev.data);
        if (msg.t === "assign") {
          playerId = msg.playerId;
          // tell the app it joined
          socket._emitLocal("room_joined", { roomId: roomId, playerId: playerId });
        } else if (msg.t === "event") {
          socket._emitLocal(msg.e, msg.d);
        }
      } catch (e) {}
    };

    var offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIceComplete(pc);

    var joinCode = encode(pc.localDescription);

    var joinBox = el("textarea", {
      style: { width: "100%", height: "110px", marginTop: "8px", fontFamily: "monospace" },
      readOnly: true,
    });
    joinBox.value = joinCode;

    var answerInput = el("textarea", {
      style: { width: "100%", height: "110px", marginTop: "8px", fontFamily: "monospace" },
      placeholder: "Paste host ANSWER code here…",
    });
    var btn = el(
      "button",
      {
        style: {
          marginTop: "10px",
          padding: "10px 12px",
          borderRadius: "10px",
          border: "1px solid rgba(255,255,255,0.2)",
          background: "#16a34a",
          color: "#fff",
          fontWeight: "700",
          cursor: "pointer",
        },
        text: "Connect",
      },
      []
    );
    btn.onclick = async function () {
      try {
        var ans = decode(answerInput.value);
        await pc.setRemoteDescription(ans);
        // once data channel opens, lobby_update etc will arrive
      } catch (e) {
        alert("Invalid ANSWER code");
      }
    };

    showModal("Join room (copy/paste)", [
      el("div", { style: { fontSize: "14px", opacity: "0.9" } }, [
        "Step 1: Send this JOIN CODE to the host. Step 2: Paste the host's ANSWER and press Connect.",
      ]),
      el("div", { style: { marginTop: "10px", fontSize: "13px", opacity: "0.85" }, text: "JOIN CODE (send to host):" }),
      joinBox,
      el("div", { style: { marginTop: "10px", fontSize: "13px", opacity: "0.85" }, text: "HOST ANSWER (paste here):" }),
      answerInput,
      btn,
    ]);
  }

  // -------------------------
  // Implement socket.emit(...) commands used by the game
  // -------------------------
  socket.emit = function (ev, payload) {
    payload = payload || {};

    if (ev === "create_room") {
      role = "host";
      playerId = 0;
      playerName = (payload.playerName || "").trim() || "Host";
      roomId = randRoomId();
      lobbyNames = [playerName];

      // tell the app "room created"
      socket._emitLocal("room_created", { roomId: roomId, playerId: playerId });
      updateLobbyAndBroadcast();

      // show host instructions to add players
      setTimeout(function () {
        hostShowAddPlayerDialog();
      }, 600);
      return;
    }

    if (ev === "join_room") {
      role = "client";
      playerName = (payload.playerName || "").trim() || "Player";
      roomId = String(payload.roomId || "").toUpperCase().trim();
      // Wait for WebRTC connect -> then emit room_joined
      clientCreateOfferAndShowDialog();
      return;
    }

    if (ev === "rejoin_room") {
      // With no server, true "rejoin" isn't automatic.
      // We'll just re-emit current lobby/state if we have them.
      if (role === "host") {
        updateLobbyAndBroadcast();
        if (gameState) broadcastEvent("game_state", { state: gameState });
      } else if (role === "client") {
        // If connection still alive, do nothing; otherwise user must reconnect.
      }
      return;
    }

    if (ev === "start_game") {
      if (role !== "host") return;
      if (lobbyNames.length < 2) return socket._emitLocal("error", "কমপক্ষে ২ জন লাগবে");

      var players = lobbyNames.map(function (n) {
        return { name: n, isHuman: true };
      });
      gameState = Qj(players);
      gameState = Object.assign({}, gameState, { isOnline: true, playStep: "start_turn" });
      broadcastEvent("game_state", { state: gameState });
      return;
    }

    if (ev === "game_action") {
      if (!payload) return;
      if (role === "host") {
        handleHostIncomingAction(payload);
      } else {
        sendToHost({ t: "action", payload: payload });
      }
      return;
    }

    // ignore anything else
  };

  socket.disconnect = function () {
    socket.connected = false;
    try {
      hostPeers.forEach(function (p) {
        try {
          p.dc && p.dc.close();
        } catch (e) {}
        try {
          p.pc && p.pc.close();
        } catch (e) {}
      });
      hostPeers = [];
      if (clientDc) clientDc.close();
      if (clientPc) clientPc.close();
    } catch (e) {}
  };

  // Hook host to accept messages from clients: client always creates dc, host created dc too.
  // In practice, the host will receive the *remote* datachannel via ondatachannel.
  // So also listen for that.
  // (If the host used createDataChannel earlier, this is still safe.)
  function attachHostOnDataChannel(pc, pid) {
    pc.ondatachannel = function (ev) {
      var dc = ev.channel;
      dc.onmessage = function (e) {
        try {
          var msg = JSON.parse(e.data);
          if (msg.t === "action") handleHostIncomingAction(msg.payload);
        } catch (err) {}
      };
      var peer = hostPeers.find(function (p) {
        return p.playerId === pid;
      });
      if (peer) peer.dc = dc;
    };
  }
  // Patch createHostPeerFromOffer to attach ondatachannel too
  var _origCreate = createHostPeerFromOffer;
  createHostPeerFromOffer = async function (offerObj) {
    var res = await _origCreate(offerObj);
    // attach, pid will be assigned later but that's ok
    attachHostOnDataChannel(res.pc, -1);
    return res;
  };

  // Expose factory used by patched bundle
  window.__LAN_P2P_IO__ = function () {
    return socket;
  };

  // Add a small helper in console for host to reopen "add player" dialog:
  window.__LAN_HOST_ADD_PLAYER__ = function () {
    if (role === "host") hostShowAddPlayerDialog();
  };
})();

