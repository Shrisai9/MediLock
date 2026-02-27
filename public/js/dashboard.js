/**
 * MediLock - Dashboard JavaScript
 * Patient and Doctor dashboard functionality
 */

// Check authentication on page load
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Dashboard loading, auth:', auth);
  
  if (!isLoggedIn()) {
    window.location.href = 'login.html';
    return;
  }
  
  console.log('User role:', auth.user?.role);
  
  // Update user info
  updateUserInfo();
  
  // Load dashboard data
  loadDashboardData();
});

// Update user info in header
function updateUserInfo() {
  const userNameElements = document.querySelectorAll('#userName, #welcomeName');
  userNameElements.forEach(el => {
    if (auth.user) {
      el.textContent = auth.user.firstName || auth.user.email;
    }
  });
}

// Load dashboard data based on role
async function loadDashboardData() {
  try {
    if (!auth.user) {
      console.error('No user data found');
      window.location.href = 'login.html';
      return;
    }
    
    console.log('Loading dashboard for role:', auth.user.role);
    
    if (auth.user.role === 'patient') {
      await loadPatientDashboard();
    } else if (auth.user.role === 'doctor') {
      await loadDoctorDashboard();
    } else if (auth.user.role === 'admin') {
      await loadAdminDashboard();
    }
  } catch (error) {
    console.error('Error loading dashboard:', error);
    showNotification('Failed to load dashboard data', 'danger');
  }
}

// Load patient dashboard
async function loadPatientDashboard() {
  try {
    console.log('Loading patient dashboard...');
    
    // Load appointments
    const appointmentsRes = await apiRequest('/appointments?upcoming=true');
    console.log('Appointments response:', appointmentsRes);
    
    const appointments = appointmentsRes.data || [];
    console.log('Appointments:', appointments.length);
    
    // Update appointments list
    const appointmentsList = document.getElementById('appointmentsList');
    if (appointmentsList) {
      if (appointments.length === 0) {
        appointmentsList.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No upcoming appointments</td></tr>';
      } else {
        appointmentsList.innerHTML = appointments.map(apt => `
          <tr>
            <td>${apt.doctor_name || 'Doctor'}</td>
            <td>${apt.specialization || '-'}</td>
            <td>${formatDateTime(apt.appointment_date)}</td>
            <td><span class="badge bg-${getStatusColor(apt.status)}">${apt.status}</span></td>
            <td>
              ${apt.status === 'scheduled' ? `<button class="btn btn-sm btn-primary" onclick="joinConsultation(${apt.id})">Join</button>` : ''}
              <button class="btn btn-sm btn-outline-danger" onclick="cancelAppointment(${apt.id})">Cancel</button>
            </td>
          </tr>
        `).join('');
      }
    }
    
    // Update counts
    if (document.getElementById('upcomingCount')) {
      document.getElementById('upcomingCount').textContent = appointments.length;
    }
    
    // Load prescriptions count
    try {
      const prescriptionsRes = await apiRequest('/prescriptions/my/prescriptions');
      if (document.getElementById('prescriptionsCount')) {
        document.getElementById('prescriptionsCount').textContent = (prescriptionsRes.data || []).length;
      }
    } catch (e) {
      console.log('No prescriptions yet');
      if (document.getElementById('prescriptionsCount')) {
        document.getElementById('prescriptionsCount').textContent = '0';
      }
    }
    
    // Load doctors count
    try {
      const doctorsRes = await apiRequest('/doctors?limit=100');
      if (document.getElementById('doctorsCount')) {
        document.getElementById('doctorsCount').textContent = (doctorsRes.data?.doctors || doctorsRes.data || []).length;
      }
    } catch (e) {
      console.log('Error loading doctors');
      if (document.getElementById('doctorsCount')) {
        document.getElementById('doctorsCount').textContent = '0';
      }
    }
    
  } catch (error) {
    console.error('Error loading patient dashboard:', error);
  }
}

