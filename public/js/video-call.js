/**
 * MediLock - Video Call JavaScript
 * Native WebRTC implementation using Socket.IO for signaling
 */

// Global variables
let socket = null;
let localStream = null;
let encryptionManager = null;
let roomId = null;
let appointmentId = null;
let callTimerInterval = null;
let callDuration = 0;

// WebRTC Configuration
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ]
};

// Store peer connections
const peers = {}; // socketId -> RTCPeerConnection
const iceCandidateQueue = {}; // socketId -> Array of candidates

// Media constraints
const mediaConstraints = {
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    facingMode: 'user'
  },
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }
};

// Ensure dependencies (Socket.IO)
async function ensureDependencies() {
  if (typeof io === 'undefined') {
    console.log('Socket.IO not found, loading from CDN...');
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load Socket.IO'));
      document.head.appendChild(script);
    });
  }
}

// Initialize
async function initVideoCall() {
  try {
    console.log('Initializing video call...');

    // WebRTC requires Secure Context (HTTPS or localhost)
    if (!window.isSecureContext) {
      showNotification('Video calls require HTTPS. Please use a secure connection.', 'danger');
      console.error('WebRTC requires Secure Context');
    }
    
    // Get appointment ID
    const urlParams = new URLSearchParams(window.location.search);
    appointmentId = urlParams.get('appointmentId');

    if (!appointmentId) {
      showNotification('No appointment ID provided', 'danger');
      return;
    }

    // Fetch appointment details for Room ID
    try {
      const response = await apiRequest('/appointments/' + appointmentId);
      if (response.success && response.data) {
        roomId = response.data.room_id;
        const roomIdDisplay = document.getElementById('roomIdDisplay');
        if (roomIdDisplay) roomIdDisplay.textContent = roomId;
      } else {
        throw new Error('Invalid appointment data');
      }
    } catch (e) {
      console.error('Error fetching appointment:', e);
      showNotification('Failed to load appointment details', 'danger');
      return;
    }

    // Initialize Encryption
    if (typeof EncryptionManager !== 'undefined') {
      encryptionManager = new EncryptionManager();
      await encryptionManager.initialize();
    }

    // Load Socket.IO
    await ensureDependencies();

    // Get Local Stream
    try {
      await getLocalStream();
    } catch (err) {
      console.warn('Could not get local stream, proceeding to connect anyway:', err);
    }

    // Setup Preview
    setupPreview();

    // Show Setup Modal
    const setupModalEl = document.getElementById('setupModal');
    if (setupModalEl) {
      // Prevent premature focus which causes ARIA warnings
      const autoFocusElements = setupModalEl.querySelectorAll('[autofocus]');
      autoFocusElements.forEach(el => el.removeAttribute('autofocus'));

      // Fix for ARIA warning: remove aria-hidden if present before showing
      setupModalEl.removeAttribute('aria-hidden');

      const setupModal = new bootstrap.Modal(setupModalEl);
      setupModal.show();
    }

    // Connect Socket
    await connectSocket();

  } catch (error) {
    console.error('Fatal error initializing video call:', error);
    // Only show generic error if specific media error wasn't already shown
    if (!['NotAllowedError', 'NotReadableError', 'TrackStartError', 'NotFoundError'].includes(error.name)) {
      showNotification('Failed to initialize video call', 'danger');
    }
  }
}

// Get Local Stream
async function getLocalStream() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
    
    const localVideo = document.getElementById('localVideo');
    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.muted = true;
      localVideo.setAttribute('playsinline', 'true');
      await localVideo.play().catch(e => console.warn('Local video play error:', e));
    }
    return localStream;
  } catch (error) {
    console.error('Error accessing media devices:', error);
    if (error.name === 'NotAllowedError') {
        showNotification('Camera/Microphone permission denied', 'danger');
    } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        showNotification('Camera is in use by another application or tab', 'danger');
    } else if (error.name === 'NotFoundError') {
        showNotification('No camera or microphone found', 'danger');
    } else {
        showNotification(`Media access error: ${error.message}`, 'danger');
    }
    throw error;
  }
}

// Setup Preview (in modal)
function setupPreview() {
    const preview = document.getElementById('setupPreview');
    if (localStream && preview) {
        preview.srcObject = localStream;
        preview.muted = true;
        preview.play().catch(e => console.warn('Preview play error:', e));
    }
}

