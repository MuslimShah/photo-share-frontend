/* global localStorage, window, document */

const DEFAULT_API_BASE = 'https://photo-share-backend-kappa.vercel.app/api';
const DEFAULT_AVATAR = 'https://placehold.co/40x40?text=%2B';

function normalizeBase(url) {
  if (!url) return '';
  return url.replace(/\/+$/, '');
}

function resolveApiBase() {
  if (typeof window === 'undefined') {
    return DEFAULT_API_BASE;
  }

  if (window.__PHOTOSHARE_API_BASE) {
    return normalizeBase(window.__PHOTOSHARE_API_BASE);
  }

  const meta = typeof document !== 'undefined'
    ? document.querySelector('meta[name="photoshare-api-base"]')
    : null;
  if (meta?.content) {
    return normalizeBase(meta.content.trim());
  }

  if (window.location.protocol === 'file:') {
    return DEFAULT_API_BASE;
  }

  if (window.location.port === '5000') {
    return normalizeBase(`${window.location.origin}/api`);
  }

  if (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  ) {
    return DEFAULT_API_BASE;
  }

  return normalizeBase(`${window.location.origin}/api`);
}

const API_BASE = resolveApiBase();
let currentUser = null;

const htmlEscapeMap = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value) {
  if (typeof value !== 'string') {
    return value ?? '';
  }
  return value.replace(/[&<>"']/g, (char) => htmlEscapeMap[char]);
}

function getToken() {
  return localStorage.getItem('photoshare_token') || null;
}

function setToken(token) {
  if (token) {
    localStorage.setItem('photoshare_token', token);
  } else {
    localStorage.removeItem('photoshare_token');
  }
}

function getUserRole() {
  return localStorage.getItem('photoshare_role') || null;
}

function setUserRole(role) {
  if (role) {
    localStorage.setItem('photoshare_role', role);
  } else {
    localStorage.removeItem('photoshare_role');
  }
}

function setUserName(name) {
  if (name) {
    localStorage.setItem('photoshare_name', name);
  } else {
    localStorage.removeItem('photoshare_name');
  }
}

function getUserName() {
  return localStorage.getItem('photoshare_name') || null;
}

async function fetchWithAuth(path, options = {}) {
  const token = getToken();
  const headers = new Headers(options.headers || {});

  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
    if (options.body && typeof options.body !== 'string') {
      options.body = JSON.stringify(options.body);
    }
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    logout();
    window.location.href = 'login.html';
    return Promise.reject(new Error('Unauthorized'));
  }

  return response;
}

async function uploadImageFile(file) {
  if (!file) {
    throw new Error('Please select a photo to upload.');
  }

  const formData = new FormData();
  formData.append('image', file);

  const res = await fetchWithAuth('/photos/upload-image', {
    method: 'POST',
    body: formData,
  });

  let payload = {};
  try {
    payload = await res.json();
  } catch (error) {
    // ignore parse errors, handled below
  }

  if (!res.ok || !payload?.imageUrl) {
    throw new Error(payload?.message || 'Image upload failed');
  }

  return payload.imageUrl;
}

async function createPhotoRecord({ title, caption, location, people, imageUrl }) {
  const res = await fetchWithAuth('/photos', {
    method: 'POST',
    body: {
      title,
      caption,
      location,
      people,
      imageUrl,
    },
  });

  let payload;
  try {
    payload = await res.json();
  } catch (error) {
    throw new Error('Unexpected response from server');
  }

  if (!res.ok) {
    throw new Error(payload?.message || 'Photo creation failed');
  }

  return payload;
}

function setupLocationAutocomplete(inputEl, suggestionsEl) {
  if (!inputEl || !suggestionsEl) return null;

  let timeout;
  let results = [];
  let selectedValue = inputEl.value.trim();

  const clearSuggestions = () => {
    suggestionsEl.innerHTML = '';
    suggestionsEl.classList.add('hidden');
    results = [];
  };

  const renderSuggestions = (items) => {
    if (!items.length) {
      clearSuggestions();
      return;
    }

    suggestionsEl.innerHTML = items
      .map(
        (item, index) => `
          <div class="suggestion-item" data-index="${index}">
            <img
              src="${escapeHtml(item.avatarUrl || DEFAULT_AVATAR)}"
              alt="${escapeHtml(item.name)}"
              class="avatar-xs"
            />
            <span>${escapeHtml(item.name)}</span>
          </div>
        `,
      )
      .join('');
    suggestionsEl.classList.remove('hidden');
  };

  const fetchSuggestions = async (query) => {
    try {
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('q', query);
      url.searchParams.set('format', 'json');
      url.searchParams.set('limit', '7');
      url.searchParams.set('addressdetails', '0');

      const res = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json',
        },
      });
      if (!res.ok) {
        clearSuggestions();
        return;
      }
      const data = await res.json();
      results = (data || []).map((item) => ({
        id: item.place_id,
        name: item.display_name,
      }));
      renderSuggestions(results);
    } catch (error) {
      clearSuggestions();
    }
  };

  inputEl.addEventListener('input', () => {
    selectedValue = inputEl.value.trim();
    const value = inputEl.value.trim();
    if (timeout) clearTimeout(timeout);
    if (value.length < 2) {
      clearSuggestions();
      return;
    }
    timeout = setTimeout(() => fetchSuggestions(value), 250);
  });

  suggestionsEl.addEventListener('mousedown', (event) => {
    const item = event.target.closest('.suggestion-item');
    if (!item) return;
    const index = Number(item.dataset.index);
    const suggestion = results[index];
    if (suggestion) {
      selectedValue = suggestion.name;
      inputEl.value = suggestion.name;
      clearSuggestions();
    }
  });

  inputEl.addEventListener('blur', () => {
    setTimeout(() => {
      clearSuggestions();
    }, 150);
  });

  return {
    getValue() {
      return selectedValue || inputEl.value.trim();
    },
    reset() {
      selectedValue = '';
      inputEl.value = '';
      clearSuggestions();
    },
  };
}

