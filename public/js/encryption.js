/**
 * MediLock - Client-side Encryption
 * Web Crypto API for End-to-End Encryption
 */

// Encryption configuration
const ENCRYPTION_CONFIG = {
  algorithm: 'AES-GCM',
  keyLength: 256,
  ivLength: 12,
  tagLength: 128,
  curve: 'P-256'
};

// Generate ECDH key pair
async function generateKeyPair() {
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: ENCRYPTION_CONFIG.curve
    },
    true,
    ['deriveKey', 'deriveBits']
  );
  
  return keyPair;
}

// Export public key
async function exportPublicKey(key) {
  const exported = await window.crypto.subtle.exportKey('raw', key);
  return arrayBufferToBase64(exported);
}

// Import public key from base64
async function importPublicKey(base64Key) {
  const keyData = base64ToArrayBuffer(base64Key);
  
  return await window.crypto.subtle.importKey(
    'raw',
    keyData,
    {
      name: 'ECDH',
      namedCurve: ENCRYPTION_CONFIG.curve
    },
    true,
    []
  );
}

// Derive shared secret from ECDH
async function deriveSharedSecret(privateKey, publicKey) {
  const sharedKey = await window.crypto.subtle.deriveKey(
    {
      name: 'ECDH',
      public: publicKey
    },
    privateKey,
    {
      name: ENCRYPTION_CONFIG.algorithm,
      length: ENCRYPTION_CONFIG.keyLength
    },
    false,
    ['encrypt', 'decrypt']
  );
  
  return sharedKey;
}

// Generate random AES key
async function generateAESKey() {
  return await window.crypto.subtle.generateKey(
    {
      name: ENCRYPTION_CONFIG.algorithm,
      length: ENCRYPTION_CONFIG.keyLength
    },
    true,
    ['encrypt', 'decrypt']
  );
}

// Encrypt data with AES-GCM
async function encryptData(key, plaintext) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  
  const iv = window.crypto.getRandomValues(new Uint8Array(ENCRYPTION_CONFIG.ivLength));
  
  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: ENCRYPTION_CONFIG.algorithm,
      iv: iv,
      tagLength: ENCRYPTION_CONFIG.tagLength
    },
    key,
    data
  );
  
  // Combine IV and encrypted data
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  
  return arrayBufferToBase64(combined.buffer);
}

// Decrypt data with AES-GCM
async function decryptData(key, encryptedBase64) {
  const combined = new Uint8Array(base64ToArrayBuffer(encryptedBase64));
  
  const iv = combined.slice(0, ENCRYPTION_CONFIG.ivLength);
  const data = combined.slice(ENCRYPTION_CONFIG.ivLength);
  
  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: ENCRYPTION_CONFIG.algorithm,
      iv: iv,
      tagLength: ENCRYPTION_CONFIG.tagLength
    },
    key,
    data
  );
  
  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

// Encrypt message for chat
async function encryptMessage(message, sharedKey) {
  return await encryptData(sharedKey, message);
}

// Decrypt message from chat
async function decryptMessage(encryptedMessage, sharedKey) {
  return await decryptData(sharedKey, encryptedMessage);
}

// Hash data using SHA-256
async function hashData(data) {
  const encoder = new TextEncoder();
  const hashed = await window.crypto.subtle.digest('SHA-256', encoder.encode(data));
  return arrayBufferToBase64(hashed);
}

// Generate random ID
function generateId(length = 16) {
  const array = new Uint8Array(length);
  window.crypto.getRandomValues(array);
  return arrayBufferToBase64(array.buffer).replace(/[^a-zA-Z0-9]/g, '').substring(0, length);
}

// Utility: ArrayBuffer to Base64
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Utility: Base64 to ArrayBuffer
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Export key for storage
async function exportKey(key) {
  const exported = await window.crypto.subtle.exportKey('raw', key);
  return arrayBufferToBase64(exported);
}

// Import key from storage
async function importKey(keyData) {
  const data = base64ToArrayBuffer(keyData);
  
  return await window.crypto.subtle.importKey(
    'raw',
    data,
    {
      name: ENCRYPTION_CONFIG.algorithm,
      length: ENCRYPTION_CONFIG.keyLength
    },
    true,
    ['encrypt', 'decrypt']
  );
}

// Encryption manager class
class EncryptionManager {
  constructor() {
    this.keyPair = null;
    this.sharedKey = null;
    this.peerPublicKey = null;
  }
  
  // Initialize encryption
  async initialize() {
    this.keyPair = await generateKeyPair();
    const publicKey = await exportPublicKey(this.keyPair.publicKey);
    return publicKey;
  }
  
  // Set peer's public key and derive shared secret
  async setPeerPublicKey(peerPublicKey) {
    this.peerPublicKey = await importPublicKey(peerPublicKey);
    this.sharedKey = await deriveSharedSecret(this.keyPair.privateKey, this.peerPublicKey);
  }
  
  // Encrypt message
  async encrypt(message) {
    if (!this.sharedKey) {
      throw new Error('Shared key not established');
    }
    return await encryptMessage(message, this.sharedKey);
  }
  
  // Decrypt message
  async decrypt(encryptedMessage) {
    if (!this.sharedKey) {
      throw new Error('Shared key not established');
    }
    return await decryptMessage(encryptedMessage, this.sharedKey);
  }
  
  // Get public key
  async getPublicKey() {
    if (!this.keyPair) {
      await this.initialize();
    }
    return await exportPublicKey(this.keyPair.publicKey);
  }
}

// Make functions globally available
window.EncryptionManager = EncryptionManager;
window.generateKeyPair = generateKeyPair;
window.exportPublicKey = exportPublicKey;
window.importPublicKey = importPublicKey;
window.deriveSharedSecret = deriveSharedSecret;
window.encryptData = encryptData;
window.decryptData = decryptData;
window.encryptMessage = encryptMessage;
window.decryptMessage = decryptMessage;
window.hashData = hashData;
window.generateId = generateId;
window.arrayBufferToBase64 = arrayBufferToBase64;
window.base64ToArrayBuffer = base64ToArrayBuffer;
