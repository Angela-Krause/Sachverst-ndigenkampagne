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