// Load doctor dashboard
async function loadDoctorDashboard() {
  try {
    console.log('Loading doctor dashboard...');
    
    // Load upcoming appointments for the doctor
    const appointmentsRes = await apiRequest('/appointments?upcoming=true');
    console.log('Doctor appointments response:', appointmentsRes);
    
    const appointments = appointmentsRes.data || [];
    console.log('Doctor appointments:', appointments.length);
    
    // Update schedule list
    const scheduleList = document.getElementById('scheduleList');
    if (scheduleList) {
      if (appointments.length === 0) {
        scheduleList.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No upcoming appointments</td></tr>';
      } else {
        scheduleList.innerHTML = appointments.map(apt => `
          <tr>
            <td>${formatDateTime(apt.appointment_date)}</td>
            <td>${apt.patient_name || 'Patient'}</td>
            <td>Video Consultation</td>
            <td><span class="badge bg-${getStatusColor(apt.status)}">${apt.status}</span></td>
            <td>
              ${apt.status === 'scheduled' ? `<button class="btn btn-sm btn-primary" onclick="startConsultation(${apt.id})">Start</button>` : ''}
            </td>
          </tr>
        `).join('');
      }
    }
    
    // Update counts
    if (document.getElementById('todayAppointments')) {
      document.getElementById('todayAppointments').textContent = appointments.length;
    }
    if (document.getElementById('todayCount')) {
      document.getElementById('todayCount').textContent = appointments.length;
    }
    
    // Get doctor profile
    try {
      const doctorRes = await apiRequest('/auth/me');
      if (doctorRes.data) {
        if (document.getElementById('rating')) {
          document.getElementById('rating').textContent = doctorRes.data.rating || '4.9';
        }
        if (document.getElementById('totalPatients')) {
          document.getElementById('totalPatients').textContent = doctorRes.data.total_consultations || '0';
        }
        
        // Update availability button
        const availabilityBtn = document.getElementById('availabilityBtn');
        if (availabilityBtn && doctorRes.data.is_available !== undefined) {
          if (doctorRes.data.is_available) {
            availabilityBtn.classList.add('btn-success');
            availabilityBtn.classList.remove('btn-danger');
            availabilityBtn.innerHTML = '<i class="fas fa-toggle-on"></i> Available';
          } else {
            availabilityBtn.classList.add('btn-danger');
            availabilityBtn.classList.remove('btn-success');
            availabilityBtn.innerHTML = '<i class="fas fa-toggle-off"></i> Unavailable';
          }
        }
      }
    } catch (e) {
      console.log('Error loading doctor profile');
    }
    
  } catch (error) {
    console.error('Error loading doctor dashboard:', error);
  }
}

// Load admin dashboard
async function loadAdminDashboard() {
  try {
    // Load stats
    const statsRes = await apiRequest('/users/stats');
    const stats = statsRes.data;
    
    // Update counts
    const patientsStat = stats.usersByRole?.find(u => u.role === 'patient');
    const doctorsStat = stats.usersByRole?.find(u => u.role === 'doctor');
    
    if (document.getElementById('totalPatients')) {
      document.getElementById('totalPatients').textContent = patientsStat?.total || '0';
    }
    if (document.getElementById('totalDoctors')) {
      document.getElementById('totalDoctors').textContent = doctorsStat?.total || '0';
    }
    if (document.getElementById('totalAppointments')) {
      document.getElementById('totalAppointments').textContent = stats.totalAppointments || '0';
    }
    if (document.getElementById('todayAppointments')) {
      document.getElementById('todayAppointments').textContent = stats.todayAppointments || '0';
    }
    
    // Load users list
    try {
      const usersRes = await apiRequest('/users?limit=5');
      const activityList = document.getElementById('activityList');
      if (activityList && usersRes.data && usersRes.data.users) {
        activityList.innerHTML = usersRes.data.users.slice(0, 5).map(user => `
          <tr>
            <td>${formatDateTime(user.created_at)}</td>
            <td>${user.first_name || ''} ${user.last_name || ''}</td>
            <td>${user.role}</td>
            <td>${user.is_active ? '<span class="badge bg-success">Active</span>' : '<span class="badge bg-danger">Inactive</span>'}</td>
          </tr>
        `).join('');
      }
    } catch (e) {
      console.log('Error loading users');
    }
    
  } catch (error) {
    console.error('Error loading admin dashboard:', error);
  }
}

