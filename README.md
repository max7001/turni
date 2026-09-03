# 📱 Gestione Orari di Lavoro — Giusy de Santis (v1.0.0)

Applicazione web progressiva (PWA) ottimizzata per smartphone per la visualizzazione e gestione dei turni di lavoro di Giusy de Santis a partire dai file Excel mensili (`.xlsx`), con sincronizzazione cloud su Firebase e predisposizione per il deployment su Vercel.

---

## 🌟 Funzionalità Principali

1. **Calendario Mensile Touch & Responsive**:
   - 🟢 **Verde - Giorni di Riposo**: evidenzia i giorni senza turni assegnati (0 ore).
   - 🟡 **Giallo - Apertura o Chiusura**: evidenzia i giorni in cui è prevista l'apertura (inizio turno $\le$ 09:30) o la chiusura (uscita turno $\ge$ 21:00) del punto vendita.
   - 🔵 **Turno Ordinario**: turni regolari intermedi.
   - Nella casella di ciascun giorno sono riportati l'orario di inizio e fine lavoro e il totale delle ore.
   - Toccando una casella si apre il dettaglio completo della giornata (orario mattina, orario pomeriggio, monte ore, tipologia).

2. **Banner Periodo Turni (in alto nella schermata principale)**:
   - Mostra l'intervallo iniziale e finale delle date relative ai turni importati (es. `6 Settembre 2026 — 3 Ottobre 2026`).

3. **Acquisizione Automatica da Excel (`.xlsx`)**:
   - Tasto **Carica** (icona di upload in alto a destra).
   - Legge esclusivamente il foglio **`"Inserimento Orari"`** e individua la riga di **`"Giusy de Santis"`**.
   - Converte fedelmente la struttura delle settimane e gli orari in formato decimale italiano (`7.3` $\rightarrow$ `07:30`, `9` $\rightarrow$ `09:00`, `13.3` $\rightarrow$ `13:30`, `17` $\rightarrow$ `17:00`, `22` $\rightarrow$ `22:00`).

4. **Sincronizzazione Cloud Firebase**:
   - Ad ogni importazione, i dati vengono salvati automaticamente su Firebase (sia come stato corrente che nello storico per statistiche future).
   - Funzionamento offline garantito: i turni vengono memorizzati anche in locale (`localStorage`) per essere sempre disponibili anche in assenza di connessione.

5. **Schermata Impostazioni**:
   - Tasto **Impostazioni** (icona ingranaggio in alto a destra).
   - Scelta del tema: **Chiaro** o **Scuro**.
   - Versione software indicata: **v1.0.0**.
   - Stato della sincronizzazione Firebase.
   - Pulsante per ribloccare l'applicazione con password.

6. **Sicurezza e Crittografia Avanzata**:
   - Accesso protetto con codice password **`121208`**.
   - Lo smartphone memorizza la sessione in modo sicuro e non richiede più la password agli accessi successivi.
   - **Tutti i dati sensibili sono crittografati**: la password è verificata tramite hashing crittografico `SHA-256`, mentre le chiavi API e i parametri di configurazione di Firebase sono memorizzati in forma cifrata e decifrati dinamicamente solo in memoria a runtime.

---

## 🚀 Pubblicazione su Vercel

L'applicazione è completamente statica e ottimizzata, pronta per Vercel:

### Metodo 1: Tramite Vercel CLI
```bash
cd /Users/massimilianoborri/.gemini/antigravity/scratch/gestione-orari
npx vercel
```

### Metodo 2: Tramite GitHub / Vercel Dashboard
1. Carica la cartella `gestione-orari` su una nuova repository GitHub.
2. Vai su [vercel.com](https://vercel.com) e clicca su **"Add New Project"**.
3. Seleziona il repository GitHub: Vercel riconoscerà automaticamente la configurazione e pubblicherà l'app in pochi secondi.

---

## 📱 Utilizzo come App su Smartphone (PWA)

1. Apri il link di Vercel nel browser del tuo smartphone:
   - **Su iPhone (Safari)**: tocca il tasto di condivisione (icona quadrata con freccia verso l'alto) e seleziona **"Aggiungi alla schermata Home"**.
   - **Su Android (Chrome)**: tocca i 3 puntini in alto a destra e seleziona **"Installa applicazione"** o **"Aggiungi a schermata Home"**.
2. L'app si aprirà a schermo intero senza barre del browser, esattamente come un'app nativa.
3. Inserisci la prima volta il codice `121208` sul tastierino numerico: lo smartphone memorizzerà l'accesso e non lo chiederà più.
