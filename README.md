# 📱 Gestione Orari di Lavoro — Giusy de Santis (v1.6.0)

Applicazione web progressiva (PWA) ottimizzata per smartphone per la visualizzazione e gestione dei turni di lavoro di Giusy de Santis a partire dai file Excel mensili (`.xlsx`), con sincronizzazione cloud su Firebase e predisposizione per il deployment su Vercel.

---

## 🌟 Funzionalità Principali

1. **Calendario Mensile a Settimane Complete & Riconoscimento Ferie (Novità v1.6.0)**:
   - **Riconoscimento automatico caselle azzurre (Ferie)**: durante l'importazione del file Excel, le celle evidenziate in colore azzurro (`#33CCFF` / ciano) vengono identificate tramite analisi degli stili XML del file `.xlsx` (`JSZip`) e contrassegnate come **Ferie** (e **NON** come riposo).
   - **Evidenziazione in azzurro sul calendario**: le giornate di ferie mostrano badge dedicato "Ferie" e orario "Ferie" con tonalità azzurra sia in modalità chiara che scura.
   - **Settimane complete da Lunedì a Domenica**: il calendario mostra le settimane intere includendo i giorni a cavallo del mese precedente e successivo (con relativi turni orari, riposo o ferie evidenziati).
   - **Transizione automatica al mese in corso**: dal primo giorno del mese successivo (o mese solare reale), il calendario si posiziona automaticamente su tutto il mese in corso.
   - 🟢 **Riposo**: evidenzia i giorni senza turni assegnati (0 ore).
   - 🩵 **Ferie**: evidenzia le giornate di ferie/vacanza riconosciute dalle celle azzurre.
   - 🟡 **Apertura o Chiusura**: evidenzia i giorni in cui è prevista l'apertura (inizio turno $\le$ 09:30) o la chiusura (uscita turno $\ge$ 21:00) del punto vendita.
   - 🔵 **Turno Ordinario**: turni regolari intermedi.
   - 🟣 **Simbolino Cambio Turno (⇄)**: segnala immediatamente le giornate in cui l'orario effettivo è stato variato manualmente rispetto al file Excel.

2. **☁️ Motore di Sincronizzazione Firebase Cloud Potenziato (Novità v1.6.0)**:
   - **Sincronizzazione immediata di tutte le variazioni**: ogni modifica inserita (variazione orario effettivo, cambio straordinari, passaggio a riposo o ferie) viene validata, sanitizzata e sincronizzata all'istante su Firestore Cloud.
   - **Riconciliazione bidirezionale intelligente**: all'avvio o allo sblocco dell'app confronta la versione locale e quella su Firebase tramite timestamp `lastUpdate`, assicurando che modifiche effettuate da altri dispositivi non vadano mai perse.
   - **Realtime Firestore Listener**: ascolta in tempo reale con `onSnapshot` le modifiche salvate su Firestore per aggiornare istantaneamente tutti i dispositivi collegati.
   - **Tasto "Sincronizza Ora" nelle Impostazioni**: consente di forzare in qualsiasi momento una riconciliazione manuale immediata tra dispositivo locale e Cloud Firebase.

3. **🤖 Commento Elaborato dalla AI**:
   - **Card Analisi AI sotto il riepilogo del mese**: elabora dinamicamente una valutazione approfondita del mese in corso.
   - **Metriche analizzate**: ore complessive, media settimanale rispetto al contratto part-time da 20h, rapporto tra giorni lavorati, di riposo e di ferie, frequenza aperture/chiusure, weekend e ore di straordinario.
   - **Confronto trend con i mesi precedenti**: calcola l'incremento o decremento delle ore totali, l'andamento degli straordinari e l'intensità delle chiusure serali rispetto al mese precedente.
   - **Suggerimento pratico dell'assistente**: consigli mirati sul recupero e sulla gestione dei ritmi di lavoro.

4. **⏱️ Rilevamento Straordinari & Riepilogo Mese a 5 Riquadri**:
   - **Verifica automatica soglia 5 ore**: l'app analizza ogni giornata lavorativa. Se supera le 5 ore (orario contrattuale di base), nel modale del giorno compare una **casella dedicata per lo straordinario** con possibilità di modifica e sovrascrittura.
   - **Riepilogo Mese Selezionato**: 5 riquadri compatti (*Ore Lavorate*, *Giorni Riposo*, *Aperture*, *Chiusure*, *Straordinari*) che **tengono conto esclusivamente dei giorni appartenenti al mese selezionato**.
   - **Integrazione completa nelle Statistiche**: metrica KPI card nel modale statistiche e colonna dedicata (*Straord.*) nella tabella analitica settimanale.

5. **✏️ Variazione Manuale Orario Effettivo & Protezione Modifiche**:
   - Possibilità di impostare ogni giorno come **Turno Lavorativo**, **Giorno di Riposo** o **Giorno di Ferie** con nota opzionale sul motivo.
   - Salvaguardia esplicita: i giorni con orario variato non vengono sovrascritti dai nuovi file Excel senza autorizzazione esplicita.

6. **📥 Acquisizione Intelligente da Excel & Gestione Mesi**:
   - **Giorni a cavallo del mese successivo**: include automaticamente anche i turni dei primi giorni del mese successivo presenti nella settimana finale (es. 1, 2, 3 Ottobre nel file di Settembre).
   - **Filtro giorni non compilati**: non importa le giornate in cui non è stato compilato l'orario per nessuna persona dell'intero negozio, a meno che non siano ferie per Giusy.
   - **Aggiunta cumulativa e sovrascrittura selettiva dei soli giorni presenti**: quando si importa un nuovo file, l'app sovrascrive **esclusivamente i giorni contenuti nel file** lasciando **inalterati** tutti gli altri giorni dello stesso mese (o di mesi diversi) che non sono inclusi nel file e che erano stati importati in precedenza da altri file.
   - **Conferma per date coincidenti**: se un file contiene date già presenti in archivio, l'app chiede conferma prima di aggiornare tali date, salvaguardando le modifiche manuali salvo autorizzazione esplicita.

7. **📊 Schermata Statistiche & Sezione Cambi**:
   - Simbolo **Statistiche** nella barra superiore.
   - **Metriche KPI**: Ore Totali, Media Settimanale (su 20h), Riposi, Giorni Ferie, Aperture, Chiusure, Weekend, Turni Variati, **Ore Straordinario**.
   - **Registro Cambi Turno**: storico delle variazioni manuali con differenza ore e tasto ripristina.
   - Grafico SVG a barre delle settimane con target 20h, frequenza per giorno della settimana, tabella settimanale analitica e registro aperture/chiusure.

8. **Banner Periodo Turni (in alto nella schermata principale)**:
   - Mostra l'intervallo iniziale e finale delle date relative ai turni importati (es. `6 Settembre 2026 — 3 Ottobre 2026`).

9. **Schermata Impostazioni**:
   - Tasto **Impostazioni** (icona ingranaggio in alto a destra).
   - Scelta del tema: **Chiaro** o **Scuro**.
   - Versione software indicata: **v1.6.0**.
   - Stato sincronizzazione Cloud con badge Online/Locale e pulsante "Sincronizza Ora".
   - Pulsante per ribloccare l'applicazione con password.

10. **Sicurezza e Crittografia Avanzata**:
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
