/*
 * Anzeigen-Kennung (GCLID/GBRAID/WBRAID) und UTM-Werte aus der Adresse lesen.
 * Es wird nichts auf dem Gerät gespeichert (kein Cookie, kein localStorage).
 * Damit die Kennung beim Wechsel auf eine Unterseite erhalten bleibt,
 * wird sie an interne Links angehängt.
 * Das Formular übermittelt die Kennung zur Zuordnung der Anfrage.
 * An Google geht sie später nur, wenn die Person im Cookie-Banner
 * „Marketing & Werbung“ zugestimmt hat (krauseMarketingConsent).
 */
(function () {
  var KEYS = ['gclid', 'gbraid', 'wbraid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term'];
  var SAFE = /^[A-Za-z0-9_\-.~ äöüÄÖÜß+]{1,200}$/;
  var params = {};
  try {
    var q = new URLSearchParams(window.location.search);
    KEYS.forEach(function (k) {
      var v = q.get(k);
      if (v && SAFE.test(v)) params[k] = v;
    });
  } catch (e) { /* alte Browser: einfach ohne Kennung */ }

  window.krauseAdParams = params;

  // Entscheidung aus dem Cookie-Banner („Marketing & Werbung“) zum Zeitpunkt des Absendens
  window.krauseMarketingConsent = function () {
    try {
      var raw = localStorage.getItem('krause_immo_consent');
      if (!raw) return false;
      var d = JSON.parse(raw);
      if (d.expires && Date.now() > d.expires) return false;
      return d.marketing === true;
    } catch (e) { return false; }
  };

  /*
   * Erweiterte Conversions für Leads: Nach erfolgreichem Absenden – nur mit Einwilligung –
   * E-Mail und Telefon (normalisiert) als Ereignis „av_anfrage“ an den Tag Manager geben.
   * Das GTM-Tag „Google Ads – Nutzerdaten Anfrage“ schickt sie verschlüsselt an Google Ads.
   * weiter() wird danach aufgerufen (spätestens nach 1,5 Sekunden), z. B. Weiterleitung zur Danke-Seite.
   */
  window.krauseLeadEvent = function (email, tel, weiter) {
    var fertig = false;
    function los() { if (!fertig) { fertig = true; weiter(); } }
    try {
      if (!window.krauseMarketingConsent()) return los();
      var ud = {};
      var m = String(email || '').trim().toLowerCase();
      var mp = m.split('@');
      if (mp.length === 2 && (mp[1] === 'gmail.com' || mp[1] === 'googlemail.com')) m = mp[0].replace(/\./g, '') + '@' + mp[1];
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m)) ud.email = m;
      var d = String(tel || '').replace(/[^0-9+]/g, '');
      if (d.charAt(0) === '+') d = '+' + d.slice(1).replace(/\+/g, '');
      else if (d.slice(0, 2) === '00') d = '+' + d.slice(2);
      else if (d.charAt(0) === '0') d = '+49' + d.slice(1);
      if (/^\+[1-9][0-9]{7,14}$/.test(d)) ud.phone_number = d;
      if (!ud.email && !ud.phone_number) return los();
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ event: 'av_anfrage', av_user_data: ud, eventCallback: los, eventTimeout: 1500 });
      setTimeout(los, 1500);
    } catch (e) { los(); }
  };

  /*
   * Klick auf eine Telefonnummer: einmal pro Seitenaufruf eine Zeile „Anruf über Landingpage“
   * in der Anfragen-Tabelle anlegen (ohne Kontaktdaten; Kennung nur mit Einwilligung).
   */
  var anrufGemeldet = false;
  document.addEventListener('click', function (ev) {
    try {
      var a = ev.target && ev.target.closest ? ev.target.closest('a[href^="tel:"]') : null;
      if (!a || anrufGemeldet) return;
      anrufGemeldet = true;
      var daten = { seite: window.location.pathname, ads_consent: window.krauseMarketingConsent() };
      ['gclid', 'gbraid', 'wbraid', 'utm_campaign', 'utm_term'].forEach(function (k) { if (params[k]) daten[k] = params[k]; });
      var blob = new Blob([JSON.stringify(daten)], { type: 'application/json' });
      if (!(navigator.sendBeacon && navigator.sendBeacon('/.netlify/functions/anruf-klick', blob))) {
        fetch('/.netlify/functions/anruf-klick', { method: 'POST', body: JSON.stringify(daten), headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(function () {});
      }
    } catch (e) { /* Anruf funktioniert trotzdem */ }
  }, true);

  function init() {
    // Kennung an interne Links anhängen
    if (!Object.keys(params).length) return;
    var links = document.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#' || /^(mailto:|tel:|javascript:)/i.test(href)) continue;
      try {
        var u = new URL(href, window.location.href);
        if (u.host !== window.location.host) continue;
        KEYS.forEach(function (k) { if (params[k] && !u.searchParams.has(k)) u.searchParams.set(k, params[k]); });
        a.setAttribute('href', u.pathname + u.search + u.hash);
      } catch (e) { /* Link unverändert lassen */ }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
