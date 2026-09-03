/**
 * Gestione Orari di Lavoro - Giusy de Santis
 * Version 1.0.0
 * Mobile-First WebApp with Firebase Cloud Sync & Encrypted Security
 */

// =============================================================================
// 1. SICUREZZA & CRITTOGRAFIA (Zero credenziali o password in chiaro nel codice)
// =============================================================================

// Hash SHA-256 della password autorizzata
const HASH_AUTH_KEY = "426e7b40168da2d94e8fae623a20ff1606e48bc09fc34b47bdce1879249a0f4a";

// Payload cifrato delle credenziali Firebase (derivate da keystream crittografico)
const CIPHER_PAYLOAD = "NH5NTN4ALLBZ7/OHurSNfSInaV4hlgYfVD21wFzcKJSH27gpY4BKD/Ey4Wlh+xaCyYvugCwU5TPwwBiA/C1iQDU+jYyHpur7XnRl4x5twwC2RwXiyPxCghpFZCgclNyszBMhPrsJGVs035SF56doLAGkbRw+GDN1vSXDyPDnI0zivcWeG+m6PZQnMCEWDBnNsIPYrtR3kdfIyTR/2EWYJ0JfY7L6CsDHfZxDw7FPvysIMiNe75J16Xl0h08x5uGH/O8NGx5lblre+/VjwcdIzCGE2HUcLYRfypCv9MtdDi4NnbzsXs/Lk/kES1IqXLS6gzS41PeD6b0voVUXPGX/w3ttSl2ELS+oTubpp5H42ktuXg4gTLgVRksRpehQwQK2ptiuZnWsBFCrJON+a+UP/a3ksQ==";

