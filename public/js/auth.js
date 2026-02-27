/**
 * MediLock - Authentication JavaScript
 * Login, registration, and OTP handling
 */

// Registration form handling
document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const errorDiv = document.getElementById('registerError');
  
  // Get form data
  const formData = {
    firstName: document.getElementById('firstName').value,
    lastName: document.getElementById('lastName').value,
    email: document.getElementById('email').value,
    phone: document.getElementById('phone').value,
    password: document.getElementById('password').value,
    confirmPassword: document.getElementById('confirmPassword').value,
    role: document.querySelector('input[name="role"]:checked').value
  };
  
  // Validation
  if (formData.password !== formData.confirmPassword) {
    showError(errorDiv, 'Passwords do not match');
    return;
  }
  
  if (formData.password.length < 6) {
    showError(errorDiv, 'Password must be at least 6 characters');
    return;
  }
  
  // Show loading state
  setLoading(submitBtn, true);
  errorDiv.classList.add('d-none');
  
  try {
    const response = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify(formData)
    });
    
    if (response.success) {
      // Save auth data
      saveAuthData(response.data);
      
      // Redirect based on role
      if (response.data.role === 'doctor') {
        window.location.href = 'doctor-dashboard.html';
      } else {
        window.location.href = 'patient-dashboard.html';
      }
    }
  } catch (error) {
    showError(errorDiv, error.message);
  } finally {
    setLoading(submitBtn, false);
  }
});

// Login form handling
document.querySelectorAll('.auth-form').forEach(form => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formId = form.id;
    const errorDiv = document.getElementById('loginError') || 
                     document.getElementById('loginErrorDoctor') || 
                     document.getElementById('loginErrorAdmin');
    const submitBtn = form.querySelector('button[type="submit"]');
    
    const email = form.querySelector('input[type="email"]').value;
    const password = form.querySelector('input[type="password"]').value;
    
    // Show loading state
    setLoading(submitBtn, true);
    errorDiv.classList.add('d-none');
    
    try {
      const response = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      
      if (response.success) {
        if (response.requiresOTP) {
          // Show OTP modal
          document.getElementById('tempToken').value = response.tempToken;
          const otpModal = new bootstrap.Modal(document.getElementById('otpModal'));
          otpModal.show();
        } else {
          // Save auth data
          saveAuthData(response.data);
          
          // Redirect based on role
          redirectToDashboard(response.data.user.role);
        }
      }
    } catch (error) {
      // Show more helpful error messages
      let errorMessage = error.message;
      if (error.message.includes('fetch')) {
        errorMessage = 'Connection failed. Please check your internet connection and try again.';
      }
      showError(errorDiv, errorMessage);
    } finally {
      setLoading(submitBtn, false);
    }
  });
});

// OTP form handling
document.getElementById('otpForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const form = e.target;
  const otp = document.getElementById('otpCode').value;
  const tempToken = document.getElementById('tempToken').value;
  const errorDiv = document.getElementById('otpError');
  const submitBtn = form.querySelector('button[type="submit"]');
  
  setLoading(submitBtn, true);
  errorDiv.classList.add('d-none');
  
  try {
    const response = await apiRequest('/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ otp, tempToken })
    });
    
    if (response.success) {
      saveAuthData(response.data);
      
      // Close modal
      const otpModal = bootstrap.Modal.getInstance(document.getElementById('otpModal'));
      otpModal.hide();
      
      // Redirect
      redirectToDashboard(response.data.user.role);
    }
  } catch (error) {
    showError(errorDiv, error.message);
  } finally {
    setLoading(submitBtn, false);
  }
});

// Resend OTP
document.getElementById('resendOtp')?.addEventListener('click', async () => {
  const btn = document.getElementById('resendOtp');
  btn.disabled = true;
  
  try {
    // Get current email from temp token or stored data
    const email = auth.user?.email || '';
    await apiRequest('/auth/otp/send', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
    
    showNotification('OTP sent successfully!', 'success');
  } catch (error) {
    showNotification('Failed to resend OTP', 'danger');
  } finally {
    setTimeout(() => {
      btn.disabled = false;
    }, 30000); // 30 second cooldown
  }
});

// Confirm checkbox handling for consultation
document.getElementById('confirmReady')?.addEventListener('change', (e) => {
  const joinBtn = document.getElementById('joinBtn');
  joinBtn.disabled = !e.target.checked;
});

// Helper functions
function showError(element, message) {
  element.textContent = message;
  element.classList.remove('d-none');
}

function setLoading(button, loading) {
  if (loading) {
    button.disabled = true;
    button.querySelector('.btn-text')?.classList.add('d-none');
    button.querySelector('.btn-loader')?.classList.remove('d-none');
  } else {
    button.disabled = false;
    button.querySelector('.btn-text')?.classList.remove('d-none');
    button.querySelector('.btn-loader')?.classList.add('d-none');
  }
}

function redirectToDashboard(role) {
  switch (role) {
    case 'admin':
      window.location.href = 'admin-dashboard.html';
      break;
    case 'doctor':
      window.location.href = 'doctor-dashboard.html';
      break;
    case 'patient':
    default:
      window.location.href = 'patient-dashboard.html';
  }
}

// Logout function
function logout() {
  clearAuthData();
  window.location.href = 'index.html';
}

// Multi-step form navigation
function nextStep(step) {
  // Validate current step
  if (step === 2) {
    const firstName = document.getElementById('firstName').value;
    const email = document.getElementById('email').value;
    
    if (!firstName || !email) {
      showNotification('Please fill in required fields', 'danger');
      return;
    }
    
    if (!isValidEmail(email)) {
      showNotification('Please enter a valid email', 'danger');
      return;
    }
  }
  
  // Hide all steps
  document.querySelectorAll('.form-step').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  
  // Show next step
  document.getElementById(`step${step}`).classList.add('active');
  
  // Update progress
  for (let i = 1; i <= step; i++) {
    document.querySelector(`.step[data-step="${i}"]`)?.classList.add('active');
  }
}

function prevStep(step) {
  document.querySelectorAll('.form-step').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  
  document.getElementById(`step${step}`).classList.add('active');
  
  for (let i = 1; i <= step; i++) {
    document.querySelector(`.step[data-step="${i}"]`)?.classList.add('active');
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Make functions globally available
window.nextStep = nextStep;
window.prevStep = prevStep;
window.logout = logout;
window.togglePassword = togglePassword;
