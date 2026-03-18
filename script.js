const SUPABASE_URL = 'https://rxrodfskmvldozpznyrp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rm-U3aeXydu4W0wdSMLW5w_I4LIW5MO';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const MASTER_CODE = '1122';

document.addEventListener('DOMContentLoaded', () => {
    // --- State ---
    let state = {
        participants: [],
        clients: [], 
        prizes: [], 
        currentTier: localStorage.getItem('fe_current_tier') || 'general',
        allPrizes: { general: [], plata: [], oro: [] },
        companies: (JSON.parse(localStorage.getItem('fe_companies')) || [
            { id: 'default', name: 'SISDEL', logo: null, nit: 'N/A', manager: 'Sistema', phone: 'N/A', email: 'v1.0', code: 'FEA001', isActive: true }
        ]).map(c => {
            if (c.id === 'default' && !c.code) c.code = 'FEA001';
            if (!c.code) c.code = generateAccessCode(c.name);
            return c;
        }),
        currentCompanyId: localStorage.getItem('fe_current_company') || 'default',
        currentParticipant: null,
        clients: [],
        participants: [],
        isSpinning: false,
        isMaster: false,
        isQRLogin: false,
        qrReturnTo: 'sisdel',
        criteria: JSON.parse(localStorage.getItem('fe_criteria')) || { oro: 15000, plata: 10000, general: 0 },
        eventPeriod: JSON.parse(localStorage.getItem('fe_event_period')) || { start: '', end: '' }
    };

    // --- Per-Company Prize Helpers ---
    // 20 premios por defecto — colores variados para la ruleta
    const SIGUE = 'SIGUE PARTICIPANDO';
    const DEFAULT_COLORS = [
        '#00FF88','#FFD700','#FF5500','#00BFFF','#FF007F',
        '#8800FF','#FF8800','#00E5FF','#AAFF00','#FF4444',
        '#00FFCC','#FFB300','#7C4DFF','#F50057','#00BFA5',
        '#FF6D00','#304FFE','#00C853','#AA00FF','#FF1744'
    ];
    const DEFAULT_PRIZES = {
        general: Array.from({ length: 20 }, (_, i) => ({
            text: SIGUE,
            color: DEFAULT_COLORS[i % DEFAULT_COLORS.length]
        })),
        plata: Array.from({ length: 20 }, (_, i) => ({
            text: SIGUE,
            color: DEFAULT_COLORS[i % DEFAULT_COLORS.length]
        })),
        oro: Array.from({ length: 20 }, (_, i) => ({
            text: SIGUE,
            color: DEFAULT_COLORS[i % DEFAULT_COLORS.length]
        }))
    };

    function getActiveCompanyCode() {
        const company = state.companies.find(c => c.id === state.currentCompanyId);
        return company?.code || state.currentCompanyId || 'default';
    }

    function getPrizesKey(tier) {
        return `fe_prizes_${getActiveCompanyCode()}_${tier}`;
    }

    function loadPrizesForCompany() {
        ['general', 'plata', 'oro'].forEach(tier => {
            let saved = null;
            try {
                saved = localStorage.getItem(getPrizesKey(tier));
            } catch (err) {
                console.warn("localStorage restricted:", err);
            }
            try {
                const parsed = saved ? JSON.parse(saved) : null;
                if (parsed && Array.isArray(parsed) && parsed.length > 0) {
                    state.allPrizes[tier] = parsed;
                } else {
                    // Cargar de DEFAULT_PRIZES si no hay nada o está vacío
                    state.allPrizes[tier] = [...DEFAULT_PRIZES[tier].map(p => ({...p}))];
                }
            } catch (e) {
                state.allPrizes[tier] = [...DEFAULT_PRIZES[tier].map(p => ({...p}))];
            }
        });
        state.prizes = state.allPrizes[state.currentTier] || state.allPrizes.general;
    }

    async function loadPrizesFromCloud() {
        try {
            const code = getActiveCompanyCode();
            const { data, error } = await supabaseClient
                .from('premios')
                .select('*')
                .eq('empresa_code', code);
            // Si la tabla no existe o no hay datos, simplemente salir sin tocar los premios actuales
            if (error) {
                console.warn('Tabla premios no disponible:', error.message);
                return;
            }
            if (!data || data.length === 0) {
                console.log('Sin premios en la nube, usando premios locales/por defecto.');
                return;
            }
            data.forEach(row => {
                if (row.tier && row.prizes) {
                    const prizes = typeof row.prizes === 'string' ? JSON.parse(row.prizes) : row.prizes;
                    // Solo aceptar si es un array válido y no está vacío
                    if (Array.isArray(prizes) && prizes.length > 0) {
                        state.allPrizes[row.tier] = prizes;
                        try {
                            localStorage.setItem(getPrizesKey(row.tier), JSON.stringify(prizes));
                        } catch (err) {
                            console.warn("localStorage set failed:", err);
                        }
                    }
                }
            });
            state.prizes = state.allPrizes[state.currentTier] || state.allPrizes.general;
            renderWheel();
            console.log('Premios cargados desde la nube para empresa:', code);
        } catch (e) {
            console.warn('No se pudieron cargar premios desde la nube:', e.message);
        }
    }

    async function savePrizesCloud(tier, prizes) {
        try {
            const code = getActiveCompanyCode();
            const { error } = await supabaseClient
                .from('premios')
                .upsert({
                    empresa_code: code,
                    tier: tier,
                    prizes: prizes,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'empresa_code,tier' });
            if (error) throw error;
            console.log('Premios guardados en la nube:', tier);
        } catch (e) {
            console.warn('Error guardando premios en la nube:', e.message);
        }
    }

    async function fetchCompaniesCloud() {
        try {
            const { data, error } = await supabaseClient
                .from('empresas')
                .select('*');
            if (error || !data || data.length === 0) {
                // Si la tabla no existe aún, silenciar el error y usar localStorage
                console.warn('Empresas: usando localStorage (tabla cloud no disponible aún)');
                return;
            }
            // Merge: las empresas de la nube tienen prioridad, pero mantener 'default' siempre
            const cloudCompanies = data.map(c => ({
                id: c.id,
                name: c.name,
                nit: c.nit || 'N/A',
                manager: c.manager || 'N/A',
                phone: c.phone || 'N/A',
                email: c.email || 'N/A',
                server: c.server || '',
                code: c.code,
                logo: c.logo || null,
                isActive: c.is_active !== false
            }));
            const hasDefault = cloudCompanies.some(c => c.id === 'default');
            if (!hasDefault) {
                cloudCompanies.unshift({ id: 'default', name: 'Full Energy', logo: null, nit: 'N/A', manager: 'Sistema', phone: 'N/A', email: 'v1.0', code: 'FEA001', isActive: true });
            }
            state.companies = cloudCompanies;
            try {
                localStorage.setItem('fe_companies', JSON.stringify(state.companies));
            } catch (err) {
                console.warn("localStorage block:", err);
            }
            console.log('Empresas cargadas desde la nube:', state.companies.length);
            renderCompaniesConfig && renderCompaniesConfig();
            updateHeaderCompany();
        } catch (e) {
            console.warn('Error cargando empresas desde la nube:', e.message);
        }
    }


    // --- DOM Elements ---
    const registrationView = document.getElementById('registration-view');
    const rouletteView = document.getElementById('roulette-view');
    const promoForm = document.getElementById('promo-form');
    const autoDateSpan = document.getElementById('auto-date');
    const wheel = document.getElementById('roulette-wheel');
    const btnSpin = document.getElementById('btn-spin');
    const btnBack = document.getElementById('btn-back');
    const btnConfig = document.getElementById('btn-config');
    const settingsModal = document.getElementById('settings-modal');
    const btnCloseSettings = document.getElementById('btn-close-settings');
    const btnSaveSettings = document.getElementById('btn-save-settings');
    const prizesList = document.getElementById('prizes-list');
    const btnAddPrize = document.getElementById('btn-add-prize');
    const winnerOverlay = document.getElementById('winner-overlay');
    const winnerPilotName = document.getElementById('winner-pilot-name');
    const wonPrizeText = document.getElementById('won-prize-text');
    const btnDone = document.getElementById('btn-done');
    const participantsTableBody = document.querySelector('#participants-table tbody');
    const historyView = document.getElementById('history-view');
    const fullHistoryBody = document.getElementById('full-history-body');
    const btnHistory = document.getElementById('btn-history');
    const btnCloseHistory = document.getElementById('btn-close-history');
    const btnExport = document.getElementById('btn-export');
    const historyDateStart = document.getElementById('history-date-start');
    const historyDateEnd = document.getElementById('history-date-end');
    const btnFilterHistory = document.getElementById('btn-filter-history');

    const companyDisplayName = document.getElementById('company-display-name');

    const mainLogoContainer = document.getElementById('main-logo-container');
    const companiesList = document.getElementById('companies-list');
    const btnAddCompany = document.getElementById('btn-add-company');
    const newCompanyNameInput = document.getElementById('new-company-name');
    const newCompanyNitInput = document.getElementById('new-company-nit');
    const newCompanyManagerInput = document.getElementById('new-company-manager');
    const newCompanyPhoneInput = document.getElementById('new-company-phone');
    const newCompanyEmailInput = document.getElementById('new-company-email');
    const newCompanyServerInput = document.getElementById('new-company-server');
    const newCompanyLogoInput = document.getElementById('new-company-logo');
    const logoFileNameHint = document.getElementById('logo-file-name');

    const loginView = document.getElementById('login-view');
    const accessCodeInput = document.getElementById('access-code-input');
    const btnLogin = document.getElementById('btn-login');
    const loginError = document.getElementById('login-error');
    const appHeader = document.querySelector('header');

    const btnSisdel = document.getElementById('btn-sisdel');
    const sisdelView = document.getElementById('sisdel-view');
    const btnCloseSisdel = document.getElementById('btn-close-sisdel');

    const btnPrizesGeneral = document.getElementById('btn-prizes-general');
    const btnPrizesPlata = document.getElementById('btn-prizes-plata');
    const btnPrizesOro = document.getElementById('btn-prizes-oro');
    const prizesManagementView = document.getElementById('prizes-management-view');
    const btnClosePrizes = document.getElementById('btn-close-prizes');
    const btnSavePrizes = document.getElementById('btn-save-prizes');

    const btnHistoryNavModal = document.getElementById('btn-history-nav-modal');
    const btnQrModal = document.getElementById('btn-qr-modal');
    const companyInfoModal = document.getElementById('company-info-modal');
    const modalCompanyName = document.getElementById('modal-company-name');
    const modalCompanyCode = document.getElementById('modal-company-code');

    const qrView = document.getElementById('qr-view');
    const qrcodeDisplay = document.getElementById('qrcode-display');
    const qrCompanyName = document.getElementById('qr-company-name');
    const qrAccessCodeText = document.getElementById('qr-access-code-text');
    const btnCloseQr = document.getElementById('btn-close-qr');
    const btnDownloadQr = document.getElementById('btn-download-qr');
    const invoiceNumInput = document.getElementById('invoice-number');
    const nitInput = document.getElementById('nit');
    const pilotNameInput = document.getElementById('pilot-name');
    const phoneInput = document.getElementById('phone');
    const totalConsumptionInput = document.getElementById('total-consumption');
    const totalAccumulatedDisplay = document.getElementById('total-accumulated-display');
    const btnCloseRegistration = document.getElementById('btn-close-registration');
    const btnCloseSisdelX = document.getElementById('btn-close-sisdel-x');
    const btnConsumptionSummary = document.getElementById('btn-consumption-summary');
    const consumptionView = document.getElementById('consumption-view');
    const btnCloseConsumption = document.getElementById('btn-close-consumption');
    const btnExportConsumption = document.getElementById('btn-export-consumption');
    const consumptionDateStart = document.getElementById('consumption-date-start');
    const consumptionDateEnd = document.getElementById('consumption-date-end');
    const btnFilterConsumption = document.getElementById('btn-filter-consumption');
    const btnLogoutSettings = document.getElementById('btn-logout-settings');
    const configEventStart = document.getElementById('config-event-start');
    const configEventEnd = document.getElementById('config-event-end');
    const btnSaveEventPeriod = document.getElementById('btn-save-event-period');

    const btnCriteriaNav = document.getElementById('btn-criteria-nav');
    const criteriaManagementView = document.getElementById('criteria-management-view');
    const btnCloseCriteria = document.getElementById('btn-close-criteria');
    const btnSaveCriteria = document.getElementById('btn-save-criteria');
    const btnPrintQr = document.getElementById('btn-print-qr');

    let qrInstance = null;

    // --- Initialization ---
    async function init() {
        // Migración: Asegurar que SISDEL sea el nombre para la empresa default
        state.companies = state.companies.map(c => {
            if (c.id === 'default' && (c.name === 'Full Energy' || !c.name)) {
                return { ...c, name: 'SISDEL' };
            }
            return c;
        });

        // ⚡ DETECCIÓN INMEDIATA DE QR — ANTES de cualquier llamada a Supabase
        // Si hay ?code= en la URL, mostrar el formulario de registro AHORA
        const urlParamsEarly = new URLSearchParams(window.location.search);
        const codeParamEarly = urlParamsEarly.get('code');
        const nameParamEarly = urlParamsEarly.get('name');

        if (codeParamEarly) {
            // Ocultar login de inmediato para que no se vea ni un instante
            if (loginView) loginView.classList.add('hidden');

            let companyEarly = state.companies.find(c => c.code === codeParamEarly);
            if (!companyEarly && nameParamEarly) {
                companyEarly = {
                    id: 'comp_qr_' + Date.now(),
                    name: decodeURIComponent(nameParamEarly),
                    code: codeParamEarly,
                    logo: null, nit: 'N/A', manager: 'Auto-Registro QR',
                    phone: 'N/A', email: 'N/A', server: '', isActive: true
                };
                state.companies.push(companyEarly);
                saveCompanies();
            }
            if (!companyEarly) {
                companyEarly = state.companies.find(c => c.id === 'default') || state.companies[0];
                if (companyEarly) companyEarly = { ...companyEarly, code: codeParamEarly, isActive: true };
            }
            if (companyEarly && companyEarly.isActive !== false) {
                state.isMaster = false;
                state.isQRLogin = true;
                state.currentCompanyId = companyEarly.id;
                try {
                    localStorage.setItem('fe_current_company', companyEarly.id);
                } catch(e) {}
            }
        }

        // 🔑 PASO CRÍTICO: Cargar premios locales/defaults PRIMERO
        // Esto asegura que SIEMPRE haya premios aunque la nube falle
        loadPrizesForCompany();
        updateHeaderCompany();

        // Renderizar la ruleta INMEDIATAMENTE con premios por defecto
        // para que el usuario no vea un disco gris
        renderWheel();

        const today = new Date().toLocaleDateString();
        if (autoDateSpan) autoDateSpan.textContent = today;

        // Decidir vista final RÁPIDO (antes de esperar a la nube)
        if (state.isQRLogin) {
            window.history.replaceState({}, document.title, window.location.pathname);
            showView('registration');
            console.log("✅ QR: mostrando formulario de registro para empresa:", state.currentCompanyId);
        } else {
            showView('login');
            setTimeout(() => accessCodeInput.focus(), 150);
        }

        // 🌐 Ahora cargar datos de la nube EN SEGUNDO PLANO (no bloquea UI)
        Promise.all([
            fetchEventPeriodCloud(),
            fetchCriteriaCloud(),
            fetchCompaniesCloud()
        ]).then(() => {
            // Después de cargar empresas, intentar actualizar premios desde la nube
            return loadPrizesFromCloud();
        }).then(() => {
            // Actualizar la ruleta si la nube devolvió premios mejores
            renderWheel();
        }).catch(e => {
            console.warn('Error cargando datos de la nube (usando datos locales):', e.message);
        });

        // CORRECCIÓN CRITICAL: Si el periodo guardado empieza hoy o después, forzar marzo para capturar historial
        const marchStart = "2026-03-01";
        if (!state.eventPeriod.start || state.eventPeriod.start > marchStart) {
            state.eventPeriod.start = marchStart;
            const sixMonths = new Date();
            sixMonths.setMonth(new Date().getMonth() + 6);
            const pad = (n) => n.toString().padStart(2, '0');
            state.eventPeriod.end = `${sixMonths.getFullYear()}-${pad(sixMonths.getMonth() + 1)}-${pad(sixMonths.getDate())}`;
            localStorage.setItem('fe_event_period', JSON.stringify(state.eventPeriod));
        }

        // Cargar en los inputs de configuración
        if (configEventStart) configEventStart.value = state.eventPeriod.start;
        if (configEventEnd) configEventEnd.value = state.eventPeriod.end;
        if (historyDateStart) historyDateStart.value = state.eventPeriod.start;
        if (historyDateEnd) historyDateEnd.value = state.eventPeriod.end;
        if (consumptionDateStart) consumptionDateStart.value = state.eventPeriod.start;
        if (consumptionDateEnd) consumptionDateEnd.value = state.eventPeriod.end;

        // Cargar historial en segundo plano
        fetchParticipants();

        if (window.location.protocol === 'file:') {
            console.warn("ATENCIÓN: Sistema en modo local (file://).");
        }

    }

    function safeParseDate(val) {
        if (!val) return new Date(0);
        if (val instanceof Date) return val;
        
        // Si es un string ISO (YYYY-MM-DD) pero sin la T
        if (typeof val === 'string' && val.length === 10 && val.includes('-')) {
            // "2026-03-16" -> tratar como hora local
            const parts = val.split('-');
            return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        }

        // Si es un string ISO completo (YYYY-MM-DD...) con T
        if (typeof val === 'string' && val.includes('-') && val.includes('T')) return new Date(val);
        
        // Si es formato DD/MM/YYYY (común en el sistema)
        try {
            const datePart = val.toString().split(',')[0].trim();
            const parts = datePart.split('/');
            if (parts.length === 3) {
                const day = parseInt(parts[0]);
                const month = parseInt(parts[1]) - 1; // 0-indexed
                const year = parseInt(parts[2]);
                // Si el año es corto (ej: 26 -> 2026), ajustarlo si es necesario
                const fullYear = year < 100 ? 2000 + year : year;
                return new Date(fullYear, month, day);
            }
        } catch (e) {}
        
        return new Date(val);
    }

    function cleanAmount(val) {
        if (!val) return 0;
        let strVal = val.toString();
        // Quitar tag de empresa si existe: "50.00 [Empresa]" -> "50.00"
        if (strVal.includes(' [')) strVal = strVal.split(' [')[0];
        // Quitar Q, comas y espacios, dejar solo números y punto decimal
        const clean = strVal.replace(/[^0-9.]/g, '');
        return parseFloat(clean) || 0;
    }

    function normalizeNIT(val) {
        if (!val) return '';
        // Quitar "NIT", guiones, espacios y convertir a mayúsculas
        let s = val.toString().toUpperCase().replace(/[^A-Z0-9]/gi, '');
        if (s.startsWith('NIT')) s = s.substring(3);
        // Quitar ceros a la izquierda para comparar números como "04" y "4"
        return s.replace(/^0+/, '');
    }

    async function fetchParticipants() {
        try {
            console.log('Fetching data...');
            
            // Fetch Clientes
            const { data: clientsData, error: clientsError } = await supabaseClient
                .from('clientes')
                .select('*');
            
            if (!clientsError) {
                state.clients = clientsData || [];
            }

            // Fetch Participantes
            const { data, error } = await supabaseClient
                .from('participantes')
                .select('*');

            if (error) {
                console.error('Supabase Error:', error);
                throw error;
            }
            // Invertir manualmente para mostrar más recientes primero
            state.participants = (data || []).reverse();
            console.log('Fetched:', state.participants.length, 'records and', state.clients.length, 'clients');
            renderHistory();
        } catch (err) {
            console.error('Error fetching data:', err.message);
        }
    }

    function renderHistory() {
        const historyBody = document.getElementById('full-history-body');
        const miniBody = document.querySelector('#participants-table tbody') || document.getElementById('participants-table-body');
        
        if (historyBody) historyBody.innerHTML = '';
        if (miniBody) miniBody.innerHTML = '';

        const currentCompany = state.companies.find(c => c.id === state.currentCompanyId);

        // FILTRAR: Si no es Master, solo mostrar lo de esta empresa
        let displayParticipants = state.participants;
        if (!state.isMaster && currentCompany && currentCompany.id !== 'default') {
            displayParticipants = state.participants.filter(p => 
                (p.empresa === currentCompany.name) || 
                (p.consumo && p.consumo.includes(`[${currentCompany.name}]`))
            );
        }

        // --- FILTRO DE FECHAS ---
        const startVal = historyDateStart?.value;
        const endVal = historyDateEnd?.value;
        const startDate = startVal ? new Date(startVal + 'T00:00:00') : null;
        const endDate = endVal ? new Date(endVal + 'T23:59:59') : null;

        if (startDate || endDate) {
            displayParticipants = displayParticipants.filter(p => {
                const pDate = p.created_at ? new Date(p.created_at) : safeParseDate(p.fecha);
                if (startDate && pDate < startDate) return false;
                if (endDate && pDate > endDate) return false;
                return true;
            });
        }

        if (!displayParticipants || displayParticipants.length === 0) {
            if (historyBody) historyBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--text-dim);">No hay premios registrados para esta empresa todavía.</td></tr>';
            return;
        }

        displayParticipants.forEach(p => {
            const fechaStr = p.fecha ? (p.fecha.includes(',') ? p.fecha.split(',')[0] : p.fecha) : '';
            
            // Limpiar el tag de empresa del consumo para mostrar solo el monto al usuario
            const consumoLimpio = p.consumo ? p.consumo.split(' [')[0] : '0.00';

            // Full table in history view
            if (historyBody) {
                const rowFull = document.createElement('tr');
                rowFull.innerHTML = `
                    <td>${p.fecha || ''}</td>
                    <td>${p.factura || ''}</td>
                    <td>${p.nit || p.placa || 'N/A'}</td>
                    <td>${p.piloto || ''}</td>
                    <td style="text-align: right;">Q ${state.isMaster ? (p.consumo || '0.00') : consumoLimpio}</td>
                    <td style="font-weight:700;color:var(--success); text-align: center;">${p.premio || 'Sin premio'}</td>
                `;
                historyBody.appendChild(rowFull);
            }

            // Mini table (fallback)
            if (miniBody) {
                const rowMini = document.createElement('tr');
                rowMini.innerHTML = `
                    <td>${fechaStr}</td>
                    <td>${p.factura || ''}</td>
                    <td>${p.piloto || ''}</td>
                    <td style="font-weight:700;color:var(--success)">${p.premio || ''}</td>
                `;
                miniBody.appendChild(rowMini);
            }
        });
    }

    function updateHeaderCompany() {
        const company = state.companies.find(c => c.id === state.currentCompanyId) || state.companies[0];
        


        // Update Logo/Name
        mainLogoContainer.innerHTML = '';
        if (company.logo) {
            const img = document.createElement('img');
            img.src = company.logo;
            img.alt = company.name;
            mainLogoContainer.appendChild(img);
        } else {
            const h1 = document.createElement('h1');
            h1.id = 'company-display-name';
            h1.textContent = company.name;
            mainLogoContainer.appendChild(h1);
        }
    }

    // --- Navigation ---
    function showView(view) {
        loginView.classList.add('hidden');
        registrationView.classList.add('hidden');
        rouletteView.classList.add('hidden');
        historyView.classList.add('hidden');
        sisdelView.classList.add('hidden');
        prizesManagementView.classList.add('hidden');
        qrView.classList.add('hidden');
        consumptionView.classList.add('hidden');
        criteriaManagementView.classList.add('hidden');
        appHeader.classList.add('hidden');
        
        // Controlar visibilidad del engranaje:
        // - Master: siempre visible
        // - Empresa (login manual): visible para configurar premios
        // - Acceso por QR (cliente): OCULTO — solo ve el formulario
        if (state.isQRLogin) {
            btnConfig.classList.add('hidden');
        } else {
            btnConfig.classList.remove('hidden');
        }

        if (state.isMaster) {
            if(btnHistory) btnHistory.classList.add('hidden'); 
            if(btnSisdel) btnSisdel.classList.remove('hidden');
            if(btnPrizesGeneral) btnPrizesGeneral.classList.remove('hidden');
            if(btnPrizesPlata) btnPrizesPlata.classList.remove('hidden');
            if(btnPrizesOro) btnPrizesOro.classList.remove('hidden');
            if(btnCriteriaNav) btnCriteriaNav.classList.remove('hidden');
            if(btnHistoryNavModal) btnHistoryNavModal.classList.remove('hidden');
            if(btnConsumptionSummary) btnConsumptionSummary.classList.remove('hidden');
        } else {
            // Usuario de empresa: Ocultar gestión de otras empresas
            if(btnHistory) btnHistory.classList.add('hidden');
            if(btnSisdel) btnSisdel.classList.add('hidden');
            // Ahora pueden ver y configurar sus premios
            if(btnPrizesGeneral) btnPrizesGeneral.classList.remove('hidden');
            if(btnPrizesPlata) btnPrizesPlata.classList.remove('hidden');
            if(btnPrizesOro) btnPrizesOro.classList.remove('hidden');
            if(btnCriteriaNav) btnCriteriaNav.classList.remove('hidden');
            // Mantener el historial visible para que puedan ver su resumen
            if(btnHistoryNavModal) btnHistoryNavModal.classList.remove('hidden');
            if(btnConsumptionSummary) btnConsumptionSummary.classList.remove('hidden');
        }

        if (view === 'login') {
            loginView.classList.remove('hidden');
            setTimeout(() => accessCodeInput.focus(), 50);
        } else {
            appHeader.classList.remove('hidden');
            if (view === 'registration') {
                registrationView.classList.remove('hidden');
                // Ocultar el botón × si el cliente llegó por QR
                if (btnCloseRegistration) {
                    if (state.isQRLogin) btnCloseRegistration.classList.add('hidden');
                    else btnCloseRegistration.classList.remove('hidden');
                }
            } else if (view === 'roulette') {
                rouletteView.classList.remove('hidden');
                renderWheel();
            } else if (view === 'history') {
                historyView.classList.remove('hidden');
                fetchParticipants();
                // Mostrar botón de borrar solo si es Master
                const btnClearH = document.getElementById('btn-clear-history');
                if (btnClearH) {
                    if (state.isMaster) btnClearH.classList.remove('hidden');
                    else btnClearH.classList.add('hidden');
                }
            } else if (view === 'sisdel') {
                sisdelView.classList.remove('hidden');
                renderCompaniesConfig();
            } else if (view === 'prizes_config') {
                prizesManagementView.classList.remove('hidden');
                updateTierBadge();
                // Asegurar que los premios del tier estén cargados
                if (!state.allPrizes[state.currentTier] || state.allPrizes[state.currentTier].length === 0) {
                    loadPrizesForCompany();
                }
                state.prizes = state.allPrizes[state.currentTier];
                renderPrizesConfig();
                setupPrizeButtons();
            } else if (view === 'qr') {
                qrView.classList.remove('hidden');
            } else if (view === 'consumption') {
                consumptionView.classList.remove('hidden');
                renderConsumptionSummary();
            } else if (view === 'criteria_config') {
                criteriaManagementView.classList.remove('hidden');
                // Poblar valores actuales
                document.getElementById('criteria-oro').value = state.criteria.oro;
                document.getElementById('criteria-plata').value = state.criteria.plata;
                document.getElementById('criteria-general').value = state.criteria.general;
            }
        }
    }

    // --- Events ---
    if (nitInput) {
        nitInput.addEventListener('input', () => {
            const nit = nitInput.value.trim().toUpperCase();
            
            // ACTUALIZACIÓN INSTANTÁNEA: No importa el largo, disparar sumatoria de inmediato
            updateRealTimeAccumulated();

            if (!nit || nit === 'C/F') {
                pilotNameInput.value = '';
                if (phoneInput) phoneInput.value = '';
                return;
            }

            // 1. Buscar primero en la tabla maestros de clientes permanentemente
            const client = state.clients.find(c => c.nit && normalizeNIT(c.nit) === normalizeNIT(nit));
            if (client && client.nombre) {
                if (pilotNameInput.value !== client.nombre) {
                    pilotNameInput.value = client.nombre;
                    if (phoneInput && client.telefono) phoneInput.value = client.telefono;
                    
                    pilotNameInput.classList.add('highlight-autofill');
                    if (phoneInput) phoneInput.classList.add('highlight-autofill');
                    
                    setTimeout(() => {
                        pilotNameInput.classList.remove('highlight-autofill');
                        if (phoneInput) phoneInput.classList.remove('highlight-autofill');
                    }, 2000);
                    showToast('✓ Cliente detectado', 'success');
                }
                return;
            }

            // 2. Fallback: Buscar en el historial
            const existing = state.participants.find(p => p.nit && normalizeNIT(p.nit) === normalizeNIT(nit));
            if (existing && existing.piloto) {
                const cleanName = existing.piloto.split(' (NIT:')[0];
                if (pilotNameInput.value !== cleanName) {
                    pilotNameInput.value = cleanName;
                    if (phoneInput && existing.telefono) phoneInput.value = existing.telefono;
                    
                    pilotNameInput.classList.add('highlight-autofill');
                    if (phoneInput) phoneInput.classList.add('highlight-autofill');
                    
                    setTimeout(() => {
                        pilotNameInput.classList.remove('highlight-autofill');
                        if (phoneInput) phoneInput.classList.remove('highlight-autofill');
                    }, 2000);
                    showToast('✓ Cliente frecuente detectado', 'success');
                }
            }
        });

        // Búsqueda en vivo a la nube al salir del campo (Si no se encontró localmente)
        nitInput.addEventListener('blur', async () => {
            const nit = nitInput.value.trim().toUpperCase();
            if (!nit || nit === 'C/F') return;

            // Evitar sobrescribir si el cliente ya fue autocompletado por caché local o manual
            if (pilotNameInput.value && pilotNameInput.value.trim().length > 0) return;

            try {
                const { data, error } = await supabaseClient
                    .from('clientes')
                    .select('nombre, telefono')
                    .eq('nit', nit)
                    .maybeSingle();

                if (!error && data) {
                    pilotNameInput.value = data.nombre || '';
                    if (phoneInput && data.telefono) phoneInput.value = data.telefono;

                    pilotNameInput.classList.add('highlight-autofill');
                    if (phoneInput) phoneInput.classList.add('highlight-autofill');

                    setTimeout(() => {
                        pilotNameInput.classList.remove('highlight-autofill');
                        if (phoneInput) phoneInput.classList.remove('highlight-autofill');
                    }, 2000);
                    showToast('✓ Cliente sincronizado desde la nube', 'success');
                }
            } catch (err) {
                // Silencioso, si no existe o falla la red, el usuario simplemente sigue escribiendo manual
            }
        });
    }

    if (totalConsumptionInput) {
        totalConsumptionInput.addEventListener('input', () => {
            updateRealTimeAccumulated();
        });
    }

    function updateRealTimeAccumulated() {
        if (!totalAccumulatedDisplay) return;
        
        const nit = nitInput ? nitInput.value.trim().toUpperCase() : 'C/F';
        const consumption = totalConsumptionInput ? cleanAmount(totalConsumptionInput.value) : 0;
        
        const isCF = (nit === 'C/F' || !nit);
        let accumulated = consumption;

        if (!isCF) {
            // Normalizar límites a YYYY-MM-DD para comparación segura sin horas/zonas
            const startStr = state.eventPeriod.start || '0000-01-01';
            const endStr = state.eventPeriod.end || '9999-12-31';

            const nitNorm = normalizeNIT(nit);
            const currentCompany = state.companies.find(c => c.id === state.currentCompanyId);
            const currentCompanyName = currentCompany ? currentCompany.name : 'Full Energy';

            const previousInPeriod = state.participants.filter(p => {
                // Compatible con ambos nombres de columna por si acaso
                const pIdentNorm = normalizeNIT(p.placa || p.nit || '');
                if (!pIdentNorm || pIdentNorm !== nitNorm) return false;
                
                // Filtrar por EMPRESA para que el acumulado sea individual por sucursal/marca
                const isSameCompany = (p.empresa === currentCompanyName) || (p.consumo && typeof p.consumo === 'string' && p.consumo.includes(`[${currentCompanyName}]`));
                if (!isSameCompany) return false;

                let pDateObj = safeParseDate(p.created_at || p.fecha);
                const pad = (n) => n.toString().padStart(2, '0');
                const pDateStr = `${pDateObj.getFullYear()}-${pad(pDateObj.getMonth() + 1)}-${pad(pDateObj.getDate())}`;

                // Comparación de fechas
                return pDateStr >= startStr && pDateStr <= endStr;
            });

            previousInPeriod.forEach(p => {
                accumulated += cleanAmount(p.consumo);
            });
        }

        totalAccumulatedDisplay.textContent = `Q ${accumulated.toFixed(2)}`;
        
        // Color visual según nivel alcanzado
        if (accumulated >= state.criteria.oro) {
            totalAccumulatedDisplay.style.color = '#f1c40f'; // Dorado
            totalAccumulatedDisplay.style.background = 'rgba(241, 196, 15, 0.1)';
        } else if (accumulated >= state.criteria.plata) {
            totalAccumulatedDisplay.style.color = '#bdc3c7'; // Plata
            totalAccumulatedDisplay.style.background = 'rgba(189, 195, 199, 0.1)';
        } else {
            totalAccumulatedDisplay.style.color = 'var(--secondary)'; // General
            totalAccumulatedDisplay.style.background = 'rgba(0, 242, 254, 0.1)';
        }
    }

    promoForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const invoiceNum = document.getElementById('invoice-number').value.trim();
        const nitInputStr = document.getElementById('nit').value.trim().toUpperCase();
        const nit = nitInputStr || 'C/F';
        const pilotName = document.getElementById('pilot-name').value.trim();
        const phone = document.getElementById('phone') ? document.getElementById('phone').value.trim() : '';
        const consumption = document.getElementById('total-consumption').value.trim();

        // 1. VERIFICAR DUPLICADO en estado local primero (sin red)
        const duplicateLocal = state.participants.some(
            p => p.factura && p.factura.toString().trim() === invoiceNum.toString().trim()
        );
        if (duplicateLocal) {
            showToast(`⛔ La factura #${invoiceNum} ya participó. No puede jugar de nuevo.`, 'error');
            return;
        }

        // 2. VERIFICAR DUPLICADO en Supabase (con red)
        try {
            const { data, error } = await supabaseClient
                .from('participantes')
                .select('factura')
                .eq('factura', invoiceNum);

            if (error) throw error;

            if (data && data.length > 0) {
                showToast(`⛔ La factura #${invoiceNum} ya participó. No puede jugar de nuevo.`, 'error');
                return;
            }
        } catch (err) {
            console.error('Error verificando factura:', err.message);
            showToast('⚠️ Sin conexión al servidor. Verifica tu internet e intenta de nuevo.', 'error');
            return;
        }

        // 3. Calcular consumo acumulado para este NIT usando datos locales
        // (Los datos ya están cargados en state.participants desde fetchParticipants)
        const isCF = (nit === 'C/F');
        const startStr = state.eventPeriod.start || '0000-01-01';
        const endStr = state.eventPeriod.end || '9999-12-31';
        
        let consumptionMonto = cleanAmount(consumption);
        let totalAccumulated = consumptionMonto;
        
        if (!isCF) {
            const nitNorm = normalizeNIT(nit);
            const currentCompany = state.companies.find(c => c.id === state.currentCompanyId);
            const currentCompanyName = currentCompany ? currentCompany.name : 'Full Energy';
            
            const previousInPeriod = state.participants.filter(p => {
                const pIdentNorm = normalizeNIT(p.placa || p.nit || '');
                if (!pIdentNorm || pIdentNorm !== nitNorm) return false;
                
                // Filtrar por EMPRESA para que el acumulado sea individual por sucursal/marca
                const isSameCompany = (p.empresa === currentCompanyName) || (p.consumo && typeof p.consumo === 'string' && p.consumo.includes(`[${currentCompanyName}]`));
                if (!isSameCompany) return false;
                
                let pDateObj = safeParseDate(p.created_at || p.fecha);
                const pad = (n) => n.toString().padStart(2, '0');
                const pDateStr = `${pDateObj.getFullYear()}-${pad(pDateObj.getMonth() + 1)}-${pad(pDateObj.getDate())}`;
                return pDateStr >= startStr && pDateStr <= endStr;
            });

            previousInPeriod.forEach(p => {
                totalAccumulated += cleanAmount(p.consumo);
            });
            
            console.log(`NIT ${nit}: ${previousInPeriod.length} registros previos, Total Acumulado: Q ${totalAccumulated.toFixed(2)}`);
        }

        const totalFinal = totalAccumulated;
        
        // 4. Determinar Tier (Comparando contra criterios numéricos)
        const oroMin = parseFloat(state.criteria.oro) || 15000;
        const plataMin = parseFloat(state.criteria.plata) || 10000;
        const generalMin = parseFloat(state.criteria.general) || 0;

        console.log(`Comparando Total: ${totalAccumulated} contra Límites -> Oro: ${oroMin}, Plata: ${plataMin}, General: ${generalMin}`);

        let selectedTier = null;
        if (totalAccumulated >= oroMin) {
            selectedTier = 'oro';
        } else if (totalAccumulated >= plataMin) {
            selectedTier = 'plata';
        } else if (totalAccumulated >= generalMin) {
            selectedTier = 'general';
        }

        // Notificación visual del tier seleccionado
        showToast(`📊 Total: Q ${totalAccumulated.toFixed(2)} → Ruleta ${selectedTier ? selectedTier.toUpperCase() : 'N/A'}`, 'info');

        console.log(`Nivel Seleccionado Resultante: ${selectedTier ? selectedTier.toUpperCase() : 'NINGUNO'}`);

        if (!selectedTier) {
            showToast(`⚠️ Consumo acumulado insuficiente (Q ${totalAccumulated.toFixed(2)}) para participar.`, 'error');
            return;
        }

        // 0. Asegurar que el CLIENTE existe en la tabla clientes (NIT es PK)
        // Incluimos C/F para que la relación de base de datos no falle
        try {
            const clientUpdate = {
                nit: nit,
                nombre: (nit === 'C/F' ? 'Consumidor Final' : pilotName)
            };
            if (phone) clientUpdate.telefono = phone;

            await supabaseClient
                .from('clientes')
                .upsert([clientUpdate], { onConflict: 'nit' });
        } catch (err) {
            console.error('Error in upsert client:', err);
        }

        state.currentTier = selectedTier;
        state.prizes = state.allPrizes[selectedTier];
        try { localStorage.setItem('fe_current_tier', selectedTier); } catch(e){}

        const currentCompany = state.companies.find(c => c.id === state.currentCompanyId);

        state.currentParticipant = {
            factura: invoiceNum,
            nit: nit,
            piloto: pilotName,
            telefono: phone,
            empresa: currentCompany ? currentCompany.name : 'Full Energy',
            consumo: consumption,
            fecha: new Date().toLocaleString(),
            premio: null
        };
        showView('roulette');
    });

    btnBack.addEventListener('click', () => {
        if (!state.isSpinning) showView('registration');
    });

    function renderWheel() {
        wheel.innerHTML = '';
        const numSegments = state.prizes ? state.prizes.length : 0;
        
        if (numSegments === 0) {
            console.warn("No hay premios para renderizar la ruleta.");
            wheel.style.background = "#333"; // Fondo sólido si no hay premios
            return;
        }

        const segmentAngle = 360 / numSegments;
        const gradient = state.prizes.map((p, i) => {
            const color = p.color || '#333';
            return `${color} ${(i * 360) / numSegments}deg ${((i + 1) * 360) / numSegments}deg`;
        }).join(', ');

        wheel.style.background = `conic-gradient(${gradient})`;

        // Tamaño de fuente adaptativo según cantidad de premios
        const fontSize = numSegments <= 6  ? '0.8rem'
                       : numSegments <= 10 ? '0.7rem'
                       : numSegments <= 16 ? '0.58rem'
                       : '0.45rem';

        // Ancho del arco por segmento (en px) a radio medio ≈ 90px
        const arcWidth = Math.floor((2 * Math.PI * 90) / numSegments);
        // Alto del label = ancho del arco (limitado para no solapar)
        const labelH = Math.max(12, Math.min(arcWidth - 2, 22));

        state.prizes.forEach((prize, i) => {
            const label = document.createElement('div');
            label.className = 'segment-label';
            label.textContent = prize.text;

            const rotateAngle = (i * segmentAngle) + (segmentAngle / 2);

            // El label sale del CENTRO hacia el BORDE, rotado al ángulo del segmento
            // transform-origin 0 0 = gira sobre el centro del wheel
            Object.assign(label.style, {
                position:       'absolute',
                left:           '50%',
                top:            '50%',
                transformOrigin: '0 0',
                transform:      `rotate(${rotateAngle}deg)`,
                width:          '165px',   // desde centro al borde (radio ~180px)
                height:         `${labelH}px`,
                marginTop:      `${-labelH / 2}px`,
                display:        'flex',
                alignItems:     'center',
                paddingLeft:    '22px',    // dejar espacio en el centro (hub)
                paddingRight:   '10px',
                fontWeight:     '800',
                fontSize:       fontSize,
                color:          'white',
                textShadow:     '0 1px 3px rgba(0,0,0,1), 0 0 8px rgba(0,0,0,0.8)',
                whiteSpace:     'nowrap',
                overflow:       'hidden',
                letterSpacing:  '0.3px',
                pointerEvents:  'none'
            });

            wheel.appendChild(label);
        });

        // Actualizar indicador de Tier
        const indicator = document.getElementById('tier-indicator');
        if (indicator) {
            indicator.textContent = `MODO: ${state.currentTier.toUpperCase()}`;
            indicator.className = `tier-indicator tier-${state.currentTier}`;
        }
    }

    // Función robusta para guardar un registro en Supabase
    async function saveParticipantRecord(record) {
        // Forzar refresh del esquema haciendo un SELECT previo
        try {
            await supabaseClient.from('participantes').select('factura').limit(1);
        } catch (_) { /* continuar */ }

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const { error } = await supabaseClient
                    .from('participantes')
                    .insert([record]);

                if (error) {
                    // Si es error de caché de esquema o columna faltante
                    if (error.message && (error.message.includes('schema cache') || error.message.includes('column'))) {
                        console.warn(`Intento ${attempt}: Error de esquema detectado: ${error.message}`);
                        
                        if (attempt === 3) {
                            console.log('Intentando guardado de emergencia (esquema legado)...');
                            // Fallback: Quitar campos nuevos y añadir el tag al consumo
                            const compTag = record.empresa ? ` [${record.empresa}]` : '';
                            const legacyRecord = {
                                fecha: record.fecha,
                                factura: record.factura,
                                piloto: record.piloto,
                                consumo: record.consumo + compTag,
                                premio: record.premio,
                                placa: record.nit
                            };
                            const { error: legacyError } = await supabaseClient.from('participantes').insert([legacyRecord]);
                            if (!legacyError) return true;
                        }
                        
                        await new Promise(r => setTimeout(r, 2000));
                        continue;
                    }
                    throw error;
                }
                console.log(`✓ Registro guardado en intento ${attempt}`);
                return true;
            } catch (err) {
                console.error(`✗ Intento ${attempt} falló:`, err.message);
                if (attempt < 3) {
                    await new Promise(r => setTimeout(r, 1500));
                }
            }
        }
        return false;
    }

    function handleSpin(e) {
        if (e) e.preventDefault();
        if (state.isSpinning) return;
        state.isSpinning = true;
        btnSpin.disabled = true;

        const numPrizes = state.prizes ? state.prizes.length : 0;
        if (numPrizes === 0) {
            alert("Error: No hay premios configurados para esta ruleta.");
            state.isSpinning = false;
            btnSpin.disabled = false;
            return;
        }

        const prizeIndex = Math.floor(Math.random() * numPrizes);
        const prize = state.prizes[prizeIndex];
        const segmentAngle = 360 / numPrizes;
        const extraSpins = 7 + Math.floor(Math.random() * 5); // Más vueltas para mejor efecto
        const rotation = (extraSpins * 360) + (360 - (prizeIndex * segmentAngle) - (segmentAngle / 2));
        wheel.style.transform = `rotate(${rotation}deg)`;

        setTimeout(async () => {
            state.isSpinning = false;
            btnSpin.disabled = false;
            state.currentParticipant.premio = prize.text;

            // Mostrar ganador de inmediato
            winnerPilotName.textContent = state.currentParticipant.piloto;
            wonPrizeText.textContent = prize.text;
            winnerOverlay.classList.remove('hidden');
            confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });

            // Guardar con función robusta
            const recordToSave = { ...state.currentParticipant };
            const saved = await saveParticipantRecord(recordToSave);

            if (!saved) {
                // Respaldo local
                const pending = JSON.parse(localStorage.getItem('fe_pending_records') || '[]');
                pending.push(recordToSave);
                try { localStorage.setItem('fe_pending_records', JSON.stringify(pending)); } catch(e){}
                showToast('⚠️ Sin conexión. Registro guardado localmente.', 'error');
            } else {
                // Subir pendientes anteriores si los hay
                const pending = JSON.parse(localStorage.getItem('fe_pending_records') || '[]');
                if (pending.length > 0) {
                    for (const rec of pending) {
                        try { await supabaseClient.from('participantes').insert([rec]); }
                        catch (_) { /* ignorar */ }
                    }
                    localStorage.removeItem('fe_pending_records');
                }
            }

            await fetchParticipants();
        }, 6000);
    }

    btnSpin.addEventListener('click', handleSpin);
    // touchstart solo si es necesario, pero click suele bastar y es más seguro contra doble-tap
    // btnSpin.addEventListener('touchstart', handleSpin, { passive: false });

    btnDone.addEventListener('click', () => {
        winnerOverlay.classList.add('hidden');
        promoForm.reset();
        showView('registration');
        wheel.style.transition = 'none';
        wheel.style.transform = 'rotate(0deg)';
        setTimeout(() => { wheel.style.transition = 'transform 6s cubic-bezier(0.1, 0, 0, 1)'; }, 10);
    });

    // --- Login Events ---
    btnLogin.addEventListener('click', () => {
        const inputCode = accessCodeInput.value.trim();
        
        // 1. Validar Código Master
        if (inputCode === MASTER_CODE) {
            state.isMaster = true;
            loginError.classList.add('hidden');
            accessCodeInput.value = '';
            loadPrizesForCompany(); // Cargar premios al hacer login master
            showView('sisdel'); // Llevar directo a Crear Empresas
            return;
        }

        // 2. Validar Códigos de Empresas
        const company = state.companies.find(c => c.code === inputCode);
        if (company) {
            // Verificar si la empresa está activa
            if (company.id !== 'default' && company.isActive === false) {
                loginError.textContent = 'Esta empresa se encuentra INACTIVA actualmente.';
                loginError.classList.remove('hidden');
                accessCodeInput.value = '';
                return;
            }

            state.isMaster = false;
            state.currentCompanyId = company.id;
            try { localStorage.setItem('fe_current_company', company.id); } catch(e){}
            loadPrizesForCompany(); // Cargar premios de la empresa
            updateHeaderCompany();
            loginError.classList.add('hidden');
            accessCodeInput.value = '';
            showView('registration');
        } else {
            loginError.classList.remove('hidden');
            accessCodeInput.value = '';
        }
    });



    accessCodeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') btnLogin.click();
    });

    // --- History Events ---
    if (btnHistory) btnHistory.addEventListener('click', () => showView('history'));
    if (btnCloseHistory) btnCloseHistory.addEventListener('click', () => {
        showView('registration');
        settingsModal.classList.remove('hidden');
    });

    // --- Borrar Historial (solo Master) ---
    const btnClearHistory = document.getElementById('btn-clear-history');
    if (btnClearHistory) {
        btnClearHistory.addEventListener('click', async () => {
            const confirmed1 = confirm('⚠️ ¿Estás seguro de que deseas BORRAR TODO el historial de premios?\n\nEsta acción NO se puede deshacer.');
            if (!confirmed1) return;
            const confirmed2 = confirm('⚠️ ÚLTIMA CONFIRMACIÓN: Se eliminarán TODOS los registros de la base de datos.\n\n¿Continuar?');
            if (!confirmed2) return;

            btnClearHistory.disabled = true;
            btnClearHistory.textContent = 'Borrando...';

            try {
                const { error } = await supabaseClient
                    .from('participantes')
                    .delete()
                    .neq('id', 0); // Borra todos (condición que siempre es verdadera)

                if (error) throw error;

                state.participants = [];
                renderHistory();
                showToast('✓ Historial borrado completamente', 'success');
            } catch (err) {
                console.error('Error al borrar historial:', err);
                alert('Error al borrar el historial: ' + err.message);
            } finally {
                btnClearHistory.disabled = false;
                btnClearHistory.textContent = '🗑️ Borrar Todo';
            }
        });
    }
    
    btnExport.addEventListener('click', () => {
        if (state.participants.length === 0) {
            alert('No hay registros para exportar.');
            return;
        }

        const headers = ['Fecha', 'Factura', 'NIT', 'Nombre', 'Consumo (Q)', 'Empresa', 'Premio'];
        const csvContent = [
            headers.join(','),
            ...state.participants.map(p => [
                `${p.fecha || ''}`,
                `"${p.factura || ''}"`,
                `"${p.nit || ''}"`,
                `"${p.piloto || ''}"`,
                `"${p.consumo || ''}"`,
                `"${p.empresa || ''}"`,
                `"${p.premio || ''}"`
            ].join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `reporte_ruleta_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    if (btnFilterHistory) {
        btnFilterHistory.addEventListener('click', () => {
            renderHistory();
            showToast('✓ Historial filtrado por periodo', 'success');
        });
    }

    if (btnCriteriaNav) {
        btnCriteriaNav.addEventListener('click', () => {
            // Actualizar inputs antes de mostrar la vista
            if (configEventStart) configEventStart.value = state.eventPeriod.start;
            if (configEventEnd) configEventEnd.value = state.eventPeriod.end;
            
            settingsModal.classList.add('hidden');
            showView('criteria_config');
        });
    }

    if (btnCloseCriteria) {
        btnCloseCriteria.addEventListener('click', () => {
            showView('registration');
            settingsModal.classList.remove('hidden');
        });
    }

    if (btnSaveCriteria) {
        btnSaveCriteria.addEventListener('click', () => {
            const oroVal = parseFloat(document.getElementById('criteria-oro').value) || 0;
            const plataVal = parseFloat(document.getElementById('criteria-plata').value) || 0;
            const generalVal = parseFloat(document.getElementById('criteria-general').value) || 0;
            
            state.criteria = { oro: oroVal, plata: plataVal, general: generalVal };
            try { localStorage.setItem('fe_criteria', JSON.stringify(state.criteria)); } catch(e){}
            
            // Sincronizar con la nube
            saveCriteriaCloud(state.criteria);
            
            showView('registration');
            settingsModal.classList.remove('hidden');
        });
    }

    if (btnConfig) {
        btnConfig.addEventListener('click', () => {
            const currentCompany = state.companies.find(c => c.id === state.currentCompanyId);
            
            if (currentCompany && !state.isMaster) {
                if (companyInfoModal) companyInfoModal.classList.remove('hidden');
                if (modalCompanyName) modalCompanyName.textContent = currentCompany.name;
                if (modalCompanyCode) modalCompanyCode.textContent = currentCompany.code || '---';
            } else {
                if (companyInfoModal) companyInfoModal.classList.add('hidden');
            }

            // Población de criterios
            if (document.getElementById('criteria-oro')) {
                document.getElementById('criteria-oro').value = state.criteria.oro;
            }
            if (document.getElementById('criteria-plata')) {
                document.getElementById('criteria-plata').value = state.criteria.plata;
            }

            settingsModal.classList.remove('hidden');
            try {
                renderPrizesConfig();
                fetchParticipants(); 
            } catch (err) {
                console.error('Error loading settings data:', err);
            }
        });
    }

    if (btnQrModal) {
        btnQrModal.addEventListener('click', () => {
            const currentCompany = state.companies.find(c => c.id === state.currentCompanyId) || state.companies[0];
            state.qrReturnTo = 'settings';
            generateQR(currentCompany.code, currentCompany.name);
            settingsModal.classList.add('hidden');
        });
    }

    if (btnSisdel) {
        btnSisdel.addEventListener('click', () => {
            settingsModal.classList.add('hidden');
            showView('sisdel');
        });
    }

    if (btnPrizesGeneral) {
        btnPrizesGeneral.addEventListener('click', () => {
            state.currentTier = 'general';
            try { localStorage.setItem('fe_current_tier', 'general'); } catch(e){}
            loadPrizesForCompany(); // Recargar desde localStorage
            state.prizes = state.allPrizes.general;
            settingsModal.classList.add('hidden');
            showView('prizes_config');
        });
    }
    if (btnPrizesPlata) {
        btnPrizesPlata.addEventListener('click', () => {
            state.currentTier = 'plata';
            try { localStorage.setItem('fe_current_tier', 'plata'); } catch(e){}
            loadPrizesForCompany(); // Recargar desde localStorage
            state.prizes = state.allPrizes.plata;
            settingsModal.classList.add('hidden');
            showView('prizes_config');
        });
    }
    if (btnPrizesOro) {
        btnPrizesOro.addEventListener('click', () => {
            state.currentTier = 'oro';
            try { localStorage.setItem('fe_current_tier', 'oro'); } catch(e){}
            loadPrizesForCompany(); // Recargar desde localStorage
            state.prizes = state.allPrizes.oro;
            settingsModal.classList.add('hidden');
            showView('prizes_config');
        });
    }

    if (btnHistoryNavModal) {
        btnHistoryNavModal.addEventListener('click', () => {
            settingsModal.classList.add('hidden');
            showView('history');
        });
    }

    btnCloseQr.addEventListener('click', () => {
        if (state.qrReturnTo === 'settings') {
            showView('registration');
            settingsModal.classList.remove('hidden');
        } else {
            showView('sisdel');
        }
    });

    if (btnDownloadQr) {
        btnDownloadQr.addEventListener('click', () => {
            const qrCard = document.querySelector('.qr-card');
            if (qrCard && typeof html2canvas !== 'undefined') {
                // Ocultar el botón de descarga temporalmente para la "foto"
                btnDownloadQr.style.display = 'none';
                
                html2canvas(qrCard, {
                    backgroundColor: '#ffffff', // Fondo negro transparente no aplica bien
                    scale: 2, // Mejor resolución
                    logging: false
                }).then(canvas => {
                    // Restaurar botón
                    btnDownloadQr.style.display = 'flex';

                    const url = canvas.toDataURL('image/png');
                    const a = document.createElement('a');
                    a.href = url;
                    const name = qrCompanyName.textContent.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
                    a.download = `qr_completo_${name || 'acceso'}.png`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    showToast && showToast('Descargando imagen completa...', 'success');
                }).catch(err => {
                    console.error("Error generando imagen QR:", err);
                    btnDownloadQr.style.display = 'flex';
                    alert("Error al descargar la imagen completa.");
                });
            } else {
                alert('La librería para capturar imágenes aún no ha cargado. Refresque la página.');
            }
        });
    }

    if (btnConsumptionSummary) {
        btnConsumptionSummary.addEventListener('click', () => {
            settingsModal.classList.add('hidden');
            showView('consumption');
        });
    }
    
    if (btnCloseConsumption) {
        btnCloseConsumption.addEventListener('click', () => {
            showView('registration');
            settingsModal.classList.remove('hidden');
        });
    }

    btnPrintQr.addEventListener('click', () => {
        window.print();
    });

    function generateQR(companyCode, companyName) {
        const code = companyCode && companyCode !== 'undefined' ? companyCode : 'FEA001';
        qrCompanyName.textContent = companyName;
        qrAccessCodeText.innerHTML = `PUEDES ESCALAR Y<br>GANAR MEJORES PREMIOS`;
        
        let company = state.companies.find(c => c.code === code);
        let baseUrl = "";

        // Lógica Universal:
        // 1. Si no es file:// (está en la nube o servidor local), usar la URL del navegador automáticamente
        if (window.location.protocol !== 'file:') {
            baseUrl = window.location.origin + window.location.pathname;
        } 
        // 2. Si es file://, intentar usar la IP guardada en la empresa
        else if (company && company.server && company.server.trim() !== "") {
            let server = company.server.trim();
            if (!server.startsWith('http')) server = 'http://' + server;
            if (!server.includes('index.html') && !server.endsWith('/')) server += '/';
            baseUrl = server;
        } 
        // 3. Fallback desesperado (mantiene el formato URL para que el escáner no diga "no útil")
        else {
            baseUrl = "http://[CONFIGURAR-IP-EN-SISDEL]/";
        }

        const url = `${baseUrl}?code=${code}&name=${encodeURIComponent(companyName)}`;
        
        console.log('Generando QR Universal para:', url);
        
        renderQR(url);
        showView('qr');
    }

    function renderQR(url) {
        qrcodeDisplay.innerHTML = '';
        new QRCode(qrcodeDisplay, {
            text: url,
            width: 256,
            height: 256,
            colorDark: "#001f3f",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
        });
    }

    btnCloseSisdel.addEventListener('click', () => {
        showView('registration');
        settingsModal.classList.remove('hidden'); // Volver a settings
    });

    btnClosePrizes.addEventListener('click', () => {
        showView('registration');
        settingsModal.classList.remove('hidden'); // Volver a settings
    });

    // --- Toast notification helper ---
    function showToast(msg, type = 'success') {
        let toast = document.getElementById('app-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'app-toast';
            toast.style.cssText = `
                position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
                background: ${type === 'success' ? 'rgba(0,200,100,0.95)' : 'rgba(220,50,50,0.95)'};
                color: white; font-size: 1.1rem; font-weight: 700;
                padding: 1rem 2rem; border-radius: 15px;
                box-shadow: 0 8px 30px rgba(0,0,0,0.4);
                z-index: 9999; opacity: 0; transition: opacity 0.3s;
                pointer-events: none;
            `;
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.style.background = type === 'success' ? 'rgba(0,200,100,0.95)' : 'rgba(220,50,50,0.95)';
        toast.style.opacity = '1';
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
    }

    // --- Función central para conectar botones de la vista de premios ---
    function setupPrizeButtons() {
        // Botón AGREGAR PREMIO
        const addBtn = document.getElementById('btn-add-prize');
        if (addBtn) {
            // Clonar para eliminar listeners anteriores
            const newAddBtn = addBtn.cloneNode(true);
            addBtn.parentNode.replaceChild(newAddBtn, addBtn);
            newAddBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                syncInternalPrizes();
                state.prizes.push({ text: 'Nuevo Premio', color: '#ff4fac' });
                state.allPrizes[state.currentTier] = state.prizes;
                renderPrizesConfig();
                setupPrizeButtons();
                setTimeout(() => {
                    const rows = prizesList ? prizesList.querySelectorAll('.prize-item') : [];
                    if (rows.length > 0) {
                        rows[rows.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
                        const firstInput = rows[rows.length - 1].querySelector('.prize-name-input');
                        if (firstInput) { firstInput.focus(); firstInput.select(); }
                    }
                }, 80);
            });
        }

        // Botón GUARDAR
        const saveBtn = document.getElementById('btn-save-prizes');
        if (saveBtn) {
            const newSaveBtn = saveBtn.cloneNode(true);
            saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
            newSaveBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                syncInternalPrizes();
                if (state.prizes.length < 2) {
                    showToast('Se necesitan al menos 2 premios.', 'error');
                    return;
                }
                state.allPrizes[state.currentTier] = [...state.prizes];
                try { localStorage.setItem(getPrizesKey(state.currentTier), JSON.stringify(state.prizes)); } catch(e){}
                savePrizesCloud(state.currentTier, state.prizes);
                renderWheel();
                showToast('✓ Premios ' + state.currentTier.toUpperCase() + ' guardados correctamente');
                // Volver al menú de configuración
                showView('registration');
                settingsModal.classList.remove('hidden');
            });
        }

        // Botón VOLVER
        const backBtn = document.getElementById('btn-close-prizes');
        if (backBtn) {
            const newBackBtn = backBtn.cloneNode(true);
            backBtn.parentNode.replaceChild(newBackBtn, backBtn);
            newBackBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                showView('registration');
                settingsModal.classList.remove('hidden');
            });
        }
    }




    newCompanyLogoInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            logoFileNameHint.textContent = e.target.files[0].name;
        }
    });

    function renderCompaniesConfig() {
        if (!companiesList) return;
        companiesList.innerHTML = '';
        state.companies.forEach((comp, idx) => {
            const isDefault = comp.id === 'default';
            const isActive = comp.isActive !== false;
            
            const row = document.createElement('tr');
            if (!isActive) row.classList.add('inactive');

            row.innerHTML = `
                <td>
                    ${comp.logo ? `<img src="${comp.logo}" class="company-item-logo">` : '<div class="company-item-logo" style="display:flex;align-items:center;justify-content:center;font-size:10px;border:1px dashed #555;">Sin Logo</div>'}
                </td>
                <td>
                    <div style="display: flex; align-items: center; gap: 0.8rem;">
                        <strong style="color:var(--primary); font-size: 1.1rem;">${comp.name}</strong>
                        ${isActive ? '<span class="status-badge status-active">Activo</span>' : '<span class="status-badge status-inactive">Inactivo</span>'}
                    </div>
                    <div style="font-size:0.7rem; color:var(--text-dim);">ID: ${comp.id}</div>
                </td>
                <td>
                    <div style="font-weight:600;">NIT: ${comp.nit || 'N/A'}</div>
                    <div style="font-size:0.8rem; color:var(--text-dim);">${comp.manager || 'N/A'}</div>
                </td>
                <td>
                    <div>${comp.phone || 'N/A'}</div>
                    <div style="font-size:0.8rem; color:var(--text-dim);">${comp.email || 'N/A'}</div>
                </td>
                <td>
                    <div class="access-code-container" style="padding: 0.2rem 0.5rem;">
                        <span class="access-code-value" style="font-size: 0.9rem;">${comp.code || '---'}</span>
                    </div>
                </td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-icon btn-qr-gen" data-code="${comp.code}" data-name="${comp.name}" title="Ver QR">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                        </button>
                        ${!isDefault ? `
                            <button class="btn-icon btn-edit" title="Editar" onclick="editCompany('${comp.id}')">✏️</button>
                            <button class="btn-icon btn-toggle" title="${isActive ? 'Desactivar' : 'Activar'}" onclick="toggleCompanyStatus('${comp.id}')">
                                ${isActive ? '🚫' : '✅'}
                            </button>
                            <button class="btn-icon btn-delete btn-remove-company" data-index="${idx}" title="Eliminar">&times;</button>
                        ` : '<span style="font-size:0.7rem; color:gray;">Protegido</span>'}
                    </div>
                </td>
            `;
            companiesList.appendChild(row);
        });

        // Re-asignar eventos de eliminación y QR (los onclick son más simples pero estos se mantienen por compatibilidad)
        document.querySelectorAll('.btn-remove-company').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = e.currentTarget.dataset.index;
                if (confirm(`¿Estás seguro de eliminar ${state.companies[idx].name}?`)) {
                    if (state.companies[idx].id === state.currentCompanyId) {
                        state.currentCompanyId = 'default';
                        try { localStorage.setItem('fe_current_company', 'default'); } catch(e){}
                    }
                    state.companies.splice(idx, 1);
                    saveCompanies();
                    renderCompaniesConfig();
                    updateHeaderCompany();
                }
            });
        });

        document.querySelectorAll('.btn-qr-gen').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget;
                state.qrReturnTo = 'sisdel';
                generateQR(target.dataset.code, target.dataset.name);
            });
        });
    }

    // Exponer funciones globales
    window.editCompany = function(id) {
        const company = state.companies.find(c => c.id === id);
        if (!company) return;

        state.editingCompanyId = id;
        
        newCompanyNameInput.value = company.name;
        newCompanyNitInput.value = company.nit || 'N/A';
        newCompanyManagerInput.value = company.manager || 'N/A';
        newCompanyPhoneInput.value = company.phone || 'N/A';
        newCompanyEmailInput.value = company.email || 'N/A';
        newCompanyServerInput.value = company.server || '';
        
        btnAddCompany.textContent = '💾 GUARDAR CAMBIOS';
        btnAddCompany.style.background = 'linear-gradient(135deg, #f39c12, #d35400)';
        
        document.querySelector('.settings-section').scrollIntoView({ behavior: 'smooth' });
    };

    window.toggleCompanyStatus = function(id) {
        const company = state.companies.find(c => c.id === id);
        if (!company) return;
        
        company.isActive = ! (company.isActive !== false);
        saveCompanies();
        renderCompaniesConfig();
        updateHeaderCompany();
    };

    btnAddCompany.addEventListener('click', () => {
        console.log("Btn clic detectado. Procesando empresa...");
        const name = newCompanyNameInput.value.trim();
        const nit = newCompanyNitInput.value.trim();
        const manager = newCompanyManagerInput.value.trim();
        const phone = newCompanyPhoneInput.value.trim();
        const email = newCompanyEmailInput.value.trim();
        const server = newCompanyServerInput.value.trim();

        if (!name) {
            showToast('⚠️ El nombre de la empresa es obligatorio', 'error');
            return;
        }

        const file = newCompanyLogoInput.files[0];
        const processAdd = (logoBase64) => {
            console.log("Llamando a addCompany para:", name);
            addCompany({
                name,
                nit,
                manager,
                phone,
                email,
                server,
                logo: logoBase64
            });
        };

        if (file) {
            console.log("Leyendo logo...");
            const reader = new FileReader();
            reader.onload = (e) => processAdd(e.target.result);
            reader.readAsDataURL(file);
        } else {
            processAdd(null);
        }
    });

    function generateAccessCode(companyName) {
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const numbers = '0123456789';
        
        // 3 Letras al azar
        let L1 = letters.charAt(Math.floor(Math.random() * letters.length));
        let L3 = letters.charAt(Math.floor(Math.random() * letters.length));
        
        // La segunda letra será la primera del nombre de la empresa
        let L2 = (companyName.charAt(0) || 'X').toUpperCase();
        
        // 3 Números al azar
        let N1 = numbers.charAt(Math.floor(Math.random() * numbers.length));
        let N2 = numbers.charAt(Math.floor(Math.random() * numbers.length));
        let N3 = numbers.charAt(Math.floor(Math.random() * numbers.length));
        
        return `${L1}${L2}${L3}${N1}${N2}${N3}`;
    }

    async function addCompany(data) {
        const originalText = btnAddCompany.textContent;
        btnAddCompany.disabled = true;
        btnAddCompany.textContent = '⌛ GUARDANDO...';

        try {
            if (state.editingCompanyId) {
                // MODO EDICIÓN
                const idx = state.companies.findIndex(c => c.id === state.editingCompanyId);
                if (idx !== -1) {
                    state.companies[idx] = { 
                        ...state.companies[idx], 
                        ...data 
                    };
                    
                    // Guardar local y nube
                    saveCompaniesStateOnly(); // Guardar a localStorage
                    const cloudSuccess = await saveCompaniesCloud();
                    
                    if (cloudSuccess) {
                        showToast('✓ Empresa actualizada correctamente', 'success');
                    } else {
                        showToast('⚠️ Guardado localmente, error en la nube', 'warning');
                    }
                }
                state.editingCompanyId = null;
                btnAddCompany.textContent = '+ Registrar Empresa en SISDEL';
                btnAddCompany.style.background = '';
            } else {
                // MODO CREACIÓN
                const newComp = {
                    id: 'comp_' + Date.now(),
                    ...data,
                    isActive: true, // Siempre activa al crear
                    code: generateAccessCode(data.name)
                };
                
                // Añadir al estado local primero
                state.companies.push(newComp);
                saveCompaniesStateOnly(); // Guardar a localStorage
                
                // Intentar guardar en la nube
                console.log("Intentando sincronizar con la nube (Supabase)...");
                const cloudSuccess = await saveCompaniesCloud();
                
                if (cloudSuccess) {
                    showToast('✓ Empresa registrada con éxito en la NUBE', 'success');
                } else {
                    console.warn("Falla en nube, pero guardado localmente ok.");
                    showToast('⚠️ Registrada localmente (Error en la Nube)', 'warning');
                }
            }

            // Reset form
            newCompanyNameInput.value = '';
            newCompanyNitInput.value = '';
            newCompanyManagerInput.value = '';
            newCompanyPhoneInput.value = '';
            newCompanyEmailInput.value = '';
            newCompanyServerInput.value = '';
            newCompanyLogoInput.value = '';
            logoFileNameHint.textContent = 'Ningún archivo';
            
            renderCompaniesConfig();
            updateHeaderCompany();
        } catch (err) {
            console.error('Error en addCompany:', err);
            showToast('❌ Error al guardar: ' + err.message, 'error');
        } finally {
            btnAddCompany.disabled = false;
            btnAddCompany.textContent = state.editingCompanyId ? '💾 GUARDAR CAMBIOS' : '+ Registrar Empresa en SISDEL';
        }
    }

    function saveCompaniesStateOnly() {
        try {
            localStorage.setItem('fe_companies', JSON.stringify(state.companies));
        } catch (e) {
            console.warn("localStorage sync blocked", e);
        }
    }

    function saveCompanies() {
        saveCompaniesStateOnly();
        saveCompaniesCloud();
    }

    async function saveCompaniesCloud() {
        try {
            const toUpsert = state.companies
                .filter(c => c.id !== 'default')
                .map(c => ({
                    id: c.id,
                    name: c.name,
                    nit: c.nit || 'N/A',
                    manager: c.manager || 'N/A',
                    phone: c.phone || 'N/A',
                    email: c.email || 'N/A',
                    server: c.server || '',
                    code: c.code,
                    logo: c.logo || null,
                    is_active: c.isActive !== false
                }));
            
            if (toUpsert.length === 0) return true;

            const { error } = await supabaseClient
                .from('empresas')
                .upsert(toUpsert, { onConflict: 'id' });
            
            if (error) {
                console.error('Error de Supabase (Empresas):', error);
                throw new Error(error.message);
            }
            
            console.log('Empresas sincronizadas en la nube:', toUpsert.length);
            return true;
        } catch (e) {
            console.warn('Error sincronizando empresas a la nube:', e.message);
            return false;
        }
    }

    if (btnCloseSettings) {
        btnCloseSettings.addEventListener('click', () => {
            settingsModal.classList.add('hidden');
        });
    }

    // Cerrar modal al hacer clic en el fondo oscuro
    if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                settingsModal.classList.add('hidden');
            }
        });
    }

    if (btnLogoutSettings) {
        btnLogoutSettings.addEventListener('click', () => {
            // Limpiar sesión
            state.currentCompanyId = 'default';
            state.isMaster = false;
            accessCodeInput.value = '';
            
            // Cerrar modal y mostrar login
            settingsModal.classList.add('hidden');
            showView('login');
            
            showToast('✓ Sesión cerrada con éxito', 'success');
        });
    }

    async function fetchEventPeriodCloud() {
        try {
            const { data, error } = await supabaseClient
                .from('configuraciones')
                .select('*')
                .eq('clave', 'periodo_evento')
                .single();
            
            if (data && !error) {
                state.eventPeriod.start = data.valor_inicio || '';
                state.eventPeriod.end = data.valor_fin || '';
                try { localStorage.setItem('fe_event_period', JSON.stringify(state.eventPeriod)); } catch(e){}
                console.log("Periodo cargado desde la nube:", state.eventPeriod);
                
                // Actualizar inputs si existen
                if (configEventStart) configEventStart.value = state.eventPeriod.start;
                if (configEventEnd) configEventEnd.value = state.eventPeriod.end;
            }
        } catch (e) {
            console.warn("No se pudo cargar periodo desde la nube.");
        }
    }

    async function fetchCriteriaCloud() {
        try {
            const { data, error } = await supabaseClient
                .from('configuraciones')
                .select('*')
                .eq('clave', 'criterios_ruleta')
                .single();
            
            if (data && !error) {
                if (data.valor_oro !== undefined) {
                    state.criteria = { 
                        oro: parseFloat(data.valor_oro) || 15000, 
                        plata: parseFloat(data.valor_plata) || 10000, 
                        general: parseFloat(data.valor_general) || 0 
                    };
                    try { localStorage.setItem('fe_criteria', JSON.stringify(state.criteria)); } catch(e){}
                    console.log("Criterios cargados desde la nube:", state.criteria);

                    // Actualizar inputs de configuración de criterios si están visibles
                    const critOro = document.getElementById('criteria-oro');
                    const critPlata = document.getElementById('criteria-plata');
                    const critGen = document.getElementById('criteria-general');
                    if (critOro) critOro.value = state.criteria.oro;
                    if (critPlata) critPlata.value = state.criteria.plata;
                    if (critGen) critGen.value = state.criteria.general;
                }
            }
        } catch (e) {
            console.warn("No se pudo cargar criterios desde la nube.");
        }
    }

    async function saveCriteriaCloud(criteria) {
        try {
            const { error } = await supabaseClient
                .from('configuraciones')
                .upsert({ 
                    clave: 'criterios_ruleta', 
                    valor_oro: criteria.oro, 
                    valor_plata: criteria.plata, 
                    valor_general: criteria.general,
                    updated_at: new Date()
                }, { onConflict: 'clave' });
            
            if (error) throw error;
            showToast('✓ Criterios sincronizados en la NUBE', 'success');
        } catch (e) {
            console.error("Error sincronizando criterios:", e);
        }
    }

    async function saveEventPeriod() {
        if (!configEventStart || !configEventEnd) return;

        const start = configEventStart.value;
        const end = configEventEnd.value;

        if (!start || !end) {
            showToast('❌ Error: Ambas fechas son obligatorias', 'error');
            return;
        }

        state.eventPeriod.start = start;
        state.eventPeriod.end = end;
        localStorage.setItem('fe_event_period', JSON.stringify(state.eventPeriod));
        
        // Sincronizar filtros
        if (historyDateStart) historyDateStart.value = start;
        if (historyDateEnd) historyDateEnd.value = end;
        if (consumptionDateStart) consumptionDateStart.value = start;
        if (consumptionDateEnd) consumptionDateEnd.value = end;

        // Intentar guardar en la nube para sincronización global
        try {
            const { error } = await supabaseClient
                .from('configuraciones')
                .upsert({ 
                    clave: 'periodo_evento', 
                    valor_inicio: start, 
                    valor_fin: end,
                    updated_at: new Date()
                }, { onConflict: 'clave' });
            
            if (error) throw error;
            showToast('✓ Periodo actualizado en la NUBE', 'success');
        } catch (e) {
            console.error("Error sincronizando con la nube:", e);
            showToast('✓ Periodo guardado LOCALMENTE (error de nube)', 'warning');
        }
    }

    if (btnSaveEventPeriod) {
        btnSaveEventPeriod.addEventListener('click', saveEventPeriod);
    }

    function syncInternalPrizes() {
        if (!prizesList) return;
        const items = prizesList.querySelectorAll('.prize-item');
        // Solo sincronizar si hay items en el DOM; de lo contrario mantener el estado actual
        if (items.length === 0) return;
        state.prizes = Array.from(items).map(item => ({
            text: item.querySelector('.prize-name-input')?.value || 'Premio',
            color: item.querySelector('.prize-color-dot')?.style.backgroundColor || '#000000'
        }));
        // Convert rgb() back to hex if needed
        state.prizes = state.prizes.map(p => ({
            text: p.text,
            color: rgbToHex(p.color)
        }));
        state.allPrizes[state.currentTier] = state.prizes;
    }

    function rgbToHex(color) {
        if (color.startsWith('#')) return color;
        const result = color.match(/\d+/g);
        if (!result || result.length < 3) return '#000000';
        return '#' + result.slice(0, 3).map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
    }

    function updatePrizesCount() {
        const countEl = document.getElementById('prizes-count');
        if (countEl) countEl.textContent = `${state.prizes.length} premio${state.prizes.length !== 1 ? 's' : ''}`;
    }

    function renderPrizesConfig() {
        if (!prizesList) return;
        // Asegurar que tenemos los premios correctos del tier actual
        if (!state.prizes || state.prizes.length === 0) {
            // Intentar recargar desde localStorage o usar defaults
            const saved = localStorage.getItem(getPrizesKey(state.currentTier));
            if (saved) {
                state.prizes = JSON.parse(saved);
            } else {
                state.prizes = [...DEFAULT_PRIZES[state.currentTier].map(p => ({...p}))];
            }
            state.allPrizes[state.currentTier] = state.prizes;
        }
        
        prizesList.innerHTML = '';
        state.prizes.forEach((prize, index) => {
            const item = document.createElement('div');
            item.className = 'prize-item';
            item.dataset.index = index;
            
            // Asegurar que el color es un hex válido para el input color
            const hexColor = rgbToHex(prize.color || '#000000');
            
            item.innerHTML = `
                <div class="prize-drag-handle" title="Arrastrar">⠿</div>
                <div class="prize-color-dot" style="background-color: ${hexColor};" title="Cambiar color">
                    <input type="color" value="${hexColor}" class="prize-color-input" data-index="${index}">
                </div>
                <input type="text" value="${prize.text}" class="prize-name-input" placeholder="Nombre del premio" data-index="${index}">
                <button class="prize-delete-btn" data-index="${index}" title="Eliminar">&times;</button>
            `;
            prizesList.appendChild(item);
        });
        updatePrizesCount();
    }

    // Update badge style based on tier
    function updateTierBadge() {
        const badge = document.getElementById('current-tier-badge');
        if (!badge) return;
        badge.textContent = state.currentTier.toUpperCase();
        badge.className = 'prizes-tier-badge';
        if (state.currentTier === 'oro') badge.classList.add('tier-oro');
        else if (state.currentTier === 'plata') badge.classList.add('tier-plata');
    }

    // Single event delegation on prizesList
    if (prizesList) {
        prizesList.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.prize-delete-btn');
            if (deleteBtn) {
                const idx = parseInt(deleteBtn.dataset.index);
                if (!isNaN(idx)) {
                    syncInternalPrizes();
                    state.prizes.splice(idx, 1);
                    state.allPrizes[state.currentTier] = state.prizes;
                    renderPrizesConfig();
                }
            }
        });

        prizesList.addEventListener('input', (e) => {
            const colorInput = e.target.closest('.prize-color-input');
            const nameInput = e.target.closest('.prize-name-input');
            if (colorInput) {
                const dot = colorInput.closest('.prize-color-dot');
                if (dot) dot.style.backgroundColor = colorInput.value;
                syncInternalPrizes();
            }
            if (nameInput) {
                syncInternalPrizes();
            }
        });
    }




    if (btnSaveSettings) {
        btnSaveSettings.addEventListener('click', () => {
            settingsModal.classList.add('hidden');
        });
    }

    if (btnCloseRegistration) {
        btnCloseRegistration.addEventListener('click', () => showView('login'));
    }
    if (btnCloseSisdelX) {
        btnCloseSisdelX.addEventListener('click', () => showView('login'));
    }

    // Generic listener for all X buttons with the common class
    document.querySelectorAll('.btn-close-view').forEach(btn => {
        if (!btn.onclick && !btn.id.includes('settings')) { // Avoid double binding or special cases
            btn.addEventListener('click', () => showView('login'));
        }
    });

    const btnCloseLoginX = document.getElementById('btn-close-login-x');
    if (btnCloseLoginX) {
        btnCloseLoginX.addEventListener('click', () => {
            accessCodeInput.value = '';
            showView('login');
        });
    }

    function renderConsumptionSummary() {
        const body = document.getElementById('consumption-summary-body');
        if (!body) return;
        body.innerHTML = '';

        const startVal = consumptionDateStart?.value;
        const endVal = consumptionDateEnd?.value;
        
        const startDate = startVal ? new Date(startVal + 'T00:00:00') : null;
        const endDate = endVal ? new Date(endVal + 'T23:59:59') : null;

        if (startVal || endVal) {
            console.log(`Filtrando consumo desde ${startVal || 'inicio'} hasta ${endVal || 'fin'}`);
        }

        // Agrupar por NIT
        const groups = {};
        
        state.participants.forEach(p => {
            // Validar fecha si hay filtros (usando strings YYYY-MM-DD para evitar desfases)
            if (startVal || endVal) {
                let pDateObj = p.created_at ? new Date(p.created_at) : safeParseDate(p.fecha);
                const pad = (n) => n.toString().padStart(2, '0');
                const pDateStr = `${pDateObj.getFullYear()}-${pad(pDateObj.getMonth() + 1)}-${pad(pDateObj.getDate())}`;

                if (startVal && pDateStr < startVal) return;
                if (endVal && pDateStr > endVal) return;
            }

            const rawNit = p.nit || p.placa || 'C/F';
            const nitKey = rawNit.toUpperCase();
            const monto = cleanAmount(p.consumo);
            
            if (nitKey === 'C/F') {
                if (!groups['C/F']) {
                    groups['C/F'] = { nit: 'C/F', nombre: 'Consumidor Final', total: 0 };
                }
                groups['C/F'].total += monto;
            } else {
                if (!groups[nitKey]) {
                    groups[nitKey] = { 
                        nit: rawNit, 
                        nombre: p.piloto || 'N/A', 
                        total: 0 
                    };
                }
                groups[nitKey].total += monto;
            }
        });

        const clientList = Object.values(groups).sort((a, b) => b.total - a.total);

        clientList.forEach(c => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${c.nit}</td>
                <td>${c.nombre}</td>
                <td style="text-align: right; font-weight: 700; color: var(--success);">Q ${c.total.toFixed(2)}</td>
            `;
            body.appendChild(row);
        });
    }

    if (btnFilterConsumption) {
        btnFilterConsumption.addEventListener('click', () => {
            renderConsumptionSummary();
            showToast('✓ Resumen actualizado para el periodo seleccionado', 'success');
        });
    }

    if (btnExportConsumption) {
        btnExportConsumption.addEventListener('click', () => {
            const body = document.getElementById('consumption-summary-body');
            const rows = body.querySelectorAll('tr');
            if (rows.length === 0) return alert('No hay datos para exportar.');

            let csvContent = "NIT,Cliente,Total Consumo Acumulado\n";
            rows.forEach(row => {
                const cols = row.querySelectorAll('td');
                const rowData = Array.from(cols).map(c => `"${c.textContent.replace(/Q\s/g, '').trim()}"`);
                csvContent += rowData.join(',') + "\n";
            });

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', `resumen_consumo_clientes_${new Date().toISOString().split('T')[0]}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
    }

    init();
});
