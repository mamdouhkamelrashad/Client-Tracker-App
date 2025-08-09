// Worker code to handle heavy tasks without freezing the UI
const excelWorkerCode = `
    const scriptsToLoad = [
        'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
        'https://cdn.jsdelivr.net/npm/sheetjs/dist/xlsx.full.min.js'
    ];
    let scriptLoaded = false;
    for (const script of scriptsToLoad) {
        try {
            self.importScripts(script);
            scriptLoaded = true;
            break;
        } catch (e) {
            console.error('Failed to load script from:', script);
        }
    }
    if (!scriptLoaded) {
        self.postMessage({ status: 'error', message: 'فشل تحميل مكتبة Excel. يرجى التحقق من اتصالك بالإنترنت والمحاولة مرة أخرى.' });
        throw new Error('Could not load required scripts for worker.');
    }

    const substitutionCosts = {
        'ا': { 'أ': 0.2, 'إ': 0.2, 'آ': 0.2, 'ع': 0.6 }, 'أ': { 'ا': 0.2, 'إ': 0.2, 'آ': 0.2, 'ع': 0.6 },
        'إ': { 'ا': 0.2, 'أ': 0.2, 'آ': 0.2, 'ع': 0.6 }, 'آ': { 'ا': 0.2, 'أ': 0.2, 'إ': 0.2, 'ع': 0.6 },
        'ع': { 'ا': 0.6, 'أ': 0.6, 'إ': 0.6, 'آ': 0.6 }, 'ت': { 'ط': 0.4 }, 'ط': { 'ت': 0.4 },
        'ث': { 'س': 0.4, 'ص': 0.5 }, 'س': { 'ث': 0.4, 'ص': 0.4 }, 'ص': { 'س': 0.4, 'ث': 0.5 },
        'ذ': { 'ز': 0.3, 'ظ': 0.4 }, 'ز': { 'ذ': 0.3, 'ظ': 0.5 }, 'ظ': { 'ذ': 0.4, 'ض': 0.4, 'ز': 0.5 },
        'ض': { 'ظ': 0.4, 'د': 0.4 }, 'د': { 'ض': 0.4 }, 'ق': { 'ك': 0.5, 'غ': 0.6 }, 'ك': { 'ق': 0.5 },
        'ه': { 'ة': 0.1, 'ح': 0.5 }, 'ة': { 'ه': 0.1 }, 'ي': { 'ى': 0.1 }, 'ى': { 'ي': 0.1 }
    };
    function getSubstitutionCost(charA, charB) {
        if (substitutionCosts[charA] && substitutionCosts[charA][charB]) return substitutionCosts[charA][charB];
        return 1;
    }
    function weightedLevenshtein(a, b) {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;
        const matrix = [];
        for (let i = 0; i <= b.length; i++) matrix[i] = [i];
        for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                const charB = b.charAt(i - 1);
                const charA = a.charAt(j - 1);
                if (charB === charA) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + getSubstitutionCost(charA, charB),
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        return matrix[b.length][a.length];
    }
    function normalizeText(text) {
        return text.toString().trim()
            .replace(/[أإآ]/g, 'ا')
            .replace(/ى/g, 'ي')
            .replace(/ة/g, 'ه')
            .replace(/\s+/g, ' ')
            .toLowerCase();
    }
    function findBestRegionMatch(regionName, existingRegions) {
        const normalizedInput = normalizeText(regionName);
        if (existingRegions.includes(normalizedInput)) return existingRegions.find(r => normalizeText(r) === normalizedInput);
        let bestMatch = regionName;
        let minDistance = Infinity;
        for (const region of existingRegions) {
            const distance = weightedLevenshtein(normalizedInput, normalizeText(region));
            if (distance / normalizedInput.length < 0.3 && distance < minDistance) {
                minDistance = distance;
                bestMatch = region;
            }
        }
        return minDistance / normalizedInput.length < 0.3 ? bestMatch : regionName;
    }

    self.onmessage = function(event) {
        const { fileData, existingRegions } = event.data;
        try {
            const workbook = XLSX.read(fileData, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonClients = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            if (jsonClients.length === 0) {
                self.postMessage({ status: 'error', message: 'الملف فارغ أو لا يحتوي على بيانات.' });
                return;
            }

            const headers = jsonClients[0];
            const requiredHeaders = ['اسم العميل', 'اسم الفرع', 'العنوان', 'المنطقة', 'رابط google map'];
            const mapLinkHeader = headers.includes('الموقع / map') ? 'الموقع / map' : 'رابط google map';
            const regionHeader = headers.includes('المنطقه') ? 'المنطقه' : 'المنطقة';
            const headersAreValid = headers.includes('اسم العميل') &&
                                    headers.includes('اسم الفرع') &&
                                    headers.includes('العنوان') &&
                                    (headers.includes(regionHeader) || headers.includes('المنطقة')) &&
                                    (headers.includes(mapLinkHeader) || headers.includes('رابط google map'));

            if (!headersAreValid) {
                self.postMessage({ status: 'error', message: 'أعمدة ملف Excel غير صحيحة. يرجى مراجعة الأعمدة المطلوبة.' });
                return;
            }

            const dataRows = jsonClients.slice(1);
            const clients = [];
            const totalRows = dataRows.length;

            dataRows.forEach((row, index) => {
                const clientName = row[headers.indexOf('اسم العميل')];
                if (clientName && clientName.toString().trim() !== '') {
                    let regionName = row[headers.indexOf(regionHeader)] || '';
                    const correctedRegion = findBestRegionMatch(regionName, existingRegions);
                    const client = {
                        id: null,
                        name: clientName,
                        branchName: row[headers.indexOf('اسم الفرع')],
                        address: row[headers.indexOf('العنوان')],
                        region: correctedRegion,
                        mapLink: row[headers.indexOf(mapLinkHeader)],
                        visits: []
                    };
                    clients.push(client);
                }
                self.postMessage({ status: 'progress', progress: Math.floor(((index + 1) / totalRows) * 100) });
            });
            self.postMessage({ status: 'completed', clients: clients });
        } catch (error) {
            self.postMessage({ status: 'error', message: 'حدث خطأ غير متوقع أثناء قراءة الملف.' });
        }
    };
`;

// Service Worker registration is disabled to allow the app to run directly from file:///
// if ('serviceWorker' in navigator) {
//     window.addEventListener('load', () => {
//         navigator.serviceWorker.register('service-worker.js')
//             .then(registration => {
//                 console.log('Service Worker registered with scope:', registration.scope);
//             })
//             .catch(error => {
//                 console.error('Service Worker registration failed:', error);
//             });
//     });
// }

