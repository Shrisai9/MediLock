/**
 * MediLock - WebRTC Signaling Server
 * Socket.io handlers for real-time video consultation
 */

// Store active rooms and participants
const rooms = new Map();
const userSockets = new Map();

/**
 * Setup all socket event handlers
 * @param {Object} io - Socket.io server instance
 */
const setupSocketHandlers = (io) => {
  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Handle user authentication
    socket.on('authenticate', (data) => {
      const { userId, userName, role, roomId } = data;
      
      userSockets.set(socket.id, {
        userId,
        userName,
        role,
        roomId
      });

      socket.emit('authenticated', { success: true });
      console.log(`User authenticated: ${userName} (${role})`);
    });

    // Join a consultation room
    socket.on('join-room', async (data) => {
      try {
        const { roomId, userId, userName, role } = data;

        // Store user info - MERGE with existing to preserve peerId
        const existingInfo = userSockets.get(socket.id) || {};
        userSockets.set(socket.id, { ...existingInfo, userId, userName, role, roomId });

        // Join socket room
        socket.join(roomId);

        // Initialize room if not exists
        if (!rooms.has(roomId)) {
          rooms.set(roomId, {
            participants: new Map(),
            createdAt: new Date(),
            encryption: {
              enabled: true,
              algorithm: 'AES-256-GCM',
              keyExchange: 'ECDH'
            }
          });
        }

        const room = rooms.get(roomId);
        room.participants.set(socket.id, {
          socketId: socket.id,
          userId,
          userName,
          role,
          joinedAt: new Date()
        });

        // Notify others in the room
        socket.to(roomId).emit('user-joined', {
          socketId: socket.id,
          userId,
          userName,
          role
        });

        // Send room info to the joining user
        const participants = Array.from(room.participants.values());
        socket.emit('room-joined', {
          roomId,
          participants: participants.filter(p => p.socketId !== socket.id),
          encryption: room.encryption
        });

        console.log(`User ${userName} joined room ${roomId}`);
      } catch (error) {
        console.error('Join room error:', error);
        socket.emit('error', { message: 'Failed to join room' });
      }
    });

    // Handle WebRTC offer
    socket.on('offer', (data) => {
      const { roomId, offer, targetSocketId } = data;
      
      const room = rooms.get(roomId);
      if (!room) {
        return socket.emit('error', { message: 'Room not found' });
      }

      // Forward offer to specific user
      io.to(targetSocketId).emit('offer', {
        socketId: socket.id,
        offer,
        roomId
      });

      console.log(`Offer sent from ${socket.id} to ${targetSocketId} in room ${roomId}`);
    });

    // Handle WebRTC answer
    socket.on('answer', (data) => {
      const { roomId, answer, targetSocketId } = data;
      
      const room = rooms.get(roomId);
      if (!room) {
        return socket.emit('error', { message: 'Room not found' });
      }

      // Forward answer to specific user
      io.to(targetSocketId).emit('answer', {
        socketId: socket.id,
        answer,
        roomId
      });

      console.log(`Answer sent from ${socket.id} to ${targetSocketId} in room ${roomId}`);
    });

    // Handle ICE candidate
    socket.on('ice-candidate', (data) => {
      const { roomId, candidate, targetSocketId } = data;
      
      const room = rooms.get(roomId);
      if (!room) {
        return socket.emit('error', { message: 'Room not found' });
      }

      // Forward ICE candidate to specific user
      io.to(targetSocketId).emit('ice-candidate', {
        socketId: socket.id,
        candidate,
        roomId
      });

      console.log(`ICE candidate sent from ${socket.id} to ${targetSocketId}`);
    });

    // Handle encrypted chat messages
    socket.on('chat-message', (data) => {
      const { roomId, message, encrypted, timestamp } = data;
      
      const userInfo = userSockets.get(socket.id);
      if (!userInfo) {
        return socket.emit('error', { message: 'Not authenticated' });
      }

      // Broadcast message to all in room including sender
      io.in(roomId).emit('chat-message', {
        socketId: socket.id,
        userId: userInfo.userId,
        userName: userInfo.userName,
        message,
        encrypted,
        timestamp: timestamp || new Date().toISOString()
      });

      console.log(`Chat message in room ${roomId} from ${userInfo.userName}`);
    });

    // Handle media state changes (mute/unmute)
    socket.on('media-state-change', (data) => {
      const { roomId, audioEnabled, videoEnabled } = data;
      
      const userInfo = userSockets.get(socket.id);
      if (!userInfo) return;

      socket.to(roomId).emit('media-state-change', {
        socketId: socket.id,
        userId: userInfo.userId,
        audioEnabled,
        videoEnabled
      });
    });

    // Handle screen sharing
    socket.on('screen-share-start', (data) => {
      const { roomId } = data;
      
      const userInfo = userSockets.get(socket.id);
      if (!userInfo) return;

      socket.to(roomId).emit('screen-share-start', {
        socketId: socket.id,
        userId: userInfo.userId,
        userName: userInfo.userName
      });
    });

    socket.on('screen-share-stop', (data) => {
      const { roomId } = data;
      
      const userInfo = userSockets.get(socket.id);
      if (!userInfo) return;

      socket.to(roomId).emit('screen-share-stop', {
        socketId: socket.id,
        userId: userInfo.userId
      });
    });

    // Handle room chat (for consultation notes)
    socket.on('room-message', (data) => {
      const { roomId, message, type = 'text' } = data;
      
      const userInfo = userSockets.get(socket.id);
      if (!userInfo) {
        return socket.emit('error', { message: 'Not authenticated' });
      }

      io.in(roomId).emit('room-message', {
        socketId: socket.id,
        userId: userInfo.userId,
        userName: userInfo.userName,
        role: userInfo.role,
        message,
        type,
        timestamp: new Date().toISOString()
      });
    });

    // Handle leaving room
    socket.on('leave-room', (data) => {
      const { roomId } = data;
      handleLeaveRoom(socket, roomId);
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      const userInfo = userSockets.get(socket.id);
      
      if (userInfo && userInfo.roomId) {
        handleLeaveRoom(socket, userInfo.roomId);
      }

      userSockets.delete(socket.id);
      console.log(`Client disconnected: ${socket.id}`);
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  });

  /**
   * Handle user leaving a room
   */
  function handleLeaveRoom(socket, roomId) {
    const room = rooms.get(roomId);
    if (!room) return;

    const userInfo = userSockets.get(socket.id);
    
    // Remove from room participants
    room.participants.delete(socket.id);

    // Leave socket room
    socket.leave(roomId);

    // Notify others
    socket.to(roomId).emit('user-left', {
      socketId: socket.id,
      userId: userInfo?.userId,
      userName: userInfo?.userName
    });

    // Clean up empty rooms
    if (room.participants.size === 0) {
      rooms.delete(roomId);
      console.log(`Room ${roomId} deleted (empty)`);
    }

    console.log(`User ${userInfo?.userName || socket.id} left room ${roomId}`);
  }
};

// Export for use in server.js
module.exports = setupSocketHandlers;

// Export room management functions
module.exports.rooms = rooms;
module.exports.userSockets = userSockets;
