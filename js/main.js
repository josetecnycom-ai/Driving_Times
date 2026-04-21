/**
 * @file main.js
 * Lógica principal del Add-in de Tiempos de Conducción del Tacógrafo para Geotab Drive.
 * 
 * Normativa base: Reglamento (CE) nº 561/2006 y modificaciones Reglamento (UE) 2020/1054
 *   Art. 6   — Límites de conducción diaria (9h normal, 10h ampliada máx 2 por ciclo semanal)
 *   Art. 7   — Pausas de conducción (45 min tras 4h30m continuas, o 15+30 fraccionada)
 *   Art. 8.4 — Descanso diario reducido (9h, máx 3 entre descansos semanales)
 *   Art. 8.6 — Descanso semanal normal ≥ 45h / reducido ≥ 24h
 *   Art. 8.8 — Compensación del descanso semanal reducido antes de la 3ª semana siguiente
 */

var api;
var state;

/* ────────── Constantes normativas ────────── */
var CONT_DRIVING_MAX_SEC  = 4.5 * 3600;  // 4h 30m (Art. 7)
var DAILY_NORMAL_MAX_SEC  = 9   * 3600;  // 9h  (Art. 6.1)
var DAILY_EXTENDED_MAX_SEC= 10  * 3600;  // 10h (Art. 6.1 — ampliada)
var MAX_EXTENDED_DAYS     = 2;           // Máx 2 jornadas ampliadas por ciclo semanal
var REST_NORMAL_SEC       = 11  * 3600;  // 11h descanso diario normal (Art. 8.2)
var REST_REDUCED_SEC      = 9   * 3600;  // 9h  descanso diario reducido (Art. 8.4)
var MAX_REDUCED_RESTS     = 3;           // Máx 3 descansos reducidos entre descansos semanales
var WEEKLY_MAX_SEC        = 56  * 3600;  // 56h semanales (Art. 6.2)
var BIWEEKLY_MAX_SEC      = 90  * 3600;  // 90h bisemanales (Art. 6.3)

/* ────────── Helpers de log ────────── */
function log(msg, data) {
    console.log('[TachographAddin] ' + msg, data !== undefined ? data : '');
}

/* ────────── Init Drive ────────── */
function geotabDriveAddInInit(apiObj, stateObj, callback) {
    api   = apiObj;
    state = stateObj;
    log('Inicializado. Driver:', state.driver ? state.driver.id : 'N/A');

    document.getElementById('loading').style.display  = 'flex';
    document.getElementById('dashboard').style.display = 'none';

    checkTachographStatus();
    if (callback) callback();
}

/* ────────── Formatters ────────── */
function formatHM(totalSeconds) {
    if (!totalSeconds || isNaN(totalSeconds)) return '0h 0m';
    var abs  = Math.abs(totalSeconds);
    var h    = Math.floor(abs / 3600);
    var m    = Math.floor((abs % 3600) / 60);
    return h + 'h ' + m + 'm';
}

function formatRelativeTime(val) {
    if (!val || val === 0) return '--:--';
    var date = (typeof val === 'number') ? new Date(val * 1000) : new Date(val);
    if (isNaN(date.getTime())) return '--:--';

    var now = new Date();
    var isToday = date.getDate() === now.getDate() &&
                  date.getMonth() === now.getMonth() &&
                  date.getFullYear() === now.getFullYear();
    var timeStr = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    return (isToday ? 'Hoy ' : (date.getDate() + '/' + (date.getMonth()+1) + ' ')) + timeStr;
}

