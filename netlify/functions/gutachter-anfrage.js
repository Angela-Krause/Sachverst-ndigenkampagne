const https = require('https');

function brevoRequest(brevoKey, mailBody) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(mailBody);
    const req = https.request({
      hostname: 'api.brevo.com',
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': brevoKey,
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode, ...JSON.parse(body) }); }
        catch (e) { resolve({ statusCode: res.statusCode, raw: body }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Eingaben für HTML-Mails maskieren
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Anzeigen-Kennungen und UTM-Werte nur in sicherer Form übernehmen
function clean(v, max) {
  v = String(v == null ? '' : v).trim();
  if (!v || v.length > (max || 200) || !/^[A-Za-z0-9_\-.~ äöüÄÖÜß+\/]+$/.test(v)) return '';
  return v;
}

// Anfrage als Zeile an die Google-Tabelle senden (Apps-Script-Web-App)
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
      // Apps Script antwortet nach dem Eintrag mit einer Weiterleitung (302) – das ist ein Erfolg
      res.on('data', () => {});
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', (e) => resolve('Fehler: ' + e.message));
    req.setTimeout(8000, () => { req.destroy(); resolve('Zeitüberschreitung'); });
    req.write(data);
    req.end();
  });
}

function submitToNetlifyForms(name, tel, email, nachricht, extra) {
  return new Promise((resolve) => {
    const params = new URLSearchParams({
      'form-name': 'gutachter-anfrage',
      name,
      tel,
      email: email || '',
      nachricht: nachricht || '',
      quelle: extra.quelle,
      gclid: extra.gclid || extra.gbraid || extra.wbraid || '',
      seite: extra.seite,
      einwilligung_google: extra.ads_consent ? 'ja' : 'nein'
    });
    const data = params.toString();
    const req = https.request({
      hostname: 'gutachter-krause.de',
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', () => resolve(0));
    req.write(data);
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const brevoKey = process.env.BREVO_API_KEY;
  if (!brevoKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'API not configured' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request' }) };
  }

  const { name, tel, email, nachricht, website, formzeit } = body;
  const extra = {
    gclid: clean(body.gclid),
    gbraid: clean(body.gbraid),
    wbraid: clean(body.wbraid),
    utm_source: clean(body.utm_source, 100),
    utm_campaign: clean(body.utm_campaign, 150),
    utm_term: clean(body.utm_term, 150),
    seite: clean(body.seite, 150) || '/',
    ads_consent: body.ads_consent === true
  };
  const hasAdId = !!(extra.gclid || extra.gbraid || extra.wbraid);
  extra.quelle = hasAdId ? 'Google-Anzeige' : (extra.utm_source ? 'Kampagne: ' + extra.utm_source : 'ohne Anzeigen-Kennung');

  // Honeypot
  if (website) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  // Zeitstempel-Check: unter 3 Sekunden = Bot
  if (!formzeit || (Date.now() - parseInt(formzeit)) < 3000) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  if (!name || !tel) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name und Telefonnummer sind Pflichtfelder' }) };
  }

  // 1. IMMER in Netlify Forms speichern (Backup)
  const netlifyStatus = await submitToNetlifyForms(name, tel, email, nachricht, extra);
  console.log('Netlify Forms backup:', netlifyStatus);

  // 1b. Zeile in die Google-Tabelle für die Auftrags-Rückmeldung
  const sheetStatus = await sendToSheet({
    eingang: new Date().toISOString(),
    name: String(name).slice(0, 120),
    tel: String(tel).slice(0, 60),
    email: String(email || '').slice(0, 120),
    nachricht: String(nachricht || '').slice(0, 1000),
    quelle: extra.quelle,
    seite: extra.seite,
    gclid: extra.gclid,
    gbraid: extra.gbraid,
    wbraid: extra.wbraid,
    utm_campaign: extra.utm_campaign,
    utm_term: extra.utm_term,
    einwilligung_google: extra.ads_consent ? 'Ja' : 'Nein'
  });
  console.log('Google-Tabelle:', sheetStatus);

  // 2. E-Mail über Brevo senden
  try {
    const replyTo = email ? { email: email, name: name } : undefined;
    const notifyResult = await brevoRequest(brevoKey, {
      sender: { name: 'Krause Immobilienbewertung Website', email: 'info@krauseimmo.com' },
      to: [{ email: 'info@immobilienbewertung-krause.de', name: 'Angela Krause' }],
      cc: [{ email: 'info@mb-topad.de', name: 'Marie Böttiger' }],
      ...(replyTo && { replyTo }),
      subject: 'Neue Gutachteranfrage – ' + name,
      htmlContent:
        '<h2>Neue Gutachtenanfrage (gutachter-krause.de)</h2>' +
        '<table style="border-collapse:collapse;width:100%">' +
        '<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Name</strong></td><td style="padding:8px;border-bottom:1px solid #eee">' + esc(name) + '</td></tr>' +
        '<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Telefon</strong></td><td style="padding:8px;border-bottom:1px solid #eee"><a href="tel:' + esc(tel) + '">' + esc(tel) + '</a></td></tr>' +
        (email ? '<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>E-Mail</strong></td><td style="padding:8px;border-bottom:1px solid #eee"><a href="mailto:' + esc(email) + '">' + esc(email) + '</a></td></tr>' : '') +
        (nachricht ? '<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Nachricht</strong></td><td style="padding:8px;border-bottom:1px solid #eee">' + esc(nachricht) + '</td></tr>' : '') +
        '<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Herkunft</strong></td><td style="padding:8px;border-bottom:1px solid #eee">' + esc(extra.quelle) + (extra.utm_term ? ' (Suchbegriff: ' + esc(extra.utm_term) + ')' : '') + '</td></tr>' +
        '<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Seite</strong></td><td style="padding:8px;border-bottom:1px solid #eee">' + esc(extra.seite) + '</td></tr>' +
        (hasAdId ? '<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Einwilligung Erfolgsmessung</strong></td><td style="padding:8px;border-bottom:1px solid #eee">' + (extra.ads_consent ? 'ja' : 'nein') + '</td></tr>' : '') +
        '</table>' +
        '<p style="margin-top:1rem">Bitte in der Tabelle „Anfragen Gutachter Krause“ den Status setzen, sobald ein Angebot oder Auftrag daraus wird.</p>' +
        '<p style="margin-top:1.5rem;color:#666">Diese Nachricht wurde automatisch von gutachter-krause.de gesendet.</p>'
    });

    console.log('Brevo notify result:', JSON.stringify(notifyResult));

    const brevoOk = notifyResult.statusCode >= 200 && notifyResult.statusCode < 300;

    if (!brevoOk) {
      // Brevo fehlgeschlagen — Warn-E-Mail an Marie als Fallback
      console.error('BREVO FEHLER:', JSON.stringify(notifyResult));
      try {
        await brevoRequest(brevoKey, {
          sender: { name: 'Krause Website ALARM', email: 'info@krauseimmo.com' },
          to: [{ email: 'info@mb-topad.de', name: 'Marie Böttiger' }],
          subject: '⚠️ FORMULAR-FEHLER gutachter-krause.de – Anfrage von ' + name,
          htmlContent:
            '<h2 style="color:red">⚠️ E-Mail-Versand fehlgeschlagen!</h2>' +
            '<p>Die folgende Anfrage konnte NICHT per E-Mail zugestellt werden und ist nur im Netlify Dashboard gespeichert.</p>' +
            '<table style="border-collapse:collapse;width:100%">' +
            '<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Name</strong></td><td style="padding:8px;border-bottom:1px solid #eee">' + esc(name) + '</td></tr>' +
            '<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Telefon</strong></td><td style="padding:8px;border-bottom:1px solid #eee">' + esc(tel) + '</td></tr>' +
            (email ? '<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>E-Mail</strong></td><td style="padding:8px;border-bottom:1px solid #eee">' + esc(email) + '</td></tr>' : '') +
            (nachricht ? '<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Nachricht</strong></td><td style="padding:8px;border-bottom:1px solid #eee">' + esc(nachricht) + '</td></tr>' : '') +
            '</table>' +
            '<p><strong>Brevo-Fehler:</strong> ' + JSON.stringify(notifyResult) + '</p>' +
            '<p>Bitte im <a href="https://app.netlify.com/sites/shiny-empanada-a7fff8/forms">Netlify Dashboard</a> prüfen.</p>'
        });
      } catch (warnErr) {
        console.error('Auch Warn-Mail fehlgeschlagen:', warnErr.message);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          warning: 'email_failed',
          message: 'Daten gespeichert, E-Mail-Zustellung fehlgeschlagen'
        })
      };
    }

    // 3. Bestätigung an Absender (nur wenn E-Mail angegeben)
    if (email) {
      const confirmResult = await brevoRequest(brevoKey, {
        sender: { name: 'Angela Krause Immobilienbewertung', email: 'info@krauseimmo.com' },
        to: [{ email: email, name: name }],
        subject: 'Ihre Anfrage – Angela Krause Immobilienbewertung',
        htmlContent:
          '<p>Sehr geehrte/r ' + esc(name) + ',</p>' +
          '<p>vielen Dank für Ihre Anfrage zur Immobilienbewertung. Ich habe Ihre Nachricht erhalten und melde mich schnellstmöglich bei Ihnen.</p>' +
          '<p>In der Regel erhalten Sie innerhalb von 24 Stunden (Mo–Fr) eine persönliche Rückmeldung.</p>' +
          '<p>Bei dringenden Fragen erreichen Sie mich unter <a href="tel:+491608006113">0160 / 800 6113</a> oder <a href="mailto:info@immobilienbewertung-krause.de">info@immobilienbewertung-krause.de</a>.</p>' +
          '<p>Mit freundlichen Grüßen<br>Angela Krause (M.Sc.)<br>Immobiliensachverständige – DEKRA-zertifiziert</p>'
      });
      console.log('Brevo confirm result:', JSON.stringify(confirmResult));
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (error) {
    console.error('Function error:', error.message);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        warning: 'email_error',
        message: 'Daten gespeichert, aber E-Mail konnte nicht gesendet werden: ' + error.message
      })
    };
  }
};