// Get status color
function getStatusColor(status) {
  const colors = {
    'scheduled': 'primary',
    'in_progress': 'warning',
    'completed': 'success',
    'cancelled': 'danger',
    'no_show': 'secondary'
  };
  return colors[status] || 'secondary';
}

// Book appointment
async function bookAppointment() {
  const modalElement = document.getElementById('bookAppointmentModal');
  if (!modalElement) {
    showNotification('Booking form not available', 'danger');
    return;
  }
  
  const modal = new bootstrap.Modal(modalElement);
  modal.show();
  
  // Load all doctors (not filtering by availability)
  try {
    const res = await apiRequest('/doctors?limit=100');
    const select = document.getElementById('selectDoctor');
    const doctors = res.data?.doctors || res.data || [];
    
    if (doctors.length === 0) {
      select.innerHTML = '<option value="">No doctors available</option>';
      showNotification('No doctors available for booking', 'warning');
      return;
    }
    
    if (select) {
      select.innerHTML = '<option value="">Choose a doctor...</option>' +
        doctors.map(d => `<option value="${d.id}">Dr. ${d.first_name} ${d.last_name || ''} - ${d.specialization || 'General'}</option>`).join('');
    }
  } catch (error) {
    console.error('Error loading doctors:', error);
    showNotification('Failed to load doctors', 'danger');
  }
}

// Submit appointment
async function submitAppointment() {
  const doctorId = document.getElementById('selectDoctor')?.value;
  const appointmentDate = document.getElementById('appointmentDate')?.value;
  const symptoms = document.getElementById('symptoms')?.value;
  
  if (!doctorId || !appointmentDate) {
    showNotification('Please fill in required fields', 'danger');
    return;
  }
  
  try {
    const res = await apiRequest('/appointments', {
      method: 'POST',
      body: JSON.stringify({
        doctorId: parseInt(doctorId),
        appointmentDate: new Date(appointmentDate).toISOString(),
        symptoms
      })
    });
    
    if (res.success) {
      showNotification('Appointment booked successfully!', 'success');
      const modalElement = document.getElementById('bookAppointmentModal');
      if (modalElement) {
        const modal = bootstrap.Modal.getInstance(modalElement);
        if (modal) modal.hide();
      }
      loadDashboardData();
    } else {
      showNotification(res.message || 'Failed to book appointment', 'danger');
    }
  } catch (error) {
    console.error('Error booking appointment:', error);
    showNotification('Failed to book appointment', 'danger');
  }
}

// Cancel appointment
async function cancelAppointment(id) {
  if (!confirm('Are you sure you want to cancel this appointment?')) return;
  
  try {
    const res = await apiRequest(`/appointments/${id}`, {
      method: 'DELETE'
    });
    
    if (res.success) {
      showNotification('Appointment cancelled', 'success');
      loadDashboardData();
    }
  } catch (error) {
    showNotification(error.message, 'danger');
  }
}

// Join consultation
function joinConsultation(appointmentId) {
  if (appointmentId) {
    window.location.href = `consultation.html?appointmentId=${appointmentId}`;
  } else {
    showNotification('No appointment to join', 'warning');
  }
}

// Start consultation (doctor)
function startConsultation(appointmentId) {
  window.location.href = `consultation.html?appointmentId=${appointmentId}`;
}

// Toggle availability (doctor)
async function toggleAvailability() {
  try {
    const res = await apiRequest('/auth/me');
    const isAvailable = !res.data.is_available;
    
    await apiRequest(`/doctors/${res.data.id}/availability`, {
      method: 'PUT',
      body: JSON.stringify({ isAvailable })
    });
    
    showNotification(`You are now ${isAvailable ? 'available' : 'unavailable'}`, 'success');
    loadDashboardData();
  } catch (error) {
    showNotification(error.message, 'danger');
  }
}