function formatDate(val) {
    if (!val || val === 0) return '--';
    var date = (typeof val === 'number') ? new Date(val * 1000) : new Date(val);
    if (isNaN(date.getTime())) return '--';
    return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/* ────────── Pill state helper ────────── */
function setPillState(el, count, maxCount) {
    el.classList.remove('state-ok', 'state-warn', 'state-danger');
    if (count <= 0)          el.classList.add('state-danger');
    else if (count < maxCount) el.classList.add('state-warn');
    else                     el.classList.add('state-ok');
}

/* ────────── Render ────────── */
function renderData(d) {
    document.getElementById('loading').style.display    = 'none';
    document.getElementById('errorView').style.display  = 'none';
    document.getElementById('dashboard').style.display  = 'block';

    if (!d) { showError('No hay datos de conducción para este conductor.'); return; }

    /* ── Header ── */
    if (state && state.driver) {
        var n = state.driver.name || ((state.driver.firstName||'') + ' ' + (state.driver.lastName||'')).trim();
        document.getElementById('driverName').textContent = n || 'Conductor';
    }
    if (state && state.device) {
        document.getElementById('vehicleName').innerHTML = `
            <svg viewBox="0 0 16 16" fill="currentColor" style="width:1.2em; height:1.2em; vertical-align: middle; margin-right: 4px;">
                <path fill-rule="evenodd" d="M4.333 1.333c0-.368.299-.666.667-.666h8c.368 0 .667.298.667.666v7.334a.667.667 0 01-.667.666h-.69a2.334 2.334 0 01-4.62 0H6.31a2.334 2.334 0 01-4.62 0H1a.667.667 0 01-.667-.666v-4c0-.132.04-.26.112-.37l1.334-2A.667.667 0 012.333 2h2v-.667Zm0 2H2.69L1.667 4.87V8h.224a2.334 2.334 0 012.442-1.31V3.333Zm1.3 4c.195.192.357.417.476.667h1.782a2.334 2.334 0 014.218 0h.225V2H5.667v5.333h-.034ZM4 8a1 1 0 100 2 1 1 0 000-2Zm6 0a1 1 0 100 2 1 1 0 000-2Z" clip-rule="evenodd"></path>
            </svg>
            ${state.device.name || 'Vehículo'}
        `;
    }

    var act = ((d.activityStatus || 'UNKNOWN')).toUpperCase();
    var badge = document.getElementById('currentActivityBadge');
    badge.textContent = act;
    badge.className   = 'status-badge';
    if      (act.includes('DRIVING'))   badge.classList.add('driving');
    else if (act.includes('REST'))      badge.classList.add('rest');
    else if (act.includes('WORK'))      badge.classList.add('work');
    else if (act.includes('AVAILABLE')) badge.classList.add('available');

    /* ─────────────────────────────────────────────────────────────
       JORNADAS AMPLIADAS (Art. 6.1 CE 561/2006)
       - Límite normal: 9h. Puede ampliarse a 10h máx. 2 veces
         entre descansos semanales (dailyDrivingLongDayCount)
    ──────────────────────────────────────────────────────────────── */
    var longDayCount   = d.dailyDrivingLongDayCount || 0;
    var extendedLeft   = Math.max(0, MAX_EXTENDED_DAYS - longDayCount);
    document.getElementById('extendedDaysLeft').textContent = extendedLeft;
    setPillState(document.getElementById('pillExtended'), extendedLeft, MAX_EXTENDED_DAYS);

    /* ─────────────────────────────────────────────────────────────
       DESCANSOS DIARIOS REDUCIDOS (Art. 8.4 CE 561/2006)
       - Mínimo 9h, máx. 3 veces entre descansos semanales
         (weeklyPeriodReducedRestCount)
    ──────────────────────────────────────────────────────────────── */
    var reducedUsed   = d.weeklyPeriodReducedRestCount || 0;
    var reducedLeft   = Math.max(0, MAX_REDUCED_RESTS - reducedUsed);
    document.getElementById('reducedRestsLeft').textContent = reducedLeft;
    setPillState(document.getElementById('pillReducedRest'), reducedLeft, MAX_REDUCED_RESTS);

    /* ─────────────────────────────────────────────────────────────
       COMPENSACIÓN DESCANSO SEMANAL REDUCIDO (Art. 8.6/8.8)
       - Si pendingCompensations > 0, mostrar aviso con fecha límite
    ──────────────────────────────────────────────────────────────── */
    var pendingComp = d.pendingCompensations || 0;
    var pillComp    = document.getElementById('pillCompensation');
    if (pendingComp > 0) {
        pillComp.style.display = 'flex';
        var compDuration = d.nextCompensationDuration || 0;
        document.getElementById('compensationAmt').textContent      = formatHM(compDuration);
        document.getElementById('compensationDeadline').textContent =
            d.nextCompensationLimit ? ('antes del ' + formatDate(d.nextCompensationLimit)) : 'pendiente';
    } else {
        pillComp.style.display = 'none';
    }

    /* ─────────────────────────────────────────────────────────────
       CONDUCCIÓN CONTINUA (Art. 7 CE 561/2006)
       - Máx 4h 30m seguidas. Pausa de 45 min (o 15+30 fraccionada).
    ──────────────────────────────────────────────────────────────── */
    var contTime = d.continuousDrivingTime || 0;
    document.getElementById('continuousDrivingTxt').textContent = formatHM(contTime);
    var contPct  = Math.min((contTime / CONT_DRIVING_MAX_SEC) * 100, 100);
    var contBar  = document.getElementById('continuousBar');
    contBar.style.width = contPct + '%';
    contBar.className   = 'progress ' + (contPct > 90 ? 'fill-red' : contPct > 80 ? 'fill-yellow' : 'fill-green');

    /* ─────────────────────────────────────────────────────────────
       CONDUCCIÓN DIARIA (Art. 6.1 CE 561/2006)
       - Límite efectivo: 9h si no quedan jornadas ampliadas,
         10h si aún tiene alguna disponible (y ya supera 9h o la usa).
    ──────────────────────────────────────────────────────────────── */
    var dailyTimeSec  = d.dailyDrivingTime || 0;
    // El límite efectivo que ofrece la API ya considera las jornadas disponibles
    var dailyLimitSec = d.dailyDrivingTimeLimit || DAILY_NORMAL_MAX_SEC;
    // Si la API reporta el límite como 9h pero quedan jornadas ampliadas, la barra puede ir a 10h
    var effectiveLimit = dailyLimitSec;
    if (extendedLeft > 0 && dailyLimitSec <= DAILY_NORMAL_MAX_SEC) {
        effectiveLimit = DAILY_EXTENDED_MAX_SEC;  // Puede aspirar a 10h
    }

    document.getElementById('dailyDrivingTxt').textContent = formatHM(dailyTimeSec);
    document.getElementById('dailyLimitTxt').textContent   = '/ ' + formatHM(dailyLimitSec);
    document.getElementById('startShiftTxt').textContent   = formatRelativeTime(d.activeDailyDrivingStart);

    var dailyPct = Math.min((dailyTimeSec / effectiveLimit) * 100, 100);
    var dailyBar = document.getElementById('dailyBar');
    dailyBar.style.width = dailyPct + '%';
    dailyBar.className   = 'progress ' + (dailyPct > 97 ? 'fill-red' : dailyPct > 85 ? 'fill-yellow' : 'fill-green');

    // Tag informativo sobre tipo de jornada
    var extTag = document.getElementById('extendedDayTag');
    if (dailyTimeSec > DAILY_NORMAL_MAX_SEC) {
        extTag.textContent  = '⏱ Jornada ampliada en uso (10h)';
        extTag.className    = 'tag-ext extended';
    } else if (extendedLeft > 0) {
        extTag.textContent  = '✅ Jornada ampliable hasta 10h';
        extTag.className    = 'tag-ext extended';
    } else {
        extTag.textContent  = '🔒 Límite de 9h — no quedan jornadas ampliadas';
        extTag.className    = 'tag-ext';
        extTag.style.color  = 'var(--accent-red)';
        extTag.style.background = '#fff1f2';
    }

    /* ─────────────────────────────────────────────────────────────
       DESCANSO DIARIO (Art. 8 CE 561/2006)
       - Normal: 11h. Reducido (≥9h) máx 3 veces por ciclo semanal.
       - nextRestMaxStartTime: hora tope para INICIAR el descanso
         y poder terminar dentro del ciclo de 24h.
    ──────────────────────────────────────────────────────────────── */
    // Determinamos el mínimo de descanso requerido
    var restType       = (d.dailyDrivingRestMinType || '').toLowerCase();
    var restRequiredSec = REST_NORMAL_SEC;
    var restTypeLabel   = 'Normal (11h)';
    if (restType.includes('reduced') || restType.includes('partial')) {
        restRequiredSec = REST_REDUCED_SEC;
        restTypeLabel   = 'Reducido (9h)';
    }

    // Acumulado de descanso — si está en REST usamos restDuration, si no es 0
    var currentRestSec = act.includes('REST') ? (d.restDuration || 0) : 0;

    document.getElementById('restAccumulatedTxt').textContent = formatHM(currentRestSec);
    document.getElementById('restRequiredTxt').textContent    = '/ ' + formatHM(restRequiredSec);

    var restPct = Math.min((currentRestSec / restRequiredSec) * 100, 100);
    document.getElementById('restBar').style.width = restPct + '%';

    // Hora límite para iniciar/terminar el descanso
    var deadlineVal  = d.nextRestMaxStartTime || 0;
    var deadlineRow  = document.getElementById('deadlineRow');
    if (deadlineVal === 0) {
        document.getElementById('dailyRestDeadlineTxt').textContent = 'Descanso completado ✓';
        deadlineRow.classList.remove('danger-text');
    } else {
        document.getElementById('dailyRestDeadlineTxt').textContent = formatRelativeTime(deadlineVal);
        deadlineRow.classList.add('danger-text');
    }

    // Tag de tipo de descanso
    var restTag = document.getElementById('restTypeTag');
    if (reducedLeft > 0) {
        restTag.textContent = '🛏 Puede usar descanso reducido (9h)';
        restTag.className   = 'tag-ext reduced';
        restTag.style       = '';
    } else {
        restTag.textContent = '🔒 Descanso mínimo: 11h (reducidos agotados)';
        restTag.className   = 'tag-ext';
        restTag.style.color  = 'var(--accent-red)';
        restTag.style.background = '#fff1f2';
    }

    /* ─────────────────────────────────────────────────────────────
       ACUMULADOS SEMANAL Y BISEMANAL (Art. 6.2 y 6.3)
    ──────────────────────────────────────────────────────────────── */
    var weeklySec   = d.cumulatedWeeklyDrivingTime || 0;
    var weeklyAvail = d.weeklyDrivingAvailableTime || Math.max(0, WEEKLY_MAX_SEC - weeklySec);
    document.getElementById('weeklyTxt').textContent   = formatHM(weeklySec);
    document.getElementById('weeklyAvail').textContent = formatHM(weeklyAvail) + ' disp.';
    var wPct = Math.min((weeklySec / WEEKLY_MAX_SEC) * 100, 100);
    var wBar = document.getElementById('weeklyBar');
    wBar.style.width = wPct + '%';
    wBar.className   = 'progress ' + (wPct > 90 ? 'fill-red' : wPct > 75 ? 'fill-yellow' : 'fill-yellow');

    var biweeklySec   = d.cumulatedBiweeklyDrivingTime || 0;
    var biweeklyAvail = d.biweeklyDrivingAvailableTime || Math.max(0, BIWEEKLY_MAX_SEC - biweeklySec);
    document.getElementById('biweeklyTxt').textContent   = formatHM(biweeklySec);
    document.getElementById('biweeklyAvail').textContent = formatHM(biweeklyAvail) + ' disp.';
    var bPct = Math.min((biweeklySec / BIWEEKLY_MAX_SEC) * 100, 100);
    var bBar = document.getElementById('biweeklyBar');
    bBar.style.width = bPct + '%';
    bBar.className   = 'progress ' + (bPct > 90 ? 'fill-red' : 'fill-orange');
}

/* ────────── Error ────────── */
function showError(msg) {
    document.getElementById('loading').style.display   = 'none';
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('errorView').style.display = 'block';
    if (msg) document.getElementById('errorMessage').textContent = msg;
}

/* ────────── API Call ────────── */
function checkTachographStatus() {
    log('Comprobando estado del tacógrafo...');
    document.getElementById('loading').style.display    = 'flex';
    document.getElementById('errorView').style.display  = 'none';

    if (!api || !state || !state.driver) {
        showError('Sesión del conductor no disponible. Asegúrate de estar autenticado en Drive.');
        return;
    }

    api.call('Get', { typeName: 'TachographDrivingTimeStatus', search: {} })
    .then(function(results) {
        if (!results || results.length === 0) {
            showError('No hay datos de tacógrafo disponibles. Comprueba que la tarjeta está insertada.');
            return;
        }
        var myId   = state.driver.id;
        var myData = results.find(function(r) { return r.user && r.user.id === myId; });
        if (!myData) {
            showError('No se encontraron datos para este conductor (' + myId + ').');
            return;
        }
        renderData(myData);
    })
    .catch(function(err) {
        log('Error API', err);
        showError('Error al consultar la API: ' + (err.message || err));
    });
}

/* ────────── Mock local (file:// o localhost) ────────── */
var isMockMode = (
    window.location.protocol === 'file:' ||
    window.location.href.indexOf('127.0.0.1') > -1 ||
    window.location.href.indexOf('localhost') > -1
);

if (isMockMode) {
    log('▶ Modo Mock activado — datos simulados CE 561/2006');

    document.addEventListener('DOMContentLoaded', function() {
        setTimeout(function() {
            state = {
                driver: { id: 'b1', name: 'Alejandro Almansa' },
                device: { id: 'b2', name: '3475NMB' }
            };

            // ── Escenario de prueba: 1 jornada ampliada usada, 2 descansos reducidos usados,
            //    1 compensación semanal pendiente de 21h antes del 08/05
            renderData({
                user:                          { id: 'b1' },
                activityStatus:                'DRIVING',

                // Conducción continua: 3h 28m
                continuousDrivingTime:         12480,

                // Conducción diaria: 5h 52m — límite efectivo 9h (ya usó 1 jornada ampliada)
                dailyDrivingTime:              21120,
                dailyDrivingTimeLimit:         32400,   // 9h
                dailyDrivingLongDayCount:      1,        // ← ya usó 1 de 2 jornadas ampliadas

                // Inicio de jornada: hace 6h
                activeDailyDrivingStart:       (Date.now() / 1000) - 21600,

                // Descanso: no en REST ahora
                restDuration:                  0,
                dailyDrivingRestMinType:       'DailyRegular',

                // Límite para iniciar descanso (en 3h)
                nextRestMaxStartTime:          (Date.now() / 1000) + 10800,

                // Descansos reducidos: ya usó 2 de 3
                weeklyPeriodReducedRestCount:  2,
                weeklyPeriodRegularRestCount:  1,

                // Semanal: 38h 20m / 56h
                cumulatedWeeklyDrivingTime:    138000,
                weeklyDrivingAvailableTime:    63600,

                // Bisemanal: 71h / 90h
                cumulatedBiweeklyDrivingTime:  255600,
                biweeklyDrivingAvailableTime:  68400,

                // Compensación semanal pendiente: 21h antes del 08/05
                pendingCompensations:          1,
                nextCompensationDuration:      75600,   // 21h en segundos
                nextCompensationLimit:         1746662400 // 2026-05-08 00:00:00 UTC aprox.
            });
        }, 800);
    });
}

window.geotabDriveAddInInit = geotabDriveAddInInit;

/* Registro oficial para MyGeotab/Drive */
geotab.addin.tachoDriveCustom = function () {
    return {
        initialize: function (api, state, callback) {
            geotabDriveAddInInit(api, state, callback);
        },
        focus: function (api, state) {
            if (typeof checkTachographStatus === 'function') {
                checkTachographStatus();
            }
        },
        blur: function (api, state) {
            // Limpieza si es necesaria
        }
    };
};
