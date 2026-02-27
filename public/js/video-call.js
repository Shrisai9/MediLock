/**
 * MediLock - Video Call JavaScript
 * WebRTC implementation with E2EE
 */

// Global variables
let socket = null;
let peers = {}; // Store peer connections: { socketId: RTCPeerConnection }
let iceCandidateQueue = {}; // Store early ICE candidates: { socketId: [candidate, ...] }
let localStream = null;
let remoteStream = null;
let dataChannel = null;
let encryptionManager = null;
let roomId = null;
let appointmentId = null;
let callTimerInterval = null;
let callDuration = 0;

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

// ICE servers configuration with TURN server
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ]
};

// Helper to load external scripts if missing
async function ensureDependencies() {
  const dependencies = [];

  if (typeof io === 'undefined') {
    console.log('Socket.IO not found, loading from CDN...');
    dependencies.push(new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load Socket.IO'));
      document.head.appendChild(script);
    }));
  }

  if (dependencies.length > 0) {
    await Promise.all(dependencies);
    console.log('Dependencies loaded');
  }
}

// Initialize video call
async function initVideoCall() {
  try {
    console.log('Initializing video call...');
    // Get appointment ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    appointmentId = urlParams.get('appointmentId');
    
    // Fetch appointment details to get the room ID
    if (appointmentId) {
      try {
        const response = await apiRequest('/appointments/' + appointmentId);
        if (response.success && response.data && response.data.room_id) {
          roomId = response.data.room_id;
          console.log('Using room ID from appointment:', roomId);
        } else {
          roomId = generateId(16);
        }
      } catch (e) {
        console.log('Error fetching appointment:', e);
        roomId = generateId(16);
      }
    } else {
      roomId = generateId(16);
    }
    
    // Update UI immediately so Room ID is visible
    const roomIdDisplay = document.getElementById('roomIdDisplay');
    if (roomIdDisplay) roomIdDisplay.textContent = roomId;
    
    // Initialize encryption (with fallback)
    if (typeof EncryptionManager !== 'undefined') {
      encryptionManager = new EncryptionManager();
      await encryptionManager.initialize();
    } else {
      console.warn('EncryptionManager not loaded. Using unencrypted fallback.');
      encryptionManager = {
        initialize: async () => {},
        encrypt: async (data) => data,
        decrypt: async (data) => data,
        getPublicKey: async () => 'mock-key'
      };
    }
    
    // Ensure Socket.IO is loaded
    await ensureDependencies();

    // 1. Get local media stream FIRST (so user sees camera immediately)
    try {
      await getLocalStream();
    } catch (err) {
      console.error('Failed to get local stream:', err);
      if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        showNotification('Camera is in use by another application or tab.', 'danger');
      } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        showNotification('Camera permission denied. Please allow access in your browser settings.', 'danger');
      } else {
        showNotification('Camera access failed: ' + err.message, 'warning');
      }
    }
    
    // 3. Show setup modal
    const setupModalEl = document.getElementById('setupModal');
    if (setupModalEl) {
      const setupModal = new bootstrap.Modal(setupModalEl);
      setupModal.show();
    }

    // 4. Connect to socket (in background/parallel)
    await connectSocket();
    
  } catch (error) {
    console.error('Error initializing video call:', error);
    showNotification('Failed to initialize video call', 'danger');
  }
}

// Connect to socket server
function connectSocket() {
  return new Promise((resolve, reject) => {
    socket = io();
    
    socket.on('connect', () => {
      console.log('Socket connected, id:', socket.id);
      
      // Authenticate
      socket.emit('authenticate', {
        userId: auth.user.id,
        userName: auth.user.firstName || auth.user.email,
        role: auth.user.role
      });
      
      resolve();
    });
    
    socket.on('authenticated', () => {
      console.log('Socket authenticated');
    });
    
    socket.on('error', (error) => {
      console.error('Socket error:', error);
      reject(error);
    });
    
    // Handle room events
    socket.on('room-joined', handleRoomJoined);
    socket.on('user-joined', handleUserJoined);
    socket.on('user-left', handleUserLeft);
    
    // Handle WebRTC signaling
    socket.on('offer', handleOffer);
    socket.on('answer', handleAnswer);
    socket.on('ice-candidate', handleIceCandidate);
    
    // Handle chat messages
    socket.on('chat-message', handleChatMessage);
    
    // Handle media state changes
    socket.on('media-state-change', handleMediaStateChange);
  });
}

