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
        try { resolve(JSON.parse(body)); }
        catch (e) { resolve({ status: res.statusCode }); }
      });
    });
    req.on('error', reject);
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

  const { name, tel, email, erreichbarkeit, grund, gebaeude, nachricht, website, formzeit } = body;

  // Honeypot
  if (website) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  // Zeitstempel-Check: unter 3 Sekunden = Bot
  if (!formzeit || (Date.now() - parseInt(formzeit)) < 3000) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  if (!name || !email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name und E-Mail sind Pflichtfelder' }) };
  }

  try {
    // 1. Benachrichtigung an Angela
    await brevoRequest(brevoKey, {
      sender: { name: 'Krause Immobilienbewertung Website', email: 'info@krauseimmo.com' },
      to: [{ email: 'info@immobilienbewertung-krause.de', name: 'Angela Krause' }],
      replyTo: { email: email, name: name },
      subject: 'Neue Gutachteranfrage – ' + name,
      htmlContent:
        '<h2>Neue Gutachtenanfrage (gutachter-krause.de)</h2>' +
        '<table style="border-collapse:collapse;width:100%">' +
        '<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Name</strong></td><td style="padding:8px;border-bottom:1px solid #eee">' + name + '</td></tr>' +
        '<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>E-Mail</strong></td><td style="padding:8px;border-bottom:1px solid #eee"><a href="mailto:' + email + '">' + email + '</a></td></tr>' +
        (tel ? '<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Telefon</strong></td><td style="padding:8px;border-bottom:1px solid #eee"><a href="tel:' + tel + '">' + tel + '</a></td></tr>' : '') +
        (erreichbarkeit ? '<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Erreichbarkeit</strong></td><td style="padding:8px;border-bottom:1px solid #eee">' + erreichbarkeit + '</td></tr>' : '') +
        (grund ? '<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Anliegen</strong></td><td style="padding:8px;border-bottom:1px solid #eee">' + grund + '</td></tr>' : '') +
        (gebaeude ? '<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Gebäudeart</strong></td><td style="padding:8px;border-bottom:1px solid #eee">' + gebaeude + '</td></tr>' : '') +
        (nachricht ? '<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Nachricht</strong></td><td style="padding:8px;border-bottom:1px solid #eee">' + nachricht + '</td></tr>' : '') +
        '</table>' +
        '<p style="margin-top:1.5rem;color:#666">Diese Nachricht wurde automatisch von gutachter-krause.de gesendet.</p>'
    });

    // 2. Bestätigung an Absender
    await brevoRequest(brevoKey, {
      sender: { name: 'Angela Krause Immobilienbewertung', email: 'info@krauseimmo.com' },
      to: [{ email: email, name: name }],
      subject: 'Ihre Anfrage – Angela Krause Immobilienbewertung',
      htmlContent:
        '<p>Sehr geehrte/r ' + name + ',</p>' +
        '<p>vielen Dank für Ihre Anfrage zur Immobilienbewertung. Ich habe Ihre Nachricht erhalten und melde mich schnellstmöglich bei Ihnen.</p>' +
        '<p>In der Regel erhalten Sie innerhalb von 24 Stunden (Mo–Fr) eine persönliche Rückmeldung.</p>' +
        '<p>Bei dringenden Fragen erreichen Sie mich unter <a href="tel:+491608006113">0160 / 800 6113</a> oder <a href="mailto:info@immobilienbewertung-krause.de">info@immobilienbewertung-krause.de</a>.</p>' +
        '<p>Mit freundlichen Grüßen<br>Angela Krause (M.Sc.)<br>Immobiliensachverständige – DEKRA-zertifiziert</p>'
    });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Anfrage konnte nicht verarbeitet werden.', details: error.message })
    };
  }
};
