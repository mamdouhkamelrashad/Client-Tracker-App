let clients = [];
let activePage = 'dashboard';
const pageTitle = document.getElementById('page-title');
const mainContent = document.getElementById('main-content');
const clientsList = document.getElementById('clients-list');
const latestVisitsList = document.getElementById('latestVisitsList');
const dashboard = document.getElementById('dashboard-page');
const clientsPage = document.getElementById('clients-page');
const visitsPlannerPage = document.getElementById('visits-planner-page');
const reportsPage = document.getElementById('reports-page');
const dataManagementPage = document.getElementById('data-management-page');
const clientDetailsModal = new bootstrap.Modal(document.getElementById('clientDetailsModal'));
const addVisitModal = new bootstrap.Modal(document.getElementById('addVisitModal'));
const editClientModal = new bootstrap.Modal(document.getElementById('editClientModal'));
const loadingOverlay = document.getElementById('loading-overlay');
const loadingMessage = document.getElementById('loading-message');

// قائمة المناطق الثابتة التي يمكنك تحديدها
const predefinedRegions = [
    'المهندسين',
    'الزمالك',
    'مدينة نصر',
    'المعادي',
    'التجمع الخامس',
    'الجيزة',
    'الهرم',
    'فيصل',
    'العبور',
    'أكتوبر',
    'الشيخ زايد',
    'الإسكندرية'
];

const clientNameInput = document.getElementById('clientName');
const branchNameInput = document.getElementById('branchName');
const clientAddressInput = document.getElementById('clientAddress');
const clientRegionSelect = document.getElementById('clientRegion'); // Changed to select
const clientMapLinkInput = document.getElementById('clientMapLink');
const clientPhoneInput = document.getElementById('clientPhone');
const clientEmailInput = document.getElementById('clientEmail');
const addClientBtn = document.getElementById('addClientBtn');
const regionFilterSelect = document.getElementById('region-filter');
const searchClientInput = document.getElementById('searchClientInput');
const reportRegionFilter = document.getElementById('report-region-filter');
const plannerRegionSelect = document.getElementById('planner-region-select');
const plannerClientListContainer = document.getElementById('planner-client-list-container');

const importExcelBtn = document.getElementById('importExcelBtn');
const excelFileInput = document.getElementById('excelFileInput');
const clearAllDataBtn = document.getElementById('clearAllDataBtn');
const exportExcelBtn = document.getElementById('exportExcelBtn');

let regionsChart, statusChart;

document.addEventListener('DOMContentLoaded', () => {
    // تسجيل Service Worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/service-worker.js')
                .then(registration => {
                    console.log('Service Worker registered: ', registration);
                })
                .catch(err => {
                    console.log('Service Worker registration failed: ', err);
                });
        });
    }

    loadClients();
    renderRegions();
    setupPageNavigation();
    renderDashboard();
    renderClients();
    setupEventListeners();
    setupDarkMode();
    setupTippy(); // Initialize Tippy.js
    flatpickr("#visitDate", {
        enableTime: false,
        dateFormat: "Y-m-d",
        locale: "ar",
        defaultDate: "today"
    });
    flatpickr("#start-date", {
        enableTime: false,
        dateFormat: "Y-m-d",
        locale: "ar"
    });
    flatpickr("#end-date", {
        enableTime: false,
        dateFormat: "Y-m-d",
        locale: "ar"
    });

    // Initialize selectpickers
    $('.selectpicker').selectpicker();

    // Initial render of the report page
    renderReport();
});

function saveClients() {
    localStorage.setItem('clients', JSON.stringify(clients));
}

function loadClients() {
    const storedClients = localStorage.getItem('clients');
    if (storedClients) {
        clients = JSON.parse(storedClients);
    }
}

function renderRegions() {
    const allRegions = [...new Set([...predefinedRegions, ...clients.map(c => c.region || '')])].sort();

    const renderSelectOptions = (selectElement) => {
        const htmlOptions = allRegions.filter(region => region).map(region =>
            `<option value="${region}">${region}</option>`
        ).join('');
        selectElement.innerHTML = htmlOptions;
        $(selectElement).selectpicker('refresh');
    };

    renderSelectOptions(clientRegionSelect);
    renderSelectOptions(regionFilterSelect);
    renderSelectOptions(plannerRegionSelect);
    renderSelectOptions(reportRegionFilter);

    const editClientRegionSelect = document.getElementById('editClientRegion');
    renderSelectOptions(editClientRegionSelect);
}

