/**
 * MediLock - Authentication Routes
 * User registration, login, OTP, and session management
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { encrypt, decrypt, generateOTP, hash } = require('../middleware/encryption');

const router = express.Router();

// Generate JWT tokens
const generateTokens = (userId, email, role) => {
  const accessToken = jwt.sign(
    { userId, email, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '24h' }
  );

  const refreshToken = jwt.sign(
    { userId, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d' }
  );

  return { accessToken, refreshToken };
};

// Log audit action
const logAudit = async (userId, action, entityType, entityId, req, responseStatus) => {
  try {
    await db.insert(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, user_agent, response_status) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId || null,
        action || null,
        entityType || null,
        entityId || null,
        req?.ip || req?.connection?.remoteAddress || null,
        req?.headers?.['user-agent'] || null,
        responseStatus || null
      ]
    );
  } catch (error) {
    console.error('Audit log error:', error);
  }
};

// POST /api/auth/register - Register new user
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('firstName').trim().notEmpty(),
  body('lastName').trim().optional(),
  body('phone').optional(),
  body('role').isIn(['patient', 'doctor'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { email, password, firstName, lastName, phone, role } = req.body;

    // Check if user exists
    const existingUser = await db.getOne('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered'
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const userId = await db.insert(
      `INSERT INTO users (email, password_hash, role, first_name, last_name, phone, email_verified) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [email, passwordHash, role, firstName, lastName || null, phone || null, false]
    );

    // Create role-specific profile
    if (role === 'patient') {
      await db.insert(
        'INSERT INTO patients (user_id) VALUES (?)',
        [userId]
      );
    } else if (role === 'doctor') {
      await db.insert(
        'INSERT INTO doctors (user_id) VALUES (?)',
        [userId]
      );
    }

    // Generate tokens
    const tokens = generateTokens(userId, email, role);

    // Log audit
    await logAudit(userId, 'USER_REGISTERED', 'user', userId, req, 201);

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        userId,
        email,
        role,
        ...tokens
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed'
    });
  }
});

// POST /api/auth/login - User login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { email, password } = req.body;

    // Get user with password
    const user = await db.getOne(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      await logAudit(user.id, 'LOGIN_FAILED', 'user', user.id, req, 401);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if active
    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    // Check OTP requirement
    if (user.otp_verified) {
      // Return partial success - need OTP
      return res.json({
        success: true,
        requiresOTP: true,
        tempToken: jwt.sign(
          { userId: user.id, temp: true },
          process.env.JWT_SECRET,
          { expiresIn: '5m' }
        )
      });
    }

    // Generate tokens
    const tokens = generateTokens(user.id, user.email, user.role);

    // Update last login
    await db.update(
      'UPDATE users SET last_login = NOW() WHERE id = ?',
      [user.id]
    );

    // Log audit
    await logAudit(user.id, 'LOGIN_SUCCESS', 'user', user.id, req, 200);

    // Get role-specific data
    let roleData = {};
    if (user.role === 'doctor') {
      roleData = await db.getOne('SELECT * FROM doctors WHERE user_id = ?', [user.id]);
    } else if (user.role === 'patient') {
      roleData = await db.getOne('SELECT * FROM patients WHERE user_id = ?', [user.id]);
    }

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          firstName: user.first_name,
          lastName: user.last_name,
          phone: user.phone,
          ...roleData
        },
        ...tokens
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
});

// POST /api/auth/otp/send - Send OTP
router.post('/otp/send', [
  body('email').isEmail().normalizeEmail()
], async (req, res) => {
  try {
    const { email } = req.body;

    const user = await db.getOne('SELECT id, email, first_name FROM users WHERE email = ?', [email]);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Generate OTP
    const otp = generateOTP(6);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Store OTP
    await db.insert(
      'INSERT INTO otp_codes (user_id, otp_code, otp_type, expires_at) VALUES (?, ?, ?, ?)',
      [user.id, otp, 'login', expiresAt]
    );

    // In production, send via email/SMS
    console.log(`OTP for ${email}: ${otp}`);

    res.json({
      success: true,
      message: 'OTP sent to your email',
      // Don't expose OTP in production!
      debugOTP: process.env.NODE_ENV === 'development' ? otp : undefined
    });
  } catch (error) {
    console.error('OTP send error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP'
    });
  }
});

// POST /api/auth/otp/verify - Verify OTP
router.post('/otp/verify', [
  body('otp').isLength({ min: 6, max: 6 }),
], async (req, res) => {
  try {
    const { otp, tempToken } = req.body;

    // Verify temp token
    let decoded;
    try {
      decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    // Verify OTP
    const otpRecord = await db.getOne(
      `SELECT * FROM otp_codes 
       WHERE user_id = ? AND otp_code = ? AND is_used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [decoded.userId, otp]
    );

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // Mark OTP as used
    await db.update(
      'UPDATE otp_codes SET is_used = TRUE WHERE id = ?',
      [otpRecord.id]
    );

    // Get user
    const user = await db.getOne('SELECT * FROM users WHERE id = ?', [decoded.userId]);

    // Generate tokens
    const tokens = generateTokens(user.id, user.email, user.role);

    // Update last login
    await db.update(
      'UPDATE users SET last_login = NOW() WHERE id = ?',
      [user.id]
    );

    // Log audit
    await logAudit(user.id, 'OTP_LOGIN_SUCCESS', 'user', user.id, req, 200);

    // Get role-specific data
    let roleData = {};
    if (user.role === 'doctor') {
      roleData = await db.getOne('SELECT * FROM doctors WHERE user_id = ?', [user.id]);
    } else if (user.role === 'patient') {
      roleData = await db.getOne('SELECT * FROM patients WHERE user_id = ?', [user.id]);
    }

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          firstName: user.first_name,
          lastName: user.last_name,
          phone: user.phone,
          ...roleData
        },
        ...tokens
      }
    });
  } catch (error) {
    console.error('OTP verify error:', error);
    res.status(500).json({
      success: false,
      message: 'OTP verification failed'
    });
  }
});

// POST /api/auth/refresh - Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token required'
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    // Get user
    const user = await db.getOne('SELECT id, email, role, is_active FROM users WHERE id = ?', [decoded.userId]);

    if (!user || !user.is_active) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    // Generate new tokens
    const tokens = generateTokens(user.id, user.email, user.role);

    res.json({
      success: true,
      data: tokens
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid refresh token'
    });
  }
});

// POST /api/auth/logout - User logout
router.post('/logout', authenticate, async (req, res) => {
  try {
    // In a more complete implementation, we'd invalidate the token
    await logAudit(req.user.id, 'LOGOUT', 'user', req.user.id, req, 200);

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
});

// GET /api/auth/me - Get current user
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await db.getOne('SELECT * FROM users WHERE id = ?', [req.user.id]);

    let roleData = {};
    if (user.role === 'doctor') {
      roleData = await db.getOne('SELECT * FROM doctors WHERE user_id = ?', [user.id]);
    } else if (user.role === 'patient') {
      roleData = await db.getOne('SELECT * FROM patients WHERE user_id = ?', [user.id]);
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        isActive: user.is_active,
        emailVerified: user.email_verified,
        otpVerified: user.otp_verified,
        lastLogin: user.last_login,
        createdAt: user.created_at,
        ...roleData
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user data'
    });
  }
});

// PUT /api/auth/password - Change password
router.put('/password', authenticate, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 6 })
], async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await db.getOne('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);

    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await db.update('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, req.user.id]);

    await logAudit(req.user.id, 'PASSWORD_CHANGED', 'user', req.user.id, req, 200);

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password'
    });
  }
});

module.exports = router;
