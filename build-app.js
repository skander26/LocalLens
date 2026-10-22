// build-app.js  — run once: node build-app.js
const fs   = require('fs');
const data = JSON.parse(fs.readFileSync('./_data.json', 'utf8'));
const arr  = JSON.stringify(data, null, 0)
               .replace(/^\[/, '[\n  ')
               .replace(/\]$/, '\n]')
               .replace(/},{/g, '},\n  {');

const js = `/* ═══════════════════════════════════════
   SNAP VAULT — app.js
   ═══════════════════════════════════════ */

// ── 1. MEDIA DATABASE ──────────────────────────────────────────────────────────
const ALL_MEDIA = ${arr};

// ── 2. STATE ──────────────────────────────────────────────────────────────────
let filtered     = [];
let currentIdx   = 0;
let activeFilter = 'all';
let activeSort   = 'newest';
let searchQuery  = '';

// ── 3. HELPERS ────────────────────────────────────────────────────────────────
function parseDate(name) {
  const m = name.match(/^(\\d{4}-\\d{2}-\\d{2})/);
  return m ? m[1] : '0000-00-00';
}

function formatDateLabel(d) {
  const parts  = d.split('-');
  const y      = parts[0];
  const mo     = parseInt(parts[1], 10);
  const day    = parseInt(parts[2], 10);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return day + ' ' + months[mo - 1] + ' ' + y;
}

function formatBytes(b) {
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── 4. FILTER + SORT ──────────────────────────────────────────────────────────
function applyFilters() {
  filtered = ALL_MEDIA.filter(function(m) {
    if (activeFilter !== 'all' && m.type !== activeFilter) return false;
    if (searchQuery && m.name.toLowerCase().indexOf(searchQuery) === -1) return false;
    return true;
  });

  if (activeSort === 'newest') {
    filtered.sort(function(a, b) { return b.name.localeCompare(a.name); });
  } else {
    filtered.sort(function(a, b) { return a.name.localeCompare(b.name); });
  }

  renderGallery();
}

// ── 5. RENDER GALLERY ─────────────────────────────────────────────────────────
function renderGallery() {
  var gallery = document.getElementById('gallery');
  var empty   = document.getElementById('emptyState');
  var stats   = document.getElementById('statsText');

  gallery.innerHTML = '';

  if (filtered.length === 0) {
    empty.classList.remove('hidden');
    stats.textContent = '0 items';
    return;
  }
  empty.classList.add('hidden');

  var videos = filtered.filter(function(m) { return m.type === 'video'; }).length;
  var images = filtered.filter(function(m) { return m.type === 'image'; }).length;
  stats.textContent = filtered.length + ' items  \u2022  \uD83C\uDFAC ' + videos + ' videos  \u2022  \uD83D\uDDBC\uFE0F ' + images + ' photos';

  // Group by date
  var groups   = {};
  var groupOrder = [];
  filtered.forEach(function(m, idx) {
    var d = parseDate(m.name);
    if (!groups[d]) { groups[d] = []; groupOrder.push(d); }
    groups[d].push({ name: m.name, size: m.size, type: m.type, filteredIdx: idx });
  });

  groupOrder.forEach(function(date) {
    var items  = groups[date];
    var groupEl = document.createElement('div');
    groupEl.className = 'date-group';

    var header = document.createElement('div');
    header.className = 'date-group-header';
    var h2 = document.createElement('h2');
    h2.textContent = formatDateLabel(date);
    var count = document.createElement('span');
    count.className = 'date-group-count';
    count.textContent = items.length;
    header.appendChild(h2);
    header.appendChild(count);

    var grid = document.createElement('div');
    grid.className = 'media-grid';

    items.forEach(function(item) {
      grid.appendChild(buildCard(item));
    });

    groupEl.appendChild(header);
    groupEl.appendChild(grid);
    gallery.appendChild(groupEl);
  });
}

// ── 6. BUILD CARD ─────────────────────────────────────────────────────────────
function buildCard(item) {
  var card = document.createElement('div');
  card.className = 'card';
  card.tabIndex = 0;
  card.title = item.name;
  card.setAttribute('data-idx', item.filteredIdx);

  if (item.type === 'image') {
    var img = document.createElement('img');
    img.className = 'card-thumb';
    img.loading = 'lazy';
    img.alt = item.name;
    img.src = item.name;
    img.onerror = function() { img.style.background = '#252535'; };
    card.appendChild(img);

    var badge = document.createElement('span');
    badge.className = 'photo-badge';
    badge.textContent = '\uD83D\uDCF7';
    card.appendChild(badge);
  } else {
    var canvas = document.createElement('canvas');
    canvas.className = 'card-canvas';
    canvas.width  = 180;
    canvas.height = 320;
    card.appendChild(canvas);

    var play = document.createElement('div');
    play.className = 'play-badge';
    play.innerHTML = '\u25B6 Video';
    card.appendChild(play);

    // Lazy capture first frame
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(e) {
        if (e.isIntersecting) {
          captureFrame(item.name, canvas);
          observer.disconnect();
        }
      });
    }, { rootMargin: '300px' });
    observer.observe(card);
  }

  var label = document.createElement('div');
  label.className = 'card-label';
  label.textContent = formatBytes(item.size);
  card.appendChild(label);

  card.addEventListener('click', function() { openLightbox(item.filteredIdx); });
  card.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ') openLightbox(item.filteredIdx);
  });

  return card;
}

// ── 7. VIDEO FRAME CAPTURE ────────────────────────────────────────────────────
var frameCache = {};

function captureFrame(filename, canvas) {
  if (frameCache[filename]) {
    canvas.getContext('2d').drawImage(frameCache[filename], 0, 0, canvas.width, canvas.height);
    return;
  }

  var vid = document.createElement('video');
  vid.src         = filename;
  vid.muted       = true;
  vid.preload     = 'metadata';
  vid.crossOrigin = 'anonymous';
  vid.playsInline = true;

  vid.addEventListener('loadedmetadata', function() {
    vid.currentTime = Math.min(0.5, vid.duration * 0.1);
  });

  vid.addEventListener('seeked', function() {
    var ctx = canvas.getContext('2d');
    ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
    var off = document.createElement('canvas');
    off.width  = canvas.width;
    off.height = canvas.height;
    off.getContext('2d').drawImage(vid, 0, 0, off.width, off.height);
    frameCache[filename] = off;
    vid.removeAttribute('src');
  });

  // Fallback placeholder after 3 s
  setTimeout(function() {
    if (!frameCache[filename]) {
      var ctx  = canvas.getContext('2d');
      var grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      grad.addColorStop(0, '#1e1e2a');
      grad.addColorStop(1, '#16161f');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(168,85,247,0.5)';
      ctx.font = '40px serif';
      ctx.textAlign = 'center';
      ctx.fillText('\uD83C\uDFAC', canvas.width / 2, canvas.height / 2);
    }
  }, 3000);
}

// ── 8. LIGHTBOX ───────────────────────────────────────────────────────────────
function openLightbox(idx) {
  currentIdx = idx;
  showLightboxItem();
  document.getElementById('lightbox').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  var lb  = document.getElementById('lightbox');
  var vid = lb.querySelector('video');
  if (vid) { vid.pause(); vid.removeAttribute('src'); }
  lb.classList.add('hidden');
  document.body.style.overflow = '';
}

function showLightboxItem() {
  var item  = filtered[currentIdx];
  if (!item) return;
  var media = document.getElementById('lbMedia');
  media.innerHTML = '';

  if (item.type === 'image') {
    var img = document.createElement('img');
    img.src = item.name;
    img.alt = item.name;
    media.appendChild(img);
  } else {
    var vid = document.createElement('video');
    vid.src        = item.name;
    vid.controls   = true;
    vid.autoplay   = true;
    vid.playsInline = true;
    media.appendChild(vid);
  }

  document.getElementById('lbTitle').textContent = item.name;
  document.getElementById('lbDate').textContent  = '\uD83D\uDCC5 ' + formatDateLabel(parseDate(item.name));
  document.getElementById('lbSize').textContent  = '\uD83D\uDCBE ' + formatBytes(item.size);
  var dl = document.getElementById('lbDownload');
  dl.href     = item.name;
  dl.download = item.name;

  document.getElementById('lbPrev').disabled = (currentIdx === 0);
  document.getElementById('lbNext').disabled = (currentIdx === filtered.length - 1);
}

// ── 9. EVENT LISTENERS ────────────────────────────────────────────────────────
document.getElementById('lbClose').addEventListener('click', closeLightbox);

document.getElementById('lbPrev').addEventListener('click', function() {
  if (currentIdx > 0) { currentIdx--; showLightboxItem(); }
});

document.getElementById('lbNext').addEventListener('click', function() {
  if (currentIdx < filtered.length - 1) { currentIdx++; showLightboxItem(); }
});

document.getElementById('lightbox').addEventListener('click', function(e) {
  if (e.target === document.getElementById('lightbox')) closeLightbox();
});

document.addEventListener('keydown', function(e) {
  if (document.getElementById('lightbox').classList.contains('hidden')) return;
  if (e.key === 'Escape')      closeLightbox();
  if (e.key === 'ArrowLeft'  && currentIdx > 0)                    { currentIdx--; showLightboxItem(); }
  if (e.key === 'ArrowRight' && currentIdx < filtered.length - 1)  { currentIdx++; showLightboxItem(); }
});

// Filter tabs
document.querySelectorAll('.tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
    tab.classList.add('active');
    activeFilter = tab.dataset.filter;
    applyFilters();
  });
});

// Sort
document.getElementById('sortSelect').addEventListener('change', function(e) {
  activeSort = e.target.value;
  applyFilters();
});

// Search
var searchTimer;
document.getElementById('searchInput').addEventListener('input', function(e) {
  clearTimeout(searchTimer);
  var val = e.target.value;
  searchTimer = setTimeout(function() {
    searchQuery = val.trim().toLowerCase();
    applyFilters();
  }, 250);
});

document.getElementById('clearSearch').addEventListener('click', function() {
  document.getElementById('searchInput').value = '';
  searchQuery = '';
  applyFilters();
});

// Scroll to top
var scrollBtn = document.getElementById('scrollTop');
window.addEventListener('scroll', function() {
  scrollBtn.classList.toggle('hidden', window.scrollY < 400);
});
scrollBtn.addEventListener('click', function() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ── 10. BOOT ──────────────────────────────────────────────────────────────────
applyFilters();
`;

fs.writeFileSync('./app.js', js, 'utf8');
console.log('app.js written OK');