function setupPeopleSelector({ inputEl, suggestionsEl, containerEl }) {
  if (!inputEl || !suggestionsEl || !containerEl) return null;

  let selected = [];
  let timeout;
  let results = [];

  const renderSelected = () => {
    if (!selected.length) {
      containerEl.innerHTML = '';
      return;
    }

    containerEl.innerHTML = selected
      .map(
        (person) => `
          <span class="chip" data-id="${person.id}">
            <img
              src="${escapeHtml(person.avatarUrl || DEFAULT_AVATAR)}"
              alt="${escapeHtml(person.name)}"
              class="avatar-xs"
            />
            <span>${escapeHtml(person.name)}</span>
            <button type="button" data-action="remove" data-id="${person.id}">×</button>
          </span>
        `,
      )
      .join('');
  };

  const clearSuggestions = () => {
    suggestionsEl.innerHTML = '';
    suggestionsEl.classList.add('hidden');
    results = [];
  };

  const renderSuggestions = (items) => {
    if (!items.length) {
      clearSuggestions();
      return;
    }

    suggestionsEl.innerHTML = items
      .map(
        (item, index) => `
          <div class="suggestion-item" data-index="${index}">
            <img
              src="${escapeHtml(item.avatarUrl || DEFAULT_AVATAR)}"
              alt="${escapeHtml(item.name)}"
              class="avatar-xs"
            />
            <span>${escapeHtml(item.name)}</span>
          </div>
        `,
      )
      .join('');
    suggestionsEl.classList.remove('hidden');
  };

  const fetchSuggestions = async (query) => {
    try {
      const res = await fetchWithAuth(`/users/search?q=${encodeURIComponent(query)}`, {
        method: 'GET',
      });
      if (!res.ok) {
        clearSuggestions();
        return;
      }
      const data = await res.json();
      const selectedIds = new Set(selected.map((person) => person.id));
      results = (data || [])
        .filter((person) => !selectedIds.has(person.id) && person.id !== currentUser?.id)
        .map((person) => ({
          ...person,
          avatarUrl: person.avatarUrl || DEFAULT_AVATAR,
        }));
      renderSuggestions(results);
    } catch (error) {
      clearSuggestions();
    }
  };

  inputEl.addEventListener('input', () => {
    const value = inputEl.value.trim();
    if (timeout) clearTimeout(timeout);
    if (value.length < 2) {
      clearSuggestions();
      return;
    }
    timeout = setTimeout(() => fetchSuggestions(value), 200);
  });

  suggestionsEl.addEventListener('mousedown', (event) => {
    const item = event.target.closest('.suggestion-item');
    if (!item) return;
    const index = Number(item.dataset.index);
    const selection = results[index];
    if (selection) {
      selected.push(selection);
      renderSelected();
      inputEl.value = '';
      clearSuggestions();
    }
  });

  containerEl.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action="remove"]');
    if (!button) return;
    const { id } = button.dataset;
    selected = selected.filter((person) => person.id !== id);
    renderSelected();
  });

  inputEl.addEventListener('blur', () => {
    setTimeout(() => {
      clearSuggestions();
    }, 150);
  });

  return {
    getSelectedIds() {
      return selected.map((person) => person.id);
    },
    reset() {
      selected = [];
      renderSelected();
      clearSuggestions();
      inputEl.value = '';
    },
  };
}

