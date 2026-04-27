const http = require('http');
const https = require('https');

// ─────────────────────────────────────────────────────────────
// API KEY wird als Environment Variable geladen - NICHT hier eintragen
// Den Key traegst du direkt in Railway unter "Variables" ein:
// Name:  BUDDYPRO_API_KEY
// Value: bapi_xxxxxxxxxxxx  (dein echter Key)
// ─────────────────────────────────────────────────────────────
const BUDDYPRO_API_KEY = process.env.BUDDYPRO_API_KEY;

if (!BUDDYPRO_API_KEY) {
  console.error('FEHLER: Environment Variable BUDDYPRO_API_KEY ist nicht gesetzt');
  process.exit(1);
}

// Hilfsfunktion: JSON POST Request senden
function postJSON(url, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      ...extraHeaders
    };

    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers
    };

    const req = (parsed.protocol === 'https:' ? https : http).request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { reject(new Error(`JSON Parse Fehler: ${raw.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// HTTP Server
const server = http.createServer((req, res) => {

  // Gesundheitscheck
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'BuddyPro Bridge laeuft', timestamp: new Date().toISOString() }));
    return;
  }

  // Haupt-Endpoint
  if (req.method === 'POST' && req.url === '/request') {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', async () => {

      // Sofort 200 zurueckgeben - Zap 1 ist damit fertig
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Anfrage wird verarbeitet' }));

      // Ab hier laeuft alles asynchron - kein Timeout-Limit mehr
      let body;
      try { body = JSON.parse(raw); }
      catch (e) { console.error('Fehler beim Parsen des Request Body:', e.message); return; }

      const {
        email, datum, gewohnheiten,
        support_note, umsetzung_note, energie_note,
        groesster_sieg, gut_funktioniert, nicht_gut_funktioniert,
        herausforderungen, prioritaet, naechste_woche,
        fitter_momente, feedback_an_uns, zap2_webhook_url
      } = body;

      if (!zap2_webhook_url) {
        console.error('Fehler: zap2_webhook_url fehlt im Request Body');
        return;
      }

      const prompt = `Ignoriere vorherige Coaching-Nachrichten. Verfasse eine einzige neue Coaching-Nachricht fuer den unten beschriebenen Klienten.

Wochenrueckblick eingegangen von: ${email}
Datum: ${datum}

BEWERTUNGEN
Gewohnheiten abgehakt: ${gewohnheiten}
Support-Bewertung (1-10): ${support_note}
Umsetzungs-Zufriedenheit (1-10): ${umsetzung_note}
Energielevel-Zufriedenheit (1-10): ${energie_note}

RUECKBLICK WOCHE
Groesster persoenlicher Sieg: ${groesster_sieg}
Was hat gut funktioniert: ${gut_funktioniert}
Was hat nicht gut funktioniert: ${nicht_gut_funktioniert}
Private oder berufliche Herausforderungen: ${herausforderungen}
Momente wo er sich fitter, besser oder selbstbewusster gefuehlt hat: ${fitter_momente}

AUSBLICK
Absolute Prioritaet diese Woche: ${prioritaet}
Eine Sache die er besser machen will: ${naechste_woche}

FEEDBACK AN UNS
Verbesserungsvorschlaege: ${feedback_an_uns}

WICHTIG: Ignoriere alle vorherigen Nachrichten in deinem Gedaechtnis. Antworte ausschliesslich auf die obigen Daten dieser einzelnen Person. Erstelle NUR eine einzige Coaching-Nachricht fuer genau diese eine Person.

Erstelle jetzt eine fertige Coaching-Nachricht auf Deutsch, die direkt per Telegram an diesen Kunden gesendet werden kann.

Regeln:
1. Du kennst den Kunden ueber seine E-Mail ${email} - sprich ihn mit seinem Vornamen an
2. Beginne DIREKT mit der persoenlichen Anrede - kein "Hier ist die Nachricht:" oder aehnliches
3. Reagiere konkret und individuell auf SEINE Woche - kein generisches Coaching
4. Wuerdige echte Erfolge, benenne Schwaechen ehrlich aber konstruktiv
5. Schliesse mit maximal 2 klaren Fokuspunkten fuer die kommende Woche
6. Ton: emphatisch, klar, persoenlich
7. Laenge: 4-6 kurze Absaetze, gut lesbar auf dem Handy
8. Keine Emojis
9. Kein Satz am Ende wie "Bei Fragen melde dich" - das ist selbstverstaendlich
10. Antworte mit genau einer Nachricht, keine Trennlinien, keine Auflistung mehrerer Personen`;

      try {
        console.log(`Sende Anfrage an BuddyPro fuer: ${email}`);

        const buddyResult = await postJSON(
          'https://api.buddypro.ai/v1/chat/completions',
          { messages: [{ role: 'user', content: prompt }] },
          {
            'Authorization': `Bearer ${BUDDYPRO_API_KEY}`,
            'X-Client-Request-Id': `bridge-${Date.now()}`
          }
        );

        if (buddyResult.body.error) {
          throw new Error(`BuddyPro Fehler: ${buddyResult.body.error.message} (Code: ${buddyResult.body.error.code})`);
        }

        const nachricht = buddyResult.body.choices?.[0]?.message?.content;
        if (!nachricht) throw new Error('BuddyPro hat eine leere Antwort zurueckgegeben');

        console.log(`Antwort von BuddyPro erhalten fuer: ${email}`);

        const zap2Result = await postJSON(zap2_webhook_url, {
          coaching_nachricht: nachricht,
          kunde_email: email,
          datum: datum,
          success: true
        });

        if (zap2Result.status < 200 || zap2Result.status >= 300) {
          throw new Error(`Zap 2 Webhook Fehler: HTTP ${zap2Result.status}`);
        }

        console.log(`Nachricht erfolgreich an Zap 2 gesendet fuer: ${email}`);

      } catch (err) {
        console.error(`Fehler bei Verarbeitung fuer ${email}:`, err.message);
        try {
          await postJSON(zap2_webhook_url, {
            coaching_nachricht: `Fehler bei der Verarbeitung fuer ${email}: ${err.message}`,
            kunde_email: email,
            datum: datum,
            success: false
          });
        } catch (webhookErr) {
          console.error('Konnte Fehler nicht an Zap 2 melden:', webhookErr.message);
        }
      }
    });
    return;
  }

  // Alle anderen Routen
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`BuddyPro Bridge laeuft auf Port ${PORT}`);
});