// =================================================================================================
// IndexedDB Setup & Utility Functions
// =================================================================================================

const DB_NAME = 'ClientTrackerDB';
const DB_VERSION = 1;
const CLIENTS_STORE_NAME = 'clients';

let db;

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(CLIENTS_STORE_NAME)) {
                db.createObjectStore(CLIENTS_STORE_NAME, { keyPath: 'id' });
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };

        request.onerror = (event) => {
            reject('IndexedDB error: ' + event.target.errorCode);
        };
    });
}

async function getAllClients() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([CLIENTS_STORE_NAME], 'readonly');
        const store = transaction.objectStore(CLIENTS_STORE_NAME);
        const request = store.getAll();

        request.onsuccess = (event) => {
            resolve(event.target.result);
        };

        request.onerror = (event) => {
            reject('Error fetching clients: ' + event.target.errorCode);
        };
    });
}

async function getClientById(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([CLIENTS_STORE_NAME], 'readonly');
        const store = transaction.objectStore(CLIENTS_STORE_NAME);
        const request = store.get(id);

        request.onsuccess = (event) => {
            resolve(event.target.result);
        };

        request.onerror = (event) => {
            reject('Error fetching client: ' + event.target.errorCode);
        };
    });
}

async function addClientToDB(client) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([CLIENTS_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(CLIENTS_STORE_NAME);
        const request = store.add(client);

        request.onsuccess = () => {
            resolve();
        };

        request.onerror = (event) => {
            reject('Error adding client: ' + event.target.errorCode);
        };
    });
}

async function putClientToDB(client) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([CLIENTS_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(CLIENTS_STORE_NAME);
        const request = store.put(client);

        request.onsuccess = () => {
            resolve();
        };

        request.onerror = (event) => {
            reject('Error updating client: ' + event.target.errorCode);
        };
    });
}