// Decodifica dinamica in memoria dei parametri Firebase
function decryptFirebaseCredentials(keyHex) {
  try {
    const rawB64 = atob(CIPHER_PAYLOAD);
    const encBytes = new Uint8Array(rawB64.length);
    for (let i = 0; i < rawB64.length; i++) {
      encBytes[i] = rawB64.charCodeAt(i);
    }
    const keyBytes = new Uint8Array(keyHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
    const decBytes = new Uint8Array(encBytes.length);
    for (let i = 0; i < encBytes.length; i++) {
      decBytes[i] = encBytes[i] ^ keyBytes[i % keyBytes.length] ^ ((i * 37 + 13) & 0xFF);
    }
    const jsonStr = new TextDecoder().decode(decBytes);
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error("Errore decifratura configurazione:", err);
    return null;
  }
}

// Verifica PIN tramite Web Crypto API nativa
async function computeSha256(input) {
  const enc = new TextEncoder();
  const data = enc.encode(input);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  const hashArr = Array.from(new Uint8Array(hashBuf));
  return hashArr.map(b => b.toString(16).padStart(2, "0")).join("");
}

// =============================================================================
// 2. STATO APPLICATIVO
// =============================================================================

const APP_STATE = {
  isAuthenticated: false,
  currentDate: new Date(2026, 8, 1), // Default Settembre 2026 (dal roster)
  shiftsData: {}, // Chiave: "YYYY-MM-DD", Valore: Dettaglio turno
  periodInfo: {
    start: null,
    end: null,
    totalWeeks: 0,
    lastUpdate: null
  },
  theme: localStorage.getItem("orari_theme") || "light",
  firebaseDb: null
};

// =============================================================================
// 3. INIZIALIZZAZIONE FIREBASE (Dinamica ed asincrona)
// =============================================================================

async function initFirebase(hashKey) {
  const config = decryptFirebaseCredentials(hashKey);
  if (!config) {
    updateFirebaseStatus(false, "Configurazione non disponibile");
    return;
  }
  
  try {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
    const { getFirestore, doc, setDoc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    
    const app = initializeApp(config);
    const db = getFirestore(app);
    APP_STATE.firebaseDb = db;
    APP_STATE.firestoreOps = { doc, setDoc, getDoc };
    
    updateFirebaseStatus(true, "Connesso & Sincronizzato");
    
    // Prova a recuperare l'ultimo roster salvato su Firebase se non presente in locale
    await loadRemoteShiftsIfAvailable();
  } catch (e) {
    console.warn("Firebase non connesso (funzionamento in modalità locale offline):", e);
    updateFirebaseStatus(false, "Offline (Dati salvati in locale)");
  }
}

function updateFirebaseStatus(isOnline, message) {
  const badge = document.getElementById("firebaseStatusBadge");
  const text = document.getElementById("firebaseStatusText");
  if (badge) {
    badge.textContent = isOnline ? "Online" : "Locale";
    badge.style.background = isOnline ? "var(--riposo-bg)" : "var(--bg-subtle)";
    badge.style.color = isOnline ? "var(--riposo-text)" : "var(--text-muted)";
  }
  if (text) {
    text.textContent = message;
  }
}

async function syncToFirebase(payload) {
  if (!APP_STATE.firebaseDb || !APP_STATE.firestoreOps) {
    console.log("Firebase non attivo, salvataggio solo locale.");
    return;
  }
  try {
    const { doc, setDoc } = APP_STATE.firestoreOps;
    // Salva sia come stato corrente che come record nello storico statistiche
    await setDoc(doc(APP_STATE.firebaseDb, "turni_giusy", "current"), payload);
    const historyId = `import_${Date.now()}`;
    await setDoc(doc(APP_STATE.firebaseDb, "turni_giusy_history", historyId), payload);
    showToast("Dati sincronizzati con successo su Firebase!");
  } catch (err) {
    console.warn("Errore durante il salvataggio su Firebase:", err);
    showToast("Salvataggio locale completato (sincronizzazione cloud fallita).");
  }
}

async function loadRemoteShiftsIfAvailable() {
  if (!APP_STATE.firebaseDb || !APP_STATE.firestoreOps) return;
  try {
    const { doc, getDoc } = APP_STATE.firestoreOps;
    const snap = await getDoc(doc(APP_STATE.firebaseDb, "turni_giusy", "current"));
    if (snap.exists()) {
      const remoteData = snap.data();
      if (remoteData && remoteData.shiftsData) {
        // Se non abbiamo ancora dati in locale o i dati remoti sono più recenti
        const localSaved = localStorage.getItem("giusy_shifts_payload");
        if (!localSaved) {
          applyParsedData(remoteData, false);
          showToast("Turni recuperati dal cloud Firebase");
        }
      }
    }
  } catch (e) {
    console.warn("Impossibile recuperare i turni remoti:", e);
  }
}

// =============================================================================
// 4. GESTIONE AUTENTICAZIONE E PIN KEYPAD
// =============================================================================

let currentEnteredPin = "";

function initAuth() {
  const savedAuth = localStorage.getItem("orari_auth_session");
  if (savedAuth === HASH_AUTH_KEY) {
    // Smartphone ha memorizzato la sessione: accesso immediato senza chiedere più la password
    APP_STATE.isAuthenticated = true;
    showMainApp();
    initFirebase(HASH_AUTH_KEY);
    return;
  }
  
  // Altrimenti mostra la schermata di blocco
  showLockScreen();
}

function showLockScreen() {
  document.getElementById("lockScreen").style.display = "flex";
  document.getElementById("mainApp").style.display = "none";
  currentEnteredPin = "";
  renderPinDots();
}

function showMainApp() {
  document.getElementById("lockScreen").style.display = "none";
  document.getElementById("mainApp").style.display = "flex";
  renderCalendar();
  updatePeriodBanner();
  updateMonthlyStats();
}

function renderPinDots() {
  const dots = document.querySelectorAll("#pinDots .pin-dot");
  dots.forEach((dot, index) => {
    if (index < currentEnteredPin.length) {
      dot.classList.add("filled");
    } else {
      dot.classList.remove("filled");
    }
  });
}

async function handlePinInput(digit) {
  if (currentEnteredPin.length >= 6) return;
  currentEnteredPin += digit;
  renderPinDots();
  
  const errEl = document.getElementById("pinErrorMsg");
  errEl.textContent = "";

  if (currentEnteredPin.length === 6) {
    const computedHash = await computeSha256(currentEnteredPin);
    if (computedHash === HASH_AUTH_KEY) {
      // Password corretta! Memorizza sullo smartphone
      localStorage.setItem("orari_auth_session", HASH_AUTH_KEY);
      APP_STATE.isAuthenticated = true;
      initFirebase(HASH_AUTH_KEY);
      showToast("Accesso autorizzato!");
      setTimeout(() => {
        showMainApp();
      }, 200);
    } else {
      errEl.textContent = "Codice non corretto. Riprova.";
      // Vibrazione errore se supportata
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      setTimeout(() => {
        currentEnteredPin = "";
        renderPinDots();
      }, 600);
    }
  }
}

// Setup Event Listeners per il Tastierino PIN
document.querySelectorAll(".pin-keypad .keypad-btn[data-key]").forEach(btn => {
  btn.addEventListener("click", () => {
    handlePinInput(btn.getAttribute("data-key"));
  });
});

document.getElementById("btnPinBackspace").addEventListener("click", () => {
  if (currentEnteredPin.length > 0) {
    currentEnteredPin = currentEnteredPin.slice(0, -1);
    renderPinDots();
  }
});

document.getElementById("btnPinClear").addEventListener("click", () => {
  currentEnteredPin = "";
  renderPinDots();
  document.getElementById("pinErrorMsg").textContent = "";
});

// =============================================================================
// 5. PARSER EXCEL (.XLSX) SPECIFICO PER "INSERIMENTO ORARI" & "GIUSY DE SANTIS"
// =============================================================================

/**
 * Converte il formato orario decimale del foglio Excel in stringa HH:MM
 * Esempi riscontrati nel file reale:
 * 7.3  -> 07:30
 * 9    -> 09:00
 * 13.3 -> 13:30
 * 17   -> 17:00
 * 22   -> 22:00
 */
function formatDecimalHour(val) {
  if (val === null || val === undefined || val === "") return null;
  const str = String(val).trim().replace(",", ".");
  const num = parseFloat(str);
  if (isNaN(num) || num <= 0) return null;
  
  const hours = Math.floor(num);
  const frac = Math.round((num - hours) * 100);
  
  let minutes = 0;
  if (frac === 3 || frac === 30 || frac === 50) {
    minutes = (frac === 50) ? 30 : (frac === 3 || frac === 30 ? 30 : Math.round(frac * 0.6));
  } else if (frac > 0 && frac < 60) {
    minutes = frac;
  } else if (frac >= 60) {
    minutes = Math.round((num - hours) * 60);
  }
  
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Converte seriale Excel in oggetto data Javascript UTC
 */
function parseExcelSerialDate(serial) {
  if (!serial) return null;
  if (serial instanceof Date) return serial;
  const num = parseFloat(serial);
  if (isNaN(num) || num < 35000) return null; // date valide moderne
  // Epoch Excel: 1899-12-30 UTC
  const utcDays = Math.round(num - 25569);
  return new Date(utcDays * 86400000);
}

function formatDateKey(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Parsing completo del file Excel caricato
 */
async function processExcelFile(file) {
  try {
    showToast("Lettura file Excel in corso...");
    const data = await file.arrayBuffer();
    
    if (typeof XLSX === "undefined") {
      throw new Error("Libreria di elaborazione Excel non pronta. Riprova.");
    }
    
    const workbook = XLSX.read(data, {
      type: "array",
      cellFormula: true,
      cellDates: true
    });
    
    // 1. Individua solo il foglio "Inserimento Orari"
    const sheetName = workbook.SheetNames.find(name => 
      name.toLowerCase().trim().includes("inserimento") && name.toLowerCase().trim().includes("orari")
    );
    
    if (!sheetName) {
      throw new Error("Foglio 'Inserimento Orari' non trovato nel file caricato.");
    }
    
    const worksheet = workbook.Sheets[sheetName];
    
    // Mappatura delle colonne dei 7 giorni della settimana (da Domenica a Sabato)
    const DAY_SCHEMAS = [
      { dayIndex: 0, name: "Domenica", dateCol: "F", inM: "C", outM: "D", inP: "E", outP: "F", tot: "G" },
      { dayIndex: 1, name: "Lunedì",   dateCol: "K", inM: "H", outM: "I", inP: "J", outP: "K", tot: "L" },
      { dayIndex: 2, name: "Martedì",  dateCol: "P", inM: "M", outM: "N", inP: "O", outP: "P", tot: "Q" },
      { dayIndex: 3, name: "Mercoledì",dateCol: "U", inM: "R", outM: "S", inP: "T", outP: "U", tot: "V" },
      { dayIndex: 4, name: "Giovedì",  dateCol: "Z", inM: "W", outM: "X", inP: "Y", outP: "Z", tot: "AA" },
      { dayIndex: 5, name: "Venerdì",  dateCol: "AE", inM: "AB", outM: "AC", inP: "AD", outP: "AE", tot: "AF" },
      { dayIndex: 6, name: "Sabato",   dateCol: "AJ", inM: "AG", outM: "AH", inP: "AI", outP: "AJ", tot: "AK" }
    ];
    
    // Trova tutte le righe corrispondenti a "GIUSY DE SANTIS"
    // E le righe di intestazione settimanale (Settimana 1, Settimana 2...)
    const giusyRows = [];
    const weekHeaderRows = [];
    
    // Scandisce le celle della colonna B o cerca nelle righe
    const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1:AP500");
    
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cellB = worksheet[XLSX.utils.encode_cell({ r, c: 1 })]; // Col B
      const cellA = worksheet[XLSX.utils.encode_cell({ r, c: 0 })]; // Col A
      
      const valB = cellB ? String(cellB.v || "").toUpperCase().trim() : "";
      const valA = cellA ? String(cellA.v || "").toUpperCase().trim() : "";
      
      // Controlla se la riga è Giusy de Santis
      if (valB.includes("GIUSY") && valB.includes("SANTIS")) {
        giusyRows.push(r + 1); // 1-indexed row number
      }
      
      // Controlla se la riga è l'inizio di una settimana (es. "SETTIMANA 1")
      if (valA.includes("SETTIMANA") || valB.includes("SETTIMANA")) {
        weekHeaderRows.push(r + 1);
      }
    }
    
    if (giusyRows.length === 0) {
      throw new Error("Nessuna riga trovata per 'Giusy de Santis' nel foglio 'Inserimento Orari'.");
    }
    
    const parsedShifts = {};
    const validDates = [];
    
    // Per ciascun blocco settimanale contenente Giusy
    giusyRows.forEach((gRow, gIdx) => {
      // Trova la riga di intestazione settimanale immediatamente precedente
      const wRow = weekHeaderRows.filter(w => w < gRow).pop() || (gRow - 39);
      
      // Estrae la data di riferimento della settimana (da sabato AJ o domenica F)
      let saturdayDate = null;
      const cellSat = worksheet[`AJ${wRow}`];
      if (cellSat && cellSat.v) {
        saturdayDate = parseExcelSerialDate(cellSat.v);
      }
      
      // Per ciascuno dei 7 giorni della settimana
      DAY_SCHEMAS.forEach(dDef => {
        let dayDate = null;
        const cellDate = worksheet[`${dDef.dateCol}${wRow}`];
        if (cellDate && cellDate.v) {
          dayDate = parseExcelSerialDate(cellDate.v);
        }
        
        // Se la cella singola non ha la data calcolata, deriviamo la data dal sabato della settimana
        if (!dayDate && saturdayDate) {
          const dayOffset = 6 - dDef.dayIndex; // Sabato è 6
          dayDate = new Date(saturdayDate.getTime() - dayOffset * 86400000);
        }
        
        if (!dayDate) return;
        
        // Estrazione orari per Giusy in questo giorno
        const rawInM = worksheet[`${dDef.inM}${gRow}`]?.v;
        const rawOutM = worksheet[`${dDef.outM}${gRow}`]?.v;
        const rawInP = worksheet[`${dDef.inP}${gRow}`]?.v;
        const rawOutP = worksheet[`${dDef.outP}${gRow}`]?.v;
        const rawTot = worksheet[`${dDef.tot}${gRow}`]?.v;
        
        const inMorning = formatDecimalHour(rawInM);
        const outMorning = formatDecimalHour(rawOutM);
        const inAfternoon = formatDecimalHour(rawInP);
        const outAfternoon = formatDecimalHour(rawOutP);
        const totalHoursNum = rawTot ? parseFloat(String(rawTot).replace(",", ".")) : 0;
        
        const hasWork = (inMorning && outMorning) || (inAfternoon && outAfternoon) || totalHoursNum > 0;
        
        // Riconoscimento orario iniziale e finale complessivo della giornata
        const startTime = inMorning || inAfternoon || null;
        const endTime = outAfternoon || outMorning || null;
        
        // Valutazione Apertura e Chiusura:
        // Apertura: ingresso mattina <= 09:30
        // Chiusura: uscita pomeriggio/sera >= 21:00
        const startDec = rawInM ? parseFloat(rawInM) : (rawInP ? parseFloat(rawInP) : null);
        const endDec = rawOutP ? parseFloat(rawOutP) : (rawOutM ? parseFloat(rawOutM) : null);
        
        const isApertura = hasWork && startDec !== null && startDec <= 9.5;
        const isChiusura = hasWork && endDec !== null && endDec >= 21.0;
        const isRiposo = !hasWork || totalHoursNum === 0;
        
        const dateKey = formatDateKey(dayDate);
        
        parsedShifts[dateKey] = {
          date: dateKey,
          dayName: dDef.name,
          weekIndex: gIdx + 1,
          weekLabel: `Settimana ${gIdx + 1}`,
          hasWork,
          isRiposo,
          isApertura,
          isChiusura,
          inMorning,
          outMorning,
          inAfternoon,
          outAfternoon,
          startTime,
          endTime,
          totalHours: isRiposo ? 0 : totalHoursNum,
          displayHours: hasWork ? (
            inMorning && outMorning && inAfternoon && outAfternoon ? 
              `${inMorning}-${outMorning} / ${inAfternoon}-${outAfternoon}` : 
              (inMorning && outMorning ? `${inMorning} - ${outMorning}` : `${inAfternoon} - ${outAfternoon}`)
          ) : "Riposo"
        };
        
        if (hasWork) {
          validDates.push(dayDate);
        }
      });
    });
    
    // Gestione unione dati e verifica conflitti mese già memorizzato
    handleIncomingShifts(parsedShifts, file.name, giusyRows.length);
    
  } catch (err) {
    console.error("Errore elaborazione Excel:", err);
    alert(`Errore durante l'acquisizione del file: ${err.message}`);
  }
}

// Stato per importazione in attesa di conferma dall'utente
let pendingImport = null;

/**
 * Gestisce l'aggiunta dei turni o la richiesta di sostituzione se il mese è già presente
 */
function handleIncomingShifts(incomingShifts, fileName, giusyRowsCount) {
  const incomingDateKeys = Object.keys(incomingShifts);
  if (incomingDateKeys.length === 0) {
    showToast("Nessun turno valido trovato nel file.");
    return;
  }

  // Identifica i mesi presenti nel nuovo file (formato "YYYY-MM")
  const incomingMonthKeys = Array.from(new Set(incomingDateKeys.map(d => d.slice(0, 7))));
  
  // Identifica i mesi già memorizzati nei dati correnti dell'app
  const existingDateKeys = Object.keys(APP_STATE.shiftsData || {});
  const existingMonthKeys = new Set(existingDateKeys.map(d => d.slice(0, 7)));

  // Trova i mesi in conflitto che hanno già almeno 3 turni registrati
  const conflictingMonths = incomingMonthKeys.filter(m => {
    if (!existingMonthKeys.has(m)) return false;
    const countInMonth = existingDateKeys.filter(d => d.startsWith(m)).length;
    return countInMonth >= 3;
  });

  if (conflictingMonths.length > 0) {
    // Mese già memorizzato: chiedi conferma prima di sostituire
    pendingImport = {
      incomingShifts,
      fileName,
      totalWeeks: giusyRowsCount,
      conflictingMonths
    };
    showConflictModal(conflictingMonths);
  } else {
    // Mese nuovo: aggiungi direttamente ai dati già memorizzati in precedenza
    executeImportMerge(incomingShifts, [], fileName, giusyRowsCount);
    showToast("Nuovi turni aggiunti con successo a quelli già memorizzati!");
  }
}

function showConflictModal(conflictingMonths) {
  const monthNamesIt = [
    "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
    "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"
  ];
  
  const formattedMonths = conflictingMonths.map(mStr => {
    const [y, m] = mStr.split("-").map(Number);
    return `${monthNamesIt[m - 1]} ${y}`;
  }).join(" e ");

  const msgEl = document.getElementById("conflictModalMsg");
  if (msgEl) {
    msgEl.innerHTML = `I dati caricati contengono turni per <strong>${formattedMonths}</strong>, che risultano già memorizzati in precedenza.<br><br>Vuoi <strong>sostituire i dati di ${formattedMonths}</strong> con quelli del nuovo file oppure annullare l'operazione?`;
  }

  document.getElementById("conflictModal").classList.add("active");
}

function closeConflictModal() {
  document.getElementById("conflictModal").classList.remove("active");
  pendingImport = null;
}

/**
 * Esegue l'unione dei nuovi turni con quelli preesistenti
 * Se specificato replaceMonths, rimuove solo i turni di quei mesi prima di aggiungere i nuovi
 */
function executeImportMerge(incomingShifts, replaceMonths = [], fileName = "import.xlsx", totalWeeks = 0) {
  // Inizia con una copia dei dati già memorizzati in precedenza
  const merged = { ...APP_STATE.shiftsData };

  // Se è richiesta la sostituzione di determinati mesi, cancella solo le date di quei mesi
  if (replaceMonths.length > 0) {
    const replaceSet = new Set(replaceMonths);
    Object.keys(merged).forEach(dateKey => {
      if (replaceSet.has(dateKey.slice(0, 7))) {
        delete merged[dateKey];
      }
    });
  }

  // Aggiungi tutti i turni del file caricato
  Object.assign(merged, incomingShifts);

  // Ricalcola il periodo complessivo (Data Inizio e Data Fine su tutti i turni lavorati)
  const allWorkingDates = Object.values(merged)
    .filter(s => s.hasWork && s.date)
    .map(s => s.date)
    .sort();

  const periodStart = allWorkingDates.length > 0 ? allWorkingDates[0] : null;
  const periodEnd = allWorkingDates.length > 0 ? allWorkingDates[allWorkingDates.length - 1] : null;

  // Centra il calendario sul mese principale dei turni appena caricati
  const incomingDates = Object.keys(incomingShifts).sort();
  if (incomingDates.length > 0) {
    const midDate = incomingDates[Math.floor(incomingDates.length / 2)];
    const [y, m] = midDate.split("-").map(Number);
    APP_STATE.currentDate = new Date(y, m - 1, 1);
  }

  const payload = {
    person: "Giusy de Santis",
    fileName,
    lastUpdate: new Date().toISOString(),
    periodStart,
    periodEnd,
    totalWeeks: Math.max(totalWeeks, Math.ceil(Object.keys(merged).length / 7)),
    shiftsData: merged
  };

  applyParsedData(payload, true);
}

function applyParsedData(payload, shouldSyncCloud = true) {
  APP_STATE.shiftsData = payload.shiftsData || {};
  APP_STATE.periodInfo = {
    start: payload.periodStart,
    end: payload.periodEnd,
    totalWeeks: payload.totalWeeks,
    lastUpdate: payload.lastUpdate
  };
  
  // Salva nello storage locale per accesso offline immediato
  localStorage.setItem("giusy_shifts_payload", JSON.stringify(payload));
  
  // Sincronizza su Firebase per statistiche e persistenza cloud
  if (shouldSyncCloud) {
    syncToFirebase(payload);
  }
  
  // Aggiorna la vista
  updatePeriodBanner();
  renderCalendar();
  updateMonthlyStats();
}

// =============================================================================
// 6. RENDERING CALENDARIO & BANNER PERIODO
// =============================================================================

function formatItalianDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  const months = [
    "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
    "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"
  ];
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
}

function updatePeriodBanner() {
  const datesLabel = document.getElementById("periodDatesLabel");
  const statusPill = document.getElementById("periodStatusPill");
  
  if (APP_STATE.periodInfo.start && APP_STATE.periodInfo.end) {
    const startFormatted = formatItalianDate(APP_STATE.periodInfo.start);
    const endFormatted = formatItalianDate(APP_STATE.periodInfo.end);
    datesLabel.textContent = `${startFormatted}  —  ${endFormatted}`;
    statusPill.textContent = "Turni Attivi";
    statusPill.style.background = "var(--riposo-bg)";
    statusPill.style.color = "var(--riposo-text)";
  } else {
    datesLabel.textContent = "Nessun file caricato";
    statusPill.textContent = "In attesa";
    statusPill.style.background = "var(--brand-light)";
    statusPill.style.color = "var(--brand-primary)";
  }
}

function renderCalendar() {
  const grid = document.getElementById("calendarGrid");
  grid.innerHTML = "";
  
  const year = APP_STATE.currentDate.getFullYear();
  const month = APP_STATE.currentDate.getMonth();
  
  // Aggiorna etichetta mese (es. "Settembre 2026")
  const monthsItalian = [
    "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
    "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"
  ];
  document.getElementById("currentMonthLabel").textContent = `${monthsItalian[month]} ${year}`;
  
  // Primo giorno del mese
  const firstDay = new Date(year, month, 1);
  // Ultimo giorno del mese
  const lastDay = new Date(year, month + 1, 0);
  
  // Giorno della settimana del primo giorno (0 = Dom, 1 = Lun... convertiamo in Lun = 0, Dom = 6)
  let startDayOfWeek = firstDay.getDay() - 1;
  if (startDayOfWeek === -1) startDayOfWeek = 6; // Domenica
  
  // Giorni del mese precedente per riempire la prima settimana
  const prevMonthLastDay = new Date(year, month, 0).getDate();
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const d = prevMonthLastDay - i;
    const cell = document.createElement("div");
    cell.className = "day-cell other-month";
    cell.innerHTML = `
      <div class="day-top-row">
        <span class="day-number">${d}</span>
      </div>
    `;
    grid.appendChild(cell);
  }
  
  // Giorni del mese corrente
  const today = new Date();
  const todayKey = formatDateKey(today);
  
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const thisDate = new Date(year, month, d);
    const dateKey = formatDateKey(thisDate);
    const shift = APP_STATE.shiftsData[dateKey];
    
    const cell = document.createElement("div");
    cell.className = "day-cell";
    if (dateKey === todayKey) cell.classList.add("today");
    
    if (shift) {
      if (shift.isRiposo) {
        // EVIDENZIA IN VERDE I GIORNI DI RIPOSO
        cell.classList.add("is-riposo");
        cell.innerHTML = `
          <div class="day-top-row">
            <span class="day-number">${d}</span>
            <span class="day-badge-tag tag-riposo">Riposo</span>
          </div>
          <div class="day-info">
            <span class="day-time-text" style="color: var(--riposo-text);">Riposo</span>
          </div>
        `;
      } else if (shift.isApertura || shift.isChiusura) {
        // EVIDENZIA IN GIALLO I GIORNI DI APERTURA O CHIUSURA
        cell.classList.add("is-speciale");
        
        let tagHtml = "";
        if (shift.isApertura && shift.isChiusura) {
          tagHtml = `<span class="day-badge-tag tag-apertura">Aper</span><span class="day-badge-tag tag-chiusura">Chiu</span>`;
        } else if (shift.isApertura) {
          tagHtml = `<span class="day-badge-tag tag-apertura">Apertura</span>`;
        } else {
          tagHtml = `<span class="day-badge-tag tag-chiusura">Chiusura</span>`;
        }
        
        cell.innerHTML = `
          <div class="day-top-row">
            <span class="day-number">${d}</span>
            <span class="hours-pill">${shift.totalHours}h</span>
          </div>
          <div class="day-info">
            <div style="display: flex; gap: 2px; flex-wrap: wrap;">${tagHtml}</div>
            <span class="day-time-text">${shift.startTime} - ${shift.endTime}</span>
          </div>
        `;
      } else {
        // TURNO REGOLARE STANDARD
        cell.classList.add("is-normale");
        cell.innerHTML = `
          <div class="day-top-row">
            <span class="day-number">${d}</span>
            <span class="hours-pill">${shift.totalHours}h</span>
          </div>
          <div class="day-info">
            <span class="day-time-text">${shift.startTime} - ${shift.endTime}</span>
          </div>
        `;
      }
      
      // Click per aprire il modale di dettaglio
      cell.addEventListener("click", () => {
        openDayDetailModal(thisDate, shift);
      });
    } else {
      // Giorno senza dati importati
      cell.innerHTML = `
        <div class="day-top-row">
          <span class="day-number">${d}</span>
        </div>
      `;
    }
    
    grid.appendChild(cell);
  }
}

