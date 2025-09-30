const sheetInput = document.getElementById('sheet-url');
const fromInput = document.getElementById('from-date');
const toInput = document.getElementById('to-date');
const applyBtn = document.getElementById('apply-filters');
const resetBtn = document.getElementById('reset-filters');
const downloadCSVBtn = document.getElementById('downloadCSV');
const summaryContainer = document.getElementById('summary-cards');
const stackedContainer = document.getElementById('stacked-container');
const breadcrumbEl = document.getElementById('breadcrumb');
const backBtn = document.getElementById('btn-back');

let RAW_DATA = [];
let historyStack = []; 


function parseCurrency(v){
    if(v==null) return 0;
    const s=String(v).replace(/[^0-9.\-]/g,'');
    const n=parseFloat(s);
    return isNaN(n)?0:n;
}

function parseIntSafe(v){
    if(v==null||v==='') return 0;
    const n=parseInt(String(v).replace(/[^0-9\-]/g,''),10);
    return isNaN(n)?0:n;
}

function parseDateDMY(s){
    if(!s) return null;
    if(/\d{2}\/\d{2}\/\d{4}/.test(s)){
        const [dd,mm,yy]=s.split('/');
        return new Date(Number(yy), Number(mm)-1, Number(dd));
    }
    const d=new Date(s);
    return isNaN(d)?null:d;
}

function formatCurrency(v){
    return "$" + Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2});
}