async function deleteClientFromDB(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([CLIENTS_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(CLIENTS_STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => {
            resolve();
        };

        request.onerror = (event) => {
            reject('Error deleting client: ' + event.target.errorCode);
        };
    });
}

async function clearAllClientsFromDB() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([CLIENTS_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(CLIENTS_STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => {
            resolve();
        };

        request.onerror = (event) => {
            reject('Error clearing data: ' + event.target.errorCode);
        };
    });
}

// =================================================================================================
// Main Application Logic
// =================================================================================================

const clientNameInput = document.getElementById('clientName');
const branchNameInput = document.getElementById('branchName');
const clientRegionInput = document.getElementById('clientRegion');
const clientAddressInput = document.getElementById('clientAddress');
const clientMapLinkInput = document.getElementById('clientMapLink');
const addClientBtn = document.getElementById('addClientBtn');
const regionFilterSelect = document.getElementById('region-filter');
const regionsListDatalist = document.getElementById('regionsList');
const darkModeSwitch = document.getElementById('darkModeSwitch');
const searchClientInput = document.getElementById('searchClientInput');
const excelFileInput = document.getElementById('excelFileInput');
const importExcelBtn = document.getElementById('importExcelBtn');
const exportExcelBtn = document.getElementById('exportExcelBtn');
const editClientModal = new bootstrap.Modal(document.getElementById('editClientModal'));
const clientDetailsModal = new bootstrap.Modal(document.getElementById('clientDetailsModal'));
const saveClientChangesBtn = document.getElementById('saveClientChangesBtn');
const sortBySelect = document.getElementById('sort-by');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingMessage = document.getElementById('loading-message');
const loadingProgressBar = document.getElementById('loading-progress');
const newClientInputs = [clientNameInput, branchNameInput, clientRegionInput, clientAddressInput, clientMapLinkInput];
const navLinks = document.querySelectorAll('.nav-link');
const navbarCollapse = new bootstrap.Collapse(document.getElementById('mainNavbar'), { toggle: false });
const pageTitle = document.getElementById('page-title');
const clearAllDataBtn = document.getElementById('clearAllDataBtn');
const backupDataBtn = document.getElementById('backupDataBtn');
const restoreDataBtn = document.getElementById('restoreDataBtn');
const addVisitForm = document.getElementById('addVisitForm');
const latestVisitsList = document.getElementById('latestVisitsList');
const reportPeriodSelect = document.getElementById('report-period');
const customDateFields = document.getElementById('custom-date-fields');
const startDateInput = document.getElementById('start-date');
const endDateInput = document.getElementById('end-date');
const reportClientFilterSelect = document.getElementById('report-client-filter');
const reportRegionFilterSelect = document.getElementById('report-region-filter');
const reportTypeFilterSelect = document.getElementById('report-type-filter');
const generateReportBtn = document.getElementById('generate-report-btn');
const exportReportBtn = document.getElementById('export-report-btn');
const reportTableBody = document.getElementById('report-table-body');
const clientsByRegionContainer = document.getElementById('clients-by-region-container');
const plannerRegionSelect = document.getElementById('planner-region-select');
const generateRouteBtn = document.getElementById('generate-route-btn');
const routeList = document.getElementById('route-list');
const routeDurationBadge = document.getElementById('route-duration-badge');
const routeDistanceBadge = document.getElementById('route-distance-badge');
const clientsStatusChartCanvas = document.getElementById('clientsStatusChart');
const clientsByRegionChartCanvas = document.getElementById('clientsByRegionChart');
const dashboardCards = document.querySelectorAll('.dashboard-card');
const agedClientsCount = document.getElementById('agedClientsCount');
const paginationList = document.getElementById('pagination-list');
const restoreDataInput = document.getElementById('restoreDataInput');
const tomSelectInstances = {};

let clients = [];
let clientDetailsModalInstance;
let debounceTimeout;
let selectedClientIdForDetails = null;
let currentReportData = [];
let clientsStatusChart;
let clientsByRegionChart;
let currentPage = 1;
const itemsPerPage = 10;
let fuse;

const fuseOptions = {
    keys: ['name', 'branchName', 'address', 'region'],
    includeScore: true,
    includeMatches: true,
    minMatchCharLength: 2,
    threshold: 0.4,
};


function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function showToast(message, type = 'info') {
    Toastify({
        text: message,
        duration: 3000,
        gravity: "top",
        position: "left",
        backgroundColor: {
            info: 'linear-gradient(to right, #00b09b, #96c93d)',
            success: 'linear-gradient(to right, #198754, #28a745)',
            warning: 'linear-gradient(to right, #ffc107, #ff9800)',
            danger: 'linear-gradient(to right, #dc3545, #c82333)'
        }[type] || 'linear-gradient(to right, #00b09b, #96c93d)',
        className: "info",
        stopOnFocus: true,
        close: true
    }).showToast();
}

async function updateAllUI() {
    clients = await getAllClients();
    updateDashboardCards();
    updateCharts();
    updateRegionFilters();
    filterAndSortClients();
    updateLatestVisitsSummary();
    initializeFuse();
}

function updateReportFilters() {
    const clientOptions = clients.map(client => ({ value: client.id, text: client.name }));
    const reportClientSelect = tomSelectInstances['report-client-filter'];
    if (reportClientSelect) {
        const currentValue = reportClientSelect.getValue();
        reportClientSelect.clearOptions();
        reportClientSelect.addOptions(clientOptions);
        reportClientSelect.setValue(currentValue, true);
    }
}
function initializeFuse() {
    fuse = new Fuse(clients, fuseOptions);
}

function initializeTomSelect(elementId, options) {
    if (tomSelectInstances[elementId]) {
        tomSelectInstances[elementId].destroy();
    }
    tomSelectInstances[elementId] = new TomSelect(`#${elementId}`, options);
}

function updateRegionFilters() {
    const allRegions = [...new Set(clients.map(c => c.region).filter(Boolean))].sort();
    regionsListDatalist.innerHTML = '';
    const regionOptions = allRegions.map(region => ({ value: region, text: region }));

    allRegions.forEach(region => {
        const option = document.createElement('option');
        option.value = region;
        regionsListDatalist.appendChild(option);
    });

    ['region-filter', 'report-region-filter', 'planner-region-select'].forEach(id => {
        const select = tomSelectInstances[id];
        if (select) {
            const currentValue = select.getValue();
            select.clearOptions();
            select.addOptions(regionOptions);
            select.setValue(currentValue, true); // silent update
        }
    });
}

function highlightMatches(text, matches = []) {
    const result = [];
    let lastIndex = 0;
    matches.forEach(match => {
        result.push(text.substring(lastIndex, match.indices[0][0]));
        result.push(`<span class="highlight">${text.substring(match.indices[0][0], match.indices[0][1] + 1)}</span>`);
        lastIndex = match.indices[0][1] + 1;
    });
    result.push(text.substring(lastIndex));
    return result.join('');
}

function getDaysSinceLastVisit(client) {
    if (client.visits.length === 0) return Infinity;
    const lastVisitDate = new Date(Math.max(...client.visits.map(v => new Date(v.date))));
    const today = new Date();
    const timeDiff = today.getTime() - lastVisitDate.getTime();
    return Math.floor(timeDiff / (1000 * 3600 * 24));
}

function renderClients(clientsToRender = []) {
    clientsByRegionContainer.innerHTML = '';
    const totalPages = Math.ceil(clientsToRender.length / itemsPerPage);
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const paginatedClients = clientsToRender.slice(start, end);

    if (paginatedClients.length === 0) {
        clientsByRegionContainer.innerHTML = `<div class="p-3 text-center text-muted">لا يوجد عملاء لعرضهم.</div>`;
        renderPagination(totalPages);
        return;
    }

    const regions = [...new Set(paginatedClients.map(c => c.item.region).filter(Boolean))].sort();

    regions.forEach((region) => {
        const regionClients = paginatedClients.filter(c => c.item.region === region);
        
        const regionBlock = document.createElement('div');
        regionBlock.classList.add('card', 'region-block', 'mb-4', 'animate__animated', 'animate__fadeIn');
        
        const regionHeader = document.createElement('div');
        regionHeader.classList.add('card-header', 'region-block-header');
        regionHeader.innerHTML = `
            <i class="fas fa-map-marker-alt me-2"></i>
            <span>${region}</span>
            <span class="badge bg-primary rounded-pill">${regionClients.length}</span>
        `;

        const regionBody = document.createElement('div');
        regionBody.classList.add('card-body', 'p-0');

        const gridContainer = document.createElement('div');
        gridContainer.classList.add('clients-grid-container');

        regionClients.forEach(result => {
            const client = result.item;
            const matches = result.matches || [];
            const statusClass = client.visits.length > 0 ? 'completed' : 'pending';
            const daysSinceLastVisit = getDaysSinceLastVisit(client);
            const agedClass = daysSinceLastVisit > 30 && statusClass === 'pending' ? 'aged' : '';
            
            const nameMatch = matches.find(m => m.key === 'name');

            const clientCard = document.createElement('div');
            clientCard.classList.add('card', 'client-card-compact', statusClass, agedClass);
            clientCard.innerHTML = `
                <div class="card-body">
                    <div>
                        <h6 class="card-title mb-1">${nameMatch ? highlightMatches(client.name, [nameMatch]) : client.name}</h6>
                        <p class="card-text small text-muted">${client.branchName}</p>
                    </div>
                    <div class="mt-2 btn-group w-100">
                        <button class="btn btn-sm btn-outline-info view-details-btn" title="عرض التفاصيل" data-client-id="${client.id}"><i class="fas fa-eye"></i></button>
                        <a href="${client.mapLink}" target="_blank" class="btn btn-sm btn-outline-secondary" title="الخريطة"><i class="fas fa-map-marked-alt"></i></a>
                        <button class="btn btn-sm btn-outline-danger delete-client-btn" title="حذف" data-client-id="${client.id}"><i class="fas fa-trash-alt"></i></button>
                        </div>
                </div>
            `;
            gridContainer.appendChild(clientCard);
        });

        regionBody.appendChild(gridContainer);
        regionBlock.appendChild(regionHeader);
        regionBlock.appendChild(regionBody);
        clientsByRegionContainer.appendChild(regionBlock);
    });
    renderPagination(totalPages);
    attachClientCardListeners();
}

function renderPagination(totalPages) {
    paginationList.innerHTML = '';
    if (totalPages <= 1) return;
    const prevItem = document.createElement('li');
    prevItem.classList.add('page-item');
    if (currentPage === 1) prevItem.classList.add('disabled');
    prevItem.innerHTML = `<a class="page-link" href="#" aria-label="السابق"><span aria-hidden="true">&laquo;</span></a>`;
    prevItem.addEventListener('click', (e) => {
        e.preventDefault();
        if (currentPage > 1) {
            currentPage--;
            filterAndSortClients();
        }
    });
    paginationList.appendChild(prevItem);
    for (let i = 1; i <= totalPages; i++) {
        const pageItem = document.createElement('li');
        pageItem.classList.add('page-item');
        if (i === currentPage) pageItem.classList.add('active');
        pageItem.innerHTML = `<a class="page-link" href="#">${i}</a>`;
        pageItem.addEventListener('click', (e) => {
            e.preventDefault();
            currentPage = i;
            filterAndSortClients();
        });
        paginationList.appendChild(pageItem);
    }
    const nextItem = document.createElement('li');
    nextItem.classList.add('page-item');
    if (currentPage === totalPages) nextItem.classList.add('disabled');
    nextItem.innerHTML = `<a class="page-link" href="#" aria-label="التالي"><span aria-hidden="true">&raquo;</span></a>`;
    nextItem.addEventListener('click', (e) => {
        e.preventDefault();
        if (currentPage < totalPages) {
            currentPage++;
            filterAndSortClients();
        }
    });
    paginationList.appendChild(nextItem);
}

function attachClientCardListeners() {
    document.querySelectorAll('.view-details-btn').forEach(button => {
        button.addEventListener('click', async (e) => {
            const clientId = e.target.closest('button').dataset.clientId;
            selectedClientIdForDetails = clientId;
            const client = await getClientById(clientId);
            if (client) {
                displayClientDetails(client);
                clientDetailsModalInstance = new bootstrap.Modal(document.getElementById('clientDetailsModal'));
                clientDetailsModalInstance.show();
            }
        });
    });
    document.querySelectorAll('.delete-client-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            const clientId = e.target.closest('button').dataset.clientId;
            Swal.fire({
                title: 'هل أنت متأكد؟',
                text: "لن تتمكن من التراجع عن هذا الإجراء!",
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'نعم، احذفه!',
                cancelButtonText: 'إلغاء'
            }).then(async (result) => {
                if (result.isConfirmed) {
                    await deleteClient(clientId);
                }
            });
        });
    });
}