function updateMonthlyStats() {
  const year = APP_STATE.currentDate.getFullYear();
  const month = APP_STATE.currentDate.getMonth();
  
  let totalHours = 0;
  let riposi = 0;
  let aperture = 0;
  let chiusure = 0;
  
  Object.keys(APP_STATE.shiftsData).forEach(dateKey => {
    const [y, m] = dateKey.split("-").map(Number);
    if (y === year && (m - 1) === month) {
      const shift = APP_STATE.shiftsData[dateKey];
      if (shift.isRiposo) {
        riposi++;
      } else {
        totalHours += (shift.totalHours || 0);
        if (shift.isApertura) aperture++;
        if (shift.isChiusura) chiusure++;
      }
    }
  });
  
  document.getElementById("statHours").textContent = `${totalHours}h`;
  document.getElementById("statRiposi").textContent = riposi;
  document.getElementById("statAperture").textContent = aperture;
  document.getElementById("statChiusure").textContent = chiusure;
}

// =============================================================================
// 7. MODALE DETTAGLIO GIORNATA
// =============================================================================

function openDayDetailModal(dateObj, shift) {
  const modal = document.getElementById("dayDetailModal");
  const title = document.getElementById("modalDayDate");
  const body = document.getElementById("modalDayBody");
  
  const options = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
  title.textContent = dateObj.toLocaleDateString("it-IT", options);
  
  let badgeType = "";
  if (shift.isRiposo) {
    badgeType = `<span class="day-badge-tag tag-riposo" style="font-size: 0.8rem; padding: 4px 8px;">Giorno di Riposo (Verde)</span>`;
  } else if (shift.isApertura || shift.isChiusura) {
    const list = [];
    if (shift.isApertura) list.push("Apertura Negozio");
    if (shift.isChiusura) list.push("Chiusura Negozio");
    badgeType = `<span class="day-badge-tag tag-apertura" style="font-size: 0.8rem; padding: 4px 8px;">${list.join(" & ")} (Giallo)</span>`;
  } else {
    badgeType = `<span class="status-pill" style="font-size: 0.8rem; padding: 4px 8px;">Turno Regolare</span>`;
  }
  
  body.innerHTML = `
    <div style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
      <span style="font-size: 0.9rem; color: var(--text-secondary);">Tipologia:</span>
      <div>${badgeType}</div>
    </div>
    
    <div class="detail-item-card">
      <span class="detail-item-title">Orario Mattina</span>
      <span class="detail-item-val">${shift.inMorning && shift.outMorning ? `${shift.inMorning}  —  ${shift.outMorning}` : "Non previsto"}</span>
    </div>
    
    <div class="detail-item-card">
      <span class="detail-item-title">Orario Pomeriggio</span>
      <span class="detail-item-val">${shift.inAfternoon && shift.outAfternoon ? `${shift.inAfternoon}  —  ${shift.outAfternoon}` : "Non previsto"}</span>
    </div>
    
    <div class="detail-item-card">
      <span class="detail-item-title">Inizio & Fine Effettivi</span>
      <span class="detail-item-val" style="color: var(--brand-primary);">${shift.hasWork ? `${shift.startTime}  —  ${shift.endTime}` : "Nessun turno"}</span>
    </div>
    
    <div class="detail-item-card" style="background: var(--bg-surface); border: 1px solid var(--border-color);">
      <span class="detail-item-title" style="font-weight: 700;">Totale Ore Lavorate</span>
      <span class="detail-item-val" style="font-size: 1.1rem; color: var(--text-primary);">${shift.totalHours} ore</span>
    </div>
  `;
  
  modal.classList.add("active");
}