function logout() {
  setToken(null);
  setUserRole(null);
  setUserName(null);
  currentUser = null;
  window.location.href = 'login.html';
}

function updateNavigationVisibility() {
  const role = getUserRole();
  const token = getToken();
  const loginLink = document.getElementById('login-link');
  const signupLink = document.getElementById('signup-link');
  const logoutBtn = document.getElementById('logout-btn');

  const guestElements = document.querySelectorAll('[data-visible="guest"]');
  const authElements = document.querySelectorAll('[data-visible="auth"]');
  const creatorElements = document.querySelectorAll('[data-role="creator"]');

  guestElements.forEach((el) => el.classList.toggle('hidden', Boolean(token)));
  authElements.forEach((el) => el.classList.toggle('hidden', !token));
  creatorElements.forEach((el) => el.classList.toggle('hidden', role !== 'creator'));

  if (loginLink && !loginLink.hasAttribute('data-visible')) {
    loginLink.classList.toggle('hidden', Boolean(token));
  }
  if (signupLink && !signupLink.hasAttribute('data-visible')) {
    signupLink.classList.toggle('hidden', Boolean(token));
  }
  if (logoutBtn && !logoutBtn.hasAttribute('data-visible')) {
    logoutBtn.classList.toggle('hidden', !token);
  }
}

function buildLocationMarkup(location) {
  if (!location) return '';
  return `<div class="location-pill">📍 ${escapeHtml(location)}</div>`;
}

function buildPeopleMarkup(people) {
  if (!Array.isArray(people) || people.length === 0) return '';
  const links = people
    .filter((person) => person && (person.userId || person.user?._id || person.user?.id))
    .map((person) => {
      const personId = person.userId || person.user?._id || person.user?.id;
      const rawName = person.name || person.user?.name || 'Creator';
      const name =
        typeof rawName === 'string'
          ? rawName
          : rawName && typeof rawName.toString === 'function'
            ? rawName.toString()
            : 'Creator';
      if (!personId) {
        return `<span class="people-link">${escapeHtml(name)}</span>`;
      }
      return `<a class="people-link" href="profile.html?id=${encodeURIComponent(personId)}">${escapeHtml(name)}</a>`;
    });
  if (!links.length) return '';
  return `<div class="people-list">With ${links.join(', ')}</div>`;
}