function renderPlannerClients(regions) {
    plannerClientListContainer.innerHTML = '';
    if (!regions || regions.length === 0) {
        plannerClientListContainer.innerHTML = `<div class="alert alert-info text-center animate__animated animate__fadeIn">اختر منطقة أو أكثر لعرض العملاء.</div>`;
        return;
    }

    const clientsByRegion = clients.filter(c => regions.includes(c.region)).reduce((acc, client) => {
        const region = client.region || 'غير محددة';
        if (!acc[region]) {
            acc[region] = [];
        }
        acc[region].push(client);
        return acc;
    }, {});

    const regionsHtml = Object.keys(clientsByRegion).map(region => {
        const collapseId = `planner-collapse-${region.replace(/\s/g, '-')}`;
        const clientsInRegion = clientsByRegion[region];
        const clientsHtml = clientsInRegion.map(client => `
            <div class="form-check planner-client-item">
                <input type="checkbox" class="form-check-input planner-client-checkbox" id="client-${client.id}" data-client-id="${client.id}" data-region="${region}">
                <label class="form-check-label" for="client-${client.id}">${client.name} - ${client.branchName}</label>
            </div>
        `).join('');

        return `
            <div class="planner-region-group animate__animated animate__fadeIn">
                <div class="planner-region-header" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="true" aria-controls="${collapseId}">
                    <span><i class="fas fa-map-marked-alt me-2"></i> ${region} <span class="badge bg-secondary">${clientsInRegion.length}</span></span>
                    <div>
                        <button type="button" class="btn btn-sm btn-outline-primary select-all-clients-btn" data-region="${region}">تحديد الكل</button>
                        <i class="fas fa-chevron-down ms-2"></i>
                    </div>
                </div>
                <div class="collapse show" id="${collapseId}">
                    <div class="p-3 bg-light rounded">
                        ${clientsHtml}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    plannerClientListContainer.innerHTML = regionsHtml;

    // Add event listeners for "Select All" buttons
    document.querySelectorAll('.select-all-clients-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent the collapse from toggling
            const region = btn.dataset.region;
            document.querySelectorAll(`.planner-client-checkbox[data-region="${region}"]`).forEach(checkbox => {
                checkbox.checked = true;
            });
        });
    });
}

function renderDashboard() {
    const totalClientsCount = document.getElementById('totalClientsCount');
    const completedClientsCount = document.getElementById('completedClientsCount');
    const pendingClientsCount = document.getElementById('pendingClientsCount');

    totalClientsCount.textContent = clients.length;

    const completedCount = clients.filter(c => c.visits.length > 0).length;
    completedClientsCount.textContent = completedCount;

    const pendingCount = clients.length - completedCount;
    pendingClientsCount.textContent = pendingCount;

    const latestVisits = clients.flatMap(client =>
        client.visits.map(visit => ({
            ...visit,
            clientName: client.name,
            clientRegion: client.region
        }))
    ).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);

    if (latestVisits.length > 0) {
        latestVisitsList.innerHTML = latestVisits.map(visit => `
            <li class="list-group-item visit-item ${visit.type}">
                <strong>${visit.clientName}</strong> - ${visit.notes}
                <span class="text-muted float-start">${new Date(visit.date).toLocaleDateString('ar-EG')}</span>
            </li>
        `).join('');
    } else {
        latestVisitsList.innerHTML = `<li class="list-group-item text-center text-muted">لا توجد زيارات حديثة.</li>`;
    }

    renderCharts();
}

function renderClients(filteredClients = clients) {
    clientsList.innerHTML = '';
    if (filteredClients.length === 0) {
        clientsList.innerHTML = `<div class="col-12"><div class="alert alert-info text-center animate__animated animate__fadeIn">لا يوجد عملاء لعرضهم.</div></div>`;
        return;
    }

    const clientsByRegion = filteredClients.reduce((acc, client) => {
        const region = client.region || 'غير محددة';
        if (!acc[region]) {
            acc[region] = [];
        }
        acc[region].push(client);
        return acc;
    }, {});

    const regionsHtml = Object.keys(clientsByRegion).map(region => {
        const collapseId = `collapse-${region.replace(/\s/g, '-')}`;
        const clientsInRegion = clientsByRegion[region];
        const clientsHtml = clientsInRegion.map(client => {
            const isCompleted = client.visits.length > 0;
            const statusText = isCompleted ? 'مكتملة' : 'معلقة';

            return `
                <div class="col-md-6 mb-3 animate__animated animate__fadeIn">
                    <div class="client-item-card card h-100" data-client-id="${client.id}">
                        <div class="card-body">
                            <h6 class="card-title">${client.name} - ${client.branchName}</h6>
                            <p class="card-text mb-1"><i class="fas fa-map-marker-alt me-1"></i> ${client.address}</p>
                            <small class="text-muted"><i class="fas fa-check-circle me-1"></i> حالة الزيارة: ${statusText}</small>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="col-12 mb-5">
                <div class="card">
                    <div class="region-card-header" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="true" aria-controls="${collapseId}">
                        <h4><i class="fas fa-map-marked-alt me-2"></i> ${region} <span class="badge bg-secondary">${clientsInRegion.length}</span></h4>
                        <i class="fas fa-chevron-down"></i>
                    </div>
                    <div class="collapse show" id="${collapseId}">
                        <div class="region-card-body row p-3">
                            ${clientsHtml}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    clientsList.innerHTML = regionsHtml;
}

function renderClientDetails(client) {
    document.getElementById('detailsClientName').textContent = client.name;
    document.getElementById('detailsBranchName').textContent = client.branchName;
    document.getElementById('detailsAddress').textContent = client.address;
    document.getElementById('detailsRegion').textContent = client.region;

    // Contact Info
    const detailsPhone = document.getElementById('detailsPhone');
    const detailsEmail = document.getElementById('detailsEmail');
    const phoneLink = document.getElementById('phoneLink');
    const emailLink = document.getElementById('emailLink');

    if (client.phone) {
        detailsPhone.textContent = client.phone;
        phoneLink.href = `tel:${client.phone}`;
        phoneLink.classList.remove('d-none');
    } else {
        detailsPhone.textContent = 'لا يوجد';
        phoneLink.classList.add('d-none');
    }

    if (client.email) {
        detailsEmail.textContent = client.email;
        emailLink.href = `mailto:${client.email}`;
        emailLink.classList.remove('d-none');
    } else {
        detailsEmail.textContent = 'لا يوجد';
        emailLink.classList.add('d-none');
    }

    // Map Link
    const mapLinkItem = document.getElementById('mapLinkItem');
    const detailsMapLink = document.getElementById('detailsMapLink');
    const mapsLink = createGoogleMapsLink(client.mapLink, client.address);
    if (mapsLink) {
        detailsMapLink.href = mapsLink;
        mapLinkItem.style.display = 'list-item';
    } else {
        mapLinkItem.style.display = 'none';
    }

    // Visit Summary
    const summaryTotalVisits = document.getElementById('summaryTotalVisits');
    const summaryLastVisit = document.getElementById('summaryLastVisit');
    const summaryVisitTypes = document.getElementById('summaryVisitTypes');

    summaryTotalVisits.textContent = client.visits.length;
    if (client.visits.length > 0) {
        const latestVisitDate = new Date(Math.max(...client.visits.map(v => new Date(v.date)))).toLocaleDateString('ar-EG');
        summaryLastVisit.textContent = latestVisitDate;

        const visitTypes = [...new Set(client.visits.map(v => v.type))].map(type => {
            if (type === 'support') return 'دعم فني';
            if (type === 'training') return 'تدريب';
            if (type === 'issue') return 'مشكلة';
            if (type === 'resolved') return 'تم حلها';
            return type;
        }).join(', ');
        summaryVisitTypes.textContent = visitTypes;
    } else {
        summaryLastVisit.textContent = 'لا توجد';
        summaryVisitTypes.textContent = 'لا توجد';
    }

    // Visit History
    const detailsVisitHistory = document.getElementById('detailsVisitHistory');
    if (client.visits.length > 0) {
        detailsVisitHistory.innerHTML = client.visits.map(visit => `
            <li class="list-group-item visit-item ${visit.type}">
                <strong>${visit.type === 'support' ? 'دعم فني' : visit.type === 'training' ? 'تدريب' : visit.type === 'issue' ? 'مشكلة' : 'تم حلها'}</strong> - ${visit.notes}
                <span class="text-muted float-start">${new Date(visit.date).toLocaleDateString('ar-EG')}</span>
            </li>
        `).join('');
    } else {
        detailsVisitHistory.innerHTML = `<li class="list-group-item text-center text-muted">لا توجد زيارات سابقة.</li>`;
    }

    document.getElementById('addVisitClientId').value = client.id;
    document.getElementById('addVisitClientName').textContent = client.name;

    // Set data-id for modal buttons
    document.getElementById('editClientBtnModal').dataset.id = client.id;
    document.getElementById('deleteClientBtnModal').dataset.id = client.id;
}

function setupPageNavigation() {
    document.querySelectorAll('.navbar-nav .nav-link').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            document.querySelectorAll('.page-content').forEach(page => page.classList.remove('active'));
            document.querySelectorAll('.navbar-nav .nav-link').forEach(nav => nav.classList.remove('active'));

            const targetPage = this.dataset.page;
            document.getElementById(`${targetPage}-page`).classList.add('active');
            this.classList.add('active');

            activePage = targetPage;
            document.getElementById('page-title').textContent = this.textContent;

            if (targetPage === 'dashboard') {
                 renderDashboard();
            } else if (targetPage === 'clients') {
                renderClients();
            } else if (targetPage === 'visits-planner') {
                renderPlannerClients($(plannerRegionSelect).val());
            }

            // Collapse the navbar on mobile after a link is clicked
            const navbarCollapse = document.getElementById('navbarNavDropdown');
            const bsCollapse = bootstrap.Collapse.getInstance(navbarCollapse);
            if (bsCollapse) {
                bsCollapse.hide();
            }
        });
    });
    document.getElementById('page-title').textContent = 'اللوحة الرئيسية';
}

