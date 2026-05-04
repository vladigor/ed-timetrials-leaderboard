import { esc } from './utils.js';

// ── State ──────────────────────────────────────────────────────────────────
let allCreators = [];
let sortBy = 'total';
let sortDir = 'desc';

const SORT_DEFAULTS = {
  creator: 'asc',
  total: 'desc',
  ship: 'desc',
  fighter: 'desc',
  srv: 'desc',
  onfoot: 'desc'
};

// ── DOM refs ───────────────────────────────────────────────────────────────
const countLabel = document.getElementById('creator-count');
const tableContainer = document.getElementById('creators-table-container');

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  await loadCreators();

  tableContainer.addEventListener('click', (e) => {
    const th = e.target.closest('.th-sortable');
    if (th) {
      const col = th.dataset.sort;
      if (sortBy === col) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortBy = col;
        sortDir = SORT_DEFAULTS[col] ?? 'desc';
      }
      renderTable();
    }
  });
}

// ── Data loading ───────────────────────────────────────────────────────────
async function loadCreators() {
  try {
    const data = await fetch('/api/creators').then(r => r.json());
    allCreators = data;
    renderTable();
  } catch (err) {
    tableContainer.innerHTML = `<p class="empty-state">Could not load creators. Please try again later.</p>`;
  }
}

// ── Render ─────────────────────────────────────────────────────────────────
function renderTable() {
  let creators = allCreators.slice();

  // Sort
  creators.sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case 'creator':
        cmp = a.creator.localeCompare(b.creator);
        break;
      case 'total':
        cmp = a.total - b.total;
        break;
      case 'ship':
        cmp = a.ship - b.ship;
        break;
      case 'fighter':
        cmp = a.fighter - b.fighter;
        break;
      case 'srv':
        cmp = a.srv - b.srv;
        break;
      case 'onfoot':
        cmp = a.onfoot - b.onfoot;
        break;
    }
    return sortDir === 'desc' ? -cmp : cmp;
  });

  countLabel.textContent = `${creators.length} race creator${creators.length !== 1 ? 's' : ''}`;

  if (creators.length === 0) {
    tableContainer.innerHTML = '<p class="empty-state">No creators found.</p>';
    return;
  }

  const rows = creators.map((c) => renderRow(c)).join('');

  tableContainer.innerHTML = `
    <table class="results-table" style="width: 100%">
      <thead>
        <tr>
          ${thSort('creator', 'Creator')}
          ${thSort('total', 'Total Races', 'num')}
          ${thSort('ship', 'Ship', 'num')}
          ${thSort('fighter', 'Fighter', 'num')}
          ${thSort('srv', 'SRV', 'num')}
          ${thSort('onfoot', 'On Foot', 'num')}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function thSort(col, label, extraClass = '') {
  const isActive = sortBy === col;
  const indicator = isActive ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
  const cls = ['th-sortable', isActive ? 'th-active' : '', extraClass].filter(Boolean).join(' ');
  const style = extraClass.includes('num') ? ' style="text-align: center;"' : '';
  return `<th class="${cls}" data-sort="${col}"${style}>${label}${indicator}</th>`;
}

function renderRow(c) {
  return `
    <tr>
      <td><a href="/creator/${encodeURIComponent(c.creator)}">${esc(c.creator)}</a></td>
      <td class="num" style="text-align: center;">${c.total}</td>
      <td class="num" style="text-align: center;">${c.ship || 0}</td>
      <td class="num" style="text-align: center;">${c.fighter || 0}</td>
      <td class="num" style="text-align: center;">${c.srv || 0}</td>
      <td class="num" style="text-align: center;">${c.onfoot || 0}</td>
    </tr>
  `;
}

init();