function updateDashboardCards() {
    const totalClients = clients.length;
    const completedClients = clients.filter(c => c.visits.length > 0).length;
    const pendingClients = totalClients - completedClients;
    const agedClients = clients.filter(c => getDaysSinceLastVisit(c) > 30).length;
    document.getElementById('totalClientsCount').textContent = totalClients;
    document.getElementById('completedClientsCount').textContent = completedClients;
    document.getElementById('pendingClientsCount').textContent = pendingClients;
    agedClientsCount.textContent = agedClients;
}

function updateCharts() {
    const completedClients = clients.filter(c => c.visits.length > 0).length;
    const pendingClients = clients.length - completedClients;
    const clientsStatusData = {
        labels: ['عملاء تمت زيارتهم', 'عملاء معلقين'],
        datasets: [{
            data: [completedClients, pendingClients],
            backgroundColor: ['#198754', '#ffc107'],
            hoverOffset: 4
        }]
    };
    if (clientsStatusChart) {
        clientsStatusChart.data = clientsStatusData;
        clientsStatusChart.update();
    } else {
        clientsStatusChart = new Chart(clientsStatusChartCanvas, {
            type: 'pie',
            data: clientsStatusData,
            options: {
                responsive: true,
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                let label = context.label || '';
                                if (label) { label += ': '; }
                                if (context.parsed !== null) { label += context.parsed; }
                                return label;
                            }
                        }
                    }
                }
            }
        });
    }
    const regionCounts = clients.reduce((acc, client) => {
        acc[client.region] = (acc[client.region] || 0) + 1;
        return acc;
    }, {});
    const regionLabels = Object.keys(regionCounts);
    const regionData = Object.values(regionCounts);
    const colors = ['#0d6efd', '#198754', '#ffc107', '#dc3545', '#6c757d', '#0dcaf0', '#f8f9fa', '#6610f2'];
    const backgroundColors = regionLabels.map((_, i) => colors[i % colors.length]);
    const clientsByRegionData = {
        labels: regionLabels,
        datasets: [{
            label: 'عدد العملاء',
            data: regionData,
            backgroundColor: backgroundColors,
            borderColor: 'rgba(0, 0, 0, 0.1)',
            borderWidth: 1
        }]
    };
    if (clientsByRegionChart) {
        clientsByRegionChart.data = clientsByRegionData;
        clientsByRegionChart.update();
    } else {
        clientsByRegionChart = new Chart(clientsByRegionChartCanvas, {
            type: 'bar',
            data: clientsByRegionData,
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { precision: 0 }
                    }
                }
            }
        });
    }
}

function displayClientDetails(client) {
    document.getElementById('detailsClientName').textContent = client.name;
    document.getElementById('detailsBranchName').textContent = client.branchName;
    document.getElementById('detailsAddress').textContent = client.address;
    document.getElementById('detailsRegion').textContent = client.region;
    document.getElementById('detailsStatus').textContent = client.visits.length > 0 ? 'مكتملة الزيارات' : 'بزيارات معلقة';
    document.getElementById('detailsMapLink').href = client.mapLink;
    document.getElementById('addVisitClientId').value = client.id;
    const editBtn = document.getElementById('detailsEditBtn'); 
    editBtn.onclick = () => {
        editClient(client);
    };
    const visitHistoryList = document.getElementById('visitHistoryList');
    visitHistoryList.innerHTML = '';
    if (client.visits.length === 0) {
        visitHistoryList.innerHTML = `<li class="list-group-item text-center text-muted">لا توجد زيارات مسجلة بعد.</li>`;
    } else {
        client.visits.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(visit => {
            const visitItem = document.createElement('li');
            visitItem.classList.add('list-group-item', 'd-flex', 'justify-content-between', 'align-items-center', visit.type);
            const visitTypeArabic = {
                'support': 'دعم فني',
                'training': 'تدريب',
                'issue': 'مشكلة',
                'resolved': 'تم حلها'
            }[visit.type] || 'غير محدد';
            visitItem.innerHTML = `
                <div>
                    <strong>${visitTypeArabic}</strong>
                    <p class="mb-0 text-muted">${visit.date}</p>
                    <small>${visit.notes}</small>
                </div>
                <button class="btn btn-sm btn-outline-danger delete-visit-btn" data-client-id="${client.id}" data-visit-date="${visit.date}"><i class="fas fa-trash"></i></button>
            `;
            visitHistoryList.appendChild(visitItem);
        });
        document.querySelectorAll('.delete-visit-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const clientId = e.target.closest('button').dataset.clientId;
                const visitDate = e.target.closest('button').dataset.visitDate;
                await deleteVisit(clientId, visitDate);
            });
        });
    }
    flatpickr("#visitDate", {
        dateFormat: "Y-m-d",
        defaultDate: "today"
    });
}