function showLoading(message) {
    loadingMessage.textContent = message;
    loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    loadingOverlay.classList.add('hidden');
}

function normalizeText(text) {
    if (!text) return '';
    return text.toString().trim()
        .replace(/[أإآ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

// Updated function to create a Google Maps URL that works with both browser and app
function createGoogleMapsLink(mapLink, address) {
    if (mapLink && mapLink.startsWith('http')) {
        return mapLink;
    }
    if (address) {
        return `https://www.google.com/maps/dir/?api=1&q=${encodeURIComponent(address)}`;
    }
    return null;
}

function renderReport() {
    const reportTableBody = document.getElementById('report-table-body');
    const reportPeriod = document.getElementById('report-period').value;
    const startDateInput = document.getElementById('start-date');
    const endDateInput = document.getElementById('end-date');
    const reportClientFilter = $('#report-client-filter').val();
    const reportRegionFilter = $('#report-region-filter').val();
    const reportTypeFilter = $('#report-type-filter').val();

    let filteredVisits = clients.flatMap(client =>
        client.visits.map(visit => ({ ...visit, clientName: client.name, clientRegion: client.region }))
    );

    const today = new Date();
    let dateFilter;
    if (reportPeriod === 'weekly') {
        const oneWeekAgo = new Date(today);
        oneWeekAgo.setDate(today.getDate() - 7);
        dateFilter = v => new Date(v.date) >= oneWeekAgo;
    } else if (reportPeriod === 'monthly') {
        const oneMonthAgo = new Date(today);
        oneMonthAgo.setMonth(today.getMonth() - 1);
        dateFilter = v => new Date(v.date) >= oneMonthAgo;
    } else if (reportPeriod === 'custom') {
        const startDate = startDateInput.value ? new Date(startDateInput.value) : null;
        const endDate = endDateInput.value ? new Date(endDateInput.value) : null;
        dateFilter = v => (!startDate || new Date(v.date) >= startDate) && (!endDate || new Date(v.date) <= endDate);
    } else {
        dateFilter = v => true;
    }

    filteredVisits = filteredVisits.filter(dateFilter);

    if (reportClientFilter && reportClientFilter.length > 0) {
        filteredVisits = filteredVisits.filter(v => v.clientName === reportClientFilter);
    }

    if (reportRegionFilter && reportRegionFilter.length > 0) {
        filteredVisits = filteredVisits.filter(v => reportRegionFilter.includes(v.clientRegion));
    }

    if (reportTypeFilter && reportTypeFilter.length > 0) {
        filteredVisits = filteredVisits.filter(v => reportTypeFilter.includes(v.type));
    }

    reportTableBody.innerHTML = '';
    if (filteredVisits.length > 0) {
        const visitsHtml = filteredVisits.map(visit => `
            <tr>
                <td>${visit.clientName}</td>
                <td>${visit.clientRegion}</td>
                <td>${new Date(visit.date).toLocaleDateString('ar-EG')}</td>
                <td>${visit.type === 'support' ? 'دعم فني' : visit.type === 'training' ? 'تدريب' : visit.type === 'issue' ? 'مشكلة' : 'تم حلها'}</td>
                <td>${visit.notes}</td>
            </tr>
        `).join('');
        reportTableBody.innerHTML = visitsHtml;
    } else {
        reportTableBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">لا يوجد تقرير لعرضه.</td></tr>`;
    }

}

function renderCharts() {
    renderRegionsChart();
    renderStatusChart();
}

function renderRegionsChart() {
    const ctx = document.getElementById('regionsChart').getContext('2d');
    const regionCounts = clients.reduce((acc, client) => {
        const region = client.region || 'غير محددة';
        acc[region] = (acc[region] || 0) + 1;
        return acc;
    }, {});

    const labels = Object.keys(regionCounts);
    const data = Object.values(regionCounts);

    if (regionsChart) regionsChart.destroy();
    regionsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'عدد العملاء',
                data: data,
                backgroundColor: ['#0d6efd', '#198754', '#ffc107', '#dc3545', '#6c757d'],
                borderColor: ['#0d6efd', '#198754', '#ffc107', '#dc3545', '#6c757d'],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

function renderStatusChart() {
    const ctx = document.getElementById('statusChart').getContext('2d');
    const completedCount = clients.filter(c => c.visits.length > 0).length;
    const pendingCount = clients.length - completedCount;

    if (statusChart) statusChart.destroy();
    statusChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['مكتملة', 'معلقة'],
            datasets: [{
                data: [completedCount, pendingCount],
                backgroundColor: ['#198754', '#ffc107'],
            }]
        },
        options: {
            responsive: true,
        }
    });
}

function setupTippy() {
    tippy('[data-tippy-content]', {
        placement: 'bottom',
        theme: 'light-border',
        arrow: true,
        animation: 'fade',
    });
}

function setupEventListeners() {
    addClientBtn.addEventListener('click', async () => {
        const name = clientNameInput.value.trim();
        const branch = branchNameInput.value.trim();
        const address = clientAddressInput.value.trim();
        const region = clientRegionSelect.value;
        const mapLink = clientMapLinkInput.value.trim();
        const phone = clientPhoneInput.value.trim();
        const email = clientEmailInput.value.trim();

        if (!name || !branch || !address || !region) {
            showToast('يرجى ملء جميع الحقول المطلوبة.', 'warning', 'fas fa-exclamation-triangle');
            return;
        }

        const isDuplicate = clients.some(c => normalizeText(c.name) === normalizeText(name) && normalizeText(c.branchName) === normalizeText(branch));
        if (isDuplicate) {
            showToast('هذا العميل موجود بالفعل. يرجى إدخال عميل فريد.', 'danger', 'fas fa-times-circle');
            return;
        }

        const newClient = {
            id: Date.now(),
            name: name,
            branchName: branch,
            address: address,
            region: region,
            mapLink: mapLink,
            phone: phone,
            email: email,
            visits: []
        };

        clients.push(newClient);
        saveClients();
        renderClients();
        renderDashboard();
        renderRegions();
        showToast('تم إضافة العميل بنجاح!', 'success', 'fas fa-check-circle');
        clientNameInput.value = '';
        branchNameInput.value = '';
        clientAddressInput.value = '';
        clientRegionSelect.value = '';
        $(clientRegionSelect).selectpicker('refresh');
        clientMapLinkInput.value = '';
        clientPhoneInput.value = '';
        clientEmailInput.value = '';
    });

    $('#planner-region-select').on('changed.bs.select', () => {
        const selectedRegions = $(plannerRegionSelect).val();
        renderPlannerClients(selectedRegions);
    });

    document.getElementById('generateLinksBtn').addEventListener('click', () => {
        const selectedClientIds = Array.from(document.querySelectorAll('.planner-client-checkbox:checked')).map(cb => cb.dataset.clientId);
        const container = document.getElementById('generatedLinksContainer');
        container.innerHTML = '';

        if (!selectedClientIds || selectedClientIds.length === 0) {
            showToast('يرجى اختيار عميل واحد على الأقل.', 'warning', 'fas fa-exclamation-triangle');
            return;
        }

        const selectedClients = selectedClientIds.map(id => clients.find(c => c.id == id));

        const linksHTML = selectedClients.map(client => {
            const mapsLink = createGoogleMapsLink(client.mapLink, client.address);
            if (mapsLink) {
                return `
                    <div class="alert alert-info d-flex justify-content-between align-items-center animate__animated animate__fadeIn">
                        <span><i class="fas fa-user-circle me-2"></i> ${client.name} - ${client.branchName}</span>
                        <a href="${mapsLink}" target="_blank" class="btn btn-sm btn-primary"><i class="fas fa-location-arrow"></i> فتح في جوجل ماب</a>
                    </div>
                `;
            }
            return '';
        }).join('');

        if (linksHTML) {
            container.innerHTML = linksHTML;
            showToast('تم إنشاء روابط جوجل ماب للعملاء المختارين.', 'success', 'fas fa-link');
        } else {
            showToast('لا يمكن إنشاء روابط لعملاء لا يوجد لديهم معلومات موقع.', 'danger', 'fas fa-times-circle');
        }
    });

    document.getElementById('generateMultiRouteBtn').addEventListener('click', () => {
        const selectedClientIds = Array.from(document.querySelectorAll('.planner-client-checkbox:checked')).map(cb => cb.dataset.clientId);
        if (!selectedClientIds || selectedClientIds.length === 0) {
            showToast('يرجى اختيار عميل واحد على الأقل.', 'warning', 'fas fa-exclamation-triangle');
            return;
        }

        const selectedClients = selectedClientIds.map(id => clients.find(c => c.id == id));
        const validDestinations = selectedClients.filter(c => c.address || c.mapLink);

        if (validDestinations.length < 2) {
            showToast('يتطلب المسار المجمع عميلين على الأقل لديهم عنوان.', 'danger', 'fas fa-times-circle');
            return;
        }

        const mapsUrl = generateOptimizedMapsLink(validDestinations);

        window.open(mapsUrl, '_blank');
        showToast('تم فتح رابط المسار المجمع في علامة تبويب جديدة.', 'success', 'fas fa-route');
    });

    clientsList.addEventListener('click', (event) => {
        const target = event.target.closest('.client-item-card');
        if (!target) return;

        const clientId = target.dataset.clientId;
        const client = clients.find(c => c.id == clientId);
        if (!client) {
            showToast('خطأ: لم يتم العثور على بيانات العميل.', 'danger', 'fas fa-exclamation-circle');
            return;
        }

        renderClientDetails(client);
        clientDetailsModal.show();
    });

    document.getElementById('editClientBtnModal').addEventListener('click', () => {
        const clientId = document.getElementById('editClientBtnModal').dataset.id;
        const client = clients.find(c => c.id == clientId);

        if (client) {
            document.getElementById('editClientId').value = client.id;
            document.getElementById('editClientName').value = client.name;
            document.getElementById('editBranchName').value = client.branchName;
            document.getElementById('editClientAddress').value = client.address;
            document.getElementById('editClientMapLink').value = client.mapLink;
            document.getElementById('editClientPhone').value = client.phone;
            document.getElementById('editClientEmail').value = client.email;

            const editClientRegionSelect = document.getElementById('editClientRegion');
            editClientRegionSelect.value = client.region;
            $(editClientRegionSelect).selectpicker('refresh');

            clientDetailsModal.hide();
            editClientModal.show();
        }
    });

    document.getElementById('deleteClientBtnModal').addEventListener('click', () => {
        const clientId = document.getElementById('deleteClientBtnModal').dataset.id;
        const client = clients.find(c => c.id == clientId);

        Swal.fire({
            title: 'هل أنت متأكد؟',
            text: `سيتم حذف العميل "${client.name}" بشكل دائم.`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#dc3545',
            cancelButtonColor: '#6c757d',
            confirmButtonText: 'نعم، احذفه!',
            cancelButtonText: 'إلغاء'
        }).then((result) => {
            if (result.isConfirmed) {
                clients = clients.filter(c => c.id !== client.id);
                saveClients();
                renderClients();
                renderDashboard();
                renderRegions();
                clientDetailsModal.hide();
                showToast('تم حذف العميل بنجاح.', 'success', 'fas fa-trash-alt');
            }
        });
    });

    document.getElementById('updateClientBtn').addEventListener('click', async () => {
        const id = document.getElementById('editClientId').value;
        const name = document.getElementById('editClientName').value.trim();
        const branch = document.getElementById('editBranchName').value.trim();
        const address = document.getElementById('editClientAddress').value.trim();
        const region = document.getElementById('editClientRegion').value;
        const mapLink = document.getElementById('editClientMapLink').value.trim();
        const phone = document.getElementById('editClientPhone').value.trim();
        const email = document.getElementById('editClientEmail').value.trim();

        if (!name || !branch || !address || !region) {
            showToast('يرجى ملء جميع الحقول المطلوبة.', 'warning', 'fas fa-exclamation-triangle');
            return;
        }

        showLoading('جاري تحديث بيانات العميل...');
        try {
            const client = clients.find(c => c.id == id);
            if (client) {
                client.name = name;
                client.branchName = branch;
                client.address = address;
                client.region = region;
                client.mapLink = mapLink;
                client.phone = phone;
                client.email = email;
                saveClients();
                renderClients();
                renderDashboard();
                renderRegions();
                editClientModal.hide();
                showToast('تم تحديث بيانات العميل بنجاح!', 'success', 'fas fa-check-circle');
            }
        } catch (error) {
            showToast(`خطأ في تحديث البيانات: ${error.message}`, 'danger', 'fas fa-times-circle');
        } finally {
            hideLoading();
        }
    });

    document.getElementById('saveVisitBtn').addEventListener('click', () => {
        const clientId = document.getElementById('addVisitClientId').value;
        const date = document.getElementById('visitDate').value;
        const type = document.getElementById('visitType').value;
        const notes = document.getElementById('visitNotes').value.trim();

        if (!date || !type) {
            showToast('يرجى ملء تاريخ ونوع الزيارة.', 'warning', 'fas fa-exclamation-triangle');
            return;
        }

        const client = clients.find(c => c.id == clientId);
        if (client) {
            client.visits.push({
                id: Date.now(),
                date,
                type,
                notes
            });
            saveClients();
            renderClientDetails(client);
            renderClients();
            renderDashboard();
            addVisitModal.hide();
            showToast('تم إضافة الزيارة بنجاح!', 'success', 'fas fa-check-circle');
        }
    });

    importExcelBtn.addEventListener('click', async () => {
        const file = excelFileInput.files[0];
        if (!file) {
            showToast('يرجى اختيار ملف Excel أولاً.', 'warning', 'fas fa-exclamation-triangle');
            return;
        }

        showLoading('يتم استيراد البيانات من ملف Excel...');
        try {
            const data = await readExcelFile(file);
            await processExcelData(data);
            showToast('تم استيراد البيانات بنجاح!', 'success', 'fas fa-file-import');
            saveClients();
            renderClients();
            renderDashboard();
            renderRegions();
            excelFileInput.value = '';
        } catch (error) {
            showToast(`حدث خطأ أثناء استيراد البيانات: ${error.message}`, 'danger', 'fas fa-times-circle');
            console.error(error);
        } finally {
            hideLoading();
        }
    });

    async function processExcelData(data) {
        if (!data || data.length < 2) {
            throw new Error('الملف فارغ أو لا يحتوي على رؤوس أعمدة.');
        }

        const header = data[0].map(h => h ? h.toString().trim() : '');

        const nameIndex = header.indexOf('اسم العميل');
        const branchIndex = header.indexOf('اسم الفرع');
        const addressIndex = header.indexOf('العنوان');
        const regionIndex = header.indexOf('المنطقة');
        const mapLinkIndex = header.indexOf('رابط الخريطة');
        const phoneIndex = header.indexOf('رقم الهاتف');
        const emailIndex = header.indexOf('البريد الإلكتروني');

        const requiredColumns = ['اسم العميل', 'اسم الفرع', 'العنوان', 'المنطقة'];
        const missingColumns = requiredColumns.filter(col => header.indexOf(col) === -1);

        if (missingColumns.length > 0) {
            throw new Error(`الملف يجب أن يحتوي على الأعمدة التالية: ${missingColumns.join(', ')}.`);
        }

        const newClients = [];
        let ignoredCount = 0;
        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (!row[nameIndex] || !row[branchIndex] || !row[addressIndex] || !row[regionIndex]) {
                 ignoredCount++;
                 continue; // Skip rows with missing required data
            }

            const name = row[nameIndex].toString().trim();
            const branch = row[branchIndex].toString().trim();
            const address = row[addressIndex].toString().trim();
            const region = row[regionIndex].toString().trim();
            const mapLink = mapLinkIndex !== -1 && row[mapLinkIndex] ? row[mapLinkIndex].toString().trim() : '';
            const phone = phoneIndex !== -1 && row[phoneIndex] ? row[phoneIndex].toString().trim() : '';
            const email = emailIndex !== -1 && row[emailIndex] ? row[emailIndex].toString().trim() : '';

            const isDuplicate = clients.some(c => normalizeText(c.name) === normalizeText(name) && normalizeText(c.branchName) === normalizeText(branch));
            if (isDuplicate) {
                ignoredCount++;
                continue;
            }

            const newClient = {
                id: Date.now() + i,
                name,
                branchName: branch,
                address,
                region,
                mapLink,
                phone,
                email,
                visits: []
            };
            newClients.push(newClient);
        }

        if (ignoredCount > 0) {
            showToast(`تم تجاهل ${ignoredCount} صفًا إما لوجود بيانات ناقصة أو لوجود عميل مكرر.`, 'warning', 'fas fa-exclamation-triangle', 5000);
        }

        clients = [...clients, ...newClients];
    }

    exportExcelBtn.addEventListener('click', exportDataToExcel);

    clearAllDataBtn.addEventListener('click', () => {
        Swal.fire({
            title: 'هل أنت متأكد؟',
            text: "سيتم حذف جميع بيانات العملاء والزيارات بشكل دائم. لا يمكن التراجع عن هذا الإجراء!",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#dc3545',
            cancelButtonColor: '#6c757d',
            confirmButtonText: 'نعم، احذف كل شيء!',
            cancelButtonText: 'إلغاء'
        }).then((result) => {
            if (result.isConfirmed) {
                clients = [];
                saveClients();
                renderClients();
                renderDashboard();
                renderRegions();
                showToast('تم مسح جميع البيانات بنجاح.', 'success', 'fas fa-trash-alt');
            }
        });
    });

    // Handlers for search and filter
    $('#region-filter').on('changed.bs.select', filterAndRenderClients);
    searchClientInput.addEventListener('input', filterAndRenderClients);
    // document.getElementById('searchClientBtn').addEventListener('click', filterAndRenderClients); // Removed as search is now instant

    function filterAndRenderClients() {
        const selectedRegions = $('#region-filter').val();
        const searchTerm = searchClientInput.value.trim().toLowerCase();
        let filtered = clients;
        if (selectedRegions && selectedRegions.length > 0) {
            filtered = filtered.filter(client => selectedRegions.includes(client.region));
        }
        if (searchTerm) {
            filtered = filtered.filter(client =>
                normalizeText(client.name).includes(normalizeText(searchTerm)) ||
                normalizeText(client.branchName).includes(normalizeText(searchTerm)) ||
                normalizeText(client.address).includes(normalizeText(searchTerm))
            );
        }
        renderClients(filtered);
    }

    // Report page filters
    $('#report-period, #report-client-filter, #report-region-filter, #report-type-filter').on('change', () => {
        const customDateFields = document.getElementById('custom-date-fields');
        if (document.getElementById('report-period').value === 'custom') {
            customDateFields.style.display = 'flex';
        } else {
            customDateFields.style.display = 'none';
        }
        renderReport();
    });
    document.getElementById('exportReportBtn').addEventListener('click', exportReportToExcel);
}