function renderPhotoCard(photo) {
  const creatorName = photo.creator?.name || photo.creatorName || 'Unknown';
  const creatorId = photo.creator?._id || photo.creator?.id;
  const creatorLink = creatorId
    ? `<a href="profile.html?id=${encodeURIComponent(creatorId)}">${escapeHtml(creatorName)}</a>`
    : escapeHtml(creatorName);

  const likeCount = Array.isArray(photo.likes) ? photo.likes.length : photo.likes || 0;
  const currentUserId = localStorage.getItem('photoshare_user_id');
  const liked =
    Boolean(currentUserId) &&
    Array.isArray(photo.likes) &&
    photo.likes.some((id) => id === currentUserId);
  const caption = photo.caption ? escapeHtml(photo.caption.slice(0, 120)) : '';
  const locationHtml = buildLocationMarkup(photo.location);
  const peopleHtml = buildPeopleMarkup(photo.people);

  return `
    <article class="photo-card" data-id="${photo._id}">
      <img src="${photo.imageUrl}" alt="${escapeHtml(photo.title || 'Photo')}" />
      <div class="card-body">
        <div>
          <h3>${escapeHtml(photo.title || 'Untitled')}</h3>
          ${caption ? `<p class="muted">${caption}</p>` : ''}
          ${locationHtml}
          ${peopleHtml}
        </div>
        <div class="card-meta">
          <span>${creatorLink}</span>
          <button
            type="button"
            class="btn btn-like card-like-btn ${liked ? 'liked' : ''}"
            data-photo-id="${photo._id}"
            data-liked="${liked}"
          >
            <span class="icon">❤</span>
            <span class="like-count">${likeCount}</span>
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderPhotoGrid(container, photos, { emptyMessage = 'No photos found.' } = {}) {
  if (!container) return;
  if (!Array.isArray(photos) || photos.length === 0) {
    container.innerHTML = `<p class="empty-state">${escapeHtml(emptyMessage)}</p>`;
    return;
  }

  container.innerHTML = photos.map((photo) => renderPhotoCard(photo)).join('');
  container.querySelectorAll('.photo-card').forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-id');
      if (id) {
        window.location.href = `photo.html?id=${id}`;
      }
    });
  });
  bindCardLikeButtons(container);
}

async function loadFeed(query = '', options = {}) {
  const { containerId = 'photo-grid', emptyMessage } = options;
  const grid = document.getElementById(containerId);
  if (!grid) return;

  try {
    grid.innerHTML = '<p class="empty-state">Loading photos...</p>';
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    const res = await fetch(`${API_BASE}/photos${qs}`);
    if (!res.ok) throw new Error('Failed to fetch photos');
    const photos = await res.json();
    renderPhotoGrid(grid, photos, { emptyMessage: emptyMessage || 'No photos found.' });
  } catch (error) {
    grid.innerHTML = `<p class="empty-state">Error loading photos. ${escapeHtml(error.message)}</p>`;
  }
}

function refreshFeeds(query = '') {
  if (document.getElementById('photo-grid')) {
    loadFeed(query);
  }
  if (document.getElementById('dashboard-photo-grid')) {
    loadFeed(query, { containerId: 'dashboard-photo-grid', emptyMessage: 'No posts yet.' });
  }
}

function bindCardLikeButtons(container) {
  container.querySelectorAll('.card-like-btn').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const token = getToken();
      if (!token) {
        window.location.href = 'login.html';
        return;
      }
      const photoId = button.dataset.photoId;
      try {
        button.disabled = true;
        const res = await fetchWithAuth(`/photos/${photoId}/like`, { method: 'POST' });
        if (!res.ok) {
          const message = (await res.json())?.message || 'Unable to toggle like';
          throw new Error(message);
        }
        const updated = await res.json();
        const userId = localStorage.getItem('photoshare_user_id');
        const liked = Array.isArray(updated.likes) && userId
          ? updated.likes.includes(userId)
          : false;
        button.classList.toggle('liked', liked);
        button.dataset.liked = String(liked);
        const countEl = button.querySelector('.like-count');
        if (countEl) countEl.textContent = updated.likes.length;
      } catch (error) {
        alert(error.message);
      } finally {
        button.disabled = false;
      }
    });
  });
}

async function loadPhotoDetail() {
  const image = document.getElementById('photo-image');
  if (!image) return;

  const params = new URLSearchParams(window.location.search);
  const photoId = params.get('id');
  if (!photoId) {
    window.location.href = 'index.html';
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/photos/${photoId}`);
    if (!res.ok) throw new Error('Failed to load photo');
    const photo = await res.json();

    image.src = photo.imageUrl;
    image.alt = photo.title || 'Photo';
    document.getElementById('photo-title').textContent = photo.title || 'Untitled';
    document.getElementById('photo-caption').textContent = photo.caption || '';
    document.getElementById('photo-location').innerHTML = photo.location
      ? `Shot in ${escapeHtml(photo.location)}`
      : '';
    document.getElementById('photo-creator').innerHTML = photo.creator?._id
      ? `By <a href="profile.html?id=${encodeURIComponent(photo.creator._id)}">${escapeHtml(
          photo.creator.name,
        )}</a>`
      : escapeHtml(photo.creator?.name || '');

    const peopleContainer = document.getElementById('photo-people');
    peopleContainer.innerHTML = '';
    if (Array.isArray(photo.people) && photo.people.length > 0) {
      photo.people.forEach((person) => {
        const personId = person.userId || person.user?._id || person.user?.id;
        const name = person.name || person.user?.name;
        if (!name) return;
        const link = document.createElement(personId ? 'a' : 'span');
        link.className = 'tag link';
        link.textContent = name;
        if (personId) {
          link.href = `profile.html?id=${encodeURIComponent(personId)}`;
        }
        peopleContainer.appendChild(link);
      });
    }

    updateLikeState(photo);
    renderComments(photo.comments || []);
    bindLikeButton(photoId);
    bindCommentForm(photoId);
  } catch (error) {
    const meta = document.querySelector('.photo-meta');
    if (meta) {
      meta.innerHTML = `<p class="empty-state">Unable to load photo. ${error.message}</p>`;
    }
  }
}

