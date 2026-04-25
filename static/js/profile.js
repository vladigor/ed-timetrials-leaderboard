/**
 * Shared profile selector logic - loaded on all pages
 */

export function initProfileSelector() {
  const profileLabel = document.getElementById('profile-label');
  const btnChangeProfile = document.getElementById('btn-change-profile');

  if (!profileLabel || !btnChangeProfile) {
    console.warn('Profile selector elements not found in DOM');
    return;
  }

  // Read from localStorage and update UI
  updateProfileDisplay();

  // If on non-index page and no profile selected, redirect to home when clicked
  const isIndexPage = window.location.pathname === '/';
  if (!isIndexPage) {
    profileLabel.addEventListener('click', (e) => {
      const filterCmdr = localStorage.getItem('tt_filter_cmdr') || '';
      if (!filterCmdr) {
        e.preventDefault();
        window.location.href = '/';
      }
    });
  }
}

export function updateProfileDisplay() {
  const profileLabel = document.getElementById('profile-label');
  const btnChangeProfile = document.getElementById('btn-change-profile');

  if (!profileLabel || !btnChangeProfile) return;

  const filterCmdr = localStorage.getItem('tt_filter_cmdr') || '';

  if (filterCmdr) {
    const profileUrl = `/cmdr/${encodeURIComponent(filterCmdr)}`;
    profileLabel.textContent = `CMDR ${filterCmdr}`;
    profileLabel.href = profileUrl;
    btnChangeProfile.style.display = '';
  } else {
    profileLabel.textContent = 'Select Profile';
    profileLabel.href = '#';
    btnChangeProfile.style.display = 'none';
  }
}

export function getSelectedCommander() {
  return localStorage.getItem('tt_filter_cmdr') || '';
}