async function readExcelFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            resolve(jsonData);
        };
        reader.onerror = (error) => reject(error);
        reader.readAsArrayBuffer(file);
    });
}

function exportReportToExcel() {
    const table = document.getElementById('report-output').querySelector('table');
    const ws = XLSX.utils.table_to_sheet(table);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "التقرير");
    XLSX.writeFile(wb, "تقرير_الزيارات.xlsx");
}

function exportDataToExcel() {
    const dataToExport = clients.map(client => ({
        'اسم العميل': client.name,
        'اسم الفرع': client.branchName,
        'العنوان': client.address,
        'المنطقة': client.region,
        'رابط الخريطة': client.mapLink,
        'رقم الهاتف': client.phone,
        'البريد الإلكتروني': client.email,
        'تاريخ آخر زيارة': client.visits.length > 0 ? new Date(Math.max(...client.visits.map(v => new Date(v.date)))).toLocaleDateString('ar-EG') : 'لا يوجد'
    }));
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "بيانات_العملاء");
    XLSX.writeFile(wb, "بيانات_العملاء.xlsx");
}

// Updated function to generate the optimized multi-stop Maps link
function generateOptimizedMapsLink(clients) {
    const baseMapsUrl = 'https://www.google.com/maps/dir/?api=1';
    let waypoints = '';

    // The first client is the destination. The rest are waypoints.
    // This is a simple logic, Google Maps will optimize the route automatically.
    const destinationClient = clients[0];
    const destinations = clients.slice(1);

    const destination = encodeURIComponent(destinationClient.mapLink || destinationClient.address);

    if (destinations.length > 0) {
        waypoints = `&waypoints=${destinations.map(client => encodeURIComponent(client.mapLink || client.address)).join('|')}`;
    }

    return `${baseMapsUrl}&destination=${destination}${waypoints}`;
}