async function updateLatestVisitsSummary() {
    const allVisits = clients.flatMap(client =>
        client.visits.map(visit => ({
            ...visit,
            clientName: client.name,
            clientBranch: client.branchName,
            clientRegion: client.region
        }))
    );
    allVisits.sort((a, b) => new Date(b.date) - new Date(a.date));
    const latestVisits = allVisits.slice(0, 5);
    const list = document.getElementById('latestVisitsList');
    list.innerHTML = '';
    if (latestVisits.length === 0) {
        list.innerHTML = `<li class="list-group-item text-center text-muted">لا توجد زيارات حديثة.</li>`;
        return;
    }
    latestVisits.forEach(visit => {
        const visitItem = document.createElement('li');
        visitItem.classList.add('list-group-item', 'd-flex', 'justify-content-between', 'align-items-center', 'animate__animated', 'animate__fadeInDown');
        const visitTypeArabic = {
            'support': 'دعم فني',
            'training': 'تدريب',
            'issue': 'مشكلة',
            'resolved': 'تم حلها'
        }[visit.type] || 'غير محدد';
        visitItem.innerHTML = `
            <div>
                <strong class="text-primary">${visit.clientName} - ${visit.clientBranch}</strong><br>
                <small class="text-muted">نوع الزيارة: ${visitTypeArabic} | التاريخ: ${visit.date}</small>
                <p class="mb-0">${visit.notes.substring(0, 50)}...</p>
            </div>
        `;
        list.appendChild(visitItem);
    });
}

async function addClient(client) {
    client.id = generateUUID();
    const existingRegions = [...new Set(clients.map(c => c.region).filter(Boolean))];
    client.region = findBestRegionMatch(client.region, existingRegions);
    client.visits = [];
    await addClientToDB(client);
    await updateAllUI();
    showToast(`تم إضافة العميل "${client.name}" بنجاح.`, 'success');
}

async function deleteClient(clientId) {
    await deleteClientFromDB(clientId);
    await updateAllUI();
    Swal.fire('تم الحذف!', 'تم حذف العميل بنجاح.', 'success');
}

async function editClient(client) {
    clientDetailsModalInstance.hide();
    document.getElementById('editClientId').value = client.id;
    document.getElementById('editClientName').value = client.name;
    document.getElementById('editBranchName').value = client.branchName;
    document.getElementById('editClientAddress').value = client.address;
    document.getElementById('editClientRegion').value = client.region;
    document.getElementById('editClientMapLink').value = client.mapLink;
    editClientModal.show();
}

async function saveClientChanges() {
    const clientId = document.getElementById('editClientId').value;
    const clientToUpdate = await getClientById(clientId);
    if (clientToUpdate) {
        clientToUpdate.name = document.getElementById('editClientName').value;
        clientToUpdate.branchName = document.getElementById('editBranchName').value;
        clientToUpdate.address = document.getElementById('editClientAddress').value;
        clientToUpdate.region = document.getElementById('editClientRegion').value;
        clientToUpdate.mapLink = document.getElementById('editClientMapLink').value;
        await putClientToDB(clientToUpdate);
        await updateAllUI();
        editClientModal.hide();
        const updatedClient = await getClientById(clientId);
        displayClientDetails(updatedClient);
        clientDetailsModalInstance.show();
        showToast(`تم حفظ التغييرات للعميل "${updatedClient.name}" بنجاح.`, 'success');
    }
}

async function addVisit(clientId, visit) {
    const client = await getClientById(clientId);
    if (client) {
        client.visits.push(visit);
        await putClientToDB(client);
        await updateAllUI();
        displayClientDetails(client);
        showToast(`تم إضافة زيارة جديدة للعميل "${client.name}" بنجاح.`, 'success');
    }
}

async function deleteVisit(clientId, visitDate) {
    const client = await getClientById(clientId);
    if (client) {
        client.visits = client.visits.filter(v => v.date !== visitDate);
        await putClientToDB(client);
        await updateAllUI();
        displayClientDetails(client);
        showToast('تم حذف الزيارة بنجاح.', 'success');
    }
}

function filterAndSortClients(targetStatus = 'all') {
    let results;
    const searchTerm = searchClientInput.value.trim();

    // 1. Get initial set of clients (from Fuse.js or all clients)
    if (searchTerm.length > 1 && fuse) {
        results = fuse.search(searchTerm);
    } else {
        // Map all clients to the consistent result format
        results = clients.map(client => ({ item: client, score: 1, matches: [] }));
    }

    // 2. Augment with pre-calculated values and then filter in a more efficient way
    const regionFilterValues = tomSelectInstances['region-filter'] ? tomSelectInstances['region-filter'].getValue() : [];

    const processedResults = results
        .map(result => {
            // Pre-calculate the last visit timestamp ONCE per client for this operation
            const lastVisitTimestamp = result.item.visits.length > 0 
                ? Math.max(...result.item.visits.map(v => new Date(v.date).getTime())) 
                : 0;
            return { ...result, lastVisitTimestamp };
        })
        .filter(result => {
            const client = result.item;
            const matchesRegionFilter = regionFilterValues.length === 0 || regionFilterValues.includes(client.region);
            if (!matchesRegionFilter) return false;
            if (targetStatus === 'completed') return client.visits.length > 0;
            if (targetStatus === 'pending') return client.visits.length === 0;
            if (targetStatus === 'aged') {
                const daysSince = result.lastVisitTimestamp > 0 
                    ? Math.floor((new Date().getTime() - result.lastVisitTimestamp) / (1000 * 3600 * 24))
                    : Infinity;
                return daysSince > 30;
            }
            return true; // For 'all' status
        });

    // 3. Sort the already filtered and augmented results
    const sortByValue = sortBySelect.value;
    if (sortByValue.startsWith('name')) {
        processedResults.sort((a, b) => {
            const comparison = a.item.name.localeCompare(b.item.name, 'ar');
            return sortByValue === 'name_asc' ? comparison : -comparison;
        });
    } else if (sortByValue.startsWith('last_visit')) {
        // Sort using the pre-calculated timestamp
        processedResults.sort((a, b) => {
            const comparison = a.lastVisitTimestamp - b.lastVisitTimestamp;
            return sortByValue === 'last_visit_asc' ? comparison : -comparison;
        });
    }

    // 4. Render
    currentPage = 1;
    renderClients(processedResults);
}

