// Genera el dashboard de embarques de SIPIA a partir de datos frescos de Salesforce.
// Uso: node generar_sipia_dashboard.js
// Requiere: sf CLI autenticado como comex@lateamfoods.com

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ACCOUNT_ID = '001Dn00000HJgD6IAL'; // SIPIA
const OUT_FILE = path.join(__dirname, '..', 'sipia', 'index.html');

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const STATUS_LABEL = {
  'In Approval Process': 'On Going',
  'Waiting for sign': 'Waiting for sign',
  'Parcial Loaded': 'Parcial Loaded',
};
const STATUS_CLASS = {
  'In Approval Process': 'st-info',
  'Waiting for sign': 'st-neutral',
  'Parcial Loaded': 'st-warning',
};

const PRODUCT_ICON = {
  'Sweet Corn': '🌽',
  'Frozen Sweet Corn': '🌽',
  'Baby Gherkins': '🥒',
};

function runSOQL(query) {
  const flat = query.replace(/\s+/g, ' ').trim().replace(/"/g, '\\"');
  const cmd = `sf data query --query "${flat}" --target-org comex@lateamfoods.com --json`;
  const out = execSync(cmd, { maxBuffer: 20 * 1024 * 1024 }).toString();
  const parsed = JSON.parse(out);
  return parsed.result.records;
}

function fetchContracts() {
  return runSOQL(`
    SELECT ContractNumber, Nro_Proforma__c, Status, StartDate, EndDate, Incoterm__c,
     Puerto_origen__c, Puerto_Destino__c, Total_Value__c,
     (SELECT Name, Principal_Product__c, Unit_Price__c, Quantity__c, Loaded__c, Unloaded__c, Subtotal__c FROM Contratct_Products__r),
     (SELECT Name, Nro_Booking__c, Barco__c, ETD__c, ETD_Updated__c, ETA__c, Destination_Port__c, Status__c,
       Link_BL__c, Tracking_Page__c, Container_N__c, Nro_BL__c, Date_of_approval__c, Deliver__c, Delivery_Date__c,
       Paid__c, Amount_to_be_paid__c, Invoice_payment_date__c
      FROM Shippings__r)
    FROM Contract
    WHERE Account.Id = '${ACCOUNT_ID}' AND Status IN ('In Approval Process','Waiting for sign','Parcial Loaded')
    ORDER BY Total_Value__c DESC
  `);
}

// ---------- helpers ----------

function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmtDate(s, refYear) {
  const d = parseDate(s);
  if (!d) return null;
  const day = String(d.getUTCDate()).padStart(2, '0');
  const mon = MESES[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  return year === refYear ? `${day} ${mon}` : `${day} ${mon} ${year}`;
}

function fmtDateFull(s) {
  const d = parseDate(s);
  if (!d) return null;
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${day} ${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function money(n) {
  return 'US$ ' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function moneyDec(n) {
  return 'US$ ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(n) {
  return Math.round(n) + '%';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function productIcon(name) {
  return PRODUCT_ICON[name] || '📦';
}

// status rank for sorting: ongoing first, then tbi, then loaded
const STATUS_RANK = { 'On going': 0, 'TBI': 1, 'Loaded': 2 };

function statusPillClass(s) {
  if (s === 'Loaded') return { cls: 'st-good', label: 'Cargado' };
  if (s === 'On going') return { cls: 'st-warning', label: 'En curso' };
  return { cls: 'st-neutral', label: 'Por definir' };
}

function filterKey(s) {
  if (s === 'Loaded') return 'loaded';
  if (s === 'On going') return 'ongoing';
  return 'tbi';
}

// ---------- render pieces ----------

function renderProductRow(p) {
  const loaded = p.Loaded__c || 0;
  const qty = p.Quantity__c || 0;
  const loadedPct = qty > 0 ? (loaded / qty) * 100 : 0;
  return `
                <tr data-subtotal="${p.Subtotal__c}" data-pct="${Math.round(loadedPct)}">
                  <td class="product-name"><span class="cat-icon" aria-hidden="true">${productIcon(p.Principal_Product__c)}</span>${esc(p.Name)} <span class="principal">${esc(p.Principal_Product__c)}</span></td>
                  <td class="num">${moneyDec(p.Unit_Price__c)}</td>
                  <td class="num">${qty.toLocaleString('en-US')}</td>
                  <td class="num">${money(p.Subtotal__c)}</td>
                  <td class="num">
                    <div class="prod-progress"><div class="track"><div class="fill" style="width:${Math.round(loadedPct)}%"></div></div><span class="pct">${pct(loadedPct)}</span></div>
                  </td>
                </tr>`;
}

function delayInfo(etdReq, etdUpd) {
  if (!etdReq || !etdUpd) return null;
  const days = daysBetween(parseDate(etdReq), parseDate(etdUpd));
  return { days, delayed: days > 15 };
}

function renderDelayFlag(delay) {
  if (!delay || !delay.delayed) return '';
  return `<span class="delay-flag">⚠ Delayed Shipping · +${delay.days} días</span>`;
}

function renderTrackingCell(linkBL) {
  if (linkBL && /^https?:\/\//i.test(linkBL)) {
    return `<a class="track-btn" href="${esc(linkBL)}" target="_blank" rel="noopener">Ver tracking en vivo ↗</a>`;
  }
  if (linkBL) {
    return `<span class="track-muted">Naviera: ${esc(linkBL.toUpperCase())} · sin link directo</span>`;
  }
  return `<span class="track-muted">Sin booking aún</span>`;
}

function renderDocsPanel(s) {
  const aprobado = s.Date_of_approval__c
    ? `<b class="pay-ok">Sí</b> · ${fmtDate(s.Date_of_approval__c, REF_YEAR)}`
    : `<b class="pay-pending">No</b>`;
  let deliver;
  if (s.Deliver__c === 'Yes') {
    const dhl = s.Tracking_Page__c ? ` <a href="${esc(s.Tracking_Page__c)}" target="_blank" rel="noopener">Ver DHL ↗</a>` : '';
    deliver = `<b class="pay-ok">Sí</b> · ${fmtDate(s.Delivery_Date__c, REF_YEAR)}${dhl}`;
  } else {
    deliver = `<b class="pay-pending">No</b>`;
  }
  let factura;
  if (s.Paid__c === 'Yes') {
    factura = `<b class="pay-ok">Sí</b> · ${money(s.Amount_to_be_paid__c)}${s.Invoice_payment_date__c ? ' · ' + fmtDate(s.Invoice_payment_date__c, REF_YEAR) : ''}`;
  } else if (s.Amount_to_be_paid__c) {
    factura = `<b class="pay-pending">No</b> · ${money(s.Amount_to_be_paid__c)} pendiente`;
  } else {
    factura = `<b class="pay-pending">No</b> (sin emitir aún)`;
  }
  return `
            <div class="ship-docs-panel">
              <div class="ship-docs-panel-inner">
                <span class="docs-label">Documentos de embarque</span>
                <span class="pay-line">Aprobado: ${aprobado}</span>
                <span class="pay-line">Deliver: ${deliver}</span>
                <span class="pay-line">Factura pagada: ${factura}</span>
              </div>
            </div>`;
}

function shipAlert(s) {
  const alerts = [];
  if (s.Status__c === 'Loaded') {
    const unpaid = s.Paid__c !== 'Yes' && s.Amount_to_be_paid__c;
    const unapproved = !s.Date_of_approval__c;
    if (unapproved) alerts.push({ id: shipDomId(s), text: `<b>${esc(s.Name)}</b>${s.Barco__c ? ' (' + esc(s.Barco__c) + ')' : ''} todavía no tiene sus documentos aprobados ni entregados.` });
    if (unpaid) alerts.push({ id: shipDomId(s), text: `<b>${esc(s.Name)}</b> tiene una factura de <b>${money(s.Amount_to_be_paid__c)}</b> pendiente de pago.` });
  }
  return alerts;
}

function shipDomId(s) {
  return 'ship-' + s.Name.replace(/[^A-Za-z0-9]/g, '');
}

function routeProgressHtml(s, today, origin, dest) {
  const eta = parseDate(s.ETA__c);
  const etdUpd = parseDate(s.ETD_Updated__c);
  const delay = delayInfo(s.ETD__c, s.ETD_Updated__c);
  const delayFlagHtml = renderDelayFlag(delay);

  if (!eta || !etdUpd) {
    // no ETA on file - fall back to plain dates block
    return renderPlainDates(s, delay);
  }

  if (today.getTime() >= eta.getTime()) {
    const daysSince = daysBetween(eta, today);
    return `
              <div class="route-progress" style="--p:100%">
                <div class="ports"><span class="reached">${esc(origin)}</span><span class="reached">${esc(dest)}</span></div>
                <div class="track"><div class="fill"></div><span class="ship">🚢</span></div>
                <div class="caption"><span class="etd-tag">ETD Actualizado</span>${fmtDate(s.ETD_Updated__c, REF_YEAR)} · arribó <b>hace ${daysSince} días</b></div>
              </div>`;
  }
  if (today.getTime() < etdUpd.getTime()) {
    return `
              <div class="route-progress not-departed" style="--p:0%">
                <div class="ports"><span>${esc(origin)}</span><span>${esc(dest)}</span></div>
                <div class="track"><div class="fill"></div><span class="ship">🚢</span></div>
                <div class="caption"><span class="etd-tag">ETD Actualizado</span>${fmtDate(s.ETD_Updated__c, REF_YEAR)} · <b>aún no zarpa</b> (estimado)</div>
                ${delay && delay.delayed ? `<div class="etd-required">ETD requerido ${fmtDate(s.ETD__c, REF_YEAR)}</div>` : ''}
                ${delayFlagHtml}
              </div>`;
  }
  const total = daysBetween(etdUpd, eta) || 1;
  const elapsed = daysBetween(etdUpd, today);
  const p = Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
  return `
              <div class="route-progress in-transit" style="--p:${p}%">
                <div class="ports"><span class="reached">${esc(origin)}</span><span>${esc(dest)}</span></div>
                <div class="track"><div class="fill"></div><span class="ship">🚢</span></div>
                <div class="caption"><span class="etd-tag">ETD Actualizado</span>${fmtDate(s.ETD_Updated__c, REF_YEAR)} · <b>~${p}% del trayecto</b> (estimado, ETA ${fmtDate(s.ETA__c, REF_YEAR)})</div>
                ${delay && delay.delayed ? `<div class="etd-required">ETD requerido ${fmtDate(s.ETD__c, REF_YEAR)}</div>` : ''}
                ${delayFlagHtml}
              </div>`;
}

function renderPlainDates(s, delay) {
  if (!s.ETD_Updated__c) {
    return `<div class="ship-dates">ETD por confirmar</div>`;
  }
  const req = delay && delay.delayed
    ? `<div class="etd-required">ETD requerido ${fmtDate(s.ETD__c, REF_YEAR)}</div>${renderDelayFlag(delay)}`
    : '';
  return `<div class="ship-dates">
                <div class="etd-updated"><span class="etd-tag">ETD Actualizado</span>${fmtDate(s.ETD_Updated__c, REF_YEAR)}</div>
                ${req}
              </div>`;
}

function renderVesselCell(s) {
  if (!s.Barco__c) return `<div class="ship-vessel"><span class="v-none">Buque aún sin asignar</span></div>`;
  const m = s.Barco__c.match(/^(.*?)\s+(?:voy\.?|v\.)\s*(.+)$/i);
  const name = m ? m[1] : s.Barco__c;
  const voy = m ? m[2] : null;
  return `<div class="ship-vessel"><span class="v-name">${esc(toTitleCase(name))}</span>${voy ? `<span class="ship-note">Voy. ${esc(voy)}</span>` : ''}</div>`;
}

function toTitleCase(s) {
  return s.replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}

function renderShipmentRow(s, origin, dest) {
  const st = statusPillClass(s.Status__c);
  const id = s.Status__c === 'Loaded' ? ` id="${shipDomId(s)}"` : '';
  const alerts = shipAlert(s);
  const toggleClass = alerts.length ? ' has-alert' : '';
  const toggleAria = alerts.length ? 'Documentación y pagos — atención' : 'Documentación y pagos';

  const placeholderMatch = s.Name.match(/^S(\d+)\/(\d+)\/(\d+)/);
  const label = placeholderMatch ? `Embarque ${placeholderMatch[2]} de ${placeholderMatch[3]}` : s.Name;
  const note = (s.Nro_BL__c || s.Container_N__c)
    ? [s.Nro_BL__c ? 'BL ' + s.Nro_BL__c : null, s.Container_N__c ? 'Cont. ' + s.Container_N__c : null].filter(Boolean).join(' · ')
    : (placeholderMatch ? s.Name.split('//').slice(1).map(x => x.trim()).filter(Boolean).join(' · ') : '');

  const dateOrRoute = (s.Status__c === 'Loaded')
    ? routeProgressHtml(s, TODAY, origin, dest)
    : renderPlainDates(s, delayInfo(s.ETD__c, s.ETD_Updated__c));

  const trackingCell = s.Status__c === 'Loaded' ? renderTrackingCell(s.Link_BL__c) : renderTrackingCell(null);

  return `
            <div class="shipment-row" data-status="${filterKey(s.Status__c)}"${id}>
              <div class="ship-id-block">
                <span class="ship-id">${esc(label)}</span>
                ${note ? `<span class="ship-note">${esc(note)}</span>` : ''}
              </div>
              ${renderVesselCell(s)}
              <span class="status-pill ${st.cls}"><span class="dot"></span>${st.label}</span>
              ${dateOrRoute}
              ${trackingCell}
              <button class="ship-docs-toggle${toggleClass}" type="button" aria-expanded="false" aria-label="${toggleAria}" title="${toggleAria}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>
            </div>${renderDocsPanel(s)}`;
}

function renderContract(c, idx) {
  const label = STATUS_LABEL[c.Status] || c.Status;
  const cls = STATUS_CLASS[c.Status] || 'st-neutral';
  const products = c.Contratct_Products__r ? c.Contratct_Products__r.records : [];
  const totalQty = products.reduce((a, p) => a + (p.Quantity__c || 0), 0);
  const totalLoaded = products.reduce((a, p) => a + (p.Loaded__c || 0), 0);
  const overallPct = totalQty > 0 ? (totalLoaded / totalQty) * 100 : 0;
  const mainIcon = productIcon(products[0] ? products[0].Principal_Product__c : '');
  const mainProductName = products[0] ? products[0].Principal_Product__c : '';

  const shipments = (c.Shippings__r ? c.Shippings__r.records : []).slice();
  shipments.sort((a, b) => (STATUS_RANK[a.Status__c] ?? 3) - (STATUS_RANK[b.Status__c] ?? 3));
  const total = shipments.length;

  const origin = toTitleCase(c.Puerto_origen__c);
  const dest = toTitleCase(c.Puerto_Destino__c);
  const shipmentsHtml = shipments.map(s => renderShipmentRow(s, origin, dest)).join('\n');

  const productsHtml = products.map(renderProductRow).join('');

  const dataProducts = [...new Set(products.map(p => (p.Principal_Product__c || '').toLowerCase()))].join(' ');

  return {
    html: `
    <!-- Contract ${esc(c.ContractNumber)} -->
    <article class="contract-card collapsed" data-products="${esc(dataProducts)}" style="--card-accent: var(--${cls === 'st-info' ? 'info' : cls === 'st-warning' ? 'warning' : 'neutral'});">
      <div class="contract-head">
        <div class="head-left">
          <button class="collapse-btn" aria-label="Colapsar contrato" title="Mostrar/ocultar detalle"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>
          <div class="contract-product"><span class="cat-icon" aria-hidden="true">${mainIcon}</span>${esc(mainProductName)}</div>
        </div>
        <div class="contract-id-block">
          <span class="contract-number">Proforma N.º ${esc(c.Nro_Proforma__c || c.ContractNumber)}</span>
          <div class="route">${esc(origin)} <span class="arrow">→</span> ${esc(dest)}</div>
          <div class="contract-tags">
            <span class="tag incoterm">${esc(c.Incoterm__c)}</span>
            <span class="tag">${fmtDateFull(c.StartDate)} – ${fmtDateFull(c.EndDate)}</span>
          </div>
        </div>
        <div class="contract-right">
          <span class="status-pill ${cls}"><span class="dot"></span>${esc(label)}</span>
          <div class="contract-value">
            <div class="amount">${money(c.Total_Value__c)}</div>
            <div class="label">Valor total</div>
          </div>
          <div class="contract-progress" title="Avance de carga del contrato">
            <div class="track"><div class="fill" style="width:${Math.round(overallPct)}%"></div></div>
            <span class="pct">${pct(overallPct)}</span>
          </div>
        </div>
      </div>
      <div class="contract-body">
        <div>
          <p class="section-label">Productos</p>
          <div class="overflow-x">
            <table class="products-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th class="num">Precio unit.</th>
                  <th class="num">Unidades</th>
                  <th class="num sortable" data-sort-key="subtotal">Subtotal <span class="arrow"></span></th>
                  <th class="num sortable" data-sort-key="pct">Cargado <span class="arrow"></span></th>
                </tr>
              </thead>
              <tbody>${productsHtml}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <p class="section-label">Embarques (${total})</p>
          <div class="shipments">${shipmentsHtml}
          </div>
        </div>
      </div>
    </article>`,
    totalValue: c.Total_Value__c,
    shipments,
  };
}

// ---------- main ----------

const contracts = fetchContracts();
const TODAY = new Date();
TODAY.setUTCHours(0, 0, 0, 0);
const REF_YEAR = TODAY.getUTCFullYear();

const rendered = contracts.map(renderContract);
rendered.sort((a, b) => b.totalValue - a.totalValue);

const allShipments = rendered.flatMap(r => r.shipments);
const totalFOB = contracts.reduce((a, c) => a + (c.Total_Value__c || 0), 0);

const statusCounts = { loaded: 0, ongoing: 0, tbi: 0 };
allShipments.forEach(s => statusCounts[filterKey(s.Status__c)]++);
const totalShip = allShipments.length || 1;

const delays = allShipments
  .map(s => delayInfo(s.ETD__c, s.ETD_Updated__c))
  .filter(d => d);
const delayed = delays.filter(d => d.delayed);
const avgDelay = delayed.length ? Math.round(delayed.reduce((a, d) => a + d.days, 0) / delayed.length) : 0;

const alertItems = allShipments.flatMap(shipAlert);

const contractsHtml = rendered.map(r => r.html).join('\n');

const alertModalHtml = alertItems.length ? `
<div class="alert-overlay" id="alertOverlay" role="dialog" aria-modal="true" aria-labelledby="alertTitle">
  <div class="alert-modal">
    <div class="alert-modal-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg></div>
    <h2 id="alertTitle">Hay pendientes que revisar</h2>
    <p class="lead">Encontramos ${alertItems.length} aviso${alertItems.length === 1 ? '' : 's'} de documentación o pagos pendientes. Tocá un aviso para ir directo al detalle.</p>
    <div class="alert-list">
${alertItems.map(a => `      <button class="alert-item" data-jump="${a.id}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        <span class="t">${a.text}</span>
      </button>`).join('\n')}
    </div>
    <div class="alert-actions">
      <button class="alert-btn" id="alertDismiss" type="button">Entendido, ver el panel</button>
    </div>
  </div>
</div>` : '';

const updatedStr = `${String(TODAY.getUTCDate()).padStart(2, '0')} ${MESES[TODAY.getUTCMonth()]} ${REF_YEAR}`;

const TEMPLATE = fs.readFileSync(path.join(__dirname, 'sipia_dashboard_template.html'), 'utf8');

const replacements = {
  '{{ALERT_MODAL}}': alertModalHtml,
  '{{UPDATED_DATE}}': updatedStr,
  '{{STAT_CONTRACTS}}': contracts.length,
  '{{STAT_SHIPMENTS_TOTAL}}': allShipments.length,
  '{{STAT_LOADED_PCT}}': (statusCounts.loaded / totalShip * 100).toFixed(1),
  '{{STAT_ONGOING_PCT}}': (statusCounts.ongoing / totalShip * 100).toFixed(1),
  '{{STAT_TBI_PCT}}': (statusCounts.tbi / totalShip * 100).toFixed(1),
  '{{STAT_LOADED_N}}': statusCounts.loaded,
  '{{STAT_ONGOING_N}}': statusCounts.ongoing,
  '{{STAT_TBI_N}}': statusCounts.tbi,
  '{{STAT_FOB}}': money(totalFOB),
  '{{STAT_DELAYED_N}}': delayed.length,
  '{{STAT_DELAYED_TOTAL}}': allShipments.length,
  '{{STAT_DELAYED_AVG}}': avgDelay,
  '{{CONTRACTS}}': contractsHtml,
};

let html = TEMPLATE;
for (const [key, value] of Object.entries(replacements)) {
  html = html.split(key).join(String(value));
}

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, html, 'utf8');
console.log('OK - generado', OUT_FILE, 'con', contracts.length, 'contratos y', allShipments.length, 'embarques.');
