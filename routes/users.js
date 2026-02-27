/**
 * MediLock - User Management Routes
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../config/db');
const { authenticate, authorize, isAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/users/stats - Get user statistics (admin only) - MUST be before /:id
router.get('/stats', authenticate, isAdmin, async (req, res) => {
  try {
    const stats = await db.getAll(`
      SELECT 
        role,
        COUNT(*) as total,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN email_verified = 1 THEN 1 ELSE 0 END) as verified
      FROM users
      GROUP BY role
    `);

    const totalUsers = await db.getOne('SELECT COUNT(*) as total FROM users');
    const totalAppointments = await db.getOne('SELECT COUNT(*) as total FROM appointments');
    const todayAppointments = await db.getOne(
      'SELECT COUNT(*) as total FROM appointments WHERE DATE(appointment_date) = CURDATE()'
    );

    res.json({
      success: true,
      data: {
        usersByRole: stats,
        totalUsers: totalUsers.total,
        totalAppointments: totalAppointments.total,
        todayAppointments: todayAppointments.total
      }
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get statistics'
    });
  }
});

// GET /api/users - Get all users (admin only)
router.get('/', authenticate, isAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, role, search } = req.query;
    const offset = (page - 1) * limit;

    let sql = 'SELECT id, email, role, first_name, last_name, phone, is_active, email_verified, created_at FROM users';
    let countSql = 'SELECT COUNT(*) as total FROM users';
    const params = [];
    const conditions = [];

    if (role) {
      conditions.push('role = ?');
      params.push(role);
    }

    if (search) {
      conditions.push('(email LIKE ? OR first_name LIKE ? OR last_name LIKE ?)');
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
      countSql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ` ORDER BY created_at DESC LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`;

    const users = await db.getAll(sql, params);
    const countResult = await db.getOne(countSql, params.slice(0, -2));

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.total,
          pages: Math.ceil(countResult.total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get users'
    });
  }
});

// GET /api/users/:id - Get user by ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    if (req.user.id !== parseInt(id) && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const user = await db.getOne('SELECT * FROM users WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    let roleData = {};
    if (user.role === 'doctor') {
      roleData = await db.getOne('SELECT * FROM doctors WHERE user_id = ?', [id]);
    } else if (user.role === 'patient') {
      roleData = await db.getOne('SELECT * FROM patients WHERE user_id = ?', [id]);
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
        createdAt: user.created_at,
        ...roleData
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user'
    });
  }
});

// PUT /api/users/:id - Update user
router.put('/:id', authenticate, [
  body('firstName').optional().trim().notEmpty(),
  body('lastName').optional().trim(),
  body('phone').optional()
], async (req, res) => {
  try {
    const { id } = req.params;

    if (req.user.id !== parseInt(id) && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const { firstName, lastName, phone } = req.body;
    const updates = [];
    const params = [];

    if (firstName) {
      updates.push('first_name = ?');
      params.push(firstName);
    }
    if (lastName !== undefined) {
      updates.push('last_name = ?');
      params.push(lastName);
    }
    if (phone) {
      updates.push('phone = ?');
      params.push(phone);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    params.push(id);
    await db.update(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

    res.json({
      success: true,
      message: 'User updated successfully'
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user'
    });
  }
});

// DELETE /api/users/:id - Delete user (admin only)
router.delete('/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (req.user.id === parseInt(id)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }

    const result = await db.remove('DELETE FROM users WHERE id = ?', [id]);

    if (result === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user'
    });
  }
});

// PUT /api/users/:id/status - Toggle user status (admin only)
router.put('/:id/status', authenticate, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (isActive === undefined) {
      return res.status(400).json({
        success: false,
        message: 'isActive field is required'
      });
    }

    await db.update('UPDATE users SET is_active = ? WHERE id = ?', [isActive, id]);

    res.json({
      success: true,
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`
    });
  } catch (error) {
    console.error('Toggle user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user status'
    });
  }
});

module.exports = router;
