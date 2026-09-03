# 📱 Gestione Orari di Lavoro — Giusy de Santis (v1.4.0)

Applicazione web progressiva (PWA) ottimizzata per smartphone per la visualizzazione e gestione dei turni di lavoro di Giusy de Santis a partire dai file Excel mensili (`.xlsx`), con sincronizzazione cloud su Firebase e predisposizione per il deployment su Vercel.

---

## 🌟 Funzionalità Principali

1. **Calendario Mensile Touch & Responsive**:
   - 🟢 **Verde - Giorni di Riposo**: evidenzia i giorni senza turni assegnati (0 ore).
   - 🟡 **Giallo - Apertura o Chiusura**: evidenzia i giorni in cui è prevista l'apertura (inizio turno $\le$ 09:30) o la chiusura (uscita turno $\ge$ 21:00) del punto vendita.
   - 🔵 **Turno Ordinario**: turni regolari intermedi.
   - 🟣 **Simbolino Cambio Turno (⇄)**: segnala immediatamente le giornate in cui l'orario effettivo è stato variato manualmente rispetto al file Excel.
   - Nella casella di ciascun giorno sono riportati l'orario di inizio e fine lavoro e il totale delle ore.
   - Toccando una casella si apre il dettaglio completo della giornata.

2. **⏱️ Rilevamento Straordinari & Sovrascrittura Manuale (Novità v1.4.0)**:
   - **Verifica automatica soglia 5 ore**: l'app analizza ogni giornata lavorativa. Se supera le 5 ore (orario contrattuale di base per part-time a 20h), nel modale del giorno compare una **casella dedicata per lo straordinario** di fianco al "Totale Ore Lavorate".
   - **Possibilità di sovrascrittura**: toccando l'icona matita accanto allo straordinario è possibile modificare e sovrascrivere direttamente le ore di straordinario salvando il valore personalizzato.
   - **Riepilogo Mese a 5 Riquadri**: nella schermata principale, il riepilogo mensile è ottimizzato su 5 riquadri compatti (*Ore Lavorate*, *Giorni Riposo*, *Aperture*, *Chiusure*, *Straordinari*).
   - **Integrazione completa nelle Statistiche**: le ore di straordinario sono visibili come metrica KPI card nel modale statistiche e come colonna dedicata (*Straord.*) nella tabella analitica settimanale.

3. **✏️ Variazione Manuale Orario Effettivo (Novità v1.3.0)**:
   - Nel modale di dettaglio del giorno è possibile modificare l'orario di inizio e fine effettivi (o impostare il giorno come Riposo), inserendo anche una nota sul motivo del cambio.
   - L'applicazione memorizza l'orario originale da Excel e calcola in tempo reale le nuove ore, aperture o chiusure.
   - È sempre possibile ripristinare l'orario originale con un singolo tocco.

4. **🛡️ Protezione Esplicita Turni Variati (Novità v1.3.0)**:
   - I turni variati manualmente non possono essere sovrascritti dai successivi caricamenti Excel se non con **autorizzazione esplicita**.
   - All'importazione di un file con turni già variati a mano, l'app avvisa l'utente e permette di scegliere se mantenere le modifiche manuali o autorizzare la sovrascrittura.

5. **📥 Acquisizione Intelligente da Excel & Gestione Mesi**:
   - **Giorni a cavallo del mese successivo**: include automaticamente anche i turni dei primi giorni del mese successivo presenti nella settimana finale (es. 1, 2, 3 Ottobre nel file di Settembre).
   - **Filtro giorni non compilati**: non importa le giornate in cui non è stato compilato l'orario per nessuna persona dell'intero negozio.
   - **Aggiunta cumulativa**: i turni di nuovi mesi si sommano all'archivio senza cancellare i mesi precedenti.
   - **Conferma per mesi doppi**: se un mese è già presente, l'app chiede se si desidera sostituirlo.

6. **📊 Schermata Statistiche & Sezione Cambi**:
   - Simbolo **Statistiche** nella barra superiore.
   - **Metriche KPI**: Ore Totali, Media Settimanale (su 20h), Riposi, Aperture, Chiusure, Weekend, Turni Variati, **Ore Straordinario**.
   - **Registro Cambi Turno**: storico delle variazioni manuali con differenza ore e tasto ripristina.
   - Grafico SVG a barre delle settimane con target 20h, frequenza per giorno della settimana, tabella settimanale analitica e registro aperture/chiusure.

7. **Banner Periodo Turni (in alto nella schermata principale)**:
   - Mostra l'intervallo iniziale e finale delle date relative ai turni importati (es. `6 Settembre 2026 — 3 Ottobre 2026`).

4. **Sincronizzazione Cloud Firebase**:
   - Ad ogni importazione o aggiornamento mese, i dati cumulativi vengono sincronizzati su Firebase (sia come stato corrente che nello storico per statistiche future).
   - Funzionamento offline garantito: i turni vengono memorizzati anche in locale (`localStorage`) per essere sempre disponibili anche in assenza di connessione.

5. **Schermata Impostazioni**:
   - Tasto **Impostazioni** (icona ingranaggio in alto a destra).
   - Scelta del tema: **Chiaro** o **Scuro**.
   - Versione software indicata: **v1.2.0**.
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