// Connect Socket
function connectSocket() {
    return new Promise((resolve, reject) => {
        socket = io();

        socket.on('connect', () => {
            console.log('Socket connected:', socket.id);
            // Authenticate
            const user = (typeof auth !== 'undefined' && auth.user) ? auth.user : { id: 'guest', role: 'guest' };
            socket.emit('authenticate', {
                userId: user.id,
                userName: user.firstName || user.email || 'Guest',
                role: user.role
            });
            resolve();
        });

        socket.on('room-joined', handleRoomJoined);
        socket.on('user-joined', handleUserJoined);
        socket.on('user-left', handleUserLeft);
        socket.on('offer', handleOffer);
        socket.on('answer', handleAnswer);
        socket.on('ice-candidate', handleIceCandidate);
        socket.on('chat-message', handleChatMessage);
        socket.on('media-state-change', handleMediaStateChange);
        socket.on('screen-share-start', () => showNotification('User started screen sharing', 'info'));
        socket.on('screen-share-stop', () => showNotification('User stopped screen sharing', 'info'));
    });
}

// Join Consultation (Called from Modal Button)
function joinConsultation() {
    if (!roomId) return;
    
    console.log('Joining room:', roomId);
    const user = (typeof auth !== 'undefined' && auth.user) ? auth.user : { id: 'guest', role: 'guest' };
    
    socket.emit('join-room', {
        roomId: roomId,
        userId: user.id,
        userName: user.firstName || user.email,
        role: user.role
    });

    // Hide modal
    const setupModalEl = document.getElementById('setupModal');
    if (setupModalEl) {
        const modal = bootstrap.Modal.getInstance(setupModalEl);
        if (modal) modal.hide();
    }

    startCallTimer();
}

// --- WebRTC Logic ---

function createPeerConnection(targetSocketId) {
    console.log('Creating RTCPeerConnection for:', targetSocketId);
    
    // Close existing connection if any to prevent state issues
    if (peers[targetSocketId]) {
        console.warn('Closing existing peer connection for', targetSocketId);
        closePeerConnection(targetSocketId);
    }

    const pc = new RTCPeerConnection(iceServers);
    peers[targetSocketId] = pc;

    // Add local tracks
    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    // ICE Candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                roomId,
                targetSocketId,
                candidate: event.candidate
            });
        }
    };

    // Remote Stream
    pc.ontrack = (event) => {
        console.log('Received remote track');
        const remoteVideo = document.getElementById('remoteVideo');
        if (remoteVideo && remoteVideo.srcObject !== event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
            remoteVideo.play().catch(e => console.warn('Remote play error:', e));
            
            // Hide waiting overlay
            const waitingOverlay = document.getElementById('waitingOverlay');
            if (waitingOverlay) waitingOverlay.style.display = 'none';
        }
    };

    pc.onconnectionstatechange = () => {
        console.log(`Connection state with ${targetSocketId}: ${pc.connectionState}`);
        const state = pc.connectionState;
        
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            closePeerConnection(targetSocketId);
            showNotification(`Connection to peer ${state}`, 'warning');
        } else if (pc.connectionState === 'connected') {
            console.log('Peer connection established successfully');
            // Ensure remote video is playing
            const remoteVideo = document.getElementById('remoteVideo');
            if (remoteVideo && remoteVideo.paused && remoteVideo.srcObject) {
                remoteVideo.play().catch(e => console.warn('Resume remote video error:', e));
            }
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log(`ICE connection state with ${targetSocketId}: ${pc.iceConnectionState}`);
    };

    return pc;
}

function closePeerConnection(socketId) {
    if (peers[socketId]) {
        peers[socketId].close();
        delete peers[socketId];
    }
    if (iceCandidateQueue[socketId]) {
        delete iceCandidateQueue[socketId];
    }
}

// Helper to process queued ICE candidates
async function processIceQueue(socketId, pc) {
    if (iceCandidateQueue[socketId]) {
        console.log(`Processing ${iceCandidateQueue[socketId].length} queued ICE candidates for ${socketId}`);
        for (const candidate of iceCandidateQueue[socketId]) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
                console.error('Error adding queued ICE candidate:', e);
            }
        }
        delete iceCandidateQueue[socketId];
    }
}

// Handle: We joined the room, initiate calls to existing participants
async function handleRoomJoined(data) {
    console.log('Joined room. Participants:', data.participants);
    
    // data.participants is an array of user objects
    for (const participant of data.participants) {
        const pc = createPeerConnection(participant.socketId);
        
        // Create Offer
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            socket.emit('offer', {
                roomId,
                targetSocketId: participant.socketId,
                offer
            });
        } catch (e) {
            console.error('Error creating offer:', e);
        }
    }
}

// Handle: Someone else joined, they will send us an offer
function handleUserJoined(data) {
    console.log('User joined:', data.userName);
    showNotification(`${data.userName} joined the call`, 'info');
    
    // Update waiting text to show connection is in progress
    const waitingOverlay = document.getElementById('waitingOverlay');
    if (waitingOverlay) {
        const textEl = waitingOverlay.querySelector('h5, p, div');
        if (textEl) textEl.textContent = `${data.userName} joined. Connecting...`;
    }
    // We wait for their offer
}

// Handle: Incoming Offer
async function handleOffer(data) {
    console.log('Received offer from:', data.socketId, 'Creating answer...');
    
    const pc = createPeerConnection(data.socketId);
    
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        socket.emit('answer', {
            roomId,
            targetSocketId: data.socketId,
            answer
        });

        // Process queued ICE candidates
        await processIceQueue(data.socketId, pc);
    } catch (e) {
        console.error('Error handling offer:', e);
    }
}

// Handle: Incoming Answer
async function handleAnswer(data) {
    console.log('Received answer from:', data.socketId, 'Setting remote description...');
    const pc = peers[data.socketId];
    if (pc) {
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            
            // Process queued ICE candidates
            await processIceQueue(data.socketId, pc);
        } catch (e) {
            console.error('Error setting remote description (answer):', e);
        }
    }
}

// Handle: Incoming ICE Candidate
async function handleIceCandidate(data) {
    const pc = peers[data.socketId];
    // Only add candidate if remote description is set
    if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
            console.error('Error adding ICE candidate:', e);
        }
    } else {
        // Queue candidate if PC doesn't exist or remote description not set
        console.log('Queueing ICE candidate for:', data.socketId);
        if (!iceCandidateQueue[data.socketId]) {
            iceCandidateQueue[data.socketId] = [];
        }
        iceCandidateQueue[data.socketId].push(data.candidate);
    }
}

// Handle: User Left
function handleUserLeft(data) {
    console.log('User left:', data.socketId);
    closePeerConnection(data.socketId);
    showNotification(`${data.userName || 'Participant'} left the call`, 'info');
    
    // If no peers left, show waiting
    if (Object.keys(peers).length === 0) {
        const waitingOverlay = document.getElementById('waitingOverlay');
        if (waitingOverlay) waitingOverlay.style.display = 'flex';
        const remoteVideo = document.getElementById('remoteVideo');
        if (remoteVideo) remoteVideo.srcObject = null;
    }
}

// --- Utilities ---

function startCallTimer() {
    callTimerInterval = setInterval(() => {
        callDuration++;
        const minutes = Math.floor(callDuration / 60);
        const seconds = callDuration % 60;
        const timerElement = document.getElementById('callTimer');
        if (timerElement) {
            timerElement.querySelector('span').textContent = 
                `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }, 1000);
}

function toggleMute() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            const btn = document.getElementById('muteBtn');
            if (btn) {
                btn.classList.toggle('active', !audioTrack.enabled);
                btn.querySelector('i').className = audioTrack.enabled ? 'fas fa-microphone' : 'fas fa-microphone-slash';
            }
            socket.emit('media-state-change', { roomId, audioEnabled: audioTrack.enabled, videoEnabled: localStream.getVideoTracks()[0]?.enabled });
        }
    }
}

function toggleVideo() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            const btn = document.getElementById('videoBtn');
            if (btn) {
                btn.classList.toggle('active', !videoTrack.enabled);
                btn.querySelector('i').className = videoTrack.enabled ? 'fas fa-video' : 'fas fa-video-slash';
            }
            socket.emit('media-state-change', { roomId, audioEnabled: localStream.getAudioTracks()[0]?.enabled, videoEnabled: videoTrack.enabled });
        }
    }
}

function endCall() {
    if (confirm('End call?')) {
        if (localStream) localStream.getTracks().forEach(t => t.stop());
        Object.keys(peers).forEach(id => closePeerConnection(id));
        if (socket) socket.disconnect();
        if (callTimerInterval) clearInterval(callTimerInterval);
        window.location.href = auth.user.role === 'doctor' ? 'doctor-dashboard.html' : 'patient-dashboard.html';
    }
}

// Chat functions
async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const msg = input.value.trim();
    if (!msg) return;
    
    // Simple send for now
    socket.emit('chat-message', {
        roomId,
        message: msg,
        encrypted: false
    });
    
    displayChatMessage({ userName: 'You', message: msg, socketId: socket.id });
    input.value = '';
}

function handleChatMessage(data) {
    displayChatMessage(data);
}

function displayChatMessage(data) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const isSelf = data.socketId === socket.id;
    const div = document.createElement('div');
    div.className = `chat-message ${isSelf ? 'self' : ''}`;
    div.innerHTML = `<div class="message-content"><small>${data.userName}</small><div>${data.message}</div></div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function handleMediaStateChange(data) {
    console.log('Media state:', data);
    // Could update UI indicators for remote user mute status here
}

// Initialize
if (window.location.href.includes('consultation.html')) {
    document.addEventListener('DOMContentLoaded', initVideoCall);
}

// Expose
window.joinConsultation = joinConsultation;
window.toggleMute = toggleMute;
window.toggleVideo = toggleVideo;
window.endCall = endCall;
window.sendChatMessage = sendChatMessage;
window.toggleSetupVideo = function() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) videoTrack.enabled = !videoTrack.enabled;
    }
};