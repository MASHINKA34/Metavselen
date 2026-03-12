// voice.js — WebRTC P2P voice chat
// Initiator rule: player with LOWER socket ID always initiates.
// This prevents offer "glare" (both sides sending offers simultaneously).

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

    // Resume AudioContext after user gesture (required by all browsers)
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();

    this.enabled = true;
    document.getElementById('voice-btn').classList.add('active');
    document.getElementById('icon-mic').style.display = 'none';
    document.getElementById('icon-vol').style.display = '';
    document.getElementById('voice-label').textContent = 'Говорю';

    console.log('[Voice] Enabled. My ID:', Network.myId);

    // Tell everyone I'm ready for voice
    Network.socket.emit('voice_ready');

    // Connect to all existing players (initiator = lower socket ID)
    Object.keys(Network.others).forEach(id => {
      if (Network.myId < id) {
        console.log('[Voice] Initiating to existing player', id);
        this._initiate(id);
      }
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

  // Another player announced voice_ready
  onPeerReady(fromId) {
    if (!this.enabled) return;

    // If we already have a peer, keep it only if connected/connecting
    if (this.peers[fromId]) {
      const state = this.peers[fromId].pc.connectionState;
      if (state === 'connected' || state === 'connecting') {
        console.log('[Voice] Already connected to', fromId);
        return;
      }
      // Dead/stale peer (offer was never answered etc.) — reset
      console.log('[Voice] Resetting dead peer for', fromId, '(was:', state, ')');
      this.removePeer(fromId);
    }

    if (Network.myId < fromId) {
      console.log('[Voice] I initiate to', fromId, 'via voice_ready');
      this._initiate(fromId);
    }
    // else: they will initiate to us when they process our voice_ready
  },

  // ── Create and send an offer ──────────────────────────────────────────────
  _initiate(remoteId) {
    if (this.peers[remoteId]) return;
    console.log('[Voice] _initiate ->', remoteId);
    const pc = this._makePC(remoteId);
    this.stream?.getTracks().forEach(t => pc.addTrack(t, this.stream));

    pc.createOffer({ offerToReceiveAudio: true })
      .then(async offer => {
        await pc.setLocalDescription(offer);
        Network.socket.emit('signal', {
          to: remoteId,
          data: { type: 'offer', sdp: pc.localDescription.sdp }
        });
        console.log('[Voice] Offer sent to', remoteId);
      })
      .catch(e => console.warn('[Voice] createOffer failed:', e));
  },

  // ── Handle incoming signal ────────────────────────────────────────────────
  async handleSignal(fromId, data) {
    if (!this.enabled) {
      console.log('[Voice] Signal from', fromId, 'ignored — voice not enabled');
      return;
    }
    console.log('[Voice] Signal from', fromId, 'type:', data.type);

    if (data.type === 'offer') {
      // Remote initiates — we answer regardless of ID order
      if (this.peers[fromId]) {
        const state = this.peers[fromId].pc.connectionState;
        if (state !== 'connected' && state !== 'connecting') this.removePeer(fromId);
      }
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
        console.log('[Voice] Answer sent to', fromId);
      } catch (e) { console.warn('[Voice] handleOffer error:', e); }
    }

    else if (data.type === 'answer') {
      const pc = this.peers[fromId]?.pc;
      if (!pc) return;
      try {
        await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        console.log('[Voice] Answer applied from', fromId);
      }
      catch (e) { console.warn('[Voice] handleAnswer error:', e); }
    }

    else if (data.type === 'ice') {
      const pc = this.peers[fromId]?.pc;
      if (!pc) return;
      try { await pc.addIceCandidate(data.candidate); }
      catch { /* stale ICE candidate — normal */ }
    }
  },

  // ── RTCPeerConnection with STUN + TURN ────────────────────────────────────
  // TURN is critical for users behind strict NAT (most home networks).
  // We use the free public OpenRelay TURN service.
  _makePC(remoteId) {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:openrelay.metered.ca:80' },
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        {
          urls: 'turn:openrelay.metered.ca:443',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        {
          urls: 'turn:openrelay.metered.ca:443?transport=tcp',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        }
      ]
    });

    pc.ontrack = (e) => {
      console.log('[Voice] Got remote audio track from', remoteId);
      if (!this.audioCtx) return;
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
      const src  = this.audioCtx.createMediaStreamSource(e.streams[0]);
      const gain = this.audioCtx.createGain();
      gain.gain.value = 1.0;
      src.connect(gain);
      gain.connect(this.audioCtx.destination);
      if (this.peers[remoteId]) this.peers[remoteId].gainNode = gain;
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        Network.socket.emit('signal', {
          to: remoteId,
          data: { type: 'ice', candidate: e.candidate }
        });
      }
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      console.log('[Voice] Peer', remoteId, 'state:', s);
      if (s === 'failed') this.removePeer(remoteId);
    };

    this.peers[remoteId] = { pc, gainNode: null };
    return pc;
  },

  removePeer(id) {
    if (this.peers[id]) {
      try { this.peers[id].pc.close(); } catch {}
      delete this.peers[id];
    }
  },

  // ── Spatial audio (volume drops with distance) ────────────────────────────
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

  // Z key toggles voice (not while typing in chat)
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyZ' && document.activeElement !== document.getElementById('chat-input')) {
      if (!Network.joined) return;
      Voice.toggle();
    }
  });
});
