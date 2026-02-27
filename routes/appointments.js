/**
 * MediLock - Appointment Management Routes
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const { authenticate, isPatient, isDoctor, isPatientOrDoctor } = require('../middleware/auth');
const { encrypt, decrypt, hash } = require('../middleware/encryption');

const router = express.Router();

// POST /api/appointments - Create appointment
router.post('/', authenticate, [
  body('doctorId').isInt(),
  body('appointmentDate').isISO8601(),
  body('symptoms').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { doctorId, appointmentDate, symptoms, durationMinutes = 30 } = req.body;
    
    // Convert ISO date to MySQL format (YYYY-MM-DD HH:mm:ss)
    const formattedDate = new Date(appointmentDate).toISOString().slice(0, 19).replace('T', ' ');

    console.log('Creating appointment:', { doctorId, appointmentDate: formattedDate, userId: req.user.id, role: req.user.role });

    // Get patient ID - Check both patients table and users table
    let patient = await db.getOne('SELECT id FROM patients WHERE user_id = ?', [req.user.id]);
    
    if (!patient) {
      // Create patient profile if it doesn't exist
      console.log('Patient profile not found, creating one for user:', req.user.id);
      const patientId = await db.insert('INSERT INTO patients (user_id) VALUES (?)', [req.user.id]);
      patient = { id: patientId };
    }
    
    console.log('Patient ID:', patient.id);

    // Verify doctor exists
    const doctor = await db.getOne('SELECT * FROM doctors WHERE id = ?', [doctorId]);
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    // Generate room ID and encryption key
    const roomId = uuidv4();
    const roomPassword = uuidv4().split('-')[0];
    const encryptionKey = uuidv4() + uuidv4(); // 64 character key
    const encryptionKeyHash = hash(encryptionKey);

    // Create appointment
    const appointmentId = await db.insert(
      `INSERT INTO appointments 
        (patient_id, doctor_id, appointment_date, duration_minutes, room_id, room_password, encryption_key_hash, symptoms) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [patient.id, doctorId, formattedDate, durationMinutes, roomId, roomPassword, encryptionKeyHash, symptoms || null]
    );

    // Get appointment details
    const appointment = await db.getOne(
      'SELECT * FROM appointments WHERE id = ?',
      [appointmentId]
    );
    
    console.log('Appointment created:', appointmentId);

    res.status(201).json({
      success: true,
      message: 'Appointment created successfully',
      data: {
        ...appointment,
        // Return encryption key to client (should be transmitted via secure channel)
        encryptionKey
      }
    });
  } catch (error) {
    console.error('Create appointment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create appointment: ' + error.message
    });
  }
});

// GET /api/appointments - Get appointments
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, date, upcoming } = req.query;
    let sql;
    const params = [];

    console.log('Fetching appointments for user:', req.user.id, 'role:', req.user.role);

    if (req.user.role === 'patient') {
      // Get patient ID
      const patient = await db.getOne('SELECT id FROM patients WHERE user_id = ?', [req.user.id]);
      console.log('Patient lookup result:', patient);
      
      if (!patient) {
        // Return empty array if no patient profile
        return res.json({
          success: true,
          data: []
        });
      }

      sql = `
        SELECT a.*, 
          d.specialization,
          CONCAT(u.first_name, ' ', u.last_name) as doctor_name,
          d.consultation_fee
        FROM appointments a
        INNER JOIN doctors d ON a.doctor_id = d.id
        INNER JOIN users u ON d.user_id = u.id
        WHERE a.patient_id = ?
      `;
      params.push(patient.id);
    } else if (req.user.role === 'doctor') {
      // Get doctor ID
      const doctor = await db.getOne('SELECT id FROM doctors WHERE user_id = ?', [req.user.id]);
      console.log('Doctor lookup result:', doctor);
      
      if (!doctor) {
        return res.json({
          success: true,
          data: []
        });
      }

      sql = `
        SELECT a.*,
          CONCAT(u.first_name, ' ', u.last_name) as patient_name,
          u.email as patient_email,
          u.phone as patient_phone
        FROM appointments a
        INNER JOIN patients p ON a.patient_id = p.id
        INNER JOIN users u ON p.user_id = u.id
        WHERE a.doctor_id = ?
      `;
      params.push(doctor.id);
    } else {
      // Admin - get all
      sql = `
        SELECT a.*,
          CONCAT(u1.first_name, ' ', u1.last_name) as patient_name,
          CONCAT(u2.first_name, ' ', u2.last_name) as doctor_name,
          d.specialization
        FROM appointments a
        INNER JOIN patients p ON a.patient_id = p.id
        INNER JOIN doctors d ON a.doctor_id = d.id
        INNER JOIN users u1 ON p.user_id = u1.id
        INNER JOIN users u2 ON d.user_id = u2.id
        WHERE 1=1
      `;
    }

    if (status) {
      sql += ' AND a.status = ?';
      params.push(status);
    }

    if (date) {
      sql += ' AND DATE(a.appointment_date) = ?';
      params.push(date);
    }

    if (upcoming === 'true') {
      // Use UTC comparison to avoid timezone issues
      sql += " AND a.appointment_date > UTC_TIMESTAMP() AND a.status = 'scheduled'";
    }

    sql += ' ORDER BY a.appointment_date ASC';

    console.log('SQL:', sql);
    console.log('Params:', params);

    const appointments = await db.getAll(sql, params);
    console.log('Appointments found:', appointments.length);

    res.json({
      success: true,
      data: appointments
    });
  } catch (error) {
    console.error('Get appointments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get appointments: ' + error.message
    });
  }
});

// GET /api/appointments/:id - Get appointment by ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const appointment = await db.getOne(`
      SELECT a.*,
        d.specialization as doctor_specialization,
        CONCAT(u1.first_name, ' ', u1.last_name) as patient_name,
        u1.email as patient_email,
        u1.phone as patient_phone,
        CONCAT(u2.first_name, ' ', u2.last_name) as doctor_name,
        u2.email as doctor_email,
        d.consultation_fee
      FROM appointments a
      INNER JOIN doctors d ON a.doctor_id = d.id
      INNER JOIN patients p ON a.patient_id = p.id
      INNER JOIN users u1 ON p.user_id = u1.id
      INNER JOIN users u2 ON d.user_id = u2.id
      WHERE a.id = ?
    `, [id]);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Check access
    const patient = await db.getOne('SELECT id FROM patients WHERE user_id = ?', [req.user.id]);
    const doctor = await db.getOne('SELECT id FROM doctors WHERE user_id = ?', [req.user.id]);

    if (
      req.user.role !== 'admin' &&
      (!patient || appointment.patient_id !== patient.id) &&
      (!doctor || appointment.doctor_id !== doctor.id)
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: appointment
    });
  } catch (error) {
    console.error('Get appointment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get appointment'
    });
  }
});

// PUT /api/appointments/:id - Update appointment
router.put('/:id', authenticate, [
  body('appointmentDate').optional().isISO8601(),
  body('status').optional().isIn(['scheduled', 'in_progress', 'completed', 'cancelled'])
], async (req, res) => {
  try {
    const { id } = req.params;
    const { appointmentDate, status, symptoms } = req.body;

    const appointment = await db.getOne('SELECT * FROM appointments WHERE id = ?', [id]);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Check access
    const patient = await db.getOne('SELECT id FROM patients WHERE user_id = ?', [req.user.id]);
    const doctor = await db.getOne('SELECT id FROM doctors WHERE user_id = ?', [req.user.id]);

    const isPatientAccess = patient && appointment.patient_id === patient.id;
    const isDoctorAccess = doctor && appointment.doctor_id === doctor.id;

    if (!isPatientAccess && !isDoctorAccess && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const updates = [];
    const params = [];

    if (appointmentDate) {
      updates.push('appointment_date = ?');
      params.push(appointmentDate);
    }

    if (status) {
      updates.push('status = ?');
      params.push(status);

      // Update timestamps
      if (status === 'in_progress' && !appointment.started_at) {
        updates.push('started_at = NOW()');
      } else if (status === 'completed') {
        updates.push('ended_at = NOW()');
      }
    }

    if (symptoms !== undefined) {
      updates.push('symptoms = ?');
      params.push(symptoms);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    params.push(id);
    await db.update(`UPDATE appointments SET ${updates.join(', ')} WHERE id = ?`, params);

    res.json({
      success: true,
      message: 'Appointment updated successfully'
    });
  } catch (error) {
    console.error('Update appointment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update appointment'
    });
  }
});

// DELETE /api/appointments/:id - Cancel appointment
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const appointment = await db.getOne('SELECT * FROM appointments WHERE id = ?', [id]);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Check access
    const patient = await db.getOne('SELECT id FROM patients WHERE user_id = ?', [req.user.id]);
    const doctor = await db.getOne('SELECT id FROM doctors WHERE user_id = ?', [req.user.id]);

    const isPatientAccess = patient && appointment.patient_id === patient.id;
    const isDoctorAccess = doctor && appointment.doctor_id === doctor.id;

    if (!isPatientAccess && !isDoctorAccess && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    await db.update("UPDATE appointments SET status = 'cancelled' WHERE id = ?", [id]);

    res.json({
      success: true,
      message: 'Appointment cancelled successfully'
    });
  } catch (error) {
    console.error('Cancel appointment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel appointment'
    });
  }
});

// POST /api/appointments/:id/join - Join video consultation
router.post('/:id/join', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const appointment = await db.getOne('SELECT * FROM appointments WHERE id = ?', [id]);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Check access
    const patient = await db.getOne('SELECT id FROM patients WHERE user_id = ?', [req.user.id]);
    const doctor = await db.getOne('SELECT id FROM doctors WHERE user_id = ?', [req.user.id]);

    const isPatientAccess = patient && appointment.patient_id === patient.id;
    const isDoctorAccess = doctor && appointment.doctor_id === doctor.id;

    if (!isPatientAccess && !isDoctorAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Check if appointment can be joined
    if (appointment.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Appointment is cancelled'
      });
    }

    if (appointment.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Appointment has already ended'
      });
    }

    // Update status to in_progress
    if (appointment.status === 'scheduled') {
      await db.update(
        "UPDATE appointments SET status = 'in_progress', started_at = NOW() WHERE id = ?",
        [id]
      );
    }

    // Return room details
    res.json({
      success: true,
      data: {
        roomId: appointment.room_id,
        appointmentId: appointment.id,
        // Return room password for authentication
        roomPassword: appointment.room_password
      }
    });
  } catch (error) {
    console.error('Join appointment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to join appointment'
    });
  }
});

module.exports = router;
