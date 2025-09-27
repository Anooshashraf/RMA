/* app.js
   - Uses PapaParse to fetch & parse CSV
   - Implements stacked drilldown: Regions -> Market -> DM NAME -> Type
   - Displays performance bars based on total cost per level
   - Exports CSV, PNG, PDF
*/

const sheetInput = document.getElementById('sheet-url');
const fromInput = document.getElementById('from-date');
const toInput = document.getElementById('to-date');
const applyBtn = document.getElementById('apply-filters');
const resetBtn = document.getElementById('reset-filters');
const downloadPNGBtn = document.getElementById('downloadPNG');
const downloadPDFBtn = document.getElementById('downloadPDF');
const downloadCSVBtn = document.getElementById('downloadCSV');
const summaryContainer = document.getElementById('summary-cards');
const stackedContainer = document.getElementById('stacked-container');

let RAW_DATA = []; // records parsed from CSV

/* ---------------- Util ---------------- */
function parseCurrency(v){
  if(v == null) return 0;
  const s = String(v).replace(/[^0-9.\-]/g,'');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function parseDateDMY(s){
  if(!s) return null;
  if(/\d{2}\/\d{2}\/\d{4}/.test(s)){
    const [dd,mm,yy] = s.split('/');
    return new Date(Number(yy), Number(mm)-1, Number(dd));
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function formatCurrency(v){ return "$" + Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2}); }
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, (m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function getField(obj, candidates){
  for(const k of candidates){
    if(k in obj && obj[k] !== "") return obj[k];
    const matched = Object.keys(obj).find(x => x.toLowerCase() === k.toLowerCase());
    if(matched && obj[matched] !== "") return obj[matched];
  }
  return "";
}

/* ---------------- Data fetch ---------------- */
async function fetchCSV(url){
  try{
    const res = await fetch(url);
    if(!res.ok) throw new Error('fetch error ' + res.status);
    const txt = await res.text();
    const parsed = Papa.parse(txt, {header:true, skipEmptyLines:true});
    return parsed.data;
  }catch(err){
    console.warn('Fetching CSV failed:', err);
    return null;
  }
}

/* ---------------- Filters & summary ---------------- */
function applyFilters(data){
  const from = fromInput.value ? new Date(fromInput.value) : null;
  const to = toInput.value ? new Date(toInput.value) : null;
  if(!from && !to) return data;
  return data.filter(row=>{
    const raw = getField(row, ['Processed Date','ProcessedDate','Processed_Date']);
    const d = parseDateDMY(raw);
    if(!d) return false;
    if(from && d < from) return false;
    if(to){
      const toEnd = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23,59,59);
      if(d > toEnd) return false;
    }
    return true;
  });
}

function buildSummaryCards(data){
  summaryContainer.innerHTML = '';
  const totalCount = data.length;
  const totalCost = data.reduce((s,r)=> s + parseCurrency(getField(r,['COST','Cost','cost'])), 0);
  const cards = [
    {label:'Total Trade-ins (rows)', value:totalCount},
    {label:'Total Cost', value: formatCurrency(totalCost)}
  ];
  cards.forEach(c=>{
    const el = document.createElement('div'); el.className = 'card';
    el.innerHTML = `<div class="label">${c.label}</div><div class="value">${c.value}</div>`;
    summaryContainer.appendChild(el);
  });
}

/* ---------------- Aggregation & rendering ---------------- */
function aggregate(data, keyField){
  const groups = {};
  data.forEach(row=>{
    const key = String(getField(row, [keyField, keyField.toUpperCase(), keyField.toLowerCase()]) || 'Unknown').trim() || 'Unknown';
    if(!groups[key]) groups[key] = {count:0, cost:0, rows:[]};
    groups[key].count += 1;
    groups[key].cost += parseCurrency(getField(row,['COST','Cost','cost']));
    groups[key].rows.push(row);
  });
  return Object.keys(groups).map(k => ({key:k, count:groups[k].count, cost: groups[k].cost, rows: groups[k].rows}))
             .sort((a,b)=> b.cost - a.cost);
}

/* Determine actual CSV column names for hierarchy */
function detectKey(candidates){
  if(!RAW_DATA || RAW_DATA.length===0) return candidates[0];
  for(const c of candidates){
    if(RAW_DATA.some(r => Object.keys(r).some(k => k.toLowerCase() === c.toLowerCase()))) return c;
  }
  return candidates[0];
}

/* Render a level; parentId = data-block-id of parent block or null to start fresh */
function renderLevel(title, keyField, data, parentId){
  // clear lower blocks if parentId provided
  if(!parentId) stackedContainer.innerHTML = '';
  else {
    const children = Array.from(stackedContainer.children);
    const idx = children.findIndex(ch => ch.getAttribute('data-block-id') === parentId);
    if(idx >= 0){
      for(let i = children.length -1; i > idx; i--) stackedContainer.removeChild(children[i]);
    }
  }

  const aggregated = aggregate(data, keyField);
  const maxCost = Math.max(...aggregated.map(a=>a.cost), 1);

  const block = document.createElement('div'); block.className = 'table-block';
  const blockId = 'blk-' + Math.random().toString(36).slice(2,9);
  block.setAttribute('data-block-id', blockId);

  const header = document.createElement('div'); header.className = 'table-header';
  header.innerHTML = `<h2>${escapeHtml(title)} (by ${escapeHtml(keyField)})</h2>
    <div style="color:var(--muted);font-size:0.9rem">${aggregated.length} groups — total cost ${formatCurrency(aggregated.reduce((s,a)=>s+a.cost,0))}</div>`;
  block.appendChild(header);

  // table
  const table = document.createElement('table'); table.className = 'table';
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr><th>${escapeHtml(keyField)}</th><th class="col-right">Count</th><th class="col-right">Total Cost</th><th style="width:40%">Performance</th></tr>`;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  aggregated.forEach(g=>{
    const pct = Math.round((g.cost / maxCost) * 100);
    const fillClass = pct >= 70 ? 'high' : (pct >= 40 ? 'mid' : 'low');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(g.key)}</td>
                    <td class="col-right">${g.count}</td>
                    <td class="col-right">${formatCurrency(g.cost)}</td>
                    <td>
                      <div class="bar-cell">
                        <div class="bar-track"><div class="bar-fill ${fillClass}" style="width:${pct}%;"></div></div>
                        <div style="min-width:48px;text-align:right">${pct}%</div>
                      </div>
                    </td>`;
    tr._group = g;
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  block.appendChild(table);

  const note = document.createElement('div'); note.className = 'drillnote';
  note.textContent = 'Click any row to expand the next level.';
  block.appendChild(note);

  stackedContainer.appendChild(block);

  // attach handlers to rows
  Array.from(tbody.querySelectorAll('tr')).forEach(tr=>{
    tr.addEventListener('click', ()=>{
      const grp = tr._group;
      // determine next key according to hierarchy
      let nextKey = null;
      if(['Regions','Region','REGIONS'].includes(keyField)) nextKey = 'Market';
      else if(keyField === 'Market' || keyField === 'Market Name') nextKey = 'DM NAME';
      else if(keyField === 'DM NAME' || keyField === 'DM Name') nextKey = 'Type';
      else nextKey = null;

      // If nextKey not available in raw rows, fallback to obvious variants
      if(nextKey && !grp.rows.some(r => Object.keys(r).some(k => k.toLowerCase() === nextKey.toLowerCase()))){
        // try alternate names
        if(nextKey === 'Market' && grp.rows.some(r => Object.keys(r).some(k => k.toLowerCase() === 'market name'))) nextKey = 'Market Name';
        if(nextKey === 'DM NAME' && grp.rows.some(r => Object.keys(r).some(k => k.toLowerCase() === 'dm name'))) nextKey = 'DM Name';
      }

      if(!nextKey){
        renderRawRows(grp.rows, blockId, grp.key);
      } else {
        renderLevel(nextKey, nextKey, grp.rows, blockId);
      }

      // scroll to newly appended block
      setTimeout(()=>{
        const blocks = Array.from(stackedContainer.children);
        const last = blocks[blocks.length -1];
        if(last) last.scrollIntoView({behavior:'smooth', block:'start'});
      },150);
    });
  });

  return blockId;
}

function renderRawRows(rows, parentId, label){
  // remove blocks after parent
  const children = Array.from(stackedContainer.children);
  const idx = children.findIndex(ch => ch.getAttribute('data-block-id') === parentId);
  if(idx >= 0){
    for(let i = children.length -1; i > idx; i--) stackedContainer.removeChild(children[i]);
  }

  const block = document.createElement('div'); block.className = 'table-block';
  const blockId = 'blk-' + Math.random().toString(36).slice(2,9);
  block.setAttribute('data-block-id', blockId);

  const header = document.createElement('div'); header.className = 'table-header';
  header.innerHTML = `<h2>Detailed rows — ${escapeHtml(label)}</h2><div style="color:var(--muted);font-size:0.9rem">${rows.length} rows</div>`;
  block.appendChild(header);

  const table = document.createElement('table'); table.className = 'table';
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr><th>Processed Date</th><th>Market</th><th>DM NAME</th><th>Type</th><th class="col-right">Cost</th></tr>`;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach(r=>{
    const pd = getField(r,['Processed Date','ProcessedDate']) || '';
    const mk = getField(r,['Market','Market Name']) || '';
    const dm = getField(r,['DM NAME','DM Name']) || '';
    const tp = getField(r,['Type','TYPE']) || '';
    const cost = formatCurrency(parseCurrency(getField(r,['COST','Cost'])));
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(pd)}</td><td>${escapeHtml(mk)}</td><td>${escapeHtml(dm)}</td><td>${escapeHtml(tp)}</td><td class="col-right">${cost}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  block.appendChild(table);
  stackedContainer.appendChild(block);
  return blockId;
}

/* ---------------- Export functions ---------------- */
function exportCSV(rows){
  if(!rows || rows.length === 0){ alert('No rows to export'); return; }
  const keys = Object.keys(rows[0]);
  const csv = [keys.join(',')].concat(rows.map(r => keys.map(k => `"${String(r[k]||'').replace(/"/g,'""')}"`).join(','))).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'tradeins_export.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

