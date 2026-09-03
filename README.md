# 📱 Gestione Orari di Lavoro — Giusy de Santis (v1.5.0)

Applicazione web progressiva (PWA) ottimizzata per smartphone per la visualizzazione e gestione dei turni di lavoro di Giusy de Santis a partire dai file Excel mensili (`.xlsx`), con sincronizzazione cloud su Firebase e predisposizione per il deployment su Vercel.

---

## 🌟 Funzionalità Principali

1. **Calendario Mensile a Settimane Complete**:
   - **Settimane complete da Lunedì a Domenica**: il calendario mostra le settimane intere includendo i giorni a cavallo del mese precedente e successivo (con relativi turni orari o riposo evidenziati).
   - **Legenda e interfaccia pulita**: rimosse le diciture dei colori per un design minimalista e professionale.
   - **Transizione automatica al mese in corso**: dal primo giorno del mese successivo (o mese solare reale), il calendario si posiziona automaticamente su tutto il mese in corso.
   - 🟢 **Riposo**: evidenzia i giorni senza turni assegnati (0 ore).
   - 🟡 **Apertura o Chiusura**: evidenzia i giorni in cui è prevista l'apertura (inizio turno $\le$ 09:30) o la chiusura (uscita turno $\ge$ 21:00) del punto vendita.
   - 🔵 **Turno Ordinario**: turni regolari intermedi.
   - 🟣 **Simbolino Cambio Turno (⇄)**: segnala immediatamente le giornate in cui l'orario effettivo è stato variato manualmente rispetto al file Excel.
   - Nella casella di ciascun giorno sono riportati l'orario di inizio e fine lavoro e il totale delle ore.

2. **🤖 Commento Elaborato dalla AI (Novità v1.5.0)**:
   - **Card Analisi AI sotto il calendario**: elabora dinamicamente una valutazione approfondita del mese in corso.
   - **Metriche analizzate**: ore complessive, media settimanale rispetto al contratto part-time da 20h, rapporto tra giorni lavorati e di riposo, frequenza aperture/chiusure, weekend e ore di straordinario.
   - **Confronto trend con i mesi precedenti**: calcola l'incremento o decremento delle ore totali, l'andamento degli straordinari e l'intensità delle chiusure serali rispetto al mese precedente.
   - **Suggerimento pratico dell'assistente**: consigli mirati sul recupero e sulla gestione dei ritmi di lavoro.

3. **⏱️ Rilevamento Straordinari & Riepilogo Mese a 5 Riquadri**:
   - **Verifica automatica soglia 5 ore**: l'app analizza ogni giornata lavorativa. Se supera le 5 ore (orario contrattuale di base), nel modale del giorno compare una **casella dedicata per lo straordinario** con possibilità di modifica e sovrascrittura.
   - **Riepilogo Mese Selezionato**: 5 riquadri compatti (*Ore Lavorate*, *Giorni Riposo*, *Aperture*, *Chiusure*, *Straordinari*) che **tengono conto esclusivamente dei giorni appartenenti al mese selezionato**.
   - **Integrazione completa nelle Statistiche**: metrica KPI card nel modale statistiche e colonna dedicata (*Straord.*) nella tabella analitica settimanale.

4. **✏️ Variazione Manuale Orario Effettivo & Protezione Modifiche**:
   - Modifica di orario effettivo o riposo dal modale del giorno con nota sul motivo.
   - Salvaguardia esplicita: i giorni con orario variato non vengono sovrascritti dai nuovi file Excel senza autorizzazione esplicita.

5. **📥 Acquisizione Intelligente da Excel & Gestione Mesi**:
   - **Giorni a cavallo del mese successivo**: include automaticamente anche i turni dei primi giorni del mese successivo presenti nella settimana finale (es. 1, 2, 3 Ottobre nel file di Settembre).
   - **Filtro giorni non compilati**: non importa le giornate in cui non è stato compilato l'orario per nessuna persona dell'intero negozio.
   - **Aggiunta cumulativa e sovrascrittura selettiva dei soli giorni presenti**: quando si importa un nuovo file, l'app sovrascrive **esclusivamente i giorni contenuti nel file** lasciando **inalterati** tutti gli altri giorni dello stesso mese (o di mesi diversi) che non sono inclusi nel file e che erano stati importati in precedenza da altri file.
   - **Conferma per date coincidenti**: se un file contiene date già presenti in archivio, l'app chiede conferma prima di aggiornare tali date, salvaguardando le modifiche manuali salvo autorizzazione esplicita.

6. **📊 Schermata Statistiche & Sezione Cambi**:
   - Simbolo **Statistiche** nella barra superiore.
   - **Metriche KPI**: Ore Totali, Media Settimanale (su 20h), Riposi, Aperture, Chiusure, Weekend, Turni Variati, **Ore Straordinario**.
   - **Registro Cambi Turno**: storico delle variazioni manuali con differenza ore e tasto ripristina.
   - Grafico SVG a barre delle settimane con target 20h, frequenza per giorno della settimana, tabella settimanale analitica e registro aperture/chiusure.

7. **Banner Periodo Turni (in alto nella schermata principale)**:
   - Mostra l'intervallo iniziale e finale delle date relative ai turni importati (es. `6 Settembre 2026 — 3 Ottobre 2026`).

8. **Sincronizzazione Cloud Firebase**:
   - Ad ogni importazione o aggiornamento mese, i dati cumulativi vengono sincronizzati su Firebase (sia come stato corrente che nello storico per statistiche future).
   - Funzionamento offline garantito: i turni vengono memorizzati anche in locale (`localStorage`) per essere sempre disponibili anche in assenza di connessione.

9. **Schermata Impostazioni**:
   - Tasto **Impostazioni** (icona ingranaggio in alto a destra).
   - Scelta del tema: **Chiaro** o **Scuro**.
   - Versione software indicata: **v1.5.0**.
   - Stato della sincronizzazione Firebase.
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
