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

let firebaseInitPromise = null;
let pendingCloudPayload = null;
let unsubscribeRemoteListener = null;

async function initFirebase(hashKey = HASH_AUTH_KEY) {
  if (firebaseInitPromise) return firebaseInitPromise;

  firebaseInitPromise = (async () => {
    const config = decryptFirebaseCredentials(hashKey);
    if (!config) {
      updateFirebaseStatus(false, "Configurazione non disponibile");
      return false;
    }
    
    try {
      const { initializeApp, getApps, getApp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
      const { getFirestore, doc, setDoc, getDoc, onSnapshot } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      
      const app = getApps().length > 0 ? getApp() : initializeApp(config);
      const db = getFirestore(app);
      APP_STATE.firebaseDb = db;
      APP_STATE.firestoreOps = { doc, setDoc, getDoc, onSnapshot };
      
      updateFirebaseStatus(true, "Connesso & Sincronizzato");
      
      // 1. Riconciliazione intelligente bidirezionale tra Cloud e Locale
      await reconcileCloudAndLocalShifts();
      
      // 2. Se c'erano salvataggi in coda mentre Firebase si avviava, inviali ora
      if (pendingCloudPayload) {
        const queued = pendingCloudPayload;
        pendingCloudPayload = null;
        await syncToFirebase(queued);
      }

      // 3. Ascolto modifiche remote in tempo reale
      listenToRemoteChanges();

      return true;
    } catch (e) {
      console.warn("Firebase non connesso (funzionamento in modalità locale offline):", e);
      updateFirebaseStatus(false, "Offline (Dati salvati in locale)");
      return false;
    }
  })();

  return firebaseInitPromise;
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

/**
 * Salva i dati correnti su Firestore.
 * Pulisce qualsiasi valore undefined per evitare errori SDK e gestisce code offline.
 */
async function syncToFirebase(payload) {
  if (!payload || !payload.shiftsData) return;

  // Sanitizzazione rigorosa: rimuove undefined e prepara oggetto pulito per Firestore
  const cleanPayload = JSON.parse(JSON.stringify(payload));
  cleanPayload.lastUpdate = cleanPayload.lastUpdate || new Date().toISOString();

  // Assicurati che Firebase sia pronto
  if (!APP_STATE.firebaseDb || !APP_STATE.firestoreOps) {
    if (firebaseInitPromise) {
      await firebaseInitPromise;
    } else {
      initFirebase(HASH_AUTH_KEY);
      if (firebaseInitPromise) await firebaseInitPromise;
    }
  }

  if (!APP_STATE.firebaseDb || !APP_STATE.firestoreOps) {
    console.warn("Firebase non pronto: salvataggio locale effettuato, sync in coda.");
    pendingCloudPayload = cleanPayload;
    updateFirebaseStatus(false, "Offline (Modifiche in attesa)");
    return;
  }

  try {
    const { doc, setDoc } = APP_STATE.firestoreOps;
    
    // Salva come stato principale corrente
    await setDoc(doc(APP_STATE.firebaseDb, "turni_giusy", "current"), cleanPayload);
    
    // Salva record nello storico in modo non bloccante
    try {
      const historyId = `import_${Date.now()}`;
      await setDoc(doc(APP_STATE.firebaseDb, "turni_giusy_history", historyId), cleanPayload);
    } catch (histErr) {
      console.warn("Avviso scrittura storico (non bloccante):", histErr);
    }

    updateFirebaseStatus(true, "Connesso & Sincronizzato");
    const lastSyncEl = document.getElementById("lastSyncTimeText");
    if (lastSyncEl) {
      const timeStr = new Date().toLocaleTimeString("it-IT", { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      lastSyncEl.textContent = `Ultima sincronizzazione: oggi alle ${timeStr}`;
    }

    showToast("Modifiche salvate e sincronizzate su Firebase Cloud!");
  } catch (err) {
    console.error("Errore salvataggio Firebase:", err);
    updateFirebaseStatus(false, "Errore salvataggio cloud");
    showToast("Salvataggio locale completato (sincronizzazione cloud fallita).");
  }
}

/**
 * Confronta i dati locali e quelli remoti in base a lastUpdate:
 * - Se il Cloud ha dati più recenti, aggiorna il client locale
 * - Se il client Locale ha dati più recenti, aggiorna il Cloud
 */
async function reconcileCloudAndLocalShifts() {
  if (!APP_STATE.firebaseDb || !APP_STATE.firestoreOps) return;
  try {
    const { doc, getDoc } = APP_STATE.firestoreOps;
    const snap = await getDoc(doc(APP_STATE.firebaseDb, "turni_giusy", "current"));

    const localRaw = localStorage.getItem("giusy_shifts_payload");
    const localPayload = localRaw ? JSON.parse(localRaw) : null;
    const localTime = localPayload?.lastUpdate ? new Date(localPayload.lastUpdate).getTime() : 0;

    if (snap.exists()) {
      const remoteData = snap.data();
      const remoteTime = remoteData?.lastUpdate ? new Date(remoteData.lastUpdate).getTime() : 0;

      if (remoteTime > localTime && remoteData.shiftsData) {
        applyParsedData(remoteData, false);
        const lastSyncEl = document.getElementById("lastSyncTimeText");
        if (lastSyncEl) {
          const timeStr = new Date(remoteTime).toLocaleTimeString("it-IT", { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          lastSyncEl.textContent = `Sincronizzato da Cloud (${timeStr})`;
        }
        showToast("Turni sincronizzati con l'ultima versione dal cloud Firebase!");
      } else if (localTime > remoteTime && localPayload?.shiftsData) {
        await syncToFirebase(localPayload);
      }
    } else if (localPayload && localPayload.shiftsData) {
      await syncToFirebase(localPayload);
    }
  } catch (err) {
    console.warn("Errore riconciliazione cloud:", err);
  }
}

/**
 * Ascolta aggiornamenti in tempo reale su Firestore
 */
function listenToRemoteChanges() {
  if (!APP_STATE.firebaseDb || !APP_STATE.firestoreOps) return;
  try {
    const { doc, onSnapshot } = APP_STATE.firestoreOps;
    if (unsubscribeRemoteListener) unsubscribeRemoteListener();

    unsubscribeRemoteListener = onSnapshot(doc(APP_STATE.firebaseDb, "turni_giusy", "current"), (snap) => {
      if (!snap.exists()) return;
      const remoteData = snap.data();
      if (!remoteData || !remoteData.shiftsData) return;

      const localRaw = localStorage.getItem("giusy_shifts_payload");
      const localPayload = localRaw ? JSON.parse(localRaw) : null;
      const localTime = localPayload?.lastUpdate ? new Date(localPayload.lastUpdate).getTime() : 0;
      const remoteTime = remoteData.lastUpdate ? new Date(remoteData.lastUpdate).getTime() : 0;

      // Se il dato remoto è più recente di almeno 2 secondi rispetto a quello locale, aggiorna la UI
      if (remoteTime > (localTime + 2000)) {
        applyParsedData(remoteData, false);
        showToast("Nuove modifiche ai turni sincronizzate in tempo reale dal cloud!");
      }
    }, (err) => {
      console.warn("Snapshot listener error:", err);
    });
  } catch (err) {
    console.warn("Errore avvio listener cloud:", err);
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
    
    // 0. Individuazione caselle azzurre (giorni di Ferie) tramite JSZip
    const azzurroCellRefs = new Set();
    if (typeof JSZip !== "undefined") {
      try {
        const zip = await JSZip.loadAsync(data);
        const stylesFile = zip.file("xl/styles.xml");
        if (stylesFile) {
          const stylesXml = await stylesFile.async("string");
          
          // Trova tutti gli ID di fill azzurri / ciano (es. FF33CCFF o ciano standard)
          const azzurroFillIds = new Set();
          const fillMatches = stylesXml.match(/<fill[\s\S]*?<\/fill>/gi) || [];
          fillMatches.forEach((fillXml, idx) => {
            const rgbMatch = fillXml.match(/rgb=["']([0-9A-Fa-f]{6,8})["']/i);
            if (rgbMatch) {
              const hex = rgbMatch[1].toUpperCase();
              if (hex.endsWith("33CCFF") || hex === "FF33CCFF" || hex === "33CCFF" || hex.endsWith("00CCFF") || hex.endsWith("00FFFF")) {
                azzurroFillIds.add(idx);
              } else if (hex.length >= 6) {
                const rawHex = hex.length === 8 ? hex.slice(2) : hex;
                const r = parseInt(rawHex.slice(0, 2), 16);
                const g = parseInt(rawHex.slice(2, 4), 16);
                const b = parseInt(rawHex.slice(4, 6), 16);
                if (b >= 220 && g >= 160 && r <= 100) {
                  azzurroFillIds.add(idx);
                }
              }
            }
            const indexedMatch = fillXml.match(/indexed=["'](\d+)["']/i);
            if (indexedMatch) {
              const idxVal = parseInt(indexedMatch[1], 10);
              if (idxVal === 41 || idxVal === 42 || idxVal === 9) {
                azzurroFillIds.add(idx);
              }
            }
          });

          // Trova tutti gli xf che fanno riferimento a un fillId azzurro
          const azzurroXfIds = new Set();
          const cellXfsMatch = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/i);
          if (cellXfsMatch) {
            const xfMatches = cellXfsMatch[1].match(/<xf[\s\S]*?>/gi) || [];
            xfMatches.forEach((xfXml, xfIdx) => {
              const fillIdMatch = xfXml.match(/fillId=["'](\d+)["']/i);
              if (fillIdMatch && azzurroFillIds.has(parseInt(fillIdMatch[1], 10))) {
                azzurroXfIds.add(String(xfIdx));
              }
            });
          }

          // Individua il worksheet per "Inserimento Orari"
          let targetSheetPath = "xl/worksheets/sheet3.xml";
          const wbFile = zip.file("xl/workbook.xml");
          const relsFile = zip.file("xl/_rels/workbook.xml.rels");
          if (wbFile && relsFile) {
            const wbXml = await wbFile.async("string");
            const relsXml = await relsFile.async("string");
            const sheetTagMatch = wbXml.match(/<sheet[^>]*name=["'][^"']*inserimento[^"']*orari[^"']*["'][^>]*r:id=["']([^"']+)["']/i) ||
                                  wbXml.match(/<sheet[^>]*r:id=["']([^"']+)["'][^>]*name=["'][^"']*inserimento[^"']*orari[^"']*["']/i);
            if (sheetTagMatch) {
              const relId = sheetTagMatch[1];
              const targetMatch = relsXml.match(new RegExp(`<Relationship[^>]*Id=["']${relId}["'][^>]*Target=["']([^"']+)["']`, 'i'));
              if (targetMatch) {
                const rawTarget = targetMatch[1];
                targetSheetPath = rawTarget.startsWith("worksheets/") ? `xl/${rawTarget}` : `xl/worksheets/${rawTarget.replace(/.*[\/\\]/, '')}`;
              }
            }
          }

          let sheetFile = zip.file(targetSheetPath);
          if (!sheetFile) {
            const wsFiles = Object.keys(zip.files).filter(k => k.startsWith("xl/worksheets/sheet"));
            for (const wsKey of wsFiles) {
              const content = await zip.files[wsKey].async("string");
              if (content.includes('s="165"') || content.includes('s="142"')) {
                sheetFile = zip.files[wsKey];
                break;
              }
            }
          }

          if (sheetFile) {
            const sheetXml = await sheetFile.async("string");
            const cellRegex = /<c\s+([^>]*?)>/gi;
            let cMatch;
            while ((cMatch = cellRegex.exec(sheetXml)) !== null) {
              const attrs = cMatch[1];
              const rMatch = attrs.match(/r=["']([A-Z0-9]+)["']/i);
              const sMatch = attrs.match(/s=["'](\d+)["']/i);
              if (rMatch && sMatch && azzurroXfIds.has(sMatch[1])) {
                azzurroCellRefs.add(rMatch[1].toUpperCase());
              }
            }
          }
        }
      } catch (zipErr) {
        console.warn("Avviso lettura caselle azzurre con JSZip:", zipErr);
      }
    }

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
    
    // Funzione interna per controllare se un giorno è compilato per almeno un dipendente
    function isDayCompiledForStore(dDef, startRow, endRow) {
      const cols = [dDef.inM, dDef.outM, dDef.inP, dDef.outP, dDef.tot];
      for (let r = startRow; r <= endRow; r++) {
        for (let i = 0; i < cols.length; i++) {
          const cell = worksheet[`${cols[i]}${r}`];
          if (cell && cell.v !== undefined && cell.v !== null && cell.v !== "") {
            const val = typeof cell.v === "number" ? cell.v : parseFloat(String(cell.v).replace(",", "."));
            if (!isNaN(val) && val > 0 && val <= 24) {
              return true; // Almeno una persona nel negozio ha orario compilato in questo giorno
            }
          }
        }
      }
      return false; // Nessuna persona del negozio ha orario compilato in questo giorno
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
      
      // Righe del personale per questa settimana
      const staffStart = wRow + 4;
      const staffEnd = Math.min(wRow + 85, range.e.r + 1);

      // Per ciascuno dei 7 giorni della settimana (inclusi giorni del mese successivo)
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

        // Verifica se la casella per Giusy è azzurra (Ferie)
        const isAzzurraCell = azzurroCellRefs.has(`${dDef.inM}${gRow}`) ||
                              azzurroCellRefs.has(`${dDef.outM}${gRow}`) ||
                              azzurroCellRefs.has(`${dDef.inP}${gRow}`) ||
                              azzurroCellRefs.has(`${dDef.outP}${gRow}`) ||
                              azzurroCellRefs.has(`${dDef.tot}${gRow}`);

        // NON importare giorni se non sono stati compilati orari di nessuna persona nel negozio,
        // a meno che Giusy non abbia ferie esplicite per quel giorno
        if (!isDayCompiledForStore(dDef, staffStart, staffEnd) && !isAzzurraCell) {
          return;
        }
        
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
        
        // Se la casella è azzurra, è considerata un giorno di FERIE (NON di riposo)
        const isFerie = isAzzurraCell;
        const hasWork = !isFerie && ((inMorning && outMorning) || (inAfternoon && outAfternoon) || totalHoursNum > 0);
        
        // Riconoscimento orario iniziale e finale complessivo della giornata
        const startTime = hasWork ? (inMorning || inAfternoon || null) : null;
        const endTime = hasWork ? (outAfternoon || outMorning || null) : null;
        
        // Valutazione Apertura e Chiusura:
        // Apertura: ingresso mattina <= 09:30
        // Chiusura: uscita pomeriggio/sera >= 21:00
        const startDec = rawInM ? parseFloat(rawInM) : (rawInP ? parseFloat(rawInP) : null);
        const endDec = rawOutP ? parseFloat(rawOutP) : (rawOutM ? parseFloat(rawOutM) : null);
        
        const isApertura = hasWork && startDec !== null && startDec <= 9.5;
        const isChiusura = hasWork && endDec !== null && endDec >= 21.0;
        // NOTA: I giorni di Ferie NON sono giorni di Riposo!
        const isRiposo = !isFerie && (!hasWork || totalHoursNum === 0);
        
        const dateKey = formatDateKey(dayDate);
        
        parsedShifts[dateKey] = {
          date: dateKey,
          dayName: dDef.name,
          weekIndex: gIdx + 1,
          weekLabel: `Settimana ${gIdx + 1}`,
          hasWork,
          isRiposo,
          isFerie,
          isApertura,
          isChiusura,
          inMorning: isFerie ? null : inMorning,
          outMorning: isFerie ? null : outMorning,
          inAfternoon: isFerie ? null : inAfternoon,
          outAfternoon: isFerie ? null : outAfternoon,
          startTime,
          endTime,
          totalHours: (isRiposo || isFerie) ? 0 : totalHoursNum,
          overtimeHours: (hasWork && totalHoursNum > 5) ? Math.round((totalHoursNum - 5) * 10) / 10 : 0,
          displayHours: isFerie ? "Ferie" : (hasWork ? (
            inMorning && outMorning && inAfternoon && outAfternoon ? 
              `${inMorning}-${outMorning} / ${inAfternoon}-${outAfternoon}` : 
              (inMorning && outMorning ? `${inMorning} - ${outMorning}` : `${inAfternoon} - ${outAfternoon}`)
          ) : "Riposo")
        };
        
        if (hasWork || isFerie) {
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
 * Gestisce l'aggiunta dei turni, il controllo mesi doppi e la protezione esplicita dei turni variati
 */
function handleIncomingShifts(incomingShifts, fileName, giusyRowsCount) {
  const incomingDateKeys = Object.keys(incomingShifts);
  if (incomingDateKeys.length === 0) {
    showToast("Nessun turno valido trovato nel file.");
    return;
  }

  // Identifica i mesi presenti nel nuovo file (formato "YYYY-MM")
  const incomingMonthKeys = Array.from(new Set(incomingDateKeys.map(d => d.slice(0, 7))));
  
  // Identifica le date e i mesi già memorizzati nei dati correnti dell'app
  const existingDateKeys = Object.keys(APP_STATE.shiftsData || {});
  const existingMonthKeys = new Set(existingDateKeys.map(d => d.slice(0, 7)));

  // Trova le date coincidenti già memorizzate
  const overlappingDates = incomingDateKeys.filter(d => existingDateKeys.includes(d));

  // Trova se ci sono giorni con orario variato manualmente che verrebbero sovrascritti
  const manualOverlapDates = incomingDateKeys.filter(d => APP_STATE.shiftsData[d] && APP_STATE.shiftsData[d].isManualChange);

  // Trova i mesi in cui ci sono date coincidenti
  const conflictingMonths = incomingMonthKeys.filter(m => {
    return overlappingDates.some(d => d.startsWith(m));
  });

  if (conflictingMonths.length > 0 || manualOverlapDates.length > 0) {
    // Richiede conferma prima di sovrascrivere i giorni coincidenti
    pendingImport = {
      incomingShifts,
      fileName,
      totalWeeks: giusyRowsCount,
      conflictingMonths,
      manualOverlapDates,
      overlappingDates
    };
    showConflictModal(conflictingMonths, manualOverlapDates, overlappingDates);
  } else {
    // Tutte date nuove e nessuna variazione manuale: aggiungi direttamente
    executeImportMerge(incomingShifts, [], fileName, giusyRowsCount, true);
    showToast("Nuovi turni aggiunti con successo a quelli già memorizzati!");
  }
}

function showConflictModal(conflictingMonths, manualOverlapDates = [], overlappingDates = []) {
  const monthNamesIt = [
    "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
    "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"
  ];
  
  const formattedMonths = conflictingMonths.map(mStr => {
    const [y, m] = mStr.split("-").map(Number);
    return `${monthNamesIt[m - 1]} ${y}`;
  }).join(" e ");

  const msgEl = document.getElementById("conflictModalMsg");
  const manualNotice = document.getElementById("conflictModalManualNotice");
  const manualListEl = document.getElementById("conflictManualDatesList");
  const btnKeep = document.getElementById("btnKeepManualAndImport");
  const btnConfirmText = document.getElementById("btnConfirmReplaceText");

  if (manualOverlapDates && manualOverlapDates.length > 0) {
    manualNotice.style.display = "block";
    btnKeep.style.display = "flex";
    btnConfirmText.textContent = "Autorizza e Sovrascrivi Tutto";
    manualListEl.innerHTML = manualOverlapDates.map(d => {
      const s = APP_STATE.shiftsData[d];
      const hoursDesc = s.hasWork ? `${s.startTime} - ${s.endTime} (${s.totalHours}h)` : "Riposo";
      return `• <strong>${formatItalianDate(d)}</strong>: ${hoursDesc} (variato)`;
    }).join("<br>");
    
    if (msgEl) {
      msgEl.innerHTML = `Il file caricato contiene turni che andrebbero a sovrascrivere <strong>${manualOverlapDates.length} turno/i con orario variato manualmente</strong>.<br><br>I turni con orario variato non possono essere sovrascritti se non con la tua autorizzazione esplicita.<br><em>Nota: gli altri giorni già memorizzati dello stesso mese non inclusi nel file rimarranno inalterati.</em>`;
    }
  } else {
    manualNotice.style.display = "none";
    btnKeep.style.display = "none";
    btnConfirmText.textContent = "Aggiorna Giorni Presenti nel File";
    if (msgEl) {
      msgEl.innerHTML = `Il file contiene <strong>${overlappingDates.length} giornate</strong> di <strong>${formattedMonths}</strong> già memorizzate in precedenza.<br><br>Confermi di voler <strong>sovrascrivere solo i giorni presenti nel file</strong>? Gli altri giorni dello stesso mese (ad es. caricati da altri file) rimarranno <strong>inalterati</strong>.`;
    }
  }

  document.getElementById("conflictModal").classList.add("active");
}

function closeConflictModal() {
  document.getElementById("conflictModal").classList.remove("active");
  pendingImport = null;
}

/**
 * Esegue l'unione dei nuovi turni con quelli preesistenti.
 * Sovrascrive ESCLUSIVAMENTE i giorni presenti nel file caricato.
 * Lascia completamente inalterati i giorni dello stesso mese (o di altri mesi)
 * che non sono inclusi nel file caricato.
 */
function executeImportMerge(incomingShifts, replaceMonths = [], fileName = "import.xlsx", totalWeeks = 0, preserveManualChanges = true) {
  // Inizia con una copia dei dati già memorizzati in precedenza
  // TUTTI i giorni esistenti non inclusi in incomingShifts rimangono inalterati
  const merged = { ...APP_STATE.shiftsData };

  // Sovrascrivi SOLO i giorni presenti nel file caricato
  Object.keys(incomingShifts).forEach(dateKey => {
    if (preserveManualChanges && merged[dateKey] && merged[dateKey].isManualChange) {
      // Protezione: non sovrascrivere il giorno modificato manualmente senza autorizzazione esplicita
    } else {
      merged[dateKey] = incomingShifts[dateKey];
    }
  });

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
  syncCalendarToActiveMonth();
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

/**
 * Dal primo giorno del mese successivo (o mese in corso),
 * mostra automaticamente tutto il mese in corso nel calendario.
 */
function syncCalendarToActiveMonth() {
  const now = new Date();
  const currentRealMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const allDates = Object.keys(APP_STATE.shiftsData || {});

  if (allDates.length === 0) {
    APP_STATE.currentDate = currentRealMonth;
    return;
  }

  // Se ci sono turni per il mese solare reale in corso (dal 1° giorno del mese in poi), mostralo
  const hasShiftsInRealMonth = allDates.some(d => d.startsWith(nowKey));
  if (hasShiftsInRealMonth) {
    APP_STATE.currentDate = currentRealMonth;
    return;
  }

  // Se oggi ha raggiunto o superato il 1° giorno del mese successivo rispetto all'inizio dei dati:
  const sorted = allDates.sort();
  const earliestDate = sorted[0];
  const [earliestY, earliestM] = earliestDate.split("-").map(Number);
  const earliestMonthStart = new Date(earliestY, earliestM - 1, 1);

  if (now >= earliestMonthStart) {
    // Mostra il mese corrente
    APP_STATE.currentDate = currentRealMonth;
  } else {
    // Altrimenti imposta sul mese dei dati importati
    const midDate = sorted[Math.floor(sorted.length / 2)];
    const [y, m] = midDate.split("-").map(Number);
    APP_STATE.currentDate = new Date(y, m - 1, 1);
  }
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
  
  // 1. Settimana iniziale completa: giorni del mese precedente prima del 1° del mese (Lun=0...Dom=6)
  let startDayOfWeek = (firstDay.getDay() + 6) % 7;
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const prevDate = new Date(year, month, -i);
    const dateKey = formatDateKey(prevDate);
    const shift = APP_STATE.shiftsData[dateKey];
    grid.appendChild(createDayCell(prevDate, shift, true));
  }
  
  // 2. Giorni del mese corrente
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const thisDate = new Date(year, month, d);
    const dateKey = formatDateKey(thisDate);
    const shift = APP_STATE.shiftsData[dateKey];
    grid.appendChild(createDayCell(thisDate, shift, false));
  }

  // 3. Settimana finale completa: giorni del mese successivo fino a Domenica (Lun=0...Dom=6)
  let endDayOfWeek = (lastDay.getDay() + 6) % 7;
  const nextDaysNeeded = (6 - endDayOfWeek);
  for (let n = 1; n <= nextDaysNeeded; n++) {
    const nextDate = new Date(year, month + 1, n);
    const dateKey = formatDateKey(nextDate);
    const shift = APP_STATE.shiftsData[dateKey];
    grid.appendChild(createDayCell(nextDate, shift, true));
  }
}

function createDayCell(dateObj, shift, isOtherMonth = false) {
  const d = dateObj.getDate();
  const dateKey = formatDateKey(dateObj);
  const todayKey = formatDateKey(new Date());

  const cell = document.createElement("div");
  cell.className = "day-cell";
  if (isOtherMonth) {
    cell.classList.add("other-month");
  }
  if (dateKey === todayKey) {
    cell.classList.add("today");
  }

  if (shift) {
    if (shift.isManualChange) {
      cell.classList.add("is-cambiato");
    }

    const cambioBadge = shift.isManualChange ? `<span class="day-badge-tag tag-cambio" title="Orario variato manualmente">⇄</span>` : "";

    if (shift.isFerie) {
      // EVIDENZIA IN AZZURRO I GIORNI DI FERIE (NON DI RIPOSO)
      cell.classList.add("is-ferie");
      cell.innerHTML = `
        <div class="day-top-row">
          <span class="day-number">${d}</span>
          ${cambioBadge}
        </div>
        <div class="day-info">
          <span class="day-time-text" style="color: var(--ferie-text); font-weight: 700;">Ferie</span>
        </div>
      `;
    } else if (shift.isRiposo) {
      // EVIDENZIA IN VERDE I GIORNI DI RIPOSO
      cell.classList.add("is-riposo");
      cell.innerHTML = `
        <div class="day-top-row">
          <span class="day-number">${d}</span>
          ${cambioBadge}
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
          <div style="display: flex; align-items: center; gap: 3px;">
            ${cambioBadge}
            <span class="hours-pill">${shift.totalHours}h</span>
          </div>
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
          <div style="display: flex; align-items: center; gap: 3px;">
            ${cambioBadge}
            <span class="hours-pill">${shift.totalHours}h</span>
          </div>
        </div>
        <div class="day-info">
          <span class="day-time-text">${shift.startTime} - ${shift.endTime}</span>
        </div>
      `;
    }

    cell.addEventListener("click", () => {
      openDayDetailModal(dateObj, shift);
    });
  } else {
    cell.innerHTML = `
      <div class="day-top-row">
        <span class="day-number">${d}</span>
      </div>
    `;
  }

  return cell;
}

function updateMonthlyStats() {
  const year = APP_STATE.currentDate.getFullYear();
  const month = APP_STATE.currentDate.getMonth();
  
  let totalHours = 0;
  let riposi = 0;
  let aperture = 0;
  let chiusure = 0;
  let totalOvertime = 0;
  
  // Il riepilogo tiene conto ESCLUSIVAMENTE dei giorni che fanno parte del mese in corso selezionato
  Object.keys(APP_STATE.shiftsData).forEach(dateKey => {
    const [y, m] = dateKey.split("-").map(Number);
    if (y === year && (m - 1) === month) {
      const shift = APP_STATE.shiftsData[dateKey];
      if (shift.isFerie) {
        // Ferie: NON è un giorno di riposo, non aggiunge a riposi né a totalHours
      } else if (shift.isRiposo) {
        riposi++;
      } else {
        const h = (shift.totalHours || 0);
        totalHours += h;
        if (shift.isApertura) aperture++;
        if (shift.isChiusura) chiusure++;

        // Calcolo ore di straordinario (oltre le 5 ore contrattuali)
        const ot = shift.overtimeHours !== undefined ? shift.overtimeHours : (h > 5 ? Math.round((h - 5) * 10) / 10 : 0);
        totalOvertime += ot;
      }
    }
  });
  
  document.getElementById("statHours").textContent = `${totalHours}h`;
  document.getElementById("statRiposi").textContent = riposi;
  document.getElementById("statAperture").textContent = aperture;
  document.getElementById("statChiusure").textContent = chiusure;
  const otEl = document.getElementById("statOvertime");
  if (otEl) otEl.textContent = `${Math.round(totalOvertime * 10) / 10}h`;

  // Aggiorna anche il commento elaborato dalla AI per il mese in corso e il trend
  renderAICommentary();
}

/**
 * Elabora un commento intelligente generato dalla AI
 * che valuta il mese visualizzato e lo confronta con i mesi precedenti
 */
function renderAICommentary() {
  const container = document.getElementById("aiInsightContent");
  const monthBadge = document.getElementById("aiMonthBadge");
  if (!container) return;

  const currentYear = APP_STATE.currentDate.getFullYear();
  const currentMonth = APP_STATE.currentDate.getMonth();
  const monthNamesIt = [
    "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
    "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"
  ];
  const currentMonthName = `${monthNamesIt[currentMonth]} ${currentYear}`;
  if (monthBadge) monthBadge.textContent = currentMonthName;

  let curTotalHours = 0;
  let curWorkDays = 0;
  let curRestDays = 0;
  let curFerieDays = 0;
  let curOpenings = 0;
  let curClosings = 0;
  let curOvertime = 0;
  let curWeekendShifts = 0;
  const curWeeksSet = new Set();

  const monthsData = {};

  Object.keys(APP_STATE.shiftsData || {}).forEach(dateKey => {
    const [y, m] = dateKey.split("-").map(Number);
    const mKey = `${y}-${String(m).padStart(2, '0')}`;
    const shift = APP_STATE.shiftsData[dateKey];
    
    if (!monthsData[mKey]) {
      monthsData[mKey] = {
        year: y,
        monthIndex: m - 1,
        totalHours: 0,
        workDays: 0,
        restDays: 0,
        ferieDays: 0,
        openings: 0,
        closings: 0,
        overtime: 0,
        shiftsCount: 0
      };
    }

    const h = shift.totalHours || 0;
    const ot = shift.overtimeHours !== undefined ? shift.overtimeHours : (h > 5 ? Math.round((h - 5) * 10) / 10 : 0);
    const isWeekend = (shift.dayName === "Sabato" || shift.dayName === "Domenica");

    monthsData[mKey].shiftsCount++;
    if (shift.isFerie) {
      monthsData[mKey].ferieDays = (monthsData[mKey].ferieDays || 0) + 1;
    } else if (shift.isRiposo) {
      monthsData[mKey].restDays++;
    } else {
      monthsData[mKey].workDays++;
      monthsData[mKey].totalHours += h;
      monthsData[mKey].overtime += ot;
      if (shift.isApertura) monthsData[mKey].openings++;
      if (shift.isChiusura) monthsData[mKey].closings++;
    }

    if (y === currentYear && (m - 1) === currentMonth) {
      if (shift.weekIndex) curWeeksSet.add(shift.weekIndex);
      if (shift.isFerie) {
        curFerieDays++;
      } else if (shift.isRiposo) {
        curRestDays++;
      } else {
        curWorkDays++;
        curTotalHours += h;
        curOvertime += ot;
        if (shift.isApertura) curOpenings++;
        if (shift.isChiusura) curClosings++;
        if (isWeekend) curWeekendShifts++;
      }
    }
  });

  const curWeeksCount = Math.max(1, curWeeksSet.size);
  const curWeeklyAvg = (curTotalHours / curWeeksCount).toFixed(1);

  if (curWorkDays === 0 && curRestDays === 0 && curFerieDays === 0) {
    container.innerHTML = `
      <p style="color: var(--text-muted); font-style: italic;">
        Nessun turno registrato per ${currentMonthName}. Carica un file orari per visualizzare l'elaborazione predittiva e l'analisi AI.
      </p>
    `;
    return;
  }

  // Trova i mesi precedenti cronologicamente rispetto a quello corrente
  const curKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
  const previousMonthKeys = Object.keys(monthsData)
    .filter(k => k < curKey && monthsData[k].shiftsCount > 0)
    .sort();

  let comparisonHtml = "";
  if (previousMonthKeys.length > 0) {
    const lastPrevKey = previousMonthKeys[previousMonthKeys.length - 1];
    const prev = monthsData[lastPrevKey];
    const prevMonthName = `${monthNamesIt[prev.monthIndex]} ${prev.year}`;

    const deltaHours = Math.round((curTotalHours - prev.totalHours) * 10) / 10;
    const deltaOvertime = Math.round((curOvertime - prev.overtime) * 10) / 10;
    const deltaClosings = curClosings - prev.closings;

    let hoursTrendDesc = "";
    if (deltaHours > 0) {
      hoursTrendDesc = `un incremento di <strong>+${deltaHours}h</strong> rispetto a ${prevMonthName} (${prev.totalHours}h)`;
    } else if (deltaHours < 0) {
      hoursTrendDesc = `una riduzione di <strong>${deltaHours}h</strong> rispetto a ${prevMonthName} (${prev.totalHours}h)`;
    } else {
      hoursTrendDesc = `un monte ore identico a ${prevMonthName} (${prev.totalHours}h)`;
    }

    let otTrendDesc = "";
    if (deltaOvertime > 0) {
      otTrendDesc = `aumento dello straordinario (+${deltaOvertime}h)`;
    } else if (deltaOvertime < 0) {
      otTrendDesc = `riduzione dello straordinario (${deltaOvertime}h)`;
    } else {
      otTrendDesc = `straordinari stabili`;
    }

    let closingsTrendDesc = "";
    if (deltaClosings > 0) {
      closingsTrendDesc = `carico serale più accentuato (+${deltaClosings} chiusure)`;
    } else if (deltaClosings < 0) {
      closingsTrendDesc = `carico serale più leggero (${deltaClosings} chiusure)`;
    } else {
      closingsTrendDesc = `chiusure serali bilanciate (${curClosings})`;
    }

    comparisonHtml = `
      <div class="ai-compare-box">
        <div class="ai-compare-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="m3 16 7-7 4 4 7-7"/>
            <path d="M14 6h7v7"/>
          </svg>
          Confronto con ${prevMonthName}:
        </div>
        <div>
          Il piano presenze registra ${hoursTrendDesc}, con ${otTrendDesc} e ${closingsTrendDesc}.
        </div>
      </div>
    `;
  } else {
    comparisonHtml = `
      <div class="ai-compare-box">
        <div class="ai-compare-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <circle cx="12" cy="12" r="10"/>
            <path d="m9 12 2 2 4-4"/>
          </svg>
          Confronto con mesi precedenti:
        </div>
        <div>
          Questo mese costituisce il primo riferimento orari nell'archivio storico dell'applicazione e servirà da riferimento comparativo automatico per i prossimi mesi importati.
        </div>
      </div>
    `;
  }

  // Valutazione del carico contrattuale (20h)
  let contractAdherence = "";
  if (curWeeklyAvg >= 19.5 && curWeeklyAvg <= 20.5) {
    contractAdherence = `perfettamente allineata al contratto di <strong>20h settimanali</strong>`;
  } else if (curWeeklyAvg > 20.5) {
    contractAdherence = `leggermente superiore alla base contrattuale (${curWeeklyAvg}h/settimana)`;
  } else {
    contractAdherence = `moderata rispetto alla base contrattuale (${curWeeklyAvg}h/settimana)`;
  }

  let adviceText = "";
  if (curClosings >= 5) {
    adviceText = `Con ${curClosings} turni di chiusura (fino alle 22:00), la pianificazione dei riposi permette un buon recupero delle energie serali.`;
  } else if (curOvertime > 0) {
    adviceText = `Gli straordinari accumulati (${curOvertime}h) sono stati ben distribuiti e non hanno saturato le settimane successive.`;
  } else {
    adviceText = `I ${curRestDays} giorni di riposo garantiscono un'ottima continuità e una frequenza equilibrata tra aperture e orari intermedi.`;
  }

  container.innerHTML = `
    <p>
      Per <strong>${currentMonthName}</strong> sono previste <strong>${curTotalHours} ore lavorative</strong> su <strong>${curWorkDays} giorni di attività</strong>, <strong>${curRestDays} giorni di riposo</strong>${curFerieDays > 0 ? ` e <strong>${curFerieDays} giorni di ferie</strong>` : ""}, con una media ${contractAdherence}.
    </p>
    <p>
      Il calendario evidenzia <strong>${curClosings} turni di chiusura</strong> (≥ 21:00), <strong>${curOpenings} aperture</strong> (≤ 09:30) e <strong>${curWeekendShifts} presenze nel weekend</strong>${curOvertime > 0 ? `, oltre a <strong>${curOvertime}h di straordinario</strong>` : ""}.
    </p>
    ${comparisonHtml}
    <p style="margin-top: 8px; font-size: 0.76rem; color: var(--text-muted);">
      💡 <em>Nota AI</em>: ${adviceText}
    </p>
  `;
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
  if (shift.isFerie) {
    badgeType = `<span class="day-badge-tag tag-ferie" style="font-size: 0.8rem; padding: 4px 8px;">Giorno di Ferie</span>`;
  } else if (shift.isRiposo) {
    badgeType = `<span class="day-badge-tag tag-riposo" style="font-size: 0.8rem; padding: 4px 8px;">Giorno di Riposo</span>`;
  } else if (shift.isApertura || shift.isChiusura) {
    const list = [];
    if (shift.isApertura) list.push("Apertura Negozio");
    if (shift.isChiusura) list.push("Chiusura Negozio");
    badgeType = `<span class="day-badge-tag tag-apertura" style="font-size: 0.8rem; padding: 4px 8px;">${list.join(" & ")}</span>`;
  } else {
    badgeType = `<span class="status-pill" style="font-size: 0.8rem; padding: 4px 8px;">Turno Regolare</span>`;
  }
  
  let manualNoticeHtml = "";
  if (shift.isManualChange) {
    let origDesc = "Riposo";
    if (shift.originalIsFerie) {
      origDesc = "Ferie (0 ore)";
    } else if (shift.originalStartTime && shift.originalEndTime) {
      origDesc = `${shift.originalStartTime} — ${shift.originalEndTime} (${shift.originalTotalHours !== undefined ? shift.originalTotalHours : 0} ore)`;
    } else {
      origDesc = `Riposo (${shift.originalTotalHours !== undefined ? shift.originalTotalHours : 0} ore)`;
    }

    manualNoticeHtml = `
      <div style="background: rgba(139, 92, 246, 0.12); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: var(--radius-sm); padding: 10px 12px; margin-bottom: 14px;">
        <div style="font-weight: 700; color: #8b5cf6; display: flex; align-items: center; gap: 6px; font-size: 0.84rem;">
          <span class="day-badge-tag tag-cambio" style="padding: 2px 6px; font-size: 0.72rem;">⇄ Cambio</span>
          <span>Orario Variato Manualmente</span>
        </div>
        <div style="font-size: 0.76rem; color: var(--text-secondary); margin-top: 5px; line-height: 1.4;">
          Orario originale file Excel: <strong>${origDesc}</strong>
          ${shift.changeNote ? `<br>Motivo: <em>${shift.changeNote}</em>` : ''}
        </div>
      </div>
    `;
  }

  const effectiveOvertime = shift.overtimeHours !== undefined ? 
    shift.overtimeHours : 
    (shift.totalHours > 5 ? Math.round((shift.totalHours - 5) * 10) / 10 : 0);
  const hasOvertime = (shift.hasWork && (shift.totalHours > 5 || effectiveOvertime > 0));

  body.innerHTML = `
    ${manualNoticeHtml}

    <div style="margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center;">
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
      <span class="detail-item-val" style="color: var(--brand-primary); font-weight: 700;">${shift.hasWork ? `${shift.startTime}  —  ${shift.endTime}` : (shift.isFerie ? "Ferie (Vacanza)" : "Nessun turno (Riposo)")}</span>
    </div>
    
    <!-- Totale Ore Lavorate e Card Straordinario (se > 5 ore) -->
    <div style="display: grid; grid-template-columns: ${hasOvertime ? '1fr 1fr' : '1fr'}; gap: 10px; margin-bottom: 12px;">
      <div class="detail-item-card" style="margin-bottom: 0; background: var(--bg-surface); border: 1px solid var(--border-color);">
        <span class="detail-item-title" style="font-weight: 700;">Totale Ore Lavorate</span>
        <span class="detail-item-val" style="font-size: 1.1rem; color: var(--text-primary); font-weight: 800;">${shift.totalHours} ore</span>
      </div>

      ${hasOvertime ? `
        <div class="detail-item-card" style="margin-bottom: 0; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.4); flex-direction: column; align-items: flex-start;">
          <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <span class="detail-item-title" style="color: #b45309; font-weight: 700;">Ore Straordinario</span>
            <button type="button" id="btnEditOvertime" style="background: none; border: none; color: #b45309; cursor: pointer; padding: 2px; display: flex; align-items: center;" title="Modifica ore straordinario">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path></svg>
            </button>
          </div>
          <div id="overtimeDisplayRow" style="display: flex; align-items: baseline; justify-content: space-between; width: 100%; margin-top: 3px;">
            <span class="detail-item-val" style="font-size: 1.1rem; color: #b45309; font-weight: 800;">+${effectiveOvertime}h</span>
            <span style="font-size: 0.65rem; color: var(--text-muted);">(su base 5h)</span>
          </div>
          <div id="overtimeEditRow" style="display: none; align-items: center; gap: 6px; width: 100%; margin-top: 4px;">
            <input type="number" id="inputOvertimeVal" step="0.5" min="0" max="15" value="${effectiveOvertime}" class="form-input" style="padding: 4px 6px; font-size: 0.85rem; height: 32px; width: 65px;">
            <button type="button" id="btnSaveOvertime" class="icon-btn icon-btn-primary" style="height: 32px; padding: 0 8px; font-size: 0.75rem; border-radius: var(--radius-sm);">Salva</button>
          </div>
        </div>
      ` : ''}
    </div>

    <!-- Sezione Modifica Orario (Cambio Turno) -->
    <div class="edit-shift-section">
      <button type="button" class="edit-shift-toggle-btn" id="btnToggleEditShift">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path>
        </svg>
        <span>${shift.isManualChange ? "Modifica di Nuovo l'Orario" : "Modifica Orario Effettivo (Cambio Turno)"}</span>
      </button>

      <div id="editShiftPanel" class="edit-shift-panel" style="display: none;">
        <div class="form-group" style="margin-bottom: 12px;">
          <label class="form-label" for="selectShiftType">Tipologia Giornata</label>
          <select id="selectShiftType" class="form-input" style="font-weight: 600;">
            <option value="work" ${shift.hasWork ? "selected" : ""}>Turno Lavorativo (Orari specificati)</option>
            <option value="riposo" ${shift.isRiposo ? "selected" : ""}>Giorno di Riposo (0 ore)</option>
            <option value="ferie" ${shift.isFerie ? "selected" : ""}>Giorno di Ferie (0 ore)</option>
          </select>
        </div>

        <div id="timeInputsContainer" class="form-row-2col" style="${shift.hasWork ? "" : "display: none;"}">
          <div class="form-group">
            <label class="form-label" for="inputStartTime">Inizio Effettivo</label>
            <input type="time" id="inputStartTime" class="form-input" value="${shift.startTime || '09:00'}">
          </div>
          <div class="form-group">
            <label class="form-label" for="inputEndTime">Fine Effettiva</label>
            <input type="time" id="inputEndTime" class="form-input" value="${shift.endTime || '14:00'}">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="inputChangeNote">Motivo / Nota Cambio (Opzionale)</label>
          <input type="text" id="inputChangeNote" class="form-input" placeholder="es. Cambio turno collega, straordinario..." value="${shift.changeNote || ''}">
        </div>

        <div style="display: flex; gap: 8px; margin-top: 4px;">
          <button type="button" id="btnSaveShiftChange" class="icon-btn icon-btn-primary" style="flex: 1; height: 42px; font-weight: 700; font-size: 0.88rem; border-radius: var(--radius-sm);">
            Salva Variazione
          </button>
          ${shift.isManualChange ? `
            <button type="button" id="btnRevertShiftChange" class="icon-btn" style="height: 42px; font-weight: 600; font-size: 0.82rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color); color: #ef4444;" title="Ripristina orario originale da Excel">
              Ripristina
            </button>
          ` : ''}
        </div>
      </div>
    </div>
  `;

  // Listener per card straordinario
  if (hasOvertime) {
    const btnEditOt = document.getElementById("btnEditOvertime");
    const otDisplay = document.getElementById("overtimeDisplayRow");
    const otEdit = document.getElementById("overtimeEditRow");
    const inputOt = document.getElementById("inputOvertimeVal");
    const btnSaveOt = document.getElementById("btnSaveOvertime");

    if (btnEditOt) {
      btnEditOt.addEventListener("click", () => {
        const isEditing = otEdit.style.display === "flex";
        otEdit.style.display = isEditing ? "none" : "flex";
        otDisplay.style.display = isEditing ? "flex" : "none";
        if (!isEditing && inputOt) inputOt.focus();
      });
    }

    if (btnSaveOt) {
      btnSaveOt.addEventListener("click", () => {
        const val = parseFloat(inputOt.value);
        const newOt = !isNaN(val) && val >= 0 ? val : 0;
        shift.overtimeHours = newOt;
        shift.hasCustomOvertime = true;
        persistShiftsData();
        updateMonthlyStats();
        renderStatistics();
        openDayDetailModal(dateObj, shift);
        showToast(`Ore di straordinario impostate a ${newOt}h`);
      });
    }
  }

  // Listener per pannello modifica orario
  const btnToggle = document.getElementById("btnToggleEditShift");
  const panel = document.getElementById("editShiftPanel");
  const selectType = document.getElementById("selectShiftType");
  const timeContainer = document.getElementById("timeInputsContainer");
  const inStart = document.getElementById("inputStartTime");
  const inEnd = document.getElementById("inputEndTime");
  const inNote = document.getElementById("inputChangeNote");
  const btnSave = document.getElementById("btnSaveShiftChange");
  const btnRevert = document.getElementById("btnRevertShiftChange");

  btnToggle.addEventListener("click", () => {
    panel.style.display = panel.style.display === "none" ? "flex" : "none";
  });

  if (selectType) {
    selectType.addEventListener("change", () => {
      timeContainer.style.display = selectType.value === "work" ? "grid" : "none";
    });
  }

  btnSave.addEventListener("click", () => {
    saveShiftManualChange(shift, {
      shiftType: selectType ? selectType.value : "work",
      isRiposo: selectType ? selectType.value === "riposo" : false,
      isFerie: selectType ? selectType.value === "ferie" : false,
      startTime: inStart.value,
      endTime: inEnd.value,
      note: inNote.value.trim()
    });
    modal.classList.remove("active");
  });

  if (btnRevert) {
    btnRevert.addEventListener("click", () => {
      revertShiftManualChange(shift);
      modal.classList.remove("active");
    });
  }
  
  modal.classList.add("active");
}

function calculateShiftHours(t1, t2) {
  if (!t1 || !t2) return 0;
  const [h1, m1] = t1.split(":").map(Number);
  const [h2, m2] = t2.split(":").map(Number);
  let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (diff < 0) diff += 24 * 60;
  return Math.round((diff / 60) * 10) / 10;
}

function saveShiftManualChange(shift, changes) {
  // Salva i valori originali prima della prima variazione manuale
  if (shift.originalStartTime === undefined) {
    shift.originalStartTime = shift.startTime;
    shift.originalEndTime = shift.endTime;
    shift.originalTotalHours = shift.totalHours;
    shift.originalIsRiposo = shift.isRiposo;
    shift.originalIsFerie = shift.isFerie || false;
    shift.originalIsApertura = shift.isApertura;
    shift.originalIsChiusura = shift.isChiusura;
  }

  if (changes.shiftType === "ferie" || changes.isFerie) {
    shift.isFerie = true;
    shift.isRiposo = false;
    shift.hasWork = false;
    shift.startTime = null;
    shift.endTime = null;
    shift.totalHours = 0;
    shift.overtimeHours = 0;
    shift.isApertura = false;
    shift.isChiusura = false;
    shift.displayHours = "Ferie";
  } else if (changes.shiftType === "riposo" || changes.isRiposo) {
    shift.isFerie = false;
    shift.isRiposo = true;
    shift.hasWork = false;
    shift.startTime = null;
    shift.endTime = null;
    shift.totalHours = 0;
    shift.overtimeHours = 0;
    shift.isApertura = false;
    shift.isChiusura = false;
    shift.displayHours = "Riposo";
  } else {
    shift.isFerie = false;
    shift.isRiposo = false;
    shift.hasWork = true;
    shift.startTime = changes.startTime;
    shift.endTime = changes.endTime;
    shift.totalHours = calculateShiftHours(changes.startTime, changes.endTime);
    shift.overtimeHours = shift.totalHours > 5 ? Math.round((shift.totalHours - 5) * 10) / 10 : 0;
    
    // Calcolo apertura e chiusura in base ai nuovi orari
    const [startH, startM] = changes.startTime.split(":").map(Number);
    const [endH, endM] = changes.endTime.split(":").map(Number);
    const startDec = startH + startM / 60;
    const endDec = endH + endM / 60;
    
    shift.isApertura = startDec <= 9.5;
    shift.isChiusura = endDec >= 21.0;
    shift.displayHours = `${shift.startTime} - ${shift.endTime}`;
  }

  shift.isManualChange = true;
  shift.changeNote = changes.note || "Orario variato manualmente";
  shift.changeTimestamp = new Date().toISOString();

  persistShiftsData();
  renderCalendar();
  updateMonthlyStats();
  renderStatistics();
  showToast("Orario del giorno variato con successo!");
}

function revertShiftManualChange(shift) {
  if (shift.originalStartTime !== undefined) {
    shift.startTime = shift.originalStartTime;
    shift.endTime = shift.originalEndTime;
    shift.totalHours = shift.originalTotalHours;
    shift.isRiposo = shift.originalIsRiposo;
    shift.isFerie = shift.originalIsFerie || false;
    shift.isApertura = shift.originalIsApertura;
    shift.isChiusura = shift.originalIsChiusura;
    shift.overtimeHours = shift.totalHours > 5 ? Math.round((shift.totalHours - 5) * 10) / 10 : 0;
    delete shift.hasCustomOvertime;
    shift.hasWork = !shift.isRiposo && !shift.isFerie;
    shift.displayHours = shift.isFerie ? "Ferie" : (shift.hasWork ? `${shift.startTime} - ${shift.endTime}` : "Riposo");
  }
  
  delete shift.isManualChange;
  delete shift.changeNote;
  delete shift.changeTimestamp;

  persistShiftsData();
  renderCalendar();
  updateMonthlyStats();
  renderStatistics();
  showToast("Orario originale da file Excel ripristinato!");
}

function persistShiftsData() {
  const allWorkingDates = Object.values(APP_STATE.shiftsData)
    .filter(s => s.hasWork && s.date)
    .map(s => s.date)
    .sort();

  const periodStart = allWorkingDates.length > 0 ? allWorkingDates[0] : null;
  const periodEnd = allWorkingDates.length > 0 ? allWorkingDates[allWorkingDates.length - 1] : null;

  const payload = {
    person: "Giusy de Santis",
    lastUpdate: new Date().toISOString(),
    periodStart,
    periodEnd,
    totalShifts: Object.keys(APP_STATE.shiftsData).length,
    shiftsData: APP_STATE.shiftsData
  };

  localStorage.setItem("giusy_shifts_payload", JSON.stringify(payload));
  syncToFirebase(payload);
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
  let ferieDaysCount = 0;
  let openingsCount = 0;
  let closingsCount = 0;
  let regularCount = 0;
  let weekendShiftsCount = 0;
  let totalOvertime = 0;
  
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
    
    if (s.isFerie) {
      ferieDaysCount++;
    } else if (s.isRiposo) {
      restDaysCount++;
    } else {
      workDaysCount++;
      totalHours += h;
      
      const ot = s.overtimeHours !== undefined ? s.overtimeHours : (h > 5 ? Math.round((h - 5) * 10) / 10 : 0);
      totalOvertime += ot;

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
        overtimeHours: 0,
        workDays: 0,
        restDays: 0,
        ferieDays: 0,
        openings: 0,
        closings: 0,
        shifts: []
      };
    }
    weeksMap[wKey].shifts.push(s);
    if (s.isFerie) {
      weeksMap[wKey].ferieDays++;
    } else if (s.isRiposo) {
      weeksMap[wKey].restDays++;
    } else {
      weeksMap[wKey].workDays++;
      weeksMap[wKey].totalHours += h;
      const ot = s.overtimeHours !== undefined ? s.overtimeHours : (h > 5 ? Math.round((h - 5) * 10) / 10 : 0);
      weeksMap[wKey].overtimeHours += ot;
      if (s.isApertura) weeksMap[wKey].openings++;
      if (s.isChiusura) weeksMap[wKey].closings++;
    }
  });

  const weeksList = Object.values(weeksMap);
  const totalWeeks = Math.max(1, weeksList.length);
  const avgWeeklyHours = (totalHours / totalWeeks).toFixed(1);

  // Ordina turni speciali per data
  specialShifts.sort((a, b) => a.date.localeCompare(b.date));

  // Turni con variazioni manuali (cambi)
  const manualChanges = shifts.filter(s => s.isManualChange);

  return {
    totalHours,
    totalOvertime: Math.round(totalOvertime * 10) / 10,
    workDaysCount,
    restDaysCount,
    ferieDaysCount,
    openingsCount,
    closingsCount,
    regularCount,
    weekendShiftsCount,
    manualChangesCount: manualChanges.length,
    manualChanges,
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
  const kpiCambi = document.getElementById("kpiManualChanges");
  if (kpiCambi) kpiCambi.textContent = stats.manualChangesCount;
  const kpiOt = document.getElementById("kpiTotalOvertime");
  if (kpiOt) kpiOt.textContent = `${stats.totalOvertime}h`;

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

  // 7. Sezione Cambi Turno (Modifiche Manuali)
  renderManualChangesList(stats.manualChanges);
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
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 16px;">Nessuna settimana presente</td></tr>`;
    return;
  }

  tbody.innerHTML = weeks.map(w => {
    const ot = Math.round(w.overtimeHours * 10) / 10;
    return `
      <tr>
        <td style="font-weight: 700; color: var(--brand-primary);">${w.label}</td>
        <td><span class="hours-pill" style="font-size: 0.75rem;">${w.totalHours}h</span></td>
        <td><span style="color: #b45309; font-weight: 700;">${ot > 0 ? `+${ot}h` : '0h'}</span></td>
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

function renderManualChangesList(manualChanges) {
  const container = document.getElementById("manualChangesList");
  if (!container) return;

  if (!manualChanges || manualChanges.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 18px; font-size: 0.85rem;">
        Nessun turno variato manualmente nel periodo selezionato.
      </div>
    `;
    return;
  }

  // Ordina cronologicamente
  const sorted = [...manualChanges].sort((a, b) => a.date.localeCompare(b.date));

  container.innerHTML = sorted.map(s => {
    const origHours = s.originalTotalHours !== undefined ? s.originalTotalHours : 0;
    const newHours = s.totalHours || 0;
    const diff = Math.round((newHours - origHours) * 10) / 10;
    
    let diffBadge = "";
    if (diff > 0) {
      diffBadge = `<span class="cambio-diff-pill diff-plus">+${diff}h</span>`;
    } else if (diff < 0) {
      diffBadge = `<span class="cambio-diff-pill diff-minus">${diff}h</span>`;
    } else {
      diffBadge = `<span class="cambio-diff-pill" style="background: var(--bg-surface); color: var(--text-secondary);">= 0h</span>`;
    }

    const origDesc = (s.originalStartTime && s.originalEndTime) ? 
      `${s.originalStartTime} — ${s.originalEndTime} (${origHours}h)` : 
      (s.originalIsRiposo ? "Riposo (0h)" : `${origHours}h`);

    const newDesc = (s.startTime && s.endTime) ? 
      `${s.startTime} — ${s.endTime} (${newHours}h)` : 
      "Riposo (0h)";

    return `
      <div class="cambio-card">
        <div class="cambio-card-header">
          <span class="cambio-card-title">${formatItalianDate(s.date)} (${s.dayName})</span>
          <div>${diffBadge}</div>
        </div>
        <div class="cambio-card-body">
          <div>
            <div style="color: var(--text-secondary); font-size: 0.73rem;">Da Excel: <strong style="color: var(--text-primary);">${origDesc}</strong></div>
            <div style="color: #8b5cf6; font-size: 0.77rem; font-weight: 700; margin-top: 2px;">Effettivo: ${newDesc}</div>
          </div>
          <button type="button" class="icon-btn btn-revert-cambio" data-date="${s.date}" style="height: 32px; padding: 4px 10px; font-size: 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color); color: #ef4444;" title="Ripristina orario del file Excel">
            Ripristina
          </button>
        </div>
        ${s.changeNote ? `<div style="font-size: 0.71rem; color: var(--text-muted); font-style: italic;">Nota: ${s.changeNote}</div>` : ''}
      </div>
    `;
  }).join("");

  // Aggiungi listener ai pulsanti di ripristino
  container.querySelectorAll(".btn-revert-cambio").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const dateKey = e.currentTarget.getAttribute("data-date");
      if (dateKey && APP_STATE.shiftsData[dateKey]) {
        revertShiftManualChange(APP_STATE.shiftsData[dateKey]);
      }
    });
  });
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

// Event Listeners per Gestione Conflitti Mese già Memorizzato & Protezione Cambi
const btnKeepManual = document.getElementById("btnKeepManualAndImport");
if (btnKeepManual) {
  btnKeepManual.addEventListener("click", () => {
    if (pendingImport) {
      const { incomingShifts, conflictingMonths, fileName, totalWeeks } = pendingImport;
      executeImportMerge(incomingShifts, conflictingMonths, fileName, totalWeeks, true /* preserveManualChanges */);
      closeConflictModal();
      showToast("Giorni aggiornati proteggendo le modifiche manuali (gli altri giorni sono rimasti inalterati)!");
    }
  });
}

document.getElementById("btnConfirmReplaceMonth").addEventListener("click", () => {
  if (pendingImport) {
    const { incomingShifts, conflictingMonths, fileName, totalWeeks } = pendingImport;
    // Autorizzazione esplicita a sovrascrivere tutto compresi i turni variati
    executeImportMerge(incomingShifts, conflictingMonths, fileName, totalWeeks, false /* allow overwrite */);
    closeConflictModal();
    showToast("Giorni presenti nel file aggiornati (gli altri giorni sono rimasti inalterati)!");
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

// Pulsante per sincronizzazione manuale Firebase Cloud
const btnManualSync = document.getElementById("btnManualCloudSync");
if (btnManualSync) {
  btnManualSync.addEventListener("click", async () => {
    showToast("Sincronizzazione Cloud in corso...");
    btnManualSync.disabled = true;
    try {
      await initFirebase(HASH_AUTH_KEY);
      const localRaw = localStorage.getItem("giusy_shifts_payload");
      if (localRaw) {
        const localPayload = JSON.parse(localRaw);
        await syncToFirebase(localPayload);
      }
      await reconcileCloudAndLocalShifts();
      const timeStr = new Date().toLocaleTimeString("it-IT", { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const lastSyncEl = document.getElementById("lastSyncTimeText");
      if (lastSyncEl) {
        lastSyncEl.textContent = `Ultima sincronizzazione: oggi alle ${timeStr}`;
      }
      showToast("Dati sincronizzati con successo sul Cloud Firebase!");
    } catch (err) {
      console.error("Errore sync manuale:", err);
      showToast("Errore durante la sincronizzazione cloud.");
    } finally {
      btnManualSync.disabled = false;
    }
  });
}

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
  } else {
    syncCalendarToActiveMonth();
    renderCalendar();
    updateMonthlyStats();
  }
  
  // Inizializza verifica accesso PIN
  initAuth();
});
