/**
 * MediLock - Main JavaScript
 * General utilities and functionality
 */

// API Base URL
const API_URL = window.location.origin + '/api';

// Store auth tokens
let userData = localStorage.getItem('user');
let user = null;
if (userData && userData !== 'undefined' && userData !== 'null') {
  try {
    user = JSON.parse(userData);
  } catch (e) {
    console.error('Error parsing user data:', e);
    localStorage.removeItem('user'); // Clear invalid data
  }
}

const auth = {
  token: localStorage.getItem('accessToken'),
  refreshToken: localStorage.getItem('refreshToken'),
  user: user
};

// Check if user is logged in
function isLoggedIn() {
  return auth.token !== null;
}

// Get user role
function getUserRole() {
  return auth.user?.role || null;
}

// Save auth data
function saveAuthData(data) {
  localStorage.setItem('accessToken', data.accessToken);
  localStorage.setItem('refreshToken', data.refreshToken);
  localStorage.setItem('user', JSON.stringify(data.user));
  auth.token = data.accessToken;
  auth.refreshToken = data.refreshToken;
  auth.user = data.user;
}

// Clear auth data
function clearAuthData() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  auth.token = null;
  auth.refreshToken = null;
  auth.user = null;
}

// API request helper
async function apiRequest(endpoint, options = {}) {
  const url = `${API_URL}${endpoint}`;
  
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json'
    }
  };

  if (auth.token) {
    defaultOptions.headers['Authorization'] = `Bearer ${auth.token}`;
  }

  const finalOptions = {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...options.headers
    }
  };

  try {
    const response = await fetch(url, finalOptions);
    const data = await response.json();

    if (!response.ok) {
      // Handle token expiration
      if (response.status === 401 && auth.refreshToken) {
        const refreshed = await refreshToken();
        if (refreshed) {
          // Retry the original request
          finalOptions.headers['Authorization'] = `Bearer ${auth.token}`;
          return apiRequest(endpoint, options);
        }
      }
      throw new Error(data.message || 'Request failed');
    }

    return data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

// Refresh access token
async function refreshToken() {
  try {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ refreshToken: auth.refreshToken })
    });

    if (!response.ok) {
      clearAuthData();
      window.location.href = 'login.html';
      return false;
    }

    const data = await response.json();
    localStorage.setItem('accessToken', data.data.accessToken);
    auth.token = data.data.accessToken;
    return true;
  } catch (error) {
    console.error('Token refresh failed:', error);
    clearAuthData();
    window.location.href = 'login.html';
    return false;
  }
}

// Toggle password visibility
function togglePassword(inputId) {
  const input = document.getElementById(inputId);
  const icon = input.parentElement.querySelector('.btn-toggle-password i');
  
  if (input.type === 'password') {
    input.type = 'text';
    icon.classList.remove('fa-eye');
    icon.classList.add('fa-eye-slash');
  } else {
    input.type = 'password';
    icon.classList.remove('fa-eye-slash');
    icon.classList.add('fa-eye');
  }
}

// Show notification
function showNotification(message, type = 'info') {
  const alertDiv = document.createElement('div');
  alertDiv.className = `alert alert-${type} alert-dismissible fade show position-fixed`;
  alertDiv.style.top = '20px';
  alertDiv.style.right = '20px';
  alertDiv.style.zIndex = '9999';
  alertDiv.innerHTML = `
    ${message}
    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
  `;
  
  document.body.appendChild(alertDiv);
  
  setTimeout(() => {
    alertDiv.remove();
  }, 5000);
}

// Format date
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

// Format datetime
function formatDateTime(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Format time
function formatTime(dateString) {
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Animate counter
function animateCounter(element, target, duration = 2000) {
  let start = 0;
  const increment = target / (duration / 16);
  
  const timer = setInterval(() => {
    start += increment;
    if (start >= target) {
      element.textContent = target;
      clearInterval(timer);
    } else {
      element.textContent = Math.floor(start);
    }
  }, 16);
}

// Toggle sidebar (for dashboard pages)
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('show');
}

// Logout function
async function logout() {
  try {
    await apiRequest('/auth/logout', { method: 'POST' });
  } catch (error) {
    console.error('Logout error:', error);
  }
  
  clearAuthData();
  window.location.href = 'login.html';
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  // Add any global initialization here
  console.log('MediLock initialized');
  
  // Check for stored user
  if (auth.user) {
    console.log('User logged in:', auth.user.email);
  }
});
