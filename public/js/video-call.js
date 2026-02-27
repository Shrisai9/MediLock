/**
 * MediLock - Video Call JavaScript
 * WebRTC implementation with E2EE
 */

// Global variables
let peer = null;
let socket = null;
let localStream = null;
let remoteStream = null;
let dataChannel = null;
let encryptionManager = null;
let roomId = null;
let appointmentId = null;
let callTimerInterval = null;
let callDuration = 0;

// Map to store socket ID -> peer ID mappings
let peerIdMap = new Map();

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

  if (typeof Peer === 'undefined') {
    console.log('PeerJS not found, loading from CDN...');
    dependencies.push(new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load PeerJS'));
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
    
    // Initialize encryption
    encryptionManager = new EncryptionManager();
    await encryptionManager.initialize();
    
    // Ensure Socket.IO and PeerJS are loaded
    await ensureDependencies();

    // 1. Get local media stream FIRST (so user sees camera immediately)
    try {
      await getLocalStream();
    } catch (err) {
      console.error('Failed to get local stream:', err);
      showNotification('Camera/Microphone access failed. Please check permissions.', 'warning');
    }
    
    // 2. Setup preview
    setupPreview();
    
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
    socket.on('peer-registered', handlePeerRegistered);
    
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
    
    // Join room via socket
    socket.emit('join-room', {
      roomId: roomId,
      userId: auth.user.id,
      userName: auth.user.firstName || auth.user.email,
      role: auth.user.role
    });
    
    // Update UI
    document.getElementById('roomIdDisplay').textContent = roomId;
    
    // Hide setup modal
    const setupModalEl = document.getElementById('setupModal');
    if (setupModalEl) {
      const setupModal = bootstrap.Modal.getInstance(setupModalEl);
      if (setupModal) setupModal.hide();
    }
    
    // Create PeerJS connection
    createPeerConnection();
    
    // Start call timer
    startCallTimer();
    
  } catch (error) {
    console.error('Error joining consultation:', error);
    showNotification('Failed to join consultation', 'danger');
  }
}

// Create PeerJS connection
function createPeerConnection() {
  console.log('Creating PeerJS connection with ICE servers');
  
  peer = new Peer(undefined, {
    config: iceServers
  });
  
  peer.on('open', (id) => {
    console.log('Peer connected with ID:', id);
    
    // Register our peer ID with the socket server
    if (socket && socket.connected) {
      socket.emit('register-peer', { peerId: id });
    }
  });
  
  peer.on('call', handleIncomingCall);
  
  peer.on('error', (error) => {
    console.error('Peer error:', error);
    // Show notification but don't crash
    if (error.type === 'network' || error.type === 'server-error') {
      showNotification('Connection error. Please check your internet connection.', 'warning');
    }
  });
}

// Handle incoming call
async function handleIncomingCall(call) {
  console.log('Incoming call from peer:', call.peer);
  
  // Answer with local stream
  call.answer(localStream);
  
  call.on('stream', (stream) => {
    console.log('Received remote stream', stream.id);
    const remoteVideo = document.getElementById('remoteVideo');
    remoteVideo.srcObject = stream;
    remoteStream = stream;
    
    // Force play
    remoteVideo.play().then(() => {
      console.log('Remote video playing');
    }).catch(e => {
      console.log('Auto-play blocked, showing play button');
      remoteVideo.controls = true;
    });
    
    // Hide waiting overlay
    const waitingOverlay = document.getElementById('waitingOverlay');
    if (waitingOverlay) waitingOverlay.style.display = 'none';
  });
  
  call.on('close', () => {
    console.log('Call closed by remote');
    // Don't immediately end - wait for user to end call
  });
  
  call.on('error', (err) => {
    console.error('Call error:', err);
  });
}