function downloadPNG(){
  const el = document.getElementById('capture-area');
  html2canvas(el, {scale:1.8}).then(canvas=>{
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = 'tradeins_dashboard.png';
    link.click();
  });
}
function downloadPDF(){
  const el = document.getElementById('capture-area');
  html2canvas(el, {scale:1.8}).then(canvas=>{
    const img = canvas.toDataURL('image/png');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p','mm','a4');
    const width = pdf.internal.pageSize.getWidth();
    const imgWidth = width - 18;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    pdf.addImage(img,'PNG',9,10,imgWidth,imgHeight);
    pdf.save('tradeins_dashboard.pdf');
  });
}

/* ---------------- Init & handlers ---------------- */
async function init(){
  const url = sheetInput.value.trim();
  const data = await fetchCSV(url);
  if(!data || data.length === 0){
    alert('Could not load CSV — check URL/publication/CORS. Falling back to empty dataset.');
    RAW_DATA = [];
  } else {
    RAW_DATA = data;
  }

  // set date defaults if available
  const dateVals = RAW_DATA.map(r => parseDateDMY(getField(r,['Processed Date','ProcessedDate']))).filter(Boolean);
  if(dateVals.length){
    const minD = new Date(Math.min(...dateVals.map(d=>d.getTime())));
    const maxD = new Date(Math.max(...dateVals.map(d=>d.getTime())));
    if(!fromInput.value) fromInput.value = minD.toISOString().slice(0,10);
    if(!toInput.value) toInput.value = maxD.toISOString().slice(0,10);
  }

  refreshUI();
  applyBtn.addEventListener('click', refreshUI);
  resetBtn.addEventListener('click', ()=>{
    fromInput.value = ''; toInput.value = ''; refreshUI();
  });
  downloadPNGBtn.addEventListener('click', downloadPNG);
  downloadPDFBtn.addEventListener('click', downloadPDF);
  downloadCSVBtn.addEventListener('click', ()=> exportCSV(applyFilters(RAW_DATA)));

  // update URL reload
  sheetInput.addEventListener('change', async ()=>{
    const newUrl = sheetInput.value.trim();
    const newData = await fetchCSV(newUrl);
    if(newData && newData.length){ RAW_DATA = newData; refreshUI(); }
    else alert('Could not fetch CSV from provided URL — check sharing settings or URL.');
  });
}

function refreshUI(){
  const filtered = applyFilters(RAW_DATA);
  buildSummaryCards(filtered);
  stackedContainer.innerHTML = '';

  // determine region key name: prefer 'Regions' or 'Region'
  const regionKey = detectKey(['Regions','Region','regions','REGIONS']);
  renderLevel('Region Summary', regionKey, filtered, null);
}

/* auto start */
init();