// Show section (for navigation)
function showSection(section) {
  console.log('Showing section:', section);
  
  // Hide all sections
  document.querySelectorAll('.section-container').forEach(el => el.classList.add('d-none'));
  document.querySelectorAll('.sidebar-menu li').forEach(el => el.classList.remove('active'));
  
  // Show selected section
  const sectionMap = {
    'dashboard': null,
    'users': 'usersSection',
    'doctors': 'doctorsSection',
    'appointments': 'appointmentsSection',
    'audit': 'auditSection',
    'settings': 'settingsSection'
  };
  
  const sectionId = sectionMap[section];
  if (sectionId) {
    document.getElementById(sectionId)?.classList.remove('d-none');
  }
  
  // Load data for the section
  if (section === 'users') loadAdminUsers();
  if (section === 'doctors') loadAdminDoctors();
  if (section === 'appointments') loadAdminAppointments();
  if (section === 'audit') loadAuditLogs();
}

// Load admin users
async function loadAdminUsers() {
  const usersList = document.getElementById('usersList');
  if (!usersList) return;
  
  try {
    const res = await apiRequest('/users?limit=50');
    const users = res.data?.users || [];
    
    if (users.length === 0) {
      usersList.innerHTML = '<tr><td colspan="6" class="text-center">No users found</td></tr>';
      return;
    }
    
    usersList.innerHTML = users.map(u => `
      <tr>
        <td>${u.id}</td>
        <td>${u.first_name || ''} ${u.last_name || ''}</td>
        <td>${u.email}</td>
        <td><span class="badge bg-${u.role === 'admin' ? 'danger' : u.role === 'doctor' ? 'info' : 'primary'}">${u.role}</span></td>
        <td>${u.is_active ? '<span class="badge bg-success">Active</span>' : '<span class="badge bg-danger">Inactive</span>'}</td>
        <td>${formatDate(u.created_at)}</td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Error loading users:', error);
    usersList.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Failed to load users</td></tr>';
  }
}

// Load admin doctors
async function loadAdminDoctors() {
  const doctorsList = document.getElementById('adminDoctorsList');
  if (!doctorsList) return;
  
  try {
    const res = await apiRequest('/doctors?limit=50');
    const doctors = res.data?.doctors || res.data || [];
    
    if (doctors.length === 0) {
      doctorsList.innerHTML = '<tr><td colspan="6" class="text-center">No doctors found</td></tr>';
      return;
    }
    
    doctorsList.innerHTML = doctors.map(d => `
      <tr>
        <td>${d.id}</td>
        <td>Dr. ${d.first_name} ${d.last_name || ''}</td>
        <td>${d.specialization || 'General'}</td>
        <td>${d.experience_years || 0} years</td>
        <td>₹${d.consultation_fee || 500}</td>
        <td>${d.is_available ? '<span class="badge bg-success">Available</span>' : '<span class="badge bg-secondary">Unavailable</span>'}</td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Error loading doctors:', error);
    doctorsList.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Failed to load doctors</td></tr>';
  }
}

// Load admin appointments
async function loadAdminAppointments() {
  const appointmentsList = document.getElementById('adminAppointmentsList');
  if (!appointmentsList) return;
  
  try {
    const res = await apiRequest('/appointments?limit=50');
    const appointments = res.data || [];
    
    if (appointments.length === 0) {
      appointmentsList.innerHTML = '<tr><td colspan="5" class="text-center">No appointments found</td></tr>';
      return;
    }
    
    appointmentsList.innerHTML = appointments.map(a => `
      <tr>
        <td>${a.id}</td>
        <td>${a.patient_name || 'Patient'}</td>
        <td>${a.doctor_name || 'Doctor'}</td>
        <td>${formatDateTime(a.appointment_date)}</td>
        <td><span class="badge bg-${getStatusColor(a.status)}">${a.status}</span></td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Error loading appointments:', error);
    appointmentsList.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Failed to load appointments</td></tr>';
  }
}

// Load audit logs
async function loadAuditLogs() {
  const auditList = document.getElementById('auditLogsList');
  if (!auditList) return;
  auditList.innerHTML = '<tr><td colspan="5" class="text-center">No audit logs available</td></tr>';
}

// Format date helper
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString();
}

// Format date time helper
function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleString([], { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit' 
  });
}

// Refresh data
function refreshData() {
  loadDashboardData();
  showNotification('Data refreshed', 'success');
}

// Leave consultation
function leaveConsultation() {
  window.location.href = auth.user.role === 'doctor' ? 'doctor-dashboard.html' : 'patient-dashboard.html';
}

// ===== Patient Dashboard Additional Functions =====

// Show Find Doctors section
function showFindDoctors() {
  const mainDashboard = document.getElementById('mainDashboard');
  const doctorsSection = document.getElementById('doctorsSection');
  
  if (mainDashboard) mainDashboard.classList.add('d-none');
  if (doctorsSection) doctorsSection.classList.remove('d-none');
  
  loadDoctorsList();
}

// Show main dashboard
function showDashboard() {
  const mainDashboard = document.getElementById('mainDashboard');
  const doctorsSection = document.getElementById('doctorsSection');
  
  if (mainDashboard) mainDashboard.classList.remove('d-none');
  if (doctorsSection) doctorsSection.classList.add('d-none');
}

// Load doctors list
async function loadDoctorsList() {
  const doctorsList = document.getElementById('doctorsList');
  if (!doctorsList) return;
  
  try {
    const res = await apiRequest('/doctors?limit=100');
    const doctors = res.data?.doctors || res.data || [];
    
    if (doctors.length === 0) {
      doctorsList.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No doctors available</td></tr>';
      return;
    }

    doctorsList.innerHTML = doctors.map(d => `
      <tr>
        <td>
          <div class="d-flex align-items-center">
            <div class="doctor-avatar me-2">
              <i class="fas fa-user-md"></i>
            </div>
            <div>
              <strong>Dr. ${d.first_name} ${d.last_name || ''}</strong>
            </div>
          </div>
        </td>
        <td>${d.specialization || 'General Medicine'}</td>
        <td>${d.experience_years || 0} years</td>
        <td>₹${d.consultation_fee || 500}</td>
        <td><span class="badge bg-warning text-dark"><i class="fas fa-star"></i> ${d.rating || '4.9'}</span></td>
        <td>
          <button class="btn btn-sm btn-primary" onclick="bookAppointmentWithDoctor(${d.id}, 'Dr. ${d.first_name} ${d.last_name || ''}')">
            Book
          </button>
        </td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Error loading doctors:', error);
    doctorsList.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Failed to load doctors</td></tr>';
  }
}

// Book appointment with specific doctor
function bookAppointmentWithDoctor(doctorId, doctorName) {
  const modalElement = document.getElementById('bookAppointmentModal');
  if (!modalElement) return;
  
  const modal = new bootstrap.Modal(modalElement);
  modal.show();
  
  // Pre-select doctor
  const select = document.getElementById('selectDoctor');
  if (select) {
    select.value = doctorId;
  }
}

// Make functions globally available
window.bookAppointment = bookAppointment;
window.submitAppointment = submitAppointment;
window.cancelAppointment = cancelAppointment;
window.joinConsultation = joinConsultation;
window.startConsultation = startConsultation;
window.toggleAvailability = toggleAvailability;
window.showSection = showSection;
window.refreshData = refreshData;
window.leaveConsultation = leaveConsultation;
window.showFindDoctors = showFindDoctors;
window.showDashboard = showDashboard;
window.loadDoctorsList = loadDoctorsList;
window.bookAppointmentWithDoctor = bookAppointmentWithDoctor;
window.logout = logout;
window.toggleSidebar = toggleSidebar;