function showToast(message, type = 'info', icon = '', duration = 3000) {
    Toastify({
        text: `<i class="${icon} me-2"></i> ${message}`,
        duration: duration,
        gravity: "top",
        position: "right",
        className: `toastify-alert-${type}`,
        close: true
    }).showToast();
}

function setupDarkMode() {
    const darkModeSwitchDesktop = document.getElementById('darkModeSwitchDesktop');
    const darkModeSwitchMobile = document.getElementById('darkModeSwitchMobile');
    const isDarkMode = localStorage.getItem('darkMode') === 'enabled';

    if (isDarkMode) {
        document.body.classList.add('dark-mode');
        darkModeSwitchDesktop.checked = true;
        darkModeSwitchMobile.checked = true;
    }

    const handleSwitchChange = (event) => {
        if (event.target.checked) {
            document.body.classList.add('dark-mode');
            localStorage.setItem('darkMode', 'enabled');
        } else {
            document.body.classList.remove('dark-mode');
            localStorage.setItem('darkMode', 'disabled');
        }
        darkModeSwitchDesktop.checked = event.target.checked;
        darkModeSwitchMobile.checked = event.target.checked;
    };

    darkModeSwitchDesktop.addEventListener('change', handleSwitchChange);
    darkModeSwitchMobile.addEventListener('change', handleSwitchChange);
}