function updateLikeState(photo) {
  const likeBtn = document.getElementById('like-btn');
  const likeCount = document.getElementById('like-count');
  if (!likeBtn || !likeCount) return;

  const userId = localStorage.getItem('photoshare_user_id');
  const likes = Array.isArray(photo.likes) ? photo.likes : [];
  const liked = userId ? likes.includes(userId) : false;

  likeBtn.classList.toggle('liked', liked);
  likeCount.textContent = likes.length;
  likeBtn.dataset.photoId = photo._id;
}

function renderComments(comments) {
  const list = document.getElementById('comment-list');
  if (!list) return;

  if (!Array.isArray(comments) || comments.length === 0) {
    list.innerHTML = '<p class="empty-state">No comments yet.</p>';
    return;
  }

  list.innerHTML = comments
    .map((comment) => {
      const authorName = comment.user?.name || comment.userName || 'Anonymous';
      const authorId = comment.user?._id || comment.user?.id;
      const authorMarkup = authorId
        ? `<a href="profile.html?id=${encodeURIComponent(authorId)}">${escapeHtml(authorName)}</a>`
        : escapeHtml(authorName);
      const avatarUrl = comment.user?.avatarUrl || DEFAULT_AVATAR;
      const date = comment.createdAt ? new Date(comment.createdAt).toLocaleString() : '';
      return `
        <div class="comment">
          <div class="comment-avatar">
            <img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(authorName)}" />
          </div>
          <div class="comment-body">
            <p class="author">${authorMarkup}</p>
            <p>${escapeHtml(comment.text)}</p>
            <p class="muted small">${date}</p>
          </div>
        </div>
      `;
    })
    .join('');
}

function bindLikeButton(photoId) {
  const likeBtn = document.getElementById('like-btn');
  if (!likeBtn) return;

  const role = getUserRole();
  const token = getToken();
  const callout = document.getElementById('comment-login-callout');
  const commentForm = document.getElementById('comment-form');

  const canInteract = Boolean(token) && (role === 'consumer' || role === 'creator');

  likeBtn.disabled = !canInteract;
  if (commentForm) commentForm.classList.toggle('hidden', !canInteract);
  if (callout) callout.classList.toggle('hidden', canInteract);

  likeBtn.addEventListener('click', async () => {
    if (!canInteract) return;
    try {
      likeBtn.disabled = true;
      const res = await fetchWithAuth(`/photos/${photoId}/like`, { method: 'POST' });
      if (!res.ok) throw new Error('Unable to toggle like');
      const updated = await res.json();
      updateLikeState(updated);
    } catch (error) {
      alert(error.message);
    } finally {
      likeBtn.disabled = false;
    }
  });
}

function bindCommentForm(photoId) {
  const form = document.getElementById('comment-form');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const textarea = document.getElementById('comment-input');
    const text = textarea.value.trim();
    if (!text) return;

    try {
      textarea.disabled = true;
      const res = await fetchWithAuth(`/photos/${photoId}/comment`, {
        method: 'POST',
        body: { text },
      });
      if (!res.ok) throw new Error('Unable to post comment');
      const updated = await res.json();
      textarea.value = '';
      renderComments(updated.comments || []);
    } catch (error) {
      alert(error.message);
    } finally {
      textarea.disabled = false;
    }
  });
}

