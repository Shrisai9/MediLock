/**
 * MediLock - Video Call Client
 * Simplified and Robust WebRTC implementation
 */

// --- Global State ---
let socket = null;
let localStream = null;
let roomId = null;
let peers = {}; // socketId -> RTCPeerConnection
let iceQueue = {}; // socketId -> Array of candidates

// --- Configuration ---
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// --- Debug Logger ---
function log(msg) {
  console.log(`[VideoCall] ${msg}`);
  const debugDiv = document.getElementById('debug-log');
  if (debugDiv) {
    const line = document.createElement('div');
    line.textContent = `${new Date().toLocaleTimeString()} - ${msg}`;
    debugDiv.appendChild(line);
    debugDiv.scrollTop = debugDiv.scrollHeight;
  }
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  if (!window.location.href.includes('consultation.html')) return;

  // Create Debug UI
  const debugContainer = document.createElement('div');
  debugContainer.id = 'debug-log';
  debugContainer.style.cssText = 'position:fixed; bottom:10px; left:10px; width:300px; height:150px; background:rgba(0,0,0,0.7); color:#0f0; font-size:10px; overflow-y:scroll; z-index:9999; pointer-events:none; padding:5px;';
  document.body.appendChild(debugContainer);

  log('Initializing...');

  // 1. Get Room ID
  const urlParams = new URLSearchParams(window.location.search);
  const appointmentId = urlParams.get('appointmentId');
  if (!appointmentId) {
    alert('No appointment ID');
    return;
  }

  try {
    const res = await apiRequest(`/appointments/${appointmentId}`);
    if (res.success) {
      roomId = res.data.room_id;
      document.getElementById('roomIdDisplay').textContent = roomId;
      log(`Room ID: ${roomId}`);
    }
  } catch (e) {
    log('Error fetching appointment details');
  }

  // 2. Load Socket.IO
  if (typeof io === 'undefined') {
    log('Loading Socket.IO...');
    await new Promise(resolve => {
      const script = document.createElement('script');
      script.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
      script.onload = resolve;
      document.head.appendChild(script);
    });
  }

  // 3. Get Local Media
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('localVideo').srcObject = localStream;
    document.getElementById('setupPreview').srcObject = localStream;
    log('Local media acquired');
  } catch (e) {
    log(`Media Error: ${e.name}`);
    alert('Camera/Mic access failed. Please allow permissions.');
  }

  // 4. Show Setup Modal
  const setupModal = new bootstrap.Modal(document.getElementById('setupModal'));
  setupModal.show();

  // Remove autofocus to prevent ARIA warnings
  document.querySelectorAll('[autofocus]').forEach(el => el.removeAttribute('autofocus'));
});

