/**
 * LocalLens — Local Gallery Viewer
 * General-purpose media viewer with folder picker, smart covers, and rich filters.
 */

(() => {
  'use strict';

  // ══════════════════════════════════════════════
  // CONSTANTS & HELPERS
  // ══════════════════════════════════════════════
  const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv']);
  const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'svg', 'bmp']);
  const ALL_MEDIA_EXTS = new Set([...VIDEO_EXTS, ...IMAGE_EXTS]);

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  function getExtension(filename) {
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function parseDate(filename, lastModified) {
    // Try matching YYYY-MM-DD or YYYYMMDD in filename
    const dashMatch = filename.match(/(20\d\d)[-_](0[1-9]|1[0-2])[-_](0[1-9]|[12]\d|3[01])/);
    if (dashMatch) {
      return {
        dateStr: `${dashMatch[1]}-${dashMatch[2]}-${dashMatch[3]}`,
        yearMonth: `${dashMatch[1]}-${dashMatch[2]}`,
        timestamp: new Date(`${dashMatch[1]}-${dashMatch[2]}-${dashMatch[3]}`).getTime()
      };
    }
    const compactMatch = filename.match(/(20\d\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/);
    if (compactMatch) {
      return {
        dateStr: `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`,
        yearMonth: `${compactMatch[1]}-${compactMatch[2]}`,
        timestamp: new Date(`${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`).getTime()
      };
    }
    // Fallback to lastModified date
    const d = new Date(lastModified || Date.now());
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return {
      dateStr: `${y}-${m}-${day}`,
      yearMonth: `${y}-${m}`,
      timestamp: d.getTime()
    };
  }

  function formatDateGroupTitle(dateStr) {
    const [y, m, d] = dateStr.split('-');
    const month = MONTH_NAMES[parseInt(m, 10) - 1] || m;
    return `${month} ${parseInt(d, 10)}, ${y}`;
  }

  // ══════════════════════════════════════════════
  // APPLICATION STATE
  // ══════════════════════════════════════════════
  const state = {
    folderName: '',
    allMedia: [],
    filteredMedia: [],
    lightboxIndex: -1,
    filters: {
      type: 'all',
      dateFrom: '',
      dateTo: '',
      minSize: 0,
      ext: '',
      query: '',
      sort: 'newest'
    },
    // Cache for generated video thumbnails
    thumbnailCache: new Map()
  };

  // ══════════════════════════════════════════════
  // DOM REFERENCES
  // ══════════════════════════════════════════════
  const dom = {
    landing: document.getElementById('landing'),
    app: document.getElementById('app'),
    pickFolder: document.getElementById('pickFolder'),
    pickFolderAgain: document.getElementById('pickFolderAgain'),
    changeFolderBtn: document.getElementById('changeFolderBtn'),
    folderName: document.getElementById('folderName'),
    searchInput: document.getElementById('searchInput'),
    clearSearch: document.getElementById('clearSearch'),
    toggleFilters: document.getElementById('toggleFilters'),
    filterBar: document.getElementById('filterBar'),
    typeFilter: document.getElementById('typeFilter'),
    dateFrom: document.getElementById('dateFrom'),
    dateTo: document.getElementById('dateTo'),
    sizeFilter: document.getElementById('sizeFilter'),
    extFilter: document.getElementById('extFilter'),
    sortSelect: document.getElementById('sortSelect'),
    resetFilters: document.getElementById('resetFilters'),
    resetFiltersEmpty: document.getElementById('resetFiltersEmpty'),
    statsText: document.getElementById('statsText'),
    loadingSpinner: document.getElementById('loadingSpinner'),
    gallery: document.getElementById('gallery'),
    emptyState: document.getElementById('emptyState'),
    scrollTop: document.getElementById('scrollTop'),
    lightbox: document.getElementById('lightbox'),
    lbMedia: document.getElementById('lbMedia'),
    lbTitle: document.getElementById('lbTitle'),
    lbDate: document.getElementById('lbDate'),
    lbSize: document.getElementById('lbSize'),
    lbType: document.getElementById('lbType'),
    lbCounter: document.getElementById('lbCounter'),
    lbClose: document.getElementById('lbClose'),
    lbPrev: document.getElementById('lbPrev'),
    lbNext: document.getElementById('lbNext')
  };

  // Hidden file input fallback for browsers without File System Access API
  const fileInputFallback = document.createElement('input');
  fileInputFallback.type = 'file';
  fileInputFallback.webkitdirectory = true;
  fileInputFallback.directory = true;
  fileInputFallback.multiple = true;
  fileInputFallback.style.display = 'none';
  document.body.appendChild(fileInputFallback);

  // ══════════════════════════════════════════════
  // VIDEO THUMBNAIL GENERATOR WITH CONCURRENCY POOL
  // ══════════════════════════════════════════════
  const MAX_CONCURRENT_THUMBS = 3;
  let activeThumbWorkers = 0;
  const thumbQueue = [];

  function scheduleThumbnail(item, callback) {
    if (state.thumbnailCache.has(item.id)) {
      callback(state.thumbnailCache.get(item.id));
      return;
    }
    thumbQueue.push({ item, callback });
    processThumbQueue();
  }

  function processThumbQueue() {
    if (activeThumbWorkers >= MAX_CONCURRENT_THUMBS || thumbQueue.length === 0) return;
    const { item, callback } = thumbQueue.shift();
    activeThumbWorkers++;

    createVideoCover(item.file)
      .then(thumbUrl => {
        if (thumbUrl) state.thumbnailCache.set(item.id, thumbUrl);
        callback(thumbUrl);
      })
      .catch(() => callback(null))
      .finally(() => {
        activeThumbWorkers--;
        processThumbQueue();
      });
  }

  function createVideoCover(file) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      const url = URL.createObjectURL(file);
      video.src = url;

      let timeoutId = setTimeout(() => {
        cleanup();
        resolve(null);
      }, 4000);

      function cleanup() {
        clearTimeout(timeoutId);
        video.onloadedmetadata = null;
        video.onseeked = null;
        video.onerror = null;
        URL.revokeObjectURL(url);
      }

      video.onloadedmetadata = () => {
        // Seek to 0.5s or 15% of duration
        const targetTime = Math.min(0.5, (video.duration || 1) * 0.15);
        video.currentTime = targetTime;
      };

      video.onseeked = () => {
        try {
          const canvas = document.createElement('canvas');
          const maxDim = 400;
          let w = video.videoWidth || 360;
          let h = video.videoHeight || 640;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, w, h);
          const thumbUrl = canvas.toDataURL('image/jpeg', 0.72);
          cleanup();
          resolve(thumbUrl);
        } catch (e) {
          cleanup();
          resolve(null);
        }
      };

      video.onerror = () => {
        cleanup();
        resolve(null);
      };
    });
  }

  // ══════════════════════════════════════════════
  // FOLDER LOADING & PROCESSING
  // ══════════════════════════════════════════════
  async function pickDirectory() {
    if (window.showDirectoryPicker) {
      try {
        const handle = await window.showDirectoryPicker({ id: 'locallens', mode: 'read' });
        dom.loadingSpinner.classList.remove('hidden');
        dom.statsText.textContent = 'Scanning folder…';
        const files = await scanDirectoryHandle(handle);
        handleLoadedFiles(files, handle.name);
      } catch (err) {
        if (err.name === 'AbortError') return; // User cancelled dialog
        // Fallback to directory input if permission denied or unsupported
        fileInputFallback.click();
      }
    } else {
      fileInputFallback.click();
    }
  }

  async function scanDirectoryHandle(handle, depth = 0) {
    const list = [];
    if (depth > 2) return list; // Max 2 nested folders deep
    try {
      for await (const entry of handle.values()) {
        if (entry.kind === 'file') {
          const ext = getExtension(entry.name);
          if (ALL_MEDIA_EXTS.has(ext)) {
            const file = await entry.getFile();
            list.push(file);
          }
        } else if (entry.kind === 'directory') {
          const subFiles = await scanDirectoryHandle(entry, depth + 1);
          list.push(...subFiles);
        }
      }
    } catch (e) {
      console.warn('Directory scan error:', e);
    }
    return list;
  }

  fileInputFallback.addEventListener('change', (e) => {
    const files = Array.from(e.target.files).filter(f => {
      const ext = getExtension(f.name);
      return ALL_MEDIA_EXTS.has(ext);
    });
    const folderName = e.target.files[0]?.webkitRelativePath?.split('/')[0] || 'Selected Folder';
    handleLoadedFiles(files, folderName);
    fileInputFallback.value = '';
  });

  function handleLoadedFiles(files, folderName) {
    dom.loadingSpinner.classList.add('hidden');
    if (!files || files.length === 0) {
      alert('No supported image or video files found in the chosen folder.');
      return;
    }

    state.folderName = folderName;
    dom.folderName.textContent = folderName;

    // Detect Snapchat paired thumbnails (e.g. `xyz-thumbnail.jpg` for `xyz-main.mp4`)
    const thumbnailMap = new Map();
    const overlayMap = new Map();
    const mediaFiles = [];

    // First pass: identify companion files
    for (const f of files) {
      const name = f.name;
      if (name.includes('-thumbnail.') || name.includes('_thumbnail.')) {
        const baseKey = name.replace(/[-_]thumbnail\.[^.]+$/, '');
        thumbnailMap.set(baseKey, f);
      } else if (name.includes('-overlay.') || name.includes('_overlay.')) {
        const baseKey = name.replace(/[-_]overlay\.[^.]+$/, '');
        overlayMap.set(baseKey, f);
      } else {
        mediaFiles.push(f);
      }
    }

    // Process items
    state.allMedia = mediaFiles.map((f, idx) => {
      const ext = getExtension(f.name);
      const isVideo = VIDEO_EXTS.has(ext);
      const { dateStr, yearMonth, timestamp } = parseDate(f.name, f.lastModified);
      const baseKey = f.name.replace(/\.[^.]+$/, '').replace(/[-_]main$/, '');

      // Check if there is a paired thumbnail file from Snapchat exports
      let pairedThumbUrl = null;
      if (thumbnailMap.has(baseKey)) {
        pairedThumbUrl = URL.createObjectURL(thumbnailMap.get(baseKey));
      }

      return {
        id: `item-${idx}-${f.name}`,
        file: f,
        name: f.name,
        ext: ext,
        size: f.size,
        type: isVideo ? 'video' : 'image',
        dateStr: dateStr,
        yearMonth: yearMonth,
        timestamp: timestamp,
        pairedThumbUrl: pairedThumbUrl,
        blobUrl: null // Lazily created when requested
      };
    });

    // Populate extension filter pills dynamically
    updateExtensionPills();

    // Transition from Landing screen to App
    dom.landing.classList.add('hidden');
    dom.app.classList.remove('hidden');

    // Apply filters and render
    applyFilters();
  }

  function getMediaBlobUrl(item) {
    if (!item.blobUrl) {
      item.blobUrl = URL.createObjectURL(item.file);
    }
    return item.blobUrl;
  }

  function updateExtensionPills() {
    const extsInFolder = new Set(state.allMedia.map(m => m.ext));
    const defaultExts = ['mp4', 'jpg', 'png', 'mov'];
    const extsToShow = Array.from(new Set([...defaultExts, ...extsInFolder])).slice(0, 7);

    dom.extFilter.innerHTML = '<button class="pill active" data-value="">All</button>' +
      extsToShow.map(e => `<button class="pill" data-value="${e}">${e.toUpperCase()}</button>`).join('');

    // Reattach click listeners for ext pills
    dom.extFilter.querySelectorAll('.pill').forEach(btn => {
      btn.addEventListener('click', () => {
        dom.extFilter.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.filters.ext = btn.dataset.value;
        applyFilters();
      });
    });
  }

  // ══════════════════════════════════════════════
  // FILTERING & SORTING
  // ══════════════════════════════════════════════
  function applyFilters() {
    const { type, dateFrom, dateTo, minSize, ext, query, sort } = state.filters;
    const cleanQuery = query.trim().toLowerCase();

    state.filteredMedia = state.allMedia.filter(item => {
      // Type
      if (type !== 'all' && item.type !== type) return false;

      // Extension
      if (ext && item.ext !== ext.toLowerCase()) return false;

      // Min Size
      if (minSize > 0 && item.size < minSize) return false;

      // Date Range (YYYY-MM)
      if (dateFrom && item.yearMonth < dateFrom) return false;
      if (dateTo && item.yearMonth > dateTo) return false;

      // Search Query (matches filename or date)
      if (cleanQuery) {
        const matchesName = item.name.toLowerCase().includes(cleanQuery);
        const matchesDate = item.dateStr.includes(cleanQuery);
        if (!matchesName && !matchesDate) return false;
      }

      return true;
    });

    // Sort
    sortItems(state.filteredMedia, sort);

    // Update Stats
    const totalSize = state.filteredMedia.reduce((acc, cur) => acc + cur.size, 0);
    dom.statsText.textContent = `${state.filteredMedia.length} of ${state.allMedia.length} items · ${formatBytes(totalSize)}`;

    // Render Gallery
    renderGallery();
  }

  function sortItems(list, sortKey) {
    list.sort((a, b) => {
      switch (sortKey) {
        case 'newest':
          return b.timestamp - a.timestamp || b.name.localeCompare(a.name);
        case 'oldest':
          return a.timestamp - b.timestamp || a.name.localeCompare(b.name);
        case 'name_az':
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        case 'name_za':
          return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' });
        case 'size_desc':
          return b.size - a.size;
        case 'size_asc':
          return a.size - b.size;
        default:
          return b.timestamp - a.timestamp;
      }
    });
  }

  // ══════════════════════════════════════════════
  // GALLERY RENDERING & LAZY COVERS
  // ══════════════════════════════════════════════
  let cardObserver = null;

  function initObserver() {
    if (cardObserver) cardObserver.disconnect();
    cardObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const cardEl = entry.target;
          loadCardMedia(cardEl);
          cardObserver.unobserve(cardEl);
        }
      });
    }, { rootMargin: '300px' });
  }

  function renderGallery() {
    initObserver();
    dom.gallery.innerHTML = '';

    if (state.filteredMedia.length === 0) {
      dom.emptyState.classList.remove('hidden');
      return;
    }
    dom.emptyState.classList.add('hidden');

    // Check if sorted by date — if so, group by date, otherwise flat grid
    const isDateSorted = state.filters.sort === 'newest' || state.filters.sort === 'oldest';

    if (isDateSorted) {
      // Group by dateStr
      const groups = new Map();
      state.filteredMedia.forEach(item => {
        if (!groups.has(item.dateStr)) groups.set(item.dateStr, []);
        groups.get(item.dateStr).push(item);
      });

      groups.forEach((items, dateStr) => {
        const groupEl = document.createElement('section');
        groupEl.className = 'date-group';

        const headerEl = document.createElement('div');
        headerEl.className = 'date-group-header';
        headerEl.innerHTML = `
          <h2>${formatDateGroupTitle(dateStr)}</h2>
          <span class="date-group-count">${items.length} ${items.length === 1 ? 'item' : 'items'}</span>
        `;
        groupEl.appendChild(headerEl);

        const gridEl = document.createElement('div');
        gridEl.className = 'media-grid';

        items.forEach(item => {
          const card = createCardElement(item);
          gridEl.appendChild(card);
          cardObserver.observe(card);
        });

        groupEl.appendChild(gridEl);
        dom.gallery.appendChild(groupEl);
      });
    } else {
      // Flat grid
      const gridEl = document.createElement('div');
      gridEl.className = 'media-grid';

      state.filteredMedia.forEach(item => {
        const card = createCardElement(item);
        gridEl.appendChild(card);
        cardObserver.observe(card);
      });

      dom.gallery.appendChild(gridEl);
    }
  }

  function createCardElement(item) {
    const card = document.createElement('div');
    card.className = 'card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${item.type === 'video' ? 'Video' : 'Photo'} ${item.name}`);
    card.dataset.id = item.id;

    // Badges
    const badgeHtml = item.type === 'video'
      ? '<span class="play-badge">▶ Video</span>'
      : '<span class="photo-badge">🖼️ Photo</span>';

    card.innerHTML = `
      <div class="card-media-wrap" style="width:100%;height:100%;">
        <div class="skeleton" style="width:100%;height:100%;"></div>
      </div>
      ${badgeHtml}
      <span class="card-label">${escapeHtml(item.name)}</span>
      <span class="size-badge">${formatBytes(item.size)}</span>
    `;

    card.addEventListener('click', () => {
      const idx = state.filteredMedia.findIndex(m => m.id === item.id);
      if (idx !== -1) openLightbox(idx);
    });

    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const idx = state.filteredMedia.findIndex(m => m.id === item.id);
        if (idx !== -1) openLightbox(idx);
      }
    });

    return card;
  }

  function loadCardMedia(cardEl) {
    const id = cardEl.dataset.id;
    const item = state.allMedia.find(m => m.id === id);
    if (!item) return;

    const wrap = cardEl.querySelector('.card-media-wrap');
    if (!wrap) return;

    if (item.type === 'image') {
      // Directly display photo
      const img = document.createElement('img');
      img.className = 'card-thumb';
      img.loading = 'lazy';
      img.alt = item.name;
      img.src = getMediaBlobUrl(item);
      img.onload = () => {
        wrap.innerHTML = '';
        wrap.appendChild(img);
      };
    } else {
      // Video: check for paired thumbnail first
      if (item.pairedThumbUrl) {
        const img = document.createElement('img');
        img.className = 'card-thumb';
        img.alt = item.name;
        img.src = item.pairedThumbUrl;
        img.onload = () => {
          wrap.innerHTML = '';
          wrap.appendChild(img);
        };
      } else {
        // Generate frame cover with pool
        scheduleThumbnail(item, (thumbUrl) => {
          if (thumbUrl) {
            const img = document.createElement('img');
            img.className = 'card-thumb';
            img.alt = item.name;
            img.src = thumbUrl;
            wrap.innerHTML = '';
            wrap.appendChild(img);
          } else {
            // Fallback placeholder gradient
            wrap.innerHTML = '<div style="width:100%;height:100%;background:linear-gradient(135deg,#1f1f2e,#111118);display:flex;align-items:center;justify-content:center;color:#7070a0;font-size:28px;">🎬</div>';
          }
        });
      }
    }
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  // ══════════════════════════════════════════════
  // LIGHTBOX
  // ══════════════════════════════════════════════
  function openLightbox(index) {
    if (index < 0 || index >= state.filteredMedia.length) return;
    state.lightboxIndex = index;
    dom.lightbox.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    renderLightboxItem();
  }

  function closeLightbox() {
    dom.lightbox.classList.add('hidden');
    dom.lbMedia.innerHTML = '';
    document.body.style.overflow = '';
    state.lightboxIndex = -1;
  }

  function renderLightboxItem() {
    const item = state.filteredMedia[state.lightboxIndex];
    if (!item) return;

    dom.lbMedia.innerHTML = '';

    const blobUrl = getMediaBlobUrl(item);

    if (item.type === 'video') {
      const video = document.createElement('video');
      video.controls = true;
      video.autoplay = true;
      video.playsInline = true;
      video.src = blobUrl;
      dom.lbMedia.appendChild(video);
    } else {
      const img = document.createElement('img');
      img.src = blobUrl;
      img.alt = item.name;
      dom.lbMedia.appendChild(img);
    }

    dom.lbTitle.textContent = item.name;
    dom.lbDate.textContent = formatDateGroupTitle(item.dateStr);
    dom.lbSize.textContent = formatBytes(item.size);
    dom.lbType.textContent = item.type === 'video' ? '🎬 Video' : '🖼️ Photo';
    dom.lbCounter.textContent = `${state.lightboxIndex + 1} of ${state.filteredMedia.length}`;

    dom.lbPrev.disabled = state.lightboxIndex <= 0;
    dom.lbNext.disabled = state.lightboxIndex >= state.filteredMedia.length - 1;
  }

  function nextLightbox() {
    if (state.lightboxIndex < state.filteredMedia.length - 1) {
      state.lightboxIndex++;
      renderLightboxItem();
    }
  }

  function prevLightbox() {
    if (state.lightboxIndex > 0) {
      state.lightboxIndex--;
      renderLightboxItem();
    }
  }

  // ══════════════════════════════════════════════
  // EVENT LISTENERS & WIRING
  // ══════════════════════════════════════════════

  // Pick folder
  dom.pickFolder.addEventListener('click', pickDirectory);
  dom.pickFolderAgain.addEventListener('click', pickDirectory);
  dom.changeFolderBtn.addEventListener('click', pickDirectory);

  // Search
  let searchDebounce = null;
  dom.searchInput.addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.filters.query = e.target.value;
      applyFilters();
    }, 180);
  });

  dom.clearSearch.addEventListener('click', () => {
    dom.searchInput.value = '';
    state.filters.query = '';
    applyFilters();
    dom.searchInput.focus();
  });

  // Type filter pills
  dom.typeFilter.querySelectorAll('.pill').forEach(btn => {
    btn.addEventListener('click', () => {
      dom.typeFilter.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filters.type = btn.dataset.value;
      applyFilters();
    });
  });

  // Min size filter pills
  dom.sizeFilter.querySelectorAll('.pill').forEach(btn => {
    btn.addEventListener('click', () => {
      dom.sizeFilter.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filters.minSize = parseInt(btn.dataset.value, 10);
      applyFilters();
    });
  });

  // Date range filters
  dom.dateFrom.addEventListener('change', (e) => {
    state.filters.dateFrom = e.target.value;
    applyFilters();
  });
  dom.dateTo.addEventListener('change', (e) => {
    state.filters.dateTo = e.target.value;
    applyFilters();
  });

  // Sort dropdown
  dom.sortSelect.addEventListener('change', (e) => {
    state.filters.sort = e.target.value;
    applyFilters();
  });

  // Toggle filter bar
  dom.toggleFilters.addEventListener('click', () => {
    const isCollapsed = dom.filterBar.classList.toggle('collapsed');
    dom.toggleFilters.classList.toggle('active', !isCollapsed);
  });

  // Reset filters
  function resetAllFilters() {
    state.filters.type = 'all';
    state.filters.dateFrom = '';
    state.filters.dateTo = '';
    state.filters.minSize = 0;
    state.filters.ext = '';
    state.filters.query = '';
    state.filters.sort = 'newest';

    dom.searchInput.value = '';
    dom.dateFrom.value = '';
    dom.dateTo.value = '';
    dom.sortSelect.value = 'newest';

    // Reset pills
    dom.typeFilter.querySelectorAll('.pill').forEach((b, i) => b.classList.toggle('active', i === 0));
    dom.sizeFilter.querySelectorAll('.pill').forEach((b, i) => b.classList.toggle('active', i === 0));
    if (dom.extFilter) {
      dom.extFilter.querySelectorAll('.pill').forEach((b, i) => b.classList.toggle('active', i === 0));
    }

    applyFilters();
  }

  dom.resetFilters.addEventListener('click', resetAllFilters);
  dom.resetFiltersEmpty.addEventListener('click', resetAllFilters);

  // Lightbox navigation
  dom.lbClose.addEventListener('click', closeLightbox);
  dom.lbPrev.addEventListener('click', prevLightbox);
  dom.lbNext.addEventListener('click', nextLightbox);

  dom.lightbox.addEventListener('click', (e) => {
    if (e.target === dom.lightbox) closeLightbox();
  });

  // Keyboard navigation
  window.addEventListener('keydown', (e) => {
    if (dom.lightbox.classList.contains('hidden')) return;

    if (e.key === 'Escape') {
      closeLightbox();
    } else if (e.key === 'ArrowLeft') {
      prevLightbox();
    } else if (e.key === 'ArrowRight') {
      nextLightbox();
    } else if (e.key === ' ' && e.target === document.body) {
      // Toggle video play/pause
      const vid = dom.lbMedia.querySelector('video');
      if (vid) {
        e.preventDefault();
        vid.paused ? vid.play() : vid.pause();
      }
    }
  });

  // Scroll to top button
  window.addEventListener('scroll', () => {
    if (window.scrollY > 350) {
      dom.scrollTop.classList.remove('hidden');
    } else {
      dom.scrollTop.classList.add('hidden');
    }
  });

  dom.scrollTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

})();
