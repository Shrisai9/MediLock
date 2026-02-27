-- MediLock Database Schema
-- MySQL 8.0 - India Data Center (DPDP Act 2023 Compliance)

-- Create database
CREATE DATABASE IF NOT EXISTS medilock CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE medilock;

-- Users table (base table for all user types)
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('patient', 'doctor', 'admin') NOT NULL DEFAULT 'patient',
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100),
    phone VARCHAR(20),
    profile_picture VARCHAR(255),
    otp_secret VARCHAR(32),
    otp_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    email_verified BOOLEAN DEFAULT FALSE,
    last_login TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_role (role),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Doctors table (extends users with doctor-specific fields)
CREATE TABLE IF NOT EXISTS doctors (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT UNIQUE NOT NULL,
    specialization VARCHAR(100),
    license_number VARCHAR(50) UNIQUE,
    qualifications TEXT,
    experience_years INT DEFAULT 0,
    bio TEXT,
    consultation_fee DECIMAL(10,2) DEFAULT 0.00,
    is_available BOOLEAN DEFAULT TRUE,
    rating DECIMAL(3,2) DEFAULT 5.00,
    total_consultations INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_specialization (specialization),
    INDEX idx_is_available (is_available)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Patients table (extends users with patient-specific fields)
CREATE TABLE IF NOT EXISTS patients (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT UNIQUE NOT NULL,
    date_of_birth DATE,
    gender ENUM('male', 'female', 'other'),
    blood_group VARCHAR(5),
    allergies TEXT,
    medical_history TEXT,
    emergency_contact_name VARCHAR(100),
    emergency_contact_phone VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_date_of_birth (date_of_birth)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Appointments table
CREATE TABLE IF NOT EXISTS appointments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    patient_id INT NOT NULL,
    doctor_id INT NOT NULL,
    appointment_date DATETIME NOT NULL,
    duration_minutes INT DEFAULT 30,
    status ENUM('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show') DEFAULT 'scheduled',
    room_id VARCHAR(50) UNIQUE,
    room_password VARCHAR(100),
    encryption_key_hash VARCHAR(255),
    symptoms TEXT,
    started_at TIMESTAMP NULL,
    ended_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    INDEX idx_patient_id (patient_id),
    INDEX idx_doctor_id (doctor_id),
    INDEX idx_appointment_date (appointment_date),
    INDEX idx_status (status),
    INDEX idx_room_id (room_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Prescriptions table (encrypted data storage)
CREATE TABLE IF NOT EXISTS prescriptions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    appointment_id INT NOT NULL UNIQUE,
    diagnosis_encrypted TEXT,
    symptoms_encrypted TEXT,
    medications_json_encrypted TEXT,
    notes_encrypted TEXT,
    follow_up_date DATE,
    digital_signature VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
    INDEX idx_appointment_id (appointment_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit logs table (for DPDP compliance)
CREATE TABLE IF NOT EXISTS audit_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id INT,
    ip_address VARCHAR(45),
    user_agent TEXT,
    request_data JSON,
    response_status INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_action (action),
    INDEX idx_created_at (created_at),
    INDEX idx_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- User sessions table (for security tracking)
CREATE TABLE IF NOT EXISTS user_sessions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    refresh_token_hash VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent TEXT,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_token_hash (token_hash),
    INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Doctor availability schedule
CREATE TABLE IF NOT EXISTS doctor_schedules (
    id INT PRIMARY KEY AUTO_INCREMENT,
    doctor_id INT NOT NULL,
    day_of_week ENUM('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday') NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_available BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    INDEX idx_doctor_id (doctor_id),
    INDEX idx_day_of_week (day_of_week)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- OTP codes table
CREATE TABLE IF NOT EXISTS otp_codes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    otp_code VARCHAR(6) NOT NULL,
    otp_type ENUM('registration', 'login', 'password_reset') DEFAULT 'login',
    expires_at TIMESTAMP NOT NULL,
    is_used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_otp_code (otp_code),
    INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Consultation messages (encrypted chat during calls)
CREATE TABLE IF NOT EXISTS consultation_messages (
    id INT PRIMARY KEY AUTO_INCREMENT,
    appointment_id INT NOT NULL,
    sender_id INT NOT NULL,
    message_encrypted TEXT NOT NULL,
    message_type ENUM('text', 'file', 'system') DEFAULT 'text',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_appointment_id (appointment_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default admin user (password: admin123)
INSERT INTO users (id, email, password_hash, role, first_name, last_name, email_verified, is_active) 
VALUES (1, 'admin@medilock.in', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYIBx5R5N8u', 'admin', 'System', 'Admin', TRUE, TRUE)
ON DUPLICATE KEY UPDATE email = email;

-- Insert sample doctors
INSERT INTO users (email, password_hash, role, first_name, last_name, phone, email_verified, is_active) 
VALUES 
('dr.sharma@medilock.in', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYIBx5R5N8u', 'doctor', 'Dr. Rajesh', 'Sharma', '+91-9876543210', TRUE, TRUE),
('dr.patel@medilock.in', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYIBx5R5N8u', 'doctor', 'Dr. Priya', 'Patel', '+91-9876543211', TRUE, TRUE),
('dr.kumar@medilock.in', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYIBx5R5N8u', 'doctor', 'Dr. Amit', 'Kumar', '+91-9876543212', TRUE, TRUE)
ON DUPLICATE KEY UPDATE email = email;

-- Insert doctors profiles
INSERT INTO doctors (user_id, specialization, license_number, qualifications, experience_years, bio, consultation_fee, is_available)
VALUES 
(2, 'General Medicine', 'MH-MED-12345', 'MBBS, MD (General Medicine)', 15, 'Experienced general physician with expertise in treating common ailments and chronic conditions.', 500.00, TRUE),
(3, 'Cardiology', 'MH-CARD-67890', 'MBBS, MD (Cardiology), DM (Cardiology)', 12, 'Specialized in heart conditions and cardiovascular diseases.', 1000.00, TRUE),
(4, 'Dermatology', 'MH-DERM-11223', 'MBBS, MD (Dermatology)', 8, 'Expert in skin, hair, and nail conditions.', 750.00, TRUE)
ON DUPLICATE KEY UPDATE user_id = user_id;

-- Insert sample patients
INSERT INTO users (email, password_hash, role, first_name, last_name, phone, email_verified, is_active) 
VALUES 
('patient1@medilock.in', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYIBx5R5N8u', 'patient', 'Rahul', 'Verma', '+91-9876543213', TRUE, TRUE),
('patient2@medilock.in', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYIBx5R5N8u', 'patient', 'Anjali', 'Singh', '+91-9876543214', TRUE, TRUE)
ON DUPLICATE KEY UPDATE email = email;

-- Insert patients profiles
INSERT INTO patients (user_id, date_of_birth, gender, blood_group, allergies, medical_history)
VALUES 
(5, '1990-05-15', 'male', 'O+', 'None', 'Regular health checkups'),
(6, '1985-08-22', 'female', 'A+', 'Penicillin', 'Hypertension')
ON DUPLICATE KEY UPDATE user_id = user_id;

-- Insert doctor schedules
INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time, is_available)
VALUES 
(1, 'monday', '09:00:00', '17:00:00', TRUE),
(1, 'tuesday', '09:00:00', '17:00:00', TRUE),
(1, 'wednesday', '09:00:00', '17:00:00', TRUE),
(1, 'thursday', '09:00:00', '17:00:00', TRUE),
(1, 'friday', '09:00:00', '17:00:00', TRUE),
(2, 'monday', '10:00:00', '18:00:00', TRUE),
(2, 'tuesday', '10:00:00', '18:00:00', TRUE),
(2, 'wednesday', '10:00:00', '18:00:00', TRUE),
(2, 'thursday', '10:00:00', '18:00:00', TRUE),
(2, 'friday', '10:00:00', '18:00:00', TRUE),
(3, 'monday', '08:00:00', '14:00:00', TRUE),
(3, 'wednesday', '08:00:00', '14:00:00', TRUE),
(3, 'friday', '08:00:00', '14:00:00', TRUE)
ON DUPLICATE KEY UPDATE doctor_id = doctor_id;

-- View for appointment details
CREATE OR REPLACE VIEW v_appointment_details AS
SELECT 
    a.id,
    a.appointment_date,
    a.duration_minutes,
    a.status,
    a.room_id,
    a.symptoms,
    a.started_at,
    a.ended_at,
    p.user_id AS patient_user_id,
    CONCAT(u1.first_name, ' ', u1.last_name) AS patient_name,
    u1.email AS patient_email,
    u1.phone AS patient_phone,
    d.user_id AS doctor_user_id,
    CONCAT(u2.first_name, ' ', u2.last_name) AS doctor_name,
    u2.email AS doctor_email,
    u2.phone AS doctor_phone,
    d.specialization,
    d.consultation_fee,
    a.created_at
FROM appointments a
INNER JOIN patients p ON a.patient_id = p.id
INNER JOIN users u1 ON p.user_id = u1.id
INNER JOIN doctors d ON a.doctor_id = d.id
INNER JOIN users u2 ON d.user_id = u2.id;

-- View for user statistics
CREATE OR REPLACE VIEW v_user_statistics AS
SELECT 
    u.role,
    COUNT(*) AS total_users,
    SUM(CASE WHEN u.is_active = 1 THEN 1 ELSE 0 END) AS active_users,
    SUM(CASE WHEN u.email_verified = 1 THEN 1 ELSE 0 END) AS verified_users
FROM users u
GROUP BY u.role;