function bindLoginForm() {
  const form = document.getElementById('login-form');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');

    try {
      errorEl.classList.add('hidden');
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        let message = 'Invalid credentials';
        try {
          const payload = await res.json();
          if (payload?.message) {
            message = payload.message;
          }
        } catch (parseError) {
          // Ignore JSON parse errors here and fall back to default message
        }
        throw new Error(message);
      }
      let data;
      try {
        data = await res.json();
      } catch (parseError) {
        throw new Error('Unexpected response from server');
      }
      setToken(data.token);
      setUserRole(data.user.role);
      setUserName(data.user.name);
      localStorage.setItem('photoshare_user_id', data.user.id || data.user._id);
      currentUser = data.user;

      updateNavigationVisibility();

      window.location.href = 'index.html';
    } catch (error) {
      errorEl.textContent = error.message;
      errorEl.classList.remove('hidden');
    }
  });
}

function bindSignupForm() {
  const form = document.getElementById('signup-form');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const errorEl = document.getElementById('signup-error');

    try {
      errorEl.classList.add('hidden');
      const res = await fetch(`${API_BASE}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      if (!res.ok) {
        const message = (await res.json())?.message || 'Unable to sign up';
        throw new Error(message);
      }
      window.location.href = 'login.html';
    } catch (error) {
      errorEl.textContent = error.message;
      errorEl.classList.remove('hidden');
    }
  });
}

function ensureCreatorAccess() {
  const role = getUserRole();
  const token = getToken();
  if (!token || role !== 'creator') {
    window.location.href = 'login.html';
  }
}

async function loadCreatorDashboard() {
  ensureCreatorAccess();
  const nameEl = document.getElementById('creator-name');
  const gallery = document.getElementById('creator-gallery');
  const badge = document.getElementById('upload-count');

  if (nameEl) {
    nameEl.textContent = getUserName() || 'Creator';
  }

  try {
    gallery.innerHTML = '<p class="empty-state">Loading your uploads...</p>';
    const res = await fetchWithAuth('/photos');
    if (!res.ok) throw new Error('Unable to load uploads');
    const photos = await res.json();
    const userId = localStorage.getItem('photoshare_user_id');
    const myPhotos = photos.filter((photo) => {
      const creatorId =
        photo.creatorId ||
        photo.creator?._id ||
        photo.creatorId?.toString?.() ||
        null;
      return creatorId === userId;
    });

    badge.textContent = myPhotos.length;
    renderPhotoGrid(gallery, myPhotos, { emptyMessage: 'No uploads yet.' });
  } catch (error) {
    gallery.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}

function bindUploadForm() {
  const form = document.getElementById('upload-form');
  if (!form) return;

  const locationAutocomplete = setupLocationAutocomplete(
    document.getElementById('upload-location'),
    document.getElementById('upload-location-suggestions'),
  );
  const peopleSelector = setupPeopleSelector({
    inputEl: document.getElementById('upload-people'),
    suggestionsEl: document.getElementById('upload-people-suggestions'),
    containerEl: document.getElementById('upload-selected-people'),
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const feedback = document.getElementById('upload-feedback');
    const submitBtn = form.querySelector('button[type="submit"]');

    const fileInput = document.getElementById('upload-photo');
    if (!fileInput.files.length) {
      feedback.textContent = 'Please select a photo.';
      return;
    }

    try {
      feedback.textContent = '';
      submitBtn.disabled = true;
      const imageUrl = await uploadImageFile(fileInput.files[0]);

      await createPhotoRecord({
        title: document.getElementById('upload-title').value.trim(),
        caption: document.getElementById('upload-caption').value.trim(),
        location: locationAutocomplete ? locationAutocomplete.getValue() : '',
        people: peopleSelector ? peopleSelector.getSelectedIds() : [],
        imageUrl,
      });

      form.reset();
      locationAutocomplete?.reset();
      peopleSelector?.reset();
      feedback.textContent = 'Photo published successfully.';
      loadCreatorDashboard();
      refreshFeeds();
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function bindSearch() {
  const input = document.getElementById('search-input');
  if (!input) return;
  let debounceHandle;
  input.addEventListener('input', () => {
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => {
      const value = input.value.trim();
      const hasMainFeed = Boolean(document.getElementById('photo-grid'));
      const hasDashboardFeed = Boolean(document.getElementById('dashboard-photo-grid'));

      if (!hasMainFeed && !hasDashboardFeed) {
        if (value.length > 0) {
          window.location.href = `index.html?q=${encodeURIComponent(value)}`;
        } else {
          window.location.href = 'index.html';
        }
        return;
      }

      refreshFeeds(value);
    }, 300);
  });
}

function bindLogoutButtons() {
  document.querySelectorAll('#logout-btn').forEach((btn) => {
    btn.addEventListener('click', logout);
  });
}

function bindCreatePostModal() {
  const modal = document.getElementById('create-post-modal');
  const form = document.getElementById('create-post-form');
  const closeBtn = document.getElementById('create-post-close');
  const cancelBtn = document.getElementById('create-post-cancel');
  const feedback = document.getElementById('create-post-feedback');
  const triggers = Array.from(document.querySelectorAll('[data-action="open-create-modal"]'));

  if (!modal || !form || triggers.length === 0) return;

  const submitBtn = form.querySelector('button[type="submit"]');
  const fileInput = document.getElementById('create-photo');
  const locationAutocomplete = setupLocationAutocomplete(
    document.getElementById('create-location'),
    document.getElementById('location-suggestions'),
  );
  const peopleSelector = setupPeopleSelector({
    inputEl: document.getElementById('create-people'),
    suggestionsEl: document.getElementById('people-suggestions'),
    containerEl: document.getElementById('selected-people'),
  });

  const resetForm = () => {
    feedback.textContent = '';
    form.reset();
    if (submitBtn) submitBtn.disabled = false;
    if (fileInput) fileInput.value = '';
    locationAutocomplete?.reset();
    peopleSelector?.reset();
  };

  const closeModal = () => {
    modal.classList.add('hidden');
    document.body.classList.remove('modal-open');
    resetForm();
  };

  const openModal = () => {
    if (getUserRole() !== 'creator') {
      return;
    }
    feedback.textContent = '';
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
  };

  triggers.forEach((trigger) => {
    trigger.addEventListener('click', openModal);
  });

  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!fileInput || !fileInput.files.length) {
      feedback.textContent = 'Please select a photo.';
      return;
    }

    try {
      feedback.textContent = '';
      if (submitBtn) submitBtn.disabled = true;

      const imageUrl = await uploadImageFile(fileInput.files[0]);
      await createPhotoRecord({
        title: document.getElementById('create-title').value.trim(),
        caption: document.getElementById('create-caption').value.trim(),
        location: locationAutocomplete ? locationAutocomplete.getValue() : '',
        people: peopleSelector ? peopleSelector.getSelectedIds() : [],
        imageUrl,
      });

      closeModal();
      const searchInput = document.getElementById('search-input');
      const currentQuery = searchInput ? searchInput.value.trim() : '';
      refreshFeeds(currentQuery);
      if (document.body.dataset.page === 'creator-dashboard') {
        loadCreatorDashboard();
      }
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

async function updateProfileAvatar(file) {
  const formData = new FormData();
  formData.append('avatar', file);

  const res = await fetchWithAuth('/users/me', {
    method: 'PATCH',
    body: formData,
  });

  let payload;
  try {
    payload = await res.json();
  } catch (error) {
    throw new Error('Unexpected response from server');
  }

  if (!res.ok) {
    throw new Error(payload?.message || 'Unable to update profile');
  }

  if (currentUser && (currentUser.id === payload.id || currentUser._id === payload.id)) {
    currentUser = { ...currentUser, ...payload };
  }

  return payload;
}

async function loadProfilePage() {
  const grid = document.getElementById('profile-photo-grid');
  const nameEl = document.getElementById('profile-name');
  const roleEl = document.getElementById('profile-role');
  const emailEl = document.getElementById('profile-email');
  const joinedEl = document.getElementById('profile-joined');
  const avatarEl = document.getElementById('profile-avatar');
  const postCountEl = document.getElementById('profile-post-count');
  const avatarInput = document.getElementById('avatar-input');
  const avatarUpload = document.querySelector('.avatar-upload');

  if (!grid) return;

  const params = new URLSearchParams(window.location.search);
  let profileId = params.get('id');
  const viewerId = currentUser?.id || currentUser?._id;
  if (!profileId && viewerId) {
    profileId = viewerId;
  }

  if (!profileId) {
    window.location.href = 'login.html';
    return;
  }

  try {
    grid.innerHTML = '<p class="empty-state">Loading profile...</p>';
    const res = await fetchWithAuth(`/users/${profileId}`);
    let data;
    try {
      data = await res.json();
    } catch (error) {
      throw new Error('Unexpected response from server');
    }
    if (!res.ok) {
      throw new Error(data?.message || 'Unable to load profile');
    }

    if (nameEl) nameEl.textContent = data.name || 'User';
    if (roleEl) {
      const roleLabel = data.role ? `${data.role.charAt(0).toUpperCase()}${data.role.slice(1)}` : 'Member';
      roleEl.textContent = `Role: ${roleLabel}`;
    }
    if (emailEl) emailEl.textContent = data.email || '';
    if (joinedEl && data.createdAt) {
      joinedEl.textContent = `Joined ${new Date(data.createdAt).toLocaleDateString()}`;
    }
    if (avatarEl) {
      avatarEl.src = data.avatarUrl || 'https://placehold.co/160x160?text=Photo';
      avatarEl.alt = `${data.name || 'User'} avatar`;
    }
    if (postCountEl) postCountEl.textContent = data.photos?.length || 0;

    const feedSection = document.getElementById('profile-feed-section');
    if (data.role !== 'creator') {
      if (feedSection) feedSection.classList.add('hidden');
    } else {
      feedSection?.classList.remove('hidden');
      renderPhotoGrid(grid, data.photos || [], { emptyMessage: 'No posts yet.' });
    }

    const isSelf = viewerId && (viewerId === data.id || viewerId === data._id);
    if (avatarInput) {
      if (!isSelf) {
        if (avatarUpload) avatarUpload.classList.add('hidden');
        avatarInput.disabled = true;
      } else {
        avatarInput.addEventListener('change', async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          try {
            avatarInput.disabled = true;
            const updated = await updateProfileAvatar(file);
            if (avatarEl && updated.avatarUrl) {
              avatarEl.src = updated.avatarUrl;
            }
            if (nameEl && updated.name) {
              nameEl.textContent = updated.name;
            }
          } catch (error) {
            alert(error.message);
          } finally {
            avatarInput.value = '';
            avatarInput.disabled = false;
          }
        });
      }
    }
  } catch (error) {
    grid.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}

async function hydrateSession() {
  try {
    const token = getToken();
    if (!token) {
      return null;
    }

    const res = await fetchWithAuth('/auth/me', { cache: 'no-store' });
    if (!res.ok) throw new Error('Session expired');
    const data = await res.json();
    setUserRole(data.role);
    setUserName(data.name);
    localStorage.setItem('photoshare_user_id', data.id || data._id);
    currentUser = data;
    return data;
  } catch (error) {
    console.warn(error.message);
    logout();
    currentUser = null;
    return null;
  }
}

async function init() {
  document.getElementById('year')?.append(new Date().getFullYear());
  bindLogoutButtons();
  updateNavigationVisibility();

  const me = await hydrateSession();
  updateNavigationVisibility();

  const page = document.body.dataset.page;
  const token = getToken();
  if (!token && page !== 'login' && page !== 'signup') {
    window.location.href = 'login.html';
    return;
  }
  if (token && (page === 'login' || page === 'signup')) {
    window.location.href = 'index.html';
    return;
  }

  switch (page) {
    case 'feed': {
      bindSearch();
      bindCreatePostModal();
      const params = new URLSearchParams(window.location.search);
      const initialQuery = params.get('q')?.trim() || '';
      if (initialQuery) {
        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.value = initialQuery;
      }
      loadFeed(initialQuery);
      break;
    }
    case 'photo-detail':
      bindSearch();
      bindCreatePostModal();
      loadPhotoDetail();
      break;
    case 'login':
      bindLoginForm();
      break;
    case 'signup':
      bindSignupForm();
      break;
    case 'creator-dashboard': {
      bindSearch();
      loadCreatorDashboard();
      bindUploadForm();
      bindCreatePostModal();
      const params = new URLSearchParams(window.location.search);
      const initialQuery = params.get('q')?.trim() || '';
      if (initialQuery) {
        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.value = initialQuery;
      }
      refreshFeeds(initialQuery);
      document.getElementById('dashboard-refresh')?.addEventListener('click', () => {
        const searchInput = document.getElementById('search-input');
        const value = searchInput ? searchInput.value.trim() : '';
        refreshFeeds(value);
      });
      break;
    }
    case 'profile':
      bindSearch();
      bindCreatePostModal();
      loadProfilePage();
      break;
    default:
      break;
  }
}

document.addEventListener('DOMContentLoaded', init);

