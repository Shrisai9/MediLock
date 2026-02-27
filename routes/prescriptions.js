/**
 * MediLock - Prescription Management Routes
 * Encrypted prescription storage for DPDP compliance
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/db');
const { authenticate, isDoctor, isPatient } = require('../middleware/auth');
const { encrypt, decrypt } = require('../middleware/encryption');

const router = express.Router();

// POST /api/prescriptions - Create prescription
router.post('/', authenticate, isDoctor, [
  body('appointmentId').isInt(),
  body('diagnosis').optional().trim(),
  body('symptoms').optional().trim(),
  body('medications').isArray({ min: 1 }),
  body('notes').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { appointmentId, diagnosis, symptoms, medications, notes, followUpDate } = req.body;

    // Verify appointment exists and belongs to this doctor
    const appointment = await db.getOne(`
      SELECT a.*, d.user_id as doctor_user_id
      FROM appointments a
      INNER JOIN doctors d ON a.doctor_id = d.id
      WHERE a.id = ?
    `, [appointmentId]);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    if (appointment.doctor_user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only create prescriptions for your own appointments.'
      });
    }

    // Check if prescription already exists
    const existing = await db.getOne(
      'SELECT id FROM prescriptions WHERE appointment_id = ?',
      [appointmentId]
    );

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Prescription already exists for this appointment'
      });
    }

    // Encrypt sensitive data before storage
    const diagnosisEncrypted = diagnosis ? encrypt(diagnosis) : null;
    const symptomsEncrypted = symptoms ? encrypt(symptoms) : null;
    const medicationsEncrypted = encrypt(JSON.stringify(medications));
    const notesEncrypted = notes ? encrypt(notes) : null;

    // Generate digital signature (simplified)
    const digitalSignature = encrypt(`${req.user.id}-${Date.now()}-${appointmentId}`);

    // Create prescription
    const prescriptionId = await db.insert(
      `INSERT INTO prescriptions 
        (appointment_id, diagnosis_encrypted, symptoms_encrypted, medications_json_encrypted, notes_encrypted, follow_up_date, digital_signature) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        appointmentId,
        diagnosisEncrypted,
        symptomsEncrypted,
        medicationsEncrypted,
        notesEncrypted,
        followUpDate || null,
        digitalSignature
      ]
    );

    // Update appointment status to completed
    await db.update(
      "UPDATE appointments SET status = 'completed', ended_at = NOW() WHERE id = ?",
      [appointmentId]
    );

    res.status(201).json({
      success: true,
      message: 'Prescription created successfully',
      data: {
        id: prescriptionId,
        appointmentId
      }
    });
  } catch (error) {
    console.error('Create prescription error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create prescription'
    });
  }
});

// GET /api/prescriptions/my/prescriptions - Get patient's prescriptions
// MUST be defined BEFORE /:id to prevent conflict
router.get('/my/prescriptions', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'patient') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const patient = await db.getOne('SELECT id FROM patients WHERE user_id = ?', [req.user.id]);
    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient profile not found'
      });
    }

    const prescriptions = await db.getAll(`
      SELECT pr.*, a.appointment_date, a.status as appointment_status,
        d.specialization,
        CONCAT(u.first_name, ' ', u.last_name) as doctor_name
      FROM prescriptions pr
      INNER JOIN appointments a ON pr.appointment_id = a.id
      INNER JOIN doctors d ON a.doctor_id = d.id
      INNER JOIN users u ON d.user_id = u.id
      WHERE a.patient_id = ?
      ORDER BY pr.created_at DESC
    `, [patient.id]);

    // Decrypt medications for each prescription
    const decrypted = prescriptions.map(pr => ({
      id: pr.id,
      appointmentId: pr.appointment_id,
      appointmentDate: pr.appointment_date,
      appointmentStatus: pr.appointment_status,
      doctorName: pr.doctor_name,
      specialization: pr.specialization,
      diagnosis: pr.diagnosis_encrypted ? decrypt(pr.diagnosis_encrypted) : null,
      medications: pr.medications_json_encrypted 
        ? JSON.parse(decrypt(pr.medications_json_encrypted)) 
        : [],
      followUpDate: pr.follow_up_date,
      createdAt: pr.created_at
    }));

    res.json({
      success: true,
      data: decrypted
    });
  } catch (error) {
    console.error('Get prescriptions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get prescriptions'
    });
  }
});

// GET /api/prescriptions/appointment/:appointmentId - Get prescription by appointment
// MUST be defined BEFORE /:id
router.get('/appointment/:appointmentId', authenticate, async (req, res) => {
  try {
    const { appointmentId } = req.params;

    const prescription = await db.getOne('SELECT * FROM prescriptions WHERE appointment_id = ?', [appointmentId]);
    if (!prescription) {
      return res.status(404).json({
        success: false,
        message: 'Prescription not found'
      });
    }

    // Get appointment details to check access
    const appointment = await db.getOne(`
      SELECT a.*, 
        p.user_id as patient_user_id,
        d.user_id as doctor_user_id
      FROM appointments a
      INNER JOIN patients p ON a.patient_id = p.id
      INNER JOIN doctors d ON a.doctor_id = d.id
      WHERE a.id = ?
    `, [appointmentId]);

    // Check access
    const isPatientAccess = appointment.patient_user_id === req.user.id;
    const isDoctorAccess = appointment.doctor_user_id === req.user.id;

    if (!isPatientAccess && !isDoctorAccess && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Decrypt prescription data
    const decrypted = {
      id: prescription.id,
      appointmentId: prescription.appointment_id,
      diagnosis: prescription.diagnosis_encrypted ? decrypt(prescription.diagnosis_encrypted) : null,
      symptoms: prescription.symptoms_encrypted ? decrypt(prescription.symptoms_encrypted) : null,
      medications: prescription.medications_json_encrypted 
        ? JSON.parse(decrypt(prescription.medications_json_encrypted)) 
        : [],
      notes: prescription.notes_encrypted ? decrypt(prescription.notes_encrypted) : null,
      followUpDate: prescription.follow_up_date,
      digitalSignature: decrypt(prescription.digital_signature),
      createdAt: prescription.created_at
    };

    res.json({
      success: true,
      data: decrypted
    });
  } catch (error) {
    console.error('Get prescription error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get prescription'
    });
  }
});

// GET /api/prescriptions/:id - Get prescription by ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const prescription = await db.getOne('SELECT * FROM prescriptions WHERE id = ?', [id]);
    if (!prescription) {
      return res.status(404).json({
        success: false,
        message: 'Prescription not found'
      });
    }

    // Get appointment details to check access
    const appointment = await db.getOne(`
      SELECT a.*, 
        p.user_id as patient_user_id,
        d.user_id as doctor_user_id
      FROM appointments a
      INNER JOIN patients p ON a.patient_id = p.id
      INNER JOIN doctors d ON a.doctor_id = d.id
      WHERE a.id = ?
    `, [prescription.appointment_id]);

    // Check access
    const isPatientAccess = appointment.patient_user_id === req.user.id;
    const isDoctorAccess = appointment.doctor_user_id === req.user.id;

    if (!isPatientAccess && !isDoctorAccess && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Decrypt prescription data
    const decrypted = {
      id: prescription.id,
      appointmentId: prescription.appointment_id,
      diagnosis: prescription.diagnosis_encrypted ? decrypt(prescription.diagnosis_encrypted) : null,
      symptoms: prescription.symptoms_encrypted ? decrypt(prescription.symptoms_encrypted) : null,
      medications: prescription.medications_json_encrypted 
        ? JSON.parse(decrypt(prescription.medications_json_encrypted)) 
        : [],
      notes: prescription.notes_encrypted ? decrypt(prescription.notes_encrypted) : null,
      followUpDate: prescription.follow_up_date,
      digitalSignature: decrypt(prescription.digital_signature),
      createdAt: prescription.created_at
    };

    res.json({
      success: true,
      data: decrypted
    });
  } catch (error) {
    console.error('Get prescription error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get prescription'
    });
  }
});

// PUT /api/prescriptions/:id - Update prescription (only notes can be updated)
router.put('/:id', authenticate, isDoctor, [
  body('notes').optional().trim()
], async (req, res) => {
  try {
    const { id } = req.params;
    const { notes, followUpDate } = req.body;

    const prescription = await db.getOne('SELECT * FROM prescriptions WHERE id = ?', [id]);
    if (!prescription) {
      return res.status(404).json({
        success: false,
        message: 'Prescription not found'
      });
    }

    // Get appointment to verify doctor
    const appointment = await db.getOne(`
      SELECT d.user_id as doctor_user_id
      FROM appointments a
      INNER JOIN doctors d ON a.doctor_id = d.id
      WHERE a.id = ?
    `, [prescription.appointment_id]);

    if (appointment.doctor_user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const updates = [];
    const params = [];

    if (notes !== undefined) {
      updates.push('notes_encrypted = ?');
      params.push(notes ? encrypt(notes) : null);
    }

    if (followUpDate !== undefined) {
      updates.push('follow_up_date = ?');
      params.push(followUpDate);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    params.push(id);
    await db.update(`UPDATE prescriptions SET ${updates.join(', ')} WHERE id = ?`, params);

    res.json({
      success: true,
      message: 'Prescription updated successfully'
    });
  } catch (error) {
    console.error('Update prescription error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update prescription'
    });
  }
});

module.exports = router;