// --- Join Function ---
window.joinConsultation = async function() {
  log('Joining consultation...');
  
  // Hide modal
  const modalEl = document.getElementById('setupModal');
  const modal = bootstrap.Modal.getInstance(modalEl);
  modal.hide();

  // Connect Socket
  socket = io();

  socket.on('connect', () => {
    log(`Socket connected: ${socket.id}`);
    
    // Authenticate
    const user = auth.user || { id: 'guest', role: 'guest' };
    socket.emit('authenticate', {
      userId: user.id,
      userName: user.firstName || 'Guest',
      role: user.role
    });

    // Join Room
    socket.emit('join-room', {
      roomId: roomId,
      userId: user.id,
      userName: user.firstName || 'Guest',
      role: user.role
    });
  });

  // --- Signaling Events ---

  // 1. Existing participants sent to newcomer
  socket.on('room-joined', async (data) => {
    log(`Joined room. Peers found: ${data.participants.length}`);
    
    // We are the newcomer. We initiate calls to existing peers.
    for (const p of data.participants) {
      createPeerConnection(p.socketId, true); // true = initiator
    }
  });

  // 2. Newcomer joined (existing participants receive this)
  socket.on('user-joined', (data) => {
    log(`User joined: ${data.userName}`);
    // We wait for them to offer.
  });

  // 3. Offer received
  socket.on('offer', async (data) => {
    log(`Received Offer from ${data.socketId}`);
    const pc = createPeerConnection(data.socketId, false);
    
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    socket.emit('answer', {
      targetSocketId: data.socketId,
      answer: answer
    });
    
    processIceQueue(data.socketId);
  });

  // 4. Answer received
  socket.on('answer', async (data) => {
    log(`Received Answer from ${data.socketId}`);
    const pc = peers[data.socketId];
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      processIceQueue(data.socketId);
    }
  });

  // 5. ICE Candidate received
  socket.on('ice-candidate', async (data) => {
    const pc = peers[data.socketId];
    if (pc && pc.remoteDescription) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        log('Added ICE candidate');
      } catch (e) {
        log('Error adding ICE');
      }
    } else {
      log('Queuing ICE candidate');
      if (!iceQueue[data.socketId]) iceQueue[data.socketId] = [];
      iceQueue[data.socketId].push(data.candidate);
    }
  });

  socket.on('user-left', (data) => {
    log(`User left: ${data.userName}`);
    if (peers[data.socketId]) {
      peers[data.socketId].close();
      delete peers[data.socketId];
    }
    document.getElementById('remoteVideo').srcObject = null;
    document.getElementById('waitingOverlay').style.display = 'flex';
  });

  // Chat
  socket.on('chat-message', (data) => {
    const div = document.createElement('div');
    div.className = `chat-message ${data.socketId === socket.id ? 'self' : ''}`;
    div.innerHTML = `<small>${data.userName}</small><div>${data.message}</div>`;
    document.getElementById('chatMessages').appendChild(div);
  });
};

// --- WebRTC Core ---

function createPeerConnection(targetSocketId, isInitiator) {
  log(`Creating PC for ${targetSocketId} (Initiator: ${isInitiator})`);
  
  const pc = new RTCPeerConnection(iceServers);
  peers[targetSocketId] = pc;

  // Add local tracks
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  // Handle ICE
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        targetSocketId: targetSocketId,
        candidate: event.candidate
      });
    }
  };

  // Handle Remote Stream
  pc.ontrack = (event) => {
    log('Received Remote Stream');
    const vid = document.getElementById('remoteVideo');
    if (vid.srcObject !== event.streams[0]) {
      vid.srcObject = event.streams[0];
      document.getElementById('waitingOverlay').style.display = 'none';
    }
  };

  // Connection State
  pc.onconnectionstatechange = () => {
    log(`PC State: ${pc.connectionState}`);
  };

  // If initiator, create offer
  if (isInitiator) {
    pc.createOffer()
      .then(offer => pc.setLocalDescription(offer))
      .then(() => {
        socket.emit('offer', {
          targetSocketId: targetSocketId,
          offer: pc.localDescription
        });
      })
      .catch(e => log(`Offer Error: ${e}`));
  }

  return pc;
}

async function processIceQueue(socketId) {
  const pc = peers[socketId];
  if (iceQueue[socketId] && pc) {
    log(`Processing ${iceQueue[socketId].length} queued ICEs`);
    for (const c of iceQueue[socketId]) {
      await pc.addIceCandidate(new RTCIceCandidate(c));
    }
    delete iceQueue[socketId];
  }
}

// --- UI Utilities ---
window.toggleMute = function() {
  const track = localStream.getAudioTracks()[0];
  track.enabled = !track.enabled;
  document.getElementById('muteBtn').classList.toggle('active', !track.enabled);
};

window.toggleVideo = function() {
  const track = localStream.getVideoTracks()[0];
  track.enabled = !track.enabled;
  document.getElementById('videoBtn').classList.toggle('active', !track.enabled);
};

window.endCall = function() {
  if (confirm('End call?')) {
    window.location.href = auth.user.role === 'doctor' ? 'doctor-dashboard.html' : 'patient-dashboard.html';
  }
};

window.sendChatMessage = function() {
  const input = document.getElementById('chatInput');
  if (input.value.trim()) {
    socket.emit('chat-message', { message: input.value });
    input.value = '';
  }
};