document.getElementById("btnCloseDayModal").addEventListener("click", () => {
  document.getElementById("dayDetailModal").classList.remove("active");
});

document.getElementById("dayDetailModal").addEventListener("click", (e) => {
  if (e.target === document.getElementById("dayDetailModal")) {
    document.getElementById("dayDetailModal").classList.remove("active");
  }
});

// =============================================================================
// 8. GESTIONE IMPOSTAZIONI & TEMI (Chiaro / Scuro)
// =============================================================================

function applyTheme(theme) {
  APP_STATE.theme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("orari_theme", theme);
  
  const metaTheme = document.getElementById("metaThemeColor");
  if (metaTheme) {
    metaTheme.setAttribute("content", theme === "dark" ? "#0b1120" : "#ffffff");
  }
  
  // Aggiorna pulsanti tema
  document.getElementById("themeLightBtn").classList.toggle("active", theme === "light");
  document.getElementById("themeDarkBtn").classList.toggle("active", theme === "dark");
}

document.getElementById("themeLightBtn").addEventListener("click", () => applyTheme("light"));
document.getElementById("themeDarkBtn").addEventListener("click", () => applyTheme("dark"));

document.getElementById("btnOpenSettings").addEventListener("click", () => {
  document.getElementById("settingsModal").classList.add("active");
});