function escapeHtml(s){
    return String(s||'').replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function getField(obj, candidates){
    for(const k of candidates){
        if(k in obj && obj[k] !== "") return obj[k];
        const matched = Object.keys(obj).find(x => x.toLowerCase() === k.toLowerCase());
        if(matched && obj[matched] !== "") return obj[matched];
    }
    return "";
}


async function fetchCSV(url){
    try {
        const res = await fetch(url);
        if(!res.ok) throw new Error('fetch error ' + res.status);
        const txt = await res.text();
        const parsed = Papa.parse(txt, {header:true, skipEmptyLines:true});
        return parsed.data;
    } catch(err){
        console.warn('Fetching CSV failed:', err);
        return null;
    }
}

function blockExists(parentId, title) {
    return !!document.querySelector(
        `[data-parent-id="${parentId}"] .table-header h2`
    ) && Array.from(document.querySelectorAll(`[data-parent-id="${parentId}"] .table-header h2`))
        .some(el => el.textContent.includes(title));
}


function countNonEmptyIMEI(row) {
    const imeiValue = getField(row, ['Customer IMEI', 'IMEI', 'imei', 'CUSTOMER IMEI']);
    return imeiValue && String(imeiValue).trim() !== '' ? 1 : 0;
}


function applyFilters(data){
    const from = fromInput.value ? new Date(fromInput.value) : null;
    const to = toInput.value ? new Date(toInput.value) : null;
    if(!from && !to) return data;
    return data.filter(row=>{
        const raw = getField(row,['Processed Date','ProcessedDate','Processed_Date']);
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
    const totalLabels = data.length;
    const totalDevices = data.reduce((s,r) => s + countNonEmptyIMEI(r), 0);
    const totalCost = data.reduce((s,r)=> s + parseCurrency(getField(r,['COST','Cost','cost'])), 0);
    
    const cards = [
        {label:'Total Labels', value: totalLabels},
        {label:'Total Devices', value: totalDevices},
        {label:'Total Cost', value: formatCurrency(totalCost)}
    ];
    
    cards.forEach(c=>{
        const el = document.createElement('div');
        el.className = 'kpi';
        el.innerHTML = `<div class="label">${escapeHtml(c.label)}</div><div class="value">${escapeHtml(String(c.value))}</div>`;
        summaryContainer.appendChild(el);
    });
}

function aggregate(data, keyField){
    const groups = {};
    data.forEach(row=>{
        const keyRaw = getField(row, [keyField, keyField.toUpperCase(), keyField.toLowerCase()]);
        const key = String(keyRaw || 'Unknown').trim() || 'Unknown';
        if(!groups[key]) groups[key] = {count:0, devices:0, cost:0, daysSet: new Set(), rows:[]};
        groups[key].count += 1;
        groups[key].devices += countNonEmptyIMEI(row);
        groups[key].cost += parseCurrency(getField(row,['COST','Cost','cost']));
        const daysVal = getField(row,['Days','DAY','day']);
        if(daysVal) groups[key].daysSet.add(String(daysVal).trim());
        groups[key].rows.push(row);
    });
    
    return Object.keys(groups).map(k => ({
        key:k,
        count: groups[k].count,
        devices: groups[k].devices,
        cost: groups[k].cost,
        days: Array.from(groups[k].daysSet),
        rows: groups[k].rows
    })).sort((a,b)=> b.cost - a.cost);
}

function detectKey(candidates){
    if(!RAW_DATA || RAW_DATA.length===0) return candidates[0];
    for(const c of candidates){
        if(RAW_DATA.some(r => Object.keys(r).some(k => k.toLowerCase() === c.toLowerCase()))) return c;
    }
    return candidates[0];
}


function pushHistory(item){
    historyStack.push(item);
    renderBreadcrumb();
    backBtn.classList.toggle('hidden', historyStack.length <= 1);
}

function popHistory(){
    historyStack.pop();
    renderBreadcrumb();
    backBtn.classList.toggle('hidden', historyStack.length <= 1);
}

function renderBreadcrumb(){
    breadcrumbEl.innerHTML = historyStack.map((h,i)=>{
        if(h.mode === 'step'){
            return `<span>${escapeHtml(h.level)}${h.selected ? ' — ' + escapeHtml(h.selected) : ''}</span>`;
        } else {
            return `<span>${escapeHtml(h.level)}${h.selected ? ' — ' + escapeHtml(h.selected) : ''}</span>`;
        }
    }).join(' › ');
}

backBtn.addEventListener('click', ()=>{
    if(historyStack.length === 0) return;
    const top = historyStack[historyStack.length -1];
    if(top.mode === 'stack'){
        
        const block = document.querySelector(`[data-block-id="${top.blockId}"]`);
        if(block) block.remove();
        popHistory();
    } else {
        
        historyStack.pop();
        const prev = historyStack[historyStack.length -1];
        if(!prev){
           
            refreshUI();
            return;
        }
        
        if(prev.level === 'Regions'){
            renderRegionsStep();
        } else if(prev.level === 'Market' && prev.regionSelected){
            renderMarketStep(prev.regionSelected);
        } else {
            
            refreshUI();
        }
        renderBreadcrumb();
        backBtn.classList.toggle('hidden', historyStack.length <= 1);
    }
});


function createBlockHeader(title, meta){
    const header = document.createElement('div');
    header.className = 'table-header';
    header.innerHTML = `<h2>${escapeHtml(title)}</h2><div class="meta">${escapeHtml(meta)}</div>`;
    return header;
}


function renderStepTable(title, keyField, data, levelName, onRowClick){
    
    stackedContainer.innerHTML = '';
    const aggregated = aggregate(data, keyField);
    const maxCost = Math.max(...aggregated.map(a=>a.cost), 1);
    
    const block = document.createElement('div');
    block.className = 'table-block';
    const blockId = 'blk-' + Math.random().toString(36).slice(2,9);
    block.setAttribute('data-block-id', blockId);
    
    const header = createBlockHeader(title, `${aggregated.length} groups — total cost ${formatCurrency(aggregated.reduce((s,a)=>s+a.cost,0))}`);
    block.appendChild(header);
    
    const table = document.createElement('table');
    table.className='table';
    const thead = document.createElement('thead');
    thead.innerHTML = `<tr>
        <th>${escapeHtml(keyField)}</th>
        <th class="col-right">Count</th>
        <th class="col-right">Devices</th>
        <th class="col-right">Total Cost</th>
        <th>Days</th>
        <th style="width:36%">Performance</th>
    </tr>`;
    table.appendChild(thead);
    
    const tbody = document.createElement('tbody');
    aggregated.forEach(g=>{
        const pct = Math.round((g.cost / maxCost) * 100);
        const fill = pct >= 70 ? 'green' : (pct >= 40 ? 'amber' : 'red');
        const daysHtml = g.days.length ? g.days.map(d => `<span class="days-pill">${escapeHtml(d)}</span>`).join(' ') : '';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(g.key)}</td>
            <td class="col-right">${g.count}</td>
            <td class="col-right">${g.devices}</td>
            <td class="col-right">${formatCurrency(g.cost)}</td>
            <td>${daysHtml}</td>
            <td>
                <div class="bar-cell">
                    <div class="bar-track"><div class="bar-fill ${fill}" style="width:${pct}%;"></div></div>
                    <div style="min-width:52px;text-align:right">${pct}%</div>
                </div>
            </td>`;
        tr._group = g;
        tr.addEventListener('click', ()=> onRowClick(g));
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    block.appendChild(table);
    stackedContainer.appendChild(block);
    
    return {blockId, block};
}


function renderStackedTable(title, keyField, data, levelName, parentBlockId, onRowClick){
    const aggregated = aggregate(data, keyField);
    const maxCost = Math.max(...aggregated.map(a=>a.cost), 1);
    
    const block = document.createElement('div');
    block.className = 'table-block';
    const blockId = 'blk-' + Math.random().toString(36).slice(2,9);
    block.setAttribute('data-block-id', blockId);
    block.setAttribute('data-parent-id', parentBlockId || '');
    
    const header = createBlockHeader(title, `${aggregated.length} groups — total cost ${formatCurrency(aggregated.reduce((s,a)=>s+a.cost,0))}`);
    block.appendChild(header);
    
    const table = document.createElement('table');
    table.className='table';
    const thead = document.createElement('thead');
    thead.innerHTML = `<tr>
        <th>${escapeHtml(keyField)}</th>
        <th class="col-right">Count</th>
        <th class="col-right">Devices</th>
        <th class="col-right">Total Cost</th>
        <th>Days</th>
        <th style="width:36%">Performance</th>
    </tr>`;
    table.appendChild(thead);
    
    const tbody = document.createElement('tbody');
    aggregated.forEach(g=>{
        const pct = Math.round((g.cost / maxCost) * 100);
        const fill = pct >= 70 ? 'green' : (pct >= 40 ? 'amber' : 'red');
        const daysHtml = g.days.length ? g.days.map(d => `<span class="days-pill">${escapeHtml(d)}</span>`).join(' ') : '';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(g.key)}</td>
            <td class="col-right">${g.count}</td>
            <td class="col-right">${g.devices}</td>
            <td class="col-right">${formatCurrency(g.cost)}</td>
            <td>${daysHtml}</td>
            <td>
                <div class="bar-cell">
                    <div class="bar-track"><div class="bar-fill ${fill}" style="width:${pct}%;"></div></div>
                    <div style="min-width:52px;text-align:right">${pct}%</div>
                </div>
            </td>`;
        tr._group = g;
        tr.addEventListener('click', ()=> onRowClick(g, blockId));
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    block.appendChild(table);
    stackedContainer.appendChild(block);
    
    
    pushHistory({mode:'stack', level:levelName, selected:null, blockId});
    return blockId;
}


function renderRegionsStep(){
    const regionKey = detectKey(['Regions','Region','REGIONS','regions']);
    renderStepTable('Regions', regionKey, applyFilters(RAW_DATA), 'Regions', (group)=>{
        
        renderMarketStep(group.key);
        pushHistory({mode:'step', level:'Market', selected: group.key});
    });
    
   
    historyStack = [{mode:'step', level:'Regions'}];
    renderBreadcrumb();
    backBtn.classList.toggle('hidden', historyStack.length <= 1);
}


function renderMarketStep(regionName){
    const regionKey = detectKey(['Regions','Region','REGIONS','regions']);
    
    const rowsForRegion = applyFilters(RAW_DATA).filter(r => {
        const reg = getField(r, ['Regions','Region']);
        return String(reg || '').trim() === String(regionName).trim();
    });
    
    const marketKey = detectKey(['Market','Market Name','Market Name ','MARKET']);
    renderStepTable('Markets', marketKey, rowsForRegion, 'Market', (group)=>{
        
        const last = historyStack[historyStack.length-1];
        if(last && last.mode === 'step' && last.level === 'Market') {
            historyStack[historyStack.length-1].selected = group.key;
        } else {
            pushHistory({mode:'step', level:'Market', selected: group.key});
        }
        renderDMStack(group.rows, group.key);
    });
}


function renderDMStack(rowsForMarket, marketName, parentBlockId){
   
    const dmKey = detectKey(['DM NAME','DM Name','DM','Dm Name']);
    const lastStepBlock = Array.from(stackedContainer.children).slice(-1)[0] || null;
    const parentId = lastStepBlock ? lastStepBlock.getAttribute('data-block-id') : null;
    
    if (blockExists(parentBlockId, 'DMs')) return;
    const blockId = renderStackedTable('DMs', dmKey, rowsForMarket, 'DM', parentId, (group, parentBlockId)=>{
        
        renderTypeStack(group.rows, group.key, parentBlockId);
    });
    
}


function renderTypeStack(rowsForDM, dmName, parentBlockId){
   if (blockExists(parentBlockId, 'Type')) return;
    const typeKey = detectKey(['Type','TYPE','type']);
    renderStackedTable('Type', typeKey, rowsForDM, 'Type', parentBlockId, (group, thisParentId)=>{
        
        renderRawRowsStack(group.rows, group.key, thisParentId);
    });
}


function renderRawRowsStack(rows, label, parentBlockId){
   if (blockExists(parentBlockId, `Detailed — ${label}`)) return;
    const block = document.createElement('div');
    block.className = 'table-block';
    const blockId = 'blk-' + Math.random().toString(36).slice(2,9);
    block.setAttribute('data-block-id', blockId);
    block.setAttribute('data-parent-id', parentBlockId || '');
    
    const header = createBlockHeader(`Detailed — ${label}`, `${rows.length} rows`);
    block.appendChild(header);
    
    const table = document.createElement('table');
    table.className='table';
    const thead = document.createElement('thead');
    thead.innerHTML = `<tr><th>Processed Date</th><th>Market</th><th>DM NAME</th><th>Type</th><th class="col-right">Devices</th><th class="col-right">Cost</th><th>Days</th></tr><th>Shipping Status</th></tr>`;
    table.appendChild(thead);
    
    const tbody = document.createElement('tbody');
    rows.forEach(r=>{
        const pd = getField(r,['Processed Date','ProcessedDate']) || '';
        const mk = getField(r,['Market','Market Name']) || '';
        const dm = getField(r,['DM NAME','DM Name']) || '';
        const tp = getField(r,['Type','TYPE']) || '';
        const devices = countNonEmptyIMEI(r);
        const cost = formatCurrency(parseCurrency(getField(r,['COST','Cost'])));
        const daysVal = getField(r,['Days','DAY','day']) || '';
        const daysHtml = daysVal ? `<span class="days-pill">${escapeHtml(daysVal)}</span>` : '';
         const shipping = getField(r, ['Shipping Status', 'SHIP_STATUS', 'Shipping', 'shipping']) || '';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(pd)}</td><td>${escapeHtml(mk)}</td><td>${escapeHtml(dm)}</td><td>${escapeHtml(tp)}</td><td class="col-right">${devices}</td><td class="col-right">${cost}</td><td>${daysHtml}</td><td>${shipping}</td>`;
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    block.appendChild(table);
    stackedContainer.appendChild(block);
    
    pushHistory({mode:'stack', level:'raw', selected: label, blockId});
}


function refreshUI(){
    const filtered = applyFilters(RAW_DATA);
    buildSummaryCards(filtered);

    renderRegionsStep();
}

async function init(){
    const url = sheetInput.value.trim();
    const data = await fetchCSV(url);
    if(!data || data.length === 0){
        alert('Could not load CSV — check URL/publication/CORS. Dashboard will show no data.');
        RAW_DATA = [];
    } else {
        RAW_DATA = data;
    }
    
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
        fromInput.value='';
        toInput.value='';
        refreshUI();
    });
    

    
    downloadCSVBtn.addEventListener('click', ()=> {
        const filtered = applyFilters(RAW_DATA);
        if(!filtered.length){
            alert('No rows to export');
            return;
        }
        const keys = Object.keys(filtered[0]);
        const csv = [keys.join(',')].concat(filtered.map(r => keys.map(k => `"${String(r[k]||'').replace(/"/g,'""')}"`).join(','))).join('\n');
        const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'tradeins_export.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    });
    
    sheetInput.addEventListener('change', async ()=>{
        const newUrl = sheetInput.value.trim();
        const newData = await fetchCSV(newUrl);
        if(newData && newData.length){
            RAW_DATA = newData;
            refreshUI();
        } else alert('Could not fetch CSV from provided URL — check sharing settings or URL.');
    });
}


init();
