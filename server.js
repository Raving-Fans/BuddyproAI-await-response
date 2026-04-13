const express = require('express');
const app = express();
app.use(express.json());

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

// Gesundheitscheck - zum Testen ob der Server läuft
app.get('/', (req, res) => {
  res.json({ status: 'BuddyPro Bridge läuft', timestamp: new Date().toISOString() });
});

// Haupt-Endpoint: empfängt Daten von Zap 1
app.post('/request', async (req, res) => {

  // Sofort 200 an Zap 1 zurückgeben
  // Damit ist Zap 1 fertig und hat kein Timeout-Problem mehr
  res.json({ success: true, message: 'Anfrage wird verarbeitet' });

  // Ab hier läuft alles asynchron - kein Timeout-Limit mehr
  const {
    email,
    datum,
    gewohnheiten,
    support_note,
    umsetzung_note,
    energie_note,
    groesster_sieg,
    gut_funktioniert,
    nicht_gut_funktioniert,
    herausforderungen,
    prioritaet,
    naechste_woche,
    fitter_momente,
    feedback_an_uns,
    zap2_webhook_url   // Zap 2 Webhook URL - wird von Zap 1 mitgeschickt
  } = req.body;

  // Validierung: ohne Webhook URL können wir die Antwort nirgendwo hinschicken
  if (!zap2_webhook_url) {
    console.error('Fehler: zap2_webhook_url fehlt im Request Body');
    return;
  }

  // ─────────────────────────────────────────────────────────────
  // PROMPT - Vollstaendige Version mit allen Regeln
  // ─────────────────────────────────────────────────────────────
  const prompt = `Wochenrueckblick eingegangen von: ${email}
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
9. Kein Satz am Ende wie "Bei Fragen melde dich" - das ist selbstverstaendlich`;

  try {
    console.log(`Sende Anfrage an BuddyPro fuer: ${email}`);

    // BuddyPro anfragen - wartet so lange wie noetig, kein Timeout
    const buddyResponse = await fetch('https://api.buddypro.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BUDDYPRO_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Client-Request-Id': `bridge-${Date.now()}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const buddyData = await buddyResponse.json();

    // Fehler von BuddyPro abfangen
    if (buddyData.error) {
      throw new Error(`BuddyPro Fehler: ${buddyData.error.message} (Code: ${buddyData.error.code})`);
    }

    const nachricht = buddyData.choices?.[0]?.message?.content;

    if (!nachricht) {
      throw new Error('BuddyPro hat eine leere Antwort zurueckgegeben');
    }

    console.log(`Antwort von BuddyPro erhalten fuer: ${email}`);

    // Coaching-Nachricht an Zap 2 schicken
    const zap2Response = await fetch(zap2_webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coaching_nachricht: nachricht,
        kunde_email: email,
        success: true
      })
    });

    if (!zap2Response.ok) {
      throw new Error(`Zap 2 Webhook Fehler: HTTP ${zap2Response.status}`);
    }

    console.log(`Nachricht erfolgreich an Zap 2 gesendet fuer: ${email}`);

  } catch (err) {
    console.error(`Fehler bei Verarbeitung fuer ${email}:`, err.message);

    // Fehlermeldung ebenfalls an Zap 2 schicken
    // So bekommst du auch bei Fehlern eine Nachricht und weisst Bescheid
    try {
      await fetch(zap2_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coaching_nachricht: `Fehler bei der Verarbeitung fuer ${email}: ${err.message}`,
          kunde_email: email,
          datum: datum,
          success: false
        })
      });
    } catch (webhookErr) {
      console.error('Konnte Fehler nicht an Zap 2 melden:', webhookErr.message);
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`BuddyPro Bridge laeuft auf Port ${PORT}`);
});