document.getElementById("btnCloseSettings").addEventListener("click", () => {
  document.getElementById("settingsModal").classList.remove("active");
});

document.getElementById("settingsModal").addEventListener("click", (e) => {
  if (e.target === document.getElementById("settingsModal")) {
    document.getElementById("settingsModal").classList.remove("active");
  }
});

// =============================================================================
// 8.1 STATISTICHE & GRAFICI INTERATTIVI (Version 1.1.0)
// =============================================================================

APP_STATE.statsScope = "month"; // "month" oppure "all"

function openStatsModal() {
  renderStatistics();
  document.getElementById("statsModal").classList.add("active");
}

function closeStatsModal() {
  document.getElementById("statsModal").classList.remove("active");
}

function setStatsScope(scope) {
  APP_STATE.statsScope = scope;
  document.getElementById("btnScopeMonth").classList.toggle("active", scope === "month");
  document.getElementById("btnScopeAll").classList.toggle("active", scope === "all");
  renderStatistics();
}

function getFilteredShiftsForStats() {
  const allShifts = Object.values(APP_STATE.shiftsData);
  if (APP_STATE.statsScope === "all") {
    return allShifts;
  }
  // Filtra solo per il mese attualmente visualizzato
  const y = APP_STATE.currentDate.getFullYear();
  const m = APP_STATE.currentDate.getMonth() + 1;
  return allShifts.filter(s => {
    if (!s.date) return false;
    const [shiftY, shiftM] = s.date.split("-").map(Number);
    return shiftY === y && shiftM === m;
  });
}