function getCoordsFromLink(link) {
    try {
        const url = new URL(link);
        const match = url.pathname.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (match) {
            return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
        }
    } catch (e) {
        console.error("Invalid map link format", e);
    }
    return null;
}

function calculateDistance(coord1, coord2) {
    const R = 6371e3;
    const φ1 = coord1.lat * Math.PI / 180;
    const φ2 = coord2.lat * Math.PI / 180;
    const Δφ = (coord2.lat - coord1.lat) * Math.PI / 180;
    const Δλ = (coord2.lng - coord1.lng) * Math.PI / 180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c / 1000;
}

function calculateOptimalRoute(clientsToVisit) {
    if (clientsToVisit.length <= 1) {
        return { path: clientsToVisit.map(c => c.id), distance: 0 };
    }
    let unvisited = clientsToVisit.map(c => ({ id: c.id, coords: getCoordsFromLink(c.mapLink) }));
    let currentPath = [];
    let startNode = unvisited[0];
    currentPath.push(startNode.id);
    unvisited.shift();
    let currentNode = startNode;
    let totalDistance = 0;
    while (unvisited.length > 0) {
        let nearestNode = null;
        let minDistance = Infinity;
        for (let i = 0; i < unvisited.length; i++) {
            const nextNode = unvisited[i];
            if (!nextNode.coords) continue;
            const distance = calculateDistance(currentNode.coords, nextNode.coords);
            if (distance < minDistance) {
                minDistance = distance;
                nearestNode = nextNode;
            }
        }
        if (nearestNode) {
            currentPath.push(nearestNode.id);
            unvisited = unvisited.filter(n => n.id !== nearestNode.id);
            currentNode = nearestNode;
            totalDistance += minDistance;
        } else {
            currentPath.push(...unvisited.map(n => n.id));
            unvisited = [];
        }
    }
    return { path: currentPath, distance: totalDistance };
}

function renderOptimalRoute(selectedRegions) {
    const selectedRegionsValues = tomSelectInstances['planner-region-select'] ? tomSelectInstances['planner-region-select'].getValue() : [];
    const clientsInSelectedRegions = clients.filter(c => selectedRegionsValues.includes(c.region));
    const clientsWithValidLinks = clientsInSelectedRegions.filter(c => c.mapLink && getCoordsFromLink(c.mapLink));
    if (clientsWithValidLinks.length <= 1) {
        routeList.innerHTML = `<li class="list-group-item text-center text-muted">لا يوجد عملاء كافيين أو روابط خرائط صالحة في المناطق المختارة لإنشاء مسار.</li>`;
        routeDurationBadge.textContent = '';
        routeDistanceBadge.textContent = '';
        showToast('لا يمكن إنشاء مسار. تأكد من وجود أكثر من عميل ورابط خريطة صالح لكل منهم في المناطق المختارة.', 'warning');
        return;
    }
    const { path, distance } = calculateOptimalRoute(clientsWithValidLinks);
    let totalTime = Math.round((distance / 40) * 60);
    let totalHours = Math.floor(totalTime / 60);
    let totalMinutes = totalTime % 60;
    let durationText = '';
    if (totalHours > 0) durationText += `${totalHours} س و `;
    durationText += `${totalMinutes} د`;
    routeDurationBadge.textContent = `~ ${durationText}`;
    routeDistanceBadge.textContent = `(${distance.toFixed(2)} كم)`;
    routeList.innerHTML = '';
    path.forEach(async (clientId, index) => {
        const client = await getClientById(clientId);
        if (client) {
            const listItem = document.createElement('li');
            listItem.classList.add('list-group-item', 'd-flex', 'align-items-center', 'animate__animated', 'animate__fadeInRight');
            listItem.style.animationDelay = `${index * 0.1}s`;
            listItem.innerHTML = `
                <span class="badge bg-primary rounded-pill me-2">${index + 1}</span>
                <div class="flex-grow-1">
                    <strong class="text-primary">${client.name}</strong> - ${client.branchName}
                    <div class="text-muted small">${client.address}</div>
                </div>
                <a href="${client.mapLink}" target="_blank" class="btn btn-sm btn-outline-secondary me-2"><i class="fas fa-map-marker-alt"></i></a>
            `;
            routeList.appendChild(listItem);
        }
    });
    showToast(`تم إنشاء مسار الزيارات الأمثل للمناطق المختارة بنجاح.`, 'success');
}

async function generateReport() {
    const period = reportPeriodSelect.value;
    let startDate, endDate;
    const today = new Date();
    today.setHours(23, 59, 59, 999); // End of today

    if (period === 'custom') {
        startDate = startDateInput.value ? new Date(startDateInput.value) : null;
        endDate = endDateInput.value ? new Date(endDateInput.value) : null;
    } else {
        endDate = new Date(today);
        if (period === 'daily') startDate = new Date(today.setHours(0, 0, 0, 0));
        else if (period === 'weekly') startDate = new Date(new Date().setDate(today.getDate() - 7));
        else if (period === 'monthly') startDate = new Date(new Date().setMonth(today.getMonth() - 1));
        else if (period === 'all') startDate = new Date(0);
    }
    const selectedClientIds = tomSelectInstances['report-client-filter'] ? tomSelectInstances['report-client-filter'].getValue() : [];
    const selectedRegions = tomSelectInstances['report-region-filter'] ? tomSelectInstances['report-region-filter'].getValue() : [];
    const selectedTypes = tomSelectInstances['report-type-filter'] ? tomSelectInstances['report-type-filter'].getValue() : [];
    currentReportData = [];
    clients.forEach(client => {
        if (selectedClientIds.length === 0 || selectedClientIds.includes(client.id)) {
            if (selectedRegions.length === 0 || selectedRegions.includes(client.region)) {
                client.visits.forEach(visit => {
                    const visitDate = new Date(visit.date);
                    if ((!startDate || visitDate >= startDate) && (!endDate || visitDate <= endDate)) {
                        if (selectedTypes.length === 0 || selectedTypes.includes(visit.type)) {
                            currentReportData.push({
                                clientName: client.name,
                                region: client.region,
                                visitDate: visit.date,
                                visitType: visit.type,
                                notes: visit.notes
                            });
                        }
                    }
                });
            }
        }
    });
    currentReportData.sort((a, b) => new Date(b.visitDate) - new Date(a.visitDate));
    renderReportTable();
    showToast('تم إنشاء التقرير بنجاح.', 'success');
}

