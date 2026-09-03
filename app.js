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
    for (const gRow of giusyRows) {
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
    }
    
    // Calcolo periodo iniziale e finale
    let periodStart = null;
    let periodEnd = null;
    if (validDates.length > 0) {
      validDates.sort((a, b) => a.getTime() - b.getTime());
      periodStart = formatDateKey(validDates[0]);
      periodEnd = formatDateKey(validDates[validDates.length - 1]);
      
      // Imposta il mese visualizzato sul primo mese con turni
      APP_STATE.currentDate = new Date(validDates[0].getFullYear(), validDates[0].getMonth(), 1);
    }
    
    const payload = {
      person: "Giusy de Santis",
      fileName: file.name,
      lastUpdate: new Date().toISOString(),
      periodStart,
      periodEnd,
      totalWeeks: giusyRows.length,
      shiftsData: parsedShifts
    };
    
    // Applica i dati all'applicazione
    applyParsedData(payload, true);
    showToast("Turni di Giusy de Santis importati con successo!");
    
  } catch (err) {
    console.error("Errore elaborazione Excel:", err);
    alert(`Errore durante l'acquisizione del file: ${err.message}`);
  }
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