function computeStatistics() {
  const shifts = getFilteredShiftsForStats();
  
  let totalHours = 0;
  let workDaysCount = 0;
  let restDaysCount = 0;
  let openingsCount = 0;
  let closingsCount = 0;
  let regularCount = 0;
  let weekendShiftsCount = 0;
  
  const daysMap = {
    "Lunedì":    { name: "Lunedì", short: "Lun", count: 0, hours: 0, isWeekend: false },
    "Martedì":   { name: "Martedì", short: "Mar", count: 0, hours: 0, isWeekend: false },
    "Mercoledì": { name: "Mercoledì", short: "Mer", count: 0, hours: 0, isWeekend: false },
    "Giovedì":   { name: "Giovedì", short: "Gio", count: 0, hours: 0, isWeekend: false },
    "Venerdì":   { name: "Venerdì", short: "Ven", count: 0, hours: 0, isWeekend: false },
    "Sabato":    { name: "Sabato", short: "Sab", count: 0, hours: 0, isWeekend: true },
    "Domenica":  { name: "Domenica", short: "Dom", count: 0, hours: 0, isWeekend: true }
  };

  const weeksMap = {};
  const specialShifts = [];

  shifts.forEach(s => {
    const h = s.totalHours || 0;
    const isSpecial = s.isApertura || s.isChiusura;
    
    if (s.isRiposo) {
      restDaysCount++;
    } else {
      workDaysCount++;
      totalHours += h;
      if (s.isApertura) openingsCount++;
      if (s.isChiusura) closingsCount++;
      if (!isSpecial) regularCount++;

      // Giorno della settimana
      const dName = s.dayName || "Domenica";
      if (daysMap[dName]) {
        daysMap[dName].count++;
        daysMap[dName].hours += h;
        if (daysMap[dName].isWeekend) weekendShiftsCount++;
      }
      
      if (isSpecial) {
        specialShifts.push(s);
      }
    }

    // Raggruppamento per settimana
    const wKey = s.weekLabel || `Settimana ${s.weekIndex || 1}`;
    if (!weeksMap[wKey]) {
      weeksMap[wKey] = {
        label: wKey,
        shortLabel: wKey.replace("Settimana ", "S."),
        totalHours: 0,
        workDays: 0,
        restDays: 0,
        openings: 0,
        closings: 0,
        shifts: []
      };
    }
    weeksMap[wKey].shifts.push(s);
    if (s.isRiposo) {
      weeksMap[wKey].restDays++;
    } else {
      weeksMap[wKey].workDays++;
      weeksMap[wKey].totalHours += h;
      if (s.isApertura) weeksMap[wKey].openings++;
      if (s.isChiusura) weeksMap[wKey].closings++;
    }
  });

  const weeksList = Object.values(weeksMap);
  const totalWeeks = Math.max(1, weeksList.length);
  const avgWeeklyHours = (totalHours / totalWeeks).toFixed(1);

  // Ordina turni speciali per data
  specialShifts.sort((a, b) => a.date.localeCompare(b.date));

  return {
    totalHours,
    workDaysCount,
    restDaysCount,
    openingsCount,
    closingsCount,
    regularCount,
    weekendShiftsCount,
    avgWeeklyHours,
    totalDays: shifts.length,
    weeksList,
    daysList: Object.values(daysMap),
    specialShifts
  };
}