function renderReportTable() {
    reportTableBody.innerHTML = '';
    if (currentReportData.length === 0) {
        reportTableBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">لا يوجد تقرير لعرضه.</td></tr>`;
        return;
    }
    currentReportData.forEach(row => {
        const visitTypeArabic = {
            'support': 'دعم فني',
            'training': 'تدريب',
            'issue': 'مشكلة',
            'resolved': 'تم حلها'
        }[row.visitType] || row.visitType;
        const tableRow = document.createElement('tr');
        tableRow.innerHTML = `
            <td>${row.clientName}</td>
            <td>${row.region}</td>
            <td>${row.visitDate}</td>
            <td>${visitTypeArabic}</td>
            <td>${row.notes}</td>
        `;
        reportTableBody.appendChild(tableRow);
    });
}

function exportReportToExcel() {
    if (currentReportData.length === 0) {
        showToast('لا يوجد بيانات في التقرير لتصديرها.', 'danger');
        return;
    }
    const ws = XLSX.utils.json_to_sheet(currentReportData.map(row => ({
        'اسم العميل': row.clientName,
        'المنطقة': row.region,
        'تاريخ الزيارة': row.visitDate,
        'نوع الزيارة': {
            'support': 'دعم فني',
            'training': 'تدريب',
            'issue': 'مشكلة',
            'resolved': 'تم حلها'
        }[row.visitType] || row.visitType,
        'الملاحظات': row.notes
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "تقرير الزيارات");
    XLSX.writeFile(wb, `تقرير_الزيارات_${new Date().toLocaleDateString()}.xlsx`);
    showToast('تم تصدير التقرير بنجاح.', 'success');
}

function exportDataToExcel() {
    if (clients.length === 0) {
        showToast('لا يوجد بيانات لتصديرها.', 'danger');
        return;
    }
    const allClients = clients.flatMap(client => {
        if (client.visits.length > 0) {
            return client.visits.map(visit => ({
                'اسم العميل': client.name,
                'اسم الفرع': client.branchName,
                'العنوان': client.address,
                'المنطقة': client.region,
                'رابط google map': client.mapLink,
                'تاريخ الزيارة': visit.date,
                'نوع الزيارة': {
                    'support': 'دعم فني',
                    'training': 'تدريب',
                    'issue': 'مشكلة',
                    'resolved': 'تم حلها'
                }[visit.type] || visit.type,
                'ملاحظات الزيارة': visit.notes
            }));
        } else {
            return [{
                'اسم العميل': client.name,
                'اسم الفرع': client.branchName,
                'العنوان': client.address,
                'المنطقة': client.region,
                'رابط google map': client.mapLink,
                'تاريخ الزيارة': '',
                'نوع الزيارة': '',
                'ملاحظات الزيارة': ''
            }];
        }
    });
    const ws = XLSX.utils.json_to_sheet(allClients);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "العملاء والزيارات");
    XLSX.writeFile(wb, `بيانات_العملاء_والزيارات_${new Date().toLocaleDateString()}.xlsx`);
    showToast('تم تصدير البيانات إلى Excel بنجاح.', 'success');
}

function backupData() {
    const data = JSON.stringify(clients, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_clients_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('تم إنشاء نسخة احتياطية بنجاح.', 'success');
}

async function restoreData() {
    restoreDataInput.click();
    restoreDataInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const restoredClients = JSON.parse(event.target.result);
                if (Array.isArray(restoredClients) && restoredClients.every(c => c.id && c.name)) {
                    await clearAllClientsFromDB();
                    for (const client of restoredClients) {
                        await addClientToDB(client);
                    }
                    await updateAllUI();
                    showToast('تم استعادة البيانات بنجاح.', 'success');
                    showPage(document.querySelector('.nav-link.active').dataset.page);
                } else {
                    showToast('الملف غير صالح. يرجى التأكد من أنه ملف JSON صحيح للبيانات.', 'danger');
                }
            } catch (error) {
                showToast('حدث خطأ في قراءة الملف.', 'danger');
                console.error(error);
            }
        };
        reader.readAsText(file);
    };
}

async function clearAllData() {
    Swal.fire({
        title: 'هل أنت متأكد؟',
        text: "سيتم حذف كل بيانات العملاء والزيارات! لا يمكن التراجع عن هذا الإجراء.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'نعم، امسح كل شيء!',
        cancelButtonText: 'إلغاء'
    }).then(async (result) => {
        if (result.isConfirmed) {
            await clearAllClientsFromDB();
            clients = [];
            await updateAllUI();
            Swal.fire('تم المسح!', 'تم حذف جميع البيانات بنجاح.', 'success');
            showPage('dashboard');
        }
    });
}