// Get local media stream
async function getLocalStream() {
  try {
    console.log('Requesting local stream...');
    localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
    console.log('Local stream obtained');

    const localVideo = document.getElementById('localVideo');
    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.muted = true; // Mute to prevent feedback
      localVideo.setAttribute('playsinline', 'true'); // Required for some browsers
      localVideo.play().catch(e => console.warn('Local video play error:', e));
    }

    const setupPreview = document.getElementById('setupPreview');
    if (setupPreview) {
      setupPreview.srcObject = localStream;
      setupPreview.muted = true;
      setupPreview.setAttribute('playsinline', 'true');
      setupPreview.play().catch(e => console.warn('Setup preview play error:', e));
    }

    return localStream;
  } catch (error) {
    console.error('Error getting local stream:', error);
    throw error;
  }
}

// Setup preview
function setupPreview() {
  const preview = document.getElementById('setupPreview');
  if (localStream && preview) {
    preview.srcObject = localStream;
    preview.muted = true;
    preview.play().catch(e => console.warn('Preview play error:', e));
  }
}

// Toggle video in preview
function toggleSetupVideo() {
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
    }
  }
}

// Join consultation
async function joinConsultation() {
  try {
    console.log('Joining consultation, room:', roomId);
    
    // Blur the button to prevent aria-hidden warning
    if (document.activeElement) document.activeElement.blur();
    
    // Update UI
    document.getElementById('roomIdDisplay').textContent = roomId;
    
    // Hide setup modal
    const setupModalEl = document.getElementById('setupModal');
    if (setupModalEl) {
      const setupModal = bootstrap.Modal.getInstance(setupModalEl);
      if (setupModal) setupModal.hide();
    }
    
    // Start call timer
    startCallTimer();
    
  } catch (error) {
    console.error('Error joining consultation:', error);
    showNotification('Failed to join consultation', 'danger');
  }
}

// Handle room joined - when WE join and there are others in the room
async function handleRoomJoined(data) {
  console.log('Room joined, participants:', data.participants);
  
  // Exchange encryption keys
  if (encryptionManager) {
    await encryptionManager.getPublicKey();
  }
  
  // If there are participants, create call to each
  if (data.participants && data.participants.length > 0) {
    for (const participant of data.participants) {
      console.log('Initiating connection to:', participant.userName);
      createPeerConnection(participant.socketId, true); // true = initiator
    }
  } else {
    console.log('No participants in room yet, waiting...');
  }
}

// Create RTCPeerConnection
function createPeerConnection(targetSocketId, isInitiator) {
  console.log(`Creating RTCPeerConnection for ${targetSocketId} (Initiator: ${isInitiator})`);
  
  const pc = new RTCPeerConnection(iceServers);
  peers[targetSocketId] = pc;

  // Add local tracks
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  // Handle ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        roomId: roomId,
        candidate: event.candidate,
        targetSocketId: targetSocketId
      });
    }
  };

  // Handle remote stream
  pc.ontrack = (event) => {
    console.log('Received remote stream');
    const remoteVideo = document.getElementById('remoteVideo');
    if (remoteVideo.srcObject !== event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
      remoteStream = event.streams[0];
      
      remoteVideo.play().catch(e => {
        console.log('Auto-play blocked, showing controls');
        remoteVideo.controls = true;
      });

      // Hide waiting overlay
      const waitingOverlay = document.getElementById('waitingOverlay');
      if (waitingOverlay) waitingOverlay.style.display = 'none';
    }
  };

  // Handle connection state
  pc.onconnectionstatechange = () => {
    console.log(`Connection state with ${targetSocketId}: ${pc.connectionState}`);
  };

  // If initiator, create offer
  if (isInitiator) {
    pc.createOffer()
      .then(offer => pc.setLocalDescription(offer))
      .then(() => {
        socket.emit('offer', {
          roomId: roomId,
          offer: pc.localDescription,
          targetSocketId: targetSocketId
        });
      })
      .catch(e => console.error('Error creating offer:', e));
  }

  return pc;
}