function renderStatistics() {
  const stats = computeStatistics();
  const isMonth = APP_STATE.statsScope === "month";
  
  // Sottotitolo
  const subtitle = document.getElementById("statsSubtitle");
  if (subtitle) {
    if (isMonth) {
      const monthNames = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
      subtitle.textContent = `Mese di ${monthNames[APP_STATE.currentDate.getMonth()]} ${APP_STATE.currentDate.getFullYear()}`;
    } else {
      subtitle.textContent = `Tutti i turni importati (${stats.totalDays} giornate analizzate)`;
    }
  }

  // 1. Aggiorna KPI Cards
  document.getElementById("kpiTotalHours").textContent = `${stats.totalHours}h`;
  document.getElementById("kpiAvgWeekly").textContent = `${stats.avgWeeklyHours}h`;
  document.getElementById("kpiRestDays").textContent = `${stats.restDaysCount} gg`;
  document.getElementById("kpiOpenings").textContent = stats.openingsCount;
  document.getElementById("kpiClosings").textContent = stats.closingsCount;
  document.getElementById("kpiWeekendShifts").textContent = stats.weekendShiftsCount;

  // 2. Grafico Distribuzione Turni (Progress bar)
  const totalDays = Math.max(1, stats.totalDays);
  const pctRiposo = Math.round((stats.restDaysCount / totalDays) * 100);
  const specialCount = stats.openingsCount + stats.closingsCount;
  const pctSpeciale = Math.round((specialCount / totalDays) * 100);
  const pctNormale = Math.max(0, 100 - pctRiposo - pctSpeciale);

  const segRiposo = document.getElementById("segRiposo");
  const segSpeciale = document.getElementById("segSpeciale");
  const segNormale = document.getElementById("segNormale");
  
  if (segRiposo) segRiposo.style.width = `${pctRiposo}%`;
  if (segSpeciale) segSpeciale.style.width = `${pctSpeciale}%`;
  if (segNormale) segNormale.style.width = `${pctNormale}%`;

  document.getElementById("legendRiposoVal").textContent = `${stats.restDaysCount} (${pctRiposo}%)`;
  document.getElementById("legendSpecialeVal").textContent = `${specialCount} (${pctSpeciale}%)`;
  document.getElementById("legendNormaleVal").textContent = `${stats.regularCount} (${pctNormale}%)`;

  // 3. Grafico Ore per Settimana (SVG Bar Chart)
  renderWeeklyHoursChartSvg(stats.weeksList);

  // 4. Grafico Frequenza per Giorno della Settimana (SVG Bar Chart)
  renderDayFrequencyChartSvg(stats.daysList);

  // 5. Tabella Settimanale
  renderWeeklyStatsTable(stats.weeksList);

  // 6. Elenco Aperture & Chiusure
  renderSpecialShiftsList(stats.specialShifts);
}

function renderWeeklyHoursChartSvg(weeks) {
  const container = document.getElementById("weeklyHoursChart");
  if (!container) return;

  if (!weeks || weeks.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 24px;">Nessun dato settimanale disponibile per questo periodo.</div>`;
    return;
  }

  const width = 340;
  const height = 175;
  const padBottom = 28;
  const padTop = 26;
  const padLeft = 36;
  const padRight = 16;
  const chartHeight = height - padTop - padBottom;
  const chartWidth = width - padLeft - padRight;

  const maxHours = Math.max(26, ...weeks.map(w => w.totalHours || 0));
  const slotWidth = chartWidth / weeks.length;
  const barWidth = Math.min(34, Math.floor(slotWidth * 0.65));

  // Linea target 20 ore contrattuali
  const targetY = padTop + chartHeight - ((20 / maxHours) * chartHeight);
  const targetLineSvg = `
    <line x1="${padLeft}" y1="${targetY}" x2="${width - padRight}" y2="${targetY}" class="chart-target-line" />
    <text x="${width - padRight}" y="${targetY - 5}" class="chart-target-label" text-anchor="end">Contratto 20h</text>
  `;

  // Linee di riferimento
  const gridLevels = [10, 20];
  const gridSvg = gridLevels.map(lvl => {
    const y = padTop + chartHeight - ((lvl / maxHours) * chartHeight);
    return `
      <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" class="chart-grid-line" />
      <text x="${padLeft - 6}" y="${y + 3}" class="chart-label-text" text-anchor="end">${lvl}h</text>
    `;
  }).join("");

  // Barre delle settimane
  const barsSvg = weeks.map((w, idx) => {
    const x = padLeft + (idx * slotWidth) + (slotWidth - barWidth) / 2;
    const h = ((w.totalHours || 0) / maxHours) * chartHeight;
    const y = padTop + chartHeight - h;
    const color = (w.totalHours >= 20) ? "var(--brand-primary)" : "#6366f1";
    
    return `
      <rect x="${x}" y="${y}" width="${barWidth}" height="${h}" rx="4" fill="${color}" class="chart-bar-rect">
        <title>${w.label}: ${w.totalHours} ore</title>
      </rect>
      <text x="${x + barWidth / 2}" y="${y - 6}" class="chart-val-text">${w.totalHours}h</text>
      <text x="${x + barWidth / 2}" y="${height - 8}" class="chart-label-text">${w.shortLabel}</text>
    `;
  }).join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="chart-svg">
      ${gridSvg}
      ${targetLineSvg}
      ${barsSvg}
    </svg>
  `;
}

function renderDayFrequencyChartSvg(days) {
  const container = document.getElementById("dayFrequencyChart");
  if (!container) return;

  if (!days || days.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 24px;">Nessun dato disponibile.</div>`;
    return;
  }

  const width = 340;
  const height = 155;
  const padBottom = 26;
  const padTop = 22;
  const padLeft = 24;
  const padRight = 16;
  const chartHeight = height - padTop - padBottom;
  const chartWidth = width - padLeft - padRight;

  const maxCount = Math.max(4, ...days.map(d => d.count || 0));
  const slotWidth = chartWidth / days.length;
  const barWidth = Math.min(26, Math.floor(slotWidth * 0.65));

  const barsSvg = days.map((d, idx) => {
    const x = padLeft + (idx * slotWidth) + (slotWidth - barWidth) / 2;
    const h = ((d.count || 0) / maxCount) * chartHeight;
    const y = padTop + chartHeight - h;
    const color = d.isWeekend ? "#8b5cf6" : "var(--brand-primary)";

    return `
      <rect x="${x}" y="${y}" width="${barWidth}" height="${h}" rx="3" fill="${color}" class="chart-bar-rect">
        <title>${d.name}: ${d.count} turni (${d.hours} ore)</title>
      </rect>
      <text x="${x + barWidth / 2}" y="${y - 5}" class="chart-val-text">${d.count}</text>
      <text x="${x + barWidth / 2}" y="${height - 8}" class="chart-label-text">${d.short}</text>
    `;
  }).join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="chart-svg">
      <line x1="${padLeft}" y1="${padTop + chartHeight}" x2="${width - padRight}" y2="${padTop + chartHeight}" stroke="var(--border-color)" />
      ${barsSvg}
    </svg>
  `;
}

function renderWeeklyStatsTable(weeks) {
  const tbody = document.getElementById("weeklyStatsTbody");
  if (!tbody) return;

  if (!weeks || weeks.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 16px;">Nessuna settimana presente</td></tr>`;
    return;
  }

  tbody.innerHTML = weeks.map(w => {
    return `
      <tr>
        <td style="font-weight: 700; color: var(--brand-primary);">${w.label}</td>
        <td><span class="hours-pill" style="font-size: 0.75rem;">${w.totalHours}h</span></td>
        <td>${w.workDays} gg</td>
        <td><span style="color: var(--riposo-badge); font-weight: 700;">${w.restDays}</span></td>
        <td><span style="color: var(--speciale-badge); font-weight: 700;">${w.openings}</span></td>
        <td><span style="color: #ef4444; font-weight: 700;">${w.closings}</span></td>
      </tr>
    `;
  }).join("");
}

