/**
 * MediLock - Doctor Management Routes
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/db');
const { authenticate, authorize, isDoctor, isAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/doctors - Get all doctors
router.get('/', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 20, specialization, available } = req.query;
    const offset = (page - 1) * limit;

    let sql = `
      SELECT d.*, u.email, u.first_name, u.last_name, u.phone, u.is_active
      FROM doctors d
      INNER JOIN users u ON d.user_id = u.id
      WHERE 1=1
    `;
    let countSql = 'SELECT COUNT(*) as total FROM doctors d INNER JOIN users u ON d.user_id = u.id WHERE 1=1';
    const params = [];

    if (specialization) {
      sql += ' AND d.specialization = ?';
      countSql += ' AND d.specialization = ?';
      params.push(specialization);
    }

    if (available === 'true') {
      sql += ' AND d.is_available = TRUE';
      countSql += ' AND d.is_available = TRUE';
    }

    sql += ` ORDER BY d.rating DESC, d.total_consultations DESC LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`;

    const doctors = await db.getAll(sql, params);
    const countResult = await db.getOne(countSql, params.slice(0, -2));

    res.json({
      success: true,
      data: {
        doctors,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.total,
          pages: Math.ceil(countResult.total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get doctors error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get doctors'
    });
  }
});

// GET /api/doctors/specializations - Get list of specializations
router.get('/specializations', async (req, res) => {
  try {
    const specializations = await db.getAll(
      'SELECT DISTINCT specialization FROM doctors WHERE specialization IS NOT NULL ORDER BY specialization'
    );

    res.json({
      success: true,
      data: specializations.map(s => s.specialization)
    });
  } catch (error) {
    console.error('Get specializations error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get specializations'
    });
  }
});

// GET /api/doctors/:id - Get doctor profile
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const doctor = await db.getOne(`
      SELECT d.*, u.email, u.first_name, u.last_name, u.phone, u.is_active
      FROM doctors d
      INNER JOIN users u ON d.user_id = u.id
      WHERE d.id = ?
    `, [id]);

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    // Get schedule
    const schedule = await db.getAll(
      'SELECT * FROM doctor_schedules WHERE doctor_id = ?',
      [id]
    );

    res.json({
      success: true,
      data: {
        ...doctor,
        schedule
      }
    });
  } catch (error) {
    console.error('Get doctor error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get doctor'
    });
  }
});

// PUT /api/doctors/:id - Update doctor profile
router.put('/:id', authenticate, [
  body('specialization').optional().trim(),
  body('qualifications').optional(),
  body('bio').optional(),
  body('consultationFee').optional().isFloat({ min: 0 })
], async (req, res) => {
  try {
    const { id } = req.params;
    const { specialization, qualifications, bio, consultationFee, experienceYears } = req.body;

    // Get doctor ID from user ID
    const doctor = await db.getOne('SELECT * FROM doctors WHERE id = ?', [id]);
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    // Only the doctor himself or admin can update
    if (doctor.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const updates = [];
    const params = [];

    if (specialization !== undefined) {
      updates.push('specialization = ?');
      params.push(specialization);
    }
    if (qualifications !== undefined) {
      updates.push('qualifications = ?');
      params.push(qualifications);
    }
    if (bio !== undefined) {
      updates.push('bio = ?');
      params.push(bio);
    }
    if (consultationFee !== undefined) {
      updates.push('consultation_fee = ?');
      params.push(consultationFee);
    }
    if (experienceYears !== undefined) {
      updates.push('experience_years = ?');
      params.push(experienceYears);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    params.push(id);
    await db.update(`UPDATE doctors SET ${updates.join(', ')} WHERE id = ?`, params);

    res.json({
      success: true,
      message: 'Doctor profile updated successfully'
    });
  } catch (error) {
    console.error('Update doctor error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update doctor profile'
    });
  }
});

// PUT /api/doctors/:id/availability - Toggle doctor availability
router.put('/:id/availability', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { isAvailable } = req.body;

    const doctor = await db.getOne('SELECT * FROM doctors WHERE id = ?', [id]);
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    // Only the doctor himself can update availability
    if (doctor.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    await db.update('UPDATE doctors SET is_available = ? WHERE id = ?', [isAvailable, id]);

    res.json({
      success: true,
      message: `Doctor is now ${isAvailable ? 'available' : 'unavailable'}`
    });
  } catch (error) {
    console.error('Toggle availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update availability'
    });
  }
});

// GET /api/doctors/:id/schedule - Get doctor schedule
router.get('/:id/schedule', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const schedule = await db.getAll(
      'SELECT * FROM doctor_schedules WHERE doctor_id = ? ORDER BY FIELD(day_of_week, "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")',
      [id]
    );

    res.json({
      success: true,
      data: schedule
    });
  } catch (error) {
    console.error('Get schedule error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get schedule'
    });
  }
});

// PUT /api/doctors/:id/schedule - Update doctor schedule
router.put('/:id/schedule', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { schedule } = req.body;

    const doctor = await db.getOne('SELECT * FROM doctors WHERE id = ?', [id]);
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    // Only the doctor himself can update schedule
    if (doctor.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Delete existing schedule
    await db.remove('DELETE FROM doctor_schedules WHERE doctor_id = ?', [id]);

    // Insert new schedule
    if (schedule && schedule.length > 0) {
      for (const slot of schedule) {
        await db.insert(
          'INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time, is_available) VALUES (?, ?, ?, ?, ?)',
          [id, slot.dayOfWeek, slot.startTime, slot.endTime, slot.isAvailable !== false]
        );
      }
    }

    res.json({
      success: true,
      message: 'Schedule updated successfully'
    });
  } catch (error) {
    console.error('Update schedule error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update schedule'
    });
  }
});

// GET /api/doctors/:id/appointments - Get doctor appointments
router.get('/:id/appointments', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { date, status } = req.query;

    const doctor = await db.getOne('SELECT * FROM doctors WHERE id = ?', [id]);
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    let sql = `
      SELECT a.*, 
        p.user_id as patient_user_id,
        CONCAT(u1.first_name, ' ', u1.last_name) as patient_name,
        u1.email as patient_email,
        u1.phone as patient_phone
      FROM appointments a
      INNER JOIN patients p ON a.patient_id = p.id
      INNER JOIN users u1 ON p.user_id = u1.id
      WHERE a.doctor_id = ?
    `;
    const params = [id];

    if (date) {
      sql += ' AND DATE(a.appointment_date) = ?';
      params.push(date);
    }

    if (status) {
      sql += ' AND a.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY a.appointment_date ASC';

    const appointments = await db.getAll(sql, params);

    res.json({
      success: true,
      data: appointments
    });
  } catch (error) {
    console.error('Get appointments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get appointments'
    });
  }
});

module.exports = router;
