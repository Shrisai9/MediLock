/**
 * MediLock - Server-side Encryption Middleware
 * AES-256 encryption for sensitive data at rest
 */

const crypto = require('crypto');
require('dotenv').config();

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'medilock_aes256_key_for_data_encryption';
const IV_LENGTH = parseInt(process.env.ENCRYPTION_IV_LENGTH) || 16;
const ALGORITHM = 'aes-256-gcm';

// Ensure key is 32 bytes for AES-256
const getKey = () => {
  const key = Buffer.from(ENCRYPTION_KEY, 'utf8');
  if (key.length < 32) {
    return Buffer.concat([key], 32).slice(0, 32);
  }
  return key.slice(0, 32);
};

// Encrypt text
const encrypt = (text) => {
  if (!text) return null;
  
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Return iv:authTag:encrypted
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Encryption failed');
  }
};

// Decrypt text
const decrypt = (encryptedText) => {
  if (!encryptedText) return null;
  
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Decryption failed');
  }
};

// Encrypt object (recursive)
const encryptObject = (obj, fields) => {
  if (!obj) return obj;
  
  const encrypted = { ...obj };
  
  for (const field of fields) {
    if (encrypted[field]) {
      encrypted[field] = encrypt(encrypted[field]);
    }
  }
  
  return encrypted;
};

// Decrypt object (recursive)
const decryptObject = (obj, fields) => {
  if (!obj) return obj;
  
  const decrypted = { ...obj };
  
  for (const field of fields) {
    if (decrypted[field]) {
      decrypted[field] = decrypt(decrypted[field]);
    }
  }
  
  return decrypted;
};

// Hash data (one-way)
const hash = (data) => {
  return crypto.createHash('sha256').update(data).digest('hex');
};

// Generate random token
const generateToken = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

// Generate OTP
const generateOTP = (length = 6) => {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)];
  }
  return otp;
};

// Middleware to decrypt request body fields
const decryptRequestFields = (...fields) => {
  return (req, res, next) => {
    for (const field of fields) {
      if (req.body[field]) {
        try {
          req.body[field] = decrypt(req.body[field]);
        } catch (error) {
          return res.status(400).json({
            success: false,
            message: `Invalid encrypted data for field: ${field}`
          });
        }
      }
    }
    next();
  };
};

// Middleware to encrypt response fields
const encryptResponseFields = (...fields) => {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    
    res.json = (data) => {
      if (data && typeof data === 'object') {
        for (const field of fields) {
          if (data[field]) {
            try {
              data[field] = encrypt(data[field]);
            } catch (error) {
              console.error(`Error encrypting field ${field}:`, error);
            }
          }
        }
      }
      return originalJson(data);
    };
    
    next();
  };
};

module.exports = {
  encrypt,
  decrypt,
  encryptObject,
  decryptObject,
  hash,
  generateToken,
  generateOTP,
  decryptRequestFields,
  encryptResponseFields
};