async function showPage(pageId) {
    document.querySelectorAll('.page-content').forEach(page => {
        page.classList.remove('active');
    });
    document.getElementById(pageId + '-page').classList.add('active');
    navLinks.forEach(link => {
        link.classList.remove('active');
    });
    document.querySelector(`[data-page="${pageId}"]`).classList.add('active');
    const pageTitles = {
        'dashboard': 'اللوحة الرئيسية',
        'clients': 'إدارة العملاء',
        'visits-planner': 'مخطط الزيارات',
        'reports': 'التقارير',
        'data-management': 'إدارة البيانات'
    };
    pageTitle.textContent = pageTitles[pageId] || '';
    await updateAllUI();
    if (pageId === 'reports') {
        updateReportFilters();
    }
    if (pageId === 'visits-planner') {
        routeList.innerHTML = `<li class="list-group-item text-center text-muted">اختر منطقة واضغط على "توليد المسار" لعرض المسار هنا.</li>`;
        routeDurationBadge.textContent = '';
        routeDistanceBadge.textContent = '';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await openDB();
    await updateAllUI();
    loadingOverlay.classList.add('hidden');
    const isDarkMode = localStorage.getItem('darkMode') === 'true';
    document.body.classList.toggle('dark-mode', isDarkMode);
    darkModeSwitch.checked = isDarkMode;
    darkModeSwitch.addEventListener('change', () => {
        document.body.classList.toggle('dark-mode');
        localStorage.setItem('darkMode', darkModeSwitch.checked);
    });

    initializeTomSelect('region-filter', { plugins: ['remove_button'], onChange: () => filterAndSortClients() });
    initializeTomSelect('planner-region-select', { plugins: ['remove_button'] });
    initializeTomSelect('report-client-filter', { plugins: ['remove_button'], valueField: 'value', labelField: 'text', searchField: 'text' });
    initializeTomSelect('report-region-filter', { plugins: ['remove_button'] });
    initializeTomSelect('report-type-filter', { plugins: ['remove_button'] });

    reportPeriodSelect.addEventListener('change', () => {
        customDateFields.style.display = reportPeriodSelect.value === 'custom' ? 'flex' : 'none';
    });
    flatpickr("#start-date", { dateFormat: "Y-m-d" });
    flatpickr("#end-date", { dateFormat: "Y-m-d" });
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = link.dataset.page;
            showPage(page);
            if (document.getElementById('mainNavbar').classList.contains('show')) navbarCollapse.hide();
        });
    });
    newClientInputs.forEach(input => {
        input.addEventListener('input', () => {
            const formValid = newClientInputs.every(i => i.value.trim() !== '');
            addClientBtn.disabled = !formValid;
        });
    });
    addClientBtn.addEventListener('click', async () => {
        const newClient = {
            name: clientNameInput.value,
            branchName: branchNameInput.value,
            address: clientAddressInput.value,
            region: clientRegionInput.value,
            mapLink: clientMapLinkInput.value
        };
        await addClient(newClient);
        newClientInputs.forEach(input => input.value = '');
        addClientBtn.disabled = true;
    });
    saveClientChangesBtn.addEventListener('click', saveClientChanges);
    addVisitForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const clientId = document.getElementById('addVisitClientId').value;
        const newVisit = {
            type: document.getElementById('visitType').value,
            date: document.getElementById('visitDate').value,
            notes: document.getElementById('visitNotes').value
        };
        await addVisit(clientId, newVisit);
        document.getElementById('visitType').value = '';
        document.getElementById('visitDate').value = '';
        document.getElementById('visitNotes').value = '';
    });
    searchClientInput.addEventListener('input', () => {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(filterAndSortClients, 300);
    });
    sortBySelect.addEventListener('change', () => filterAndSortClients());
    dashboardCards.forEach(card => {
        card.addEventListener('click', (e) => {
            const targetStatus = card.dataset.targetStatus;
            showPage('clients');
            filterAndSortClients(targetStatus);
            searchClientInput.focus();
        });
    });
    importExcelBtn.addEventListener('click', () => excelFileInput.click());
    excelFileInput.addEventListener('change', handleExcelFile);

    function handleExcelFile(event) {
        const file = event.target.files[0];
        if (!file) return;
        if (window.Worker) {
            loadingMessage.textContent = 'يتم قراءة ملف Excel...';
            loadingProgressBar.style.width = '0%';
            loadingOverlay.classList.remove('hidden');
            const worker = new Worker(URL.createObjectURL(new Blob([excelWorkerCode], { type: 'text/javascript' })));
            const reader = new FileReader();
            reader.onload = async function(e) {
                const fileData = e.target.result;
                const existingClients = await getAllClients();
                const existingRegions = [...new Set(existingClients.map(c => c.region).filter(Boolean))];
                worker.postMessage({ fileData, existingRegions });
            };
            reader.readAsArrayBuffer(file);
            worker.onmessage = async function(e) {
                const { status, message, clients: importedClients, progress } = e.data;
                if (status === 'progress') {
                    loadingMessage.textContent = 'جارٍ معالجة البيانات...';
                    loadingProgressBar.style.width = `${progress}%`;
                } else if (status === 'completed') {
                    for (const client of importedClients) {
                        client.id = generateUUID();
                        await addClientToDB(client);
                    }
                    await updateAllUI();
                    loadingOverlay.classList.add('hidden');
                    showToast('تم استيراد البيانات بنجاح!', 'success');
                    showPage('clients');
                    worker.terminate();
                } else if (status === 'error') {
                    loadingOverlay.classList.add('hidden');
                    showToast(message, 'danger');
                    worker.terminate();
                }
            };
        } else {
            showToast('متصفحك لا يدعم Web Workers. يرجى تحديث متصفحك.', 'danger');
        }
    }
    exportExcelBtn.addEventListener('click', exportDataToExcel);
    backupDataBtn.addEventListener('click', backupData);
    restoreDataBtn.addEventListener('click', restoreData);
    clearAllDataBtn.addEventListener('click', clearAllData);
    generateReportBtn.addEventListener('click', generateReport);
    exportReportBtn.addEventListener('click', exportReportToExcel);
    generateRouteBtn.addEventListener('click', () => {
        const selectedRegions = tomSelectInstances['planner-region-select'] ? tomSelectInstances['planner-region-select'].getValue() : [];
        if (selectedRegions && selectedRegions.length > 0) {
            renderOptimalRoute(selectedRegions);
        } else {
            showToast('يرجى اختيار منطقة أو أكثر لتوليد المسار.', 'danger');
        }
    });
    showPage('dashboard');

    // =================================================================================================
    // PWA Installation Logic
    // =================================================================================================
    let deferredInstallPrompt = null;
    const installAppBtn = document.getElementById('installAppBtn');

    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent the mini-infobar from appearing on mobile
        e.preventDefault();
        // Stash the event so it can be triggered later.
        deferredInstallPrompt = e;
        // Update UI to notify the user they can install the PWA
        installAppBtn.style.display = 'block';
    });

    installAppBtn.addEventListener('click', async () => {
        if (!deferredInstallPrompt) {
            return;
        }
        // Show the install prompt
        deferredInstallPrompt.prompt();
        // Wait for the user to respond to the prompt
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') {
            showToast('سيتم تثبيت التطبيق على جهازك.', 'info');
        }
        // We've used the prompt, and can't use it again, throw it away
        deferredInstallPrompt = null;
        // Hide the app provided install promotion
        installAppBtn.style.display = 'none';
    });

    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        installAppBtn.style.display = 'none';
        showToast('تم تثبيت التطبيق بنجاح!', 'success');
    });

    const isIos = () => /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
    const isInStandaloneMode = () => ('standalone' in window.navigator) && (window.navigator.standalone);

    if (isIos() && !isInStandaloneMode()) {
        const iosInstallToast = new bootstrap.Toast(document.getElementById('iosInstallToast'), { delay: 20000 });
        setTimeout(() => iosInstallToast.show(), 5000);
    }
});