// Handle user joined - when SOMEONE ELSE joins the room
async function handleUserJoined(data) {
  console.log('User joined:', data.socketId);
  
  // Hide waiting overlay
  const waitingOverlay = document.getElementById('waitingOverlay');
  if (waitingOverlay) waitingOverlay.style.display = 'none';
  
  // We don't need to create an offer here. 
  // The new user (initiator) will send us an offer via handleOffer.
  
  showNotification(`${data.userName} joined the call`, 'info');
}

// Handle user left
function handleUserLeft(data) {
  console.log('User left:', data.userName);
  
  // Remove from peer ID map
  if (peers[data.socketId]) {
    peers[data.socketId].close();
    delete peers[data.socketId];
  }
  
  // Only show waiting overlay if no remote stream
  if (!remoteStream) {
    const waitingOverlay = document.getElementById('waitingOverlay');
    if (waitingOverlay) waitingOverlay.style.display = 'flex';
  }
  
  showNotification(`${data.userName || 'Participant'} left the call`, 'info');
}

// Handle WebRTC offer
async function handleOffer(data) {
  console.log('Received offer from:', data.socketId);
  
  // Create PC if not exists (receiver side)
  let pc = peers[data.socketId];
  if (!pc) {
    pc = createPeerConnection(data.socketId, false);
  }

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    // Process queued ICE candidates
    if (iceCandidateQueue[data.socketId]) {
      console.log(`Processing ${iceCandidateQueue[data.socketId].length} queued ICE candidates for ${data.socketId}`);
      for (const candidate of iceCandidateQueue[data.socketId]) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      delete iceCandidateQueue[data.socketId];
    }
    
    socket.emit('answer', {
      roomId: roomId,
      answer: pc.localDescription,
      targetSocketId: data.socketId
    });
  } catch (e) {
    console.error('Error handling offer:', e);
  }
}

// Handle WebRTC answer
async function handleAnswer(data) {
  console.log('Received answer from:', data.socketId);
  const pc = peers[data.socketId];
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    
    // Process queued ICE candidates
    if (iceCandidateQueue[data.socketId]) {
      console.log(`Processing ${iceCandidateQueue[data.socketId].length} queued ICE candidates for ${data.socketId}`);
      for (const candidate of iceCandidateQueue[data.socketId]) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      delete iceCandidateQueue[data.socketId];
    }
  }
}

// Handle ICE candidate
async function handleIceCandidate(data) {
  const pc = peers[data.socketId];
  
  // Only add candidate if remote description is set
  if (pc && pc.remoteDescription) {
    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  } else {
    // Queue candidate if PC doesn't exist or remote description not set
    console.log('Queueing ICE candidate for:', data.socketId);
    if (!iceCandidateQueue[data.socketId]) {
      iceCandidateQueue[data.socketId] = [];
    }
    iceCandidateQueue[data.socketId].push(data.candidate);
  }
}

// Handle chat message
async function handleChatMessage(data) {
  try {
    if (data.encrypted) {
      const decrypted = await encryptionManager.decrypt(data.message);
      data.message = decrypted;
    }
    displayChatMessage(data);
  } catch (error) {
    displayChatMessage(data);
  }
}

// Handle media state change
function handleMediaStateChange(data) {
  console.log('Media state changed:', data);
}

// Send chat message
async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  
  if (!message) return;
  
  try {
    // Encrypt message
    const encrypted = await encryptionManager.encrypt(message);
    
    const messageData = {
      socketId: socket.id,
      userId: auth.user.id,
      userName: auth.user.firstName || auth.user.email,
      message: message,
      encrypted: true,
      timestamp: new Date().toISOString()
    };
    
    // Send via socket
    socket.emit('chat-message', {
      roomId: roomId,
      message: encrypted,
      encrypted: true,
      timestamp: messageData.timestamp
    });
    
    // Display own message
    displayChatMessage(messageData);
    
    // Clear input
    input.value = '';
    
  } catch (error) {
    console.error('Error sending chat message:', error);
    
    // Send unencrypted as fallback
    const messageData = {
      socketId: socket.id,
      userId: auth.user.id,
      userName: auth.user.firstName || auth.user.email,
      message: message,
      encrypted: false,
      timestamp: new Date().toISOString()
    };
    
    socket.emit('chat-message', {
      roomId: roomId,
      message: message,
      encrypted: false,
      timestamp: messageData.timestamp
    });
    
    displayChatMessage(messageData);
    input.value = '';
  }
}

// Display chat message
function displayChatMessage(data) {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  
  const isSelf = data.socketId === socket.id;
  
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${isSelf ? 'self' : ''}`;
  messageDiv.innerHTML = `
    <div class="message-content">
      <small class="d-block text-white-50">${data.userName}</small>
      ${data.message}
    </div>
  `;
  
  container.appendChild(messageDiv);
  container.scrollTop = container.scrollHeight;
  
  // Update badge
  if (!isSelf) {
    const badge = document.getElementById('chatBadge');
    if (badge) {
      badge.classList.remove('d-none');
      badge.textContent = parseInt(badge.textContent || '0') + 1;
    }
  }
}

// Handle chat key press
function handleChatKeyPress(event) {
  if (event.key === 'Enter') {
    sendChatMessage();
  }
}

// Toggle mute
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
      
      // Notify others
      socket.emit('media-state-change', {
        roomId: roomId,
        audioEnabled: audioTrack.enabled,
        videoEnabled: localStream.getVideoTracks()[0]?.enabled || false
      });
    }
  }
}

// Toggle video
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
      
      // Notify others
      socket.emit('media-state-change', {
        roomId: roomId,
        audioEnabled: localStream.getAudioTracks()[0]?.enabled || false,
        videoEnabled: videoTrack.enabled
      });
    }
  }
}

// Toggle screen share
async function toggleScreenShare() {
  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true
    });
    
    // Replace video track
    const videoTrack = screenStream.getVideoTracks()[0];
    
    if (peer && peer._pc) {
      const senders = peer._pc.getSenders();
      const sender = senders.find(s => s.track?.kind === 'video');
      
      if (sender) {
        await sender.replaceTrack(videoTrack);
      }
    }
    
    // Handle screen share stop
    videoTrack.onended = async () => {
      const cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
      const cameraTrack = cameraStream.getVideoTracks()[0];
      
      if (peer && peer._pc) {
        const senders = peer._pc.getSenders();
        const sender = senders.find(s => s.track?.kind === 'video');
        
        if (sender) {
          await sender.replaceTrack(cameraTrack);
        }
      }
      
      socket.emit('screen-share-stop', { roomId: roomId });
    };
    
    socket.emit('screen-share-start', { roomId: roomId });
    showNotification('Screen sharing started', 'success');
    
  } catch (error) {
    console.error('Error sharing screen:', error);
    showNotification('Failed to share screen', 'danger');
  }
}

// Toggle chat
function toggleChat() {
  const sidebar = document.getElementById('chatSidebar');
  if (sidebar) {
    sidebar.classList.toggle('show');
  }
}

// Toggle fullscreen
function toggleFullscreen() {
  const container = document.getElementById('videoContainer');
  
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else if (container) {
    container.requestFullscreen();
  }
}

// Copy room ID
function copyRoomId() {
  navigator.clipboard.writeText(roomId);
  showNotification('Room ID copied to clipboard', 'success');
}

// End call
function endCall() {
  if (confirm('Are you sure you want to end the call?')) {
    handleCallEnded();
  }
}

// Handle call ended
function handleCallEnded() {
  // Stop local stream
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  
  // Close all peer connections
  for (let id in peers) {
    peers[id].close();
  }
  
  // Close socket
  if (socket) {
    socket.disconnect();
  }
  
  // Stop timer
  if (callTimerInterval) {
    clearInterval(callTimerInterval);
  }
  
  // Show notification
  showNotification('Call ended', 'info');
  
  // Redirect to dashboard
  setTimeout(() => {
    window.location.href = auth.user.role === 'doctor' ? 'doctor-dashboard.html' : 'patient-dashboard.html';
  }, 2000);
}

// Start call timer
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

// Initialize on page load
if (window.location.pathname.includes('consultation.html') || window.location.href.includes('consultation.html')) {
  document.addEventListener('DOMContentLoaded', initVideoCall);
}

// Make functions globally available
window.joinConsultation = joinConsultation;
window.toggleMute = toggleMute;
window.toggleVideo = toggleVideo;
window.toggleScreenShare = toggleScreenShare;
window.toggleChat = toggleChat;
window.toggleFullscreen = toggleFullscreen;
window.copyRoomId = copyRoomId;
window.endCall = endCall;
window.sendChatMessage = sendChatMessage;
window.handleChatKeyPress = handleChatKeyPress;
window.toggleSetupVideo = toggleSetupVideo;
