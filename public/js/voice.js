// voice.js — WebRTC P2P voice chat
// Initiator rule: player with LOWER socket ID always initiates.
// This prevents "glare" (both sides sending offers simultaneously).

var Voice = {
  enabled: false,
  stream: null,
  audioCtx: null,
  peers: {}, // id -> { pc, gainNode }

  async toggle() {
    this.enabled ? this.disable() : await this.enable();
  },

  async enable() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
      alert(e.name === 'NotAllowedError'
        ? 'Разрешите доступ к микрофону в настройках браузера'
        : 'Ошибка микрофона: ' + e.message);
      return;
    }

    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this.enabled = true;
    document.getElementById('voice-btn').classList.add('active');
    document.getElementById('icon-mic').style.display = 'none';
    document.getElementById('icon-vol').style.display = '';
    document.getElementById('voice-label').textContent = 'Говорю';

    // Tell everyone I'm ready for voice
    Network.socket.emit('voice_ready');

    // Connect to all existing players (I initiate only if my ID < theirs)
    Object.keys(Network.others).forEach(id => {
      if (Network.myId < id) this._initiate(id);
      // else: they will initiate to me when they get my voice_ready
    });
  },

  disable() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    Object.values(this.peers).forEach(p => { try { p.pc.close(); } catch {} });
    this.peers = {};
    this.audioCtx?.close();
    this.audioCtx = null;
    this.enabled = false;
    document.getElementById('voice-btn').classList.remove('active');
    document.getElementById('icon-mic').style.display = '';
    document.getElementById('icon-vol').style.display = 'none';
    document.getElementById('voice-label').textContent = 'Голос';
  },

  // Called when another player announces voice_ready
  onPeerReady(fromId) {
    if (!this.enabled || this.peers[fromId]) return;
    // Connect only if I'm the initiator (lower ID)
    if (Network.myId < fromId) this._initiate(fromId);
    // else: they will initiate to me (since their ID is lower → they see my voice_ready and initiate)
  },

  // Called when a new player joins while voice is enabled
  onPlayerJoined(id) {
    // We'll wait for their voice_ready; they'll initiate if their ID < ours,
    // or we'll initiate when we get their voice_ready
  },

  // ── Create and send an offer ────────────────────────────────────────────────
  _initiate(remoteId) {
    if (this.peers[remoteId]) return;
    const pc = this._makePC(remoteId);
    this.stream?.getTracks().forEach(t => pc.addTrack(t, this.stream));

    pc.createOffer({ offerToReceiveAudio: true })
      .then(async offer => {
        await pc.setLocalDescription(offer);
        Network.socket.emit('signal', {
          to: remoteId,
          data: { type: 'offer', sdp: pc.localDescription.sdp }
        });
      })
      .catch(e => console.warn('createOffer failed:', e));
  },

  // ── Handle incoming signal (offer / answer / ICE) ──────────────────────────
  async handleSignal(fromId, data) {
    if (!this.enabled) return;

    if (data.type === 'offer') {
      // Remote is initiating — we answer
      if (!this.peers[fromId]) {
        const pc = this._makePC(fromId);
        this.stream?.getTracks().forEach(t => pc.addTrack(t, this.stream));
      }
      const pc = this.peers[fromId].pc;
      try {
        await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        Network.socket.emit('signal', {
          to: fromId,
          data: { type: 'answer', sdp: pc.localDescription.sdp }
        });
      } catch (e) { console.warn('handleOffer:', e); }
    }

    else if (data.type === 'answer') {
      const pc = this.peers[fromId]?.pc;
      if (!pc) return;
      try { await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp }); }
      catch (e) { console.warn('handleAnswer:', e); }
    }

    else if (data.type === 'ice') {
      const pc = this.peers[fromId]?.pc;
      if (!pc) return;
      try { await pc.addIceCandidate(data.candidate); }
      catch { /* stale candidate, ignore */ }
    }
  },

  // ── Build RTCPeerConnection ─────────────────────────────────────────────────
  _makePC(remoteId) {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    pc.ontrack = (e) => {
      if (!this.audioCtx) return;
      const src  = this.audioCtx.createMediaStreamSource(e.streams[0]);
      const gain = this.audioCtx.createGain();
      gain.gain.value = 1.0;
      src.connect(gain);
      gain.connect(this.audioCtx.destination);
      if (this.peers[remoteId]) this.peers[remoteId].gainNode = gain;
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        Network.socket.emit('signal', { to: remoteId, data: { type: 'ice', candidate: e.candidate } });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.removePeer(remoteId);
    };

    this.peers[remoteId] = { pc, gainNode: null };
    return pc;
  },

  removePeer(id) {
    if (this.peers[id]) { try { this.peers[id].pc.close(); } catch {} delete this.peers[id]; }
  },

  // ── Spatial audio ───────────────────────────────────────────────────────────
  updatePositions(myPos, others) {
    if (!this.audioCtx || !this.enabled) return;
    others.forEach(({ id, pos }) => {
      const peer = this.peers[id];
      if (!peer?.gainNode) return;
      const dist = myPos.distanceTo(pos);
      const vol  = Math.max(0, 1 - dist / 25) ** 2;
      peer.gainNode.gain.setTargetAtTime(vol, this.audioCtx.currentTime, 0.1);
    });
  }
};

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('voice-btn').addEventListener('click', () => {
    if (!Network.joined) { alert('Сначала войди в мир!'); return; }
    Voice.toggle();
  });

  // Z key toggles voice (only when not typing in chat)
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyZ' && document.activeElement !== document.getElementById('chat-input')) {
      if (!Network.joined) return;
      Voice.toggle();
    }
  });
});