function renderSpecialShiftsList(shifts) {
  const container = document.getElementById("specialShiftsList");
  if (!container) return;

  if (!shifts || shifts.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 16px;">Nessuna apertura o chiusura presente nel periodo selezionato.</div>`;
    return;
  }

  container.innerHTML = shifts.map(s => {
    let badgeHtml = "";
    if (s.isApertura && s.isChiusura) {
      badgeHtml = `<span class="day-badge-tag tag-apertura">Apertura</span> <span class="day-badge-tag tag-chiusura">Chiusura</span>`;
    } else if (s.isApertura) {
      badgeHtml = `<span class="day-badge-tag tag-apertura">Apertura (≤ 9:30)</span>`;
    } else {
      badgeHtml = `<span class="day-badge-tag tag-chiusura">Chiusura (≥ 21:00)</span>`;
    }

    return `
      <div class="special-shift-card">
        <div class="special-shift-left">
          <span class="special-shift-date">${formatItalianDate(s.date)} (${s.dayName})</span>
          <span class="special-shift-hours">${s.startTime} — ${s.endTime} (${s.totalHours} ore)</span>
        </div>
        <div>${badgeHtml}</div>
      </div>
    `;
  }).join("");
}

// Event Listeners per Statistiche
document.getElementById("btnOpenStats").addEventListener("click", openStatsModal);
document.getElementById("btnCloseStats").addEventListener("click", closeStatsModal);

document.getElementById("statsModal").addEventListener("click", (e) => {
  if (e.target === document.getElementById("statsModal")) {
    closeStatsModal();
  }
});

document.getElementById("btnScopeMonth").addEventListener("click", () => setStatsScope("month"));
document.getElementById("btnScopeAll").addEventListener("click", () => setStatsScope("all"));

// Event Listeners per Gestione Conflitti Mese già Memorizzato
document.getElementById("btnConfirmReplaceMonth").addEventListener("click", () => {
  if (pendingImport) {
    const { incomingShifts, conflictingMonths, fileName, totalWeeks } = pendingImport;
    executeImportMerge(incomingShifts, conflictingMonths, fileName, totalWeeks);
    closeConflictModal();
    showToast("Turni del mese sostituiti con successo!");
  }
});

document.getElementById("btnCancelReplaceMonth").addEventListener("click", () => {
  closeConflictModal();
  showToast("Importazione annullata. I dati esistenti sono stati mantenuti.");
});

document.getElementById("conflictModal").addEventListener("click", (e) => {
  if (e.target === document.getElementById("conflictModal")) {
    closeConflictModal();
  }
});

// Pulsante per ribloccare l'app con la password
document.getElementById("btnLockApp").addEventListener("click", () => {
  localStorage.removeItem("orari_auth_session");
  APP_STATE.isAuthenticated = false;
  document.getElementById("settingsModal").classList.remove("active");
  showLockScreen();
  showToast("Applicazione bloccata.");
});

// =============================================================================
// 9. EVENT LISTENERS PRINCIPALI (Navigazione & Upload)
// =============================================================================

// Navigazione mese
document.getElementById("btnPrevMonth").addEventListener("click", () => {
  const d = APP_STATE.currentDate;
  APP_STATE.currentDate = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  renderCalendar();
  updateMonthlyStats();
});

document.getElementById("btnNextMonth").addEventListener("click", () => {
  const d = APP_STATE.currentDate;
  APP_STATE.currentDate = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  renderCalendar();
  updateMonthlyStats();
});

// Tasto Carica file Excel
const fileInput = document.getElementById("excelFileInput");
document.getElementById("btnUploadExcel").addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", (e) => {
  if (e.target.files && e.target.files[0]) {
    processExcelFile(e.target.files[0]);
    fileInput.value = "";
  }
});

// Toast Notifications Helper
function showToast(message) {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20 6L9 17l-5-5"></path>
    </svg>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3500);
}

// =============================================================================
// 10. AVVIO APPLICAZIONE
// =============================================================================

window.addEventListener("DOMContentLoaded", () => {
  // Applica tema salvato
  applyTheme(APP_STATE.theme);
  
  // Carica dati turni precedentemente salvati in locale se disponibili
  const savedData = localStorage.getItem("giusy_shifts_payload");
  if (savedData) {
    try {
      const parsed = JSON.parse(savedData);
      applyParsedData(parsed, false);
    } catch (e) {
      console.warn("Errore lettura cache locale:", e);
    }
  }
  
  // Inizializza verifica accesso PIN
  initAuth();
});
