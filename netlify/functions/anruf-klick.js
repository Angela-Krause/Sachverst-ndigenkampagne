/*
 * Offline-Conversions: Tippt jemand auf die Telefonnummer, wird in der
 * Anfragen-Tabelle eine Zeile „Anruf über Landingpage“ angelegt. Angela trägt
 * danach Name, Nummer und Status nach. Es werden keine Kontaktdaten erfasst,
 * nur Zeitpunkt, Seite und – mit Einwilligung – die Anzeigen-Kennung.
 * Umgebungsvariablen: SHEET_WEBHOOK_URL, SHEET_WEBHOOK_SECRET (wie gutachter-anfrage).
 */
const https = require('https');

function clean(v, max) {
  v = String(v == null ? '' : v).trim();
  if (!v || v.length > (max || 200) || !/^[A-Za-z0-9_\-.~ äöüÄÖÜß+\/]+$/.test(v)) return '';
  return v;
}

function sendToSheet(row) {
  const url = process.env.SHEET_WEBHOOK_URL;
  if (!url) return Promise.resolve('kein SHEET_WEBHOOK_URL gesetzt');
  return new Promise((resolve) => {
    let target;
    try { target = new URL(url); } catch (e) { return resolve('ungültige SHEET_WEBHOOK_URL'); }
    const data = JSON.stringify({ secret: process.env.SHEET_WEBHOOK_SECRET || '', ...row });
    const req = https.request({
      hostname: target.hostname,
      path: target.pathname + target.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', (e) => resolve('Fehler: ' + e.message));
    req.setTimeout(8000, () => { req.destroy(); resolve('Zeitüberschreitung'); });
    req.write(data);
    req.end();
  });
}

// Einfacher Schutz gegen massenhafte Einträge (gilt je Funktions-Instanz)
const letzte = new Map();
let fenster = 0, anzahl = 0;
function erlaubt(ip) {
  const jetzt = Date.now();
  if (jetzt - fenster > 60000) { fenster = jetzt; anzahl = 0; }
  if (++anzahl > 20) return false;
  if (ip && letzte.has(ip) && jetzt - letzte.get(ip) < 60000) return false;
  if (ip) letzte.set(ip, jetzt);
  if (letzte.size > 500) letzte.clear();
  return true;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' };

  // Nur Aufrufe von der eigenen Seite (Live-Domain oder Netlify-Vorschau)
  const herkunft = String(event.headers.origin || event.headers.referer || '');
  if (!/^https:\/\/([a-z0-9-]+\.)*(gutachter-krause\.de|netlify\.app)(\/|$)/i.test(herkunft)) {
    return { statusCode: 403, body: '' };
  }
  const ip = String(event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || '');
  if (!erlaubt(ip)) return { statusCode: 204, body: '' };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, body: '' }; }

  const einwilligung = body.ads_consent === true;
  const gclid = einwilligung ? clean(body.gclid) : '';
  const gbraid = einwilligung ? clean(body.gbraid) : '';
  const wbraid = einwilligung ? clean(body.wbraid) : '';
  const status = await sendToSheet({
    eingang: new Date().toISOString(),
    name: '',
    tel: '',
    email: '',
    nachricht: 'Klick auf die Telefonnummer – bitte Name, Nummer des Anrufers und Status ergänzen (Datum/Uhrzeit ggf. aus der Anrufliste anpassen)',
    quelle: 'Anruf über Landingpage',
    seite: clean(body.seite, 150) || '/',
    gclid, gbraid, wbraid,
    utm_campaign: einwilligung ? clean(body.utm_campaign, 150) : '',
    utm_term: einwilligung ? clean(body.utm_term, 150) : '',
    einwilligung_google: einwilligung ? 'Ja' : 'Nein'
  });
  console.log('Anruf-Klick an Tabelle:', status);
  return { statusCode: 204, body: '' };
};