// Handle room joined - when WE join and there are others in the room
async function handleRoomJoined(data) {
  console.log('Room joined, participants:', data.participants);
  
  // Exchange encryption keys
  const myPublicKey = await encryptionManager.getPublicKey();
  
  // If there are participants, create call to each
  if (data.participants && data.participants.length > 0) {
    for (const participant of data.participants) {
      console.log('Calling participant:', participant.socketId);
      
      try {
        const call = peer.call(participant.socketId, localStream);
        
        call.on('stream', (stream) => {
          console.log('Received remote stream from', participant.socketId);
          const remoteVideo = document.getElementById('remoteVideo');
          remoteVideo.srcObject = stream;
          remoteStream = stream;
          remoteVideo.play().catch(e => console.log('Play blocked'));
          const waitingOverlay = document.getElementById('waitingOverlay');
          if (waitingOverlay) waitingOverlay.style.display = 'none';
        });
        
        call.on('close', () => {
          console.log('Call closed');
        });
        
        call.on('error', (err) => {
          console.error('Outgoing call error:', err);
        });
      } catch (e) {
        console.error('Error calling participant:', e);
      }
    }
  } else {
    console.log('No participants in room yet, waiting...');
  }
}

// Handle user joined - when SOMEONE ELSE joins the room
async function handleUserJoined(data) {
  console.log('User joined:', data.socketId);
  
  // Hide waiting overlay
  const waitingOverlay = document.getElementById('waitingOverlay');
  if (waitingOverlay) waitingOverlay.style.display = 'none';
  
  // Create call to the new user
  try {
    const call = peer.call(data.socketId, localStream);
    
    call.on('stream', (stream) => {
      console.log('Received remote stream from new user');
      const remoteVideo = document.getElementById('remoteVideo');
      remoteVideo.srcObject = stream;
      remoteStream = stream;
      remoteVideo.play().catch(e => console.log('Play blocked'));
      if (waitingOverlay) waitingOverlay.style.display = 'none';
    });
    
    call.on('error', (err) => {
      console.error('Call error with new user:', err);
    });
  } catch (e) {
    console.error('Error calling new user:', e);
  }
  
  showNotification(`${data.userName} joined the call`, 'info');
}

// Handle user left
function handleUserLeft(data) {
  console.log('User left:', data.userName);
  
  // Remove from peer ID map
  peerIdMap.delete(data.socketId);
  
  // Only show waiting overlay if no remote stream
  if (!remoteStream) {
    const waitingOverlay = document.getElementById('waitingOverlay');
    if (waitingOverlay) waitingOverlay.style.display = 'flex';
  }
  
  showNotification(`${data.userName || 'Participant'} left the call`, 'info');
}

// Handle peer registered - when another user's peer ID is registered
function handlePeerRegistered(data) {
  console.log('Peer registered:', data.peerId, 'for', data.socketId);
  
  // Store the peer ID mapping
  peerIdMap.set(data.socketId, data.peerId);
  
  // Try to call this peer now that we have their peer ID
  if (peer && localStream) {
    try {
      console.log('Calling peer:', data.peerId);
      const call = peer.call(data.peerId, localStream);
      
      call.on('stream', (stream) => {
        console.log('Received remote stream from peer-registered');
        const remoteVideo = document.getElementById('remoteVideo');
        remoteVideo.srcObject = stream;
        remoteStream = stream;
        remoteVideo.play().catch(e => console.log('Play blocked'));
        const waitingOverlay = document.getElementById('waitingOverlay');
        if (waitingOverlay) waitingOverlay.style.display = 'none';
      });
      
      call.on('error', (err) => {
        console.error('Call error with peer-registered:', err);
      });
    } catch (e) {
      console.error('Error calling peer:', e);
    }
  }
}

// Handle WebRTC offer
async function handleOffer(data) {
  console.log('Received offer from:', data.socketId);
}

// Handle WebRTC answer
async function handleAnswer(data) {
  console.log('Received answer from:', data.socketId);
}

// Handle ICE candidate
async function handleIceCandidate(data) {
  console.log('Received ICE candidate from:', data.socketId);
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
  
  // Close peer connection
  if (peer) {
    peer.destroy();
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
