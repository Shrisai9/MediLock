/**
 * MediLock - Secure End-to-End Encrypted Video Consultation System
 * Main Server File
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const doctorRoutes = require('./routes/doctors');
const appointmentRoutes = require('./routes/appointments');
const prescriptionRoutes = require('./routes/prescriptions');

// Import socket handler
const setupSocketHandlers = require('./socket/signaling');

// Import database
const db = require('./config/db');

const app = express();
const server = http.createServer(app);

// Security middleware - Configure Helmet to allow CDN scripts and inline scripts
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https:", "http:"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https:", "http:"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
      mediaSrc: ["'self'", "blob:", "data:"],
      connectSrc: ["'self'", "wss:", "ws:", "https:", "http:"],
      frameSrc: ["'none'"]
    }
  }
}));

// CORS configuration
app.use(cors({
  origin: '*', // Allow all origins for smooth development/testing
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { success: false, message: 'Too many requests, please try again later.' },
  trustProxy: true, // Trust proxy headers for correct IP detection
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Make db available to routes
app.set('db', db);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/prescriptions', prescriptionRoutes);

// Fix for Vercel: Explicitly serve socket.io client script
app.get('/socket.io/socket.io.js', (req, res) => {
  try {
    const clientPath = require.resolve('socket.io/client-dist/socket.io.min.js');
    res.sendFile(clientPath);
  } catch (error) {
    res.redirect('https://cdn.socket.io/4.7.5/socket.io.min.js');
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    message: 'MediLock Server is running',
    timestamp: new Date().toISOString(),
    encryption: 'E2EE with AES-256-GCM + ECDH'
  });
});

// Serve frontend for all other routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Socket.io setup for WebRTC signaling
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins for socket.io
    methods: ['GET', 'POST']
  },
  serveClient: false, // Disable auto-serving to prevent conflicts with our manual route
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// Setup socket event handlers
setupSocketHandlers(io);

// Start server
const PORT = process.env.PORT || 3000;

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`
    ╔═══════════════════════════════════════════════════════════╗
    ║                                                           ║
    ║   ███████╗ ██████╗ ██╗      █████╗ ██████╗ ██████╗ ██╗   ║
    ║   ██╔════╝██╔═══██╗██║     ██╔══██╗██╔══██╗██╔══██╗╚██╗  ║
    ║   █████╗  ██║   ██║██║     ███████║██████╔╝██████╔╝ ╚████║
    ║   ██╔══╝  ██║   ██║██║     ██╔══██║██╔══██╗██╔═══╝   ╚██║
    ║   ██║     ╚██████╔╝███████╗██║  ██║██║  ██║██║        ██║
    ║   ╚═╝      ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝        ╚═╝
    ║                                                           ║
    ║   ██████╗ ███████╗██╗    ██╗██╗███╗   ██╗██████╗        ║
    ║  ██╔════╝ ██╔════╝██║    ██║██║████╗  ██║██╔══██╗       ║
    ║  ██║  ███╗█████╗  ██║ █╗ ██║██║██╔██╗ ██║██║  ██║       ║
    ║  ██║   ██║██╔══╝  ██║███╗██║██║██║╚██╗██║██║  ██║       ║
    ║  ╚██████╔╝███████╗╚███╔███╔╝██║██║ ╚████║██████╔╝       ║
    ║   ╚═════╝ ╚══════╝ ╚══╝╚══╝ ╚═╝╚═╝  ╚═══╝╚═════╝        ║
    ║                                                           ║
    ║   Secure End-to-End Encrypted Video Consultation         ║
    ║                                                           ║
    ╚═══════════════════════════════════════════════════════════╝
    
    Server running on port ${PORT}
    Environment: ${process.env.NODE_ENV || 'development'}
    Database: MySQL (India Data Center)
    Encryption: AES-256-GCM + ECDH Key Exchange
    `);

    // Check database connection
    db.testConnection();
  });
}

module.exports = app;
