/**
 * SP Bus Tracker - Aplicação Principal
 * Rastreamento de ônibus do estado de São Paulo via API Olho Vivo (SPTrans)
 */

class BusTracker {
    constructor() {
        // Estado da aplicação
        this.state = {
            selectedLine: null,
            vehicles: [],
            stops: [],
            shapes: [],
            filterDirection: 0, // 0 = todos, 1 = ida, 2 = volta
            isUpdating: false,
            updateInterval: null,
            searchDebounce: null
        };

        // Referências de camadas do mapa
        this.layers = {
            vehicles: new L.LayerGroup(),
            stops: new L.LayerGroup(),
            routes: new L.LayerGroup()
        };

        this.init();
    }

    init() {
        this.initMap();
        this.initEventListeners();
        this.checkConnection();
    }

    // ========================================
    // Mapa
    // ========================================

    initMap() {
        // Coordenadas aproximadas do centro de São Paulo
        const saoPauloCoords = [-23.55052, -46.633308];

        this.map = L.map('map', {
            center: saoPauloCoords,
            zoom: 12,
            zoomControl: true,
            attributionControl: false
        });

        // Tile layer escuro (CartoDB Dark Matter)
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 19,
            subdomains: 'abcd'
        }).addTo(this.map);

        // Adicionar grupos de camadas
        Object.values(this.layers).forEach(layer => layer.addTo(this.map));

        // Adicionar atribuição customizada
        L.control.attribution({ prefix: false }).addAttribution(
            '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> | &copy; <a href="https://carto.com/">CARTO</a>'
        ).addTo(this.map);
    }

    // ========================================
    // Event Listeners
    // ========================================

    initEventListeners() {
        const searchInput = document.getElementById('searchInput');
        const clearSearch = document.getElementById('clearSearch');
        const closeLine = document.getElementById('closeLine');
        const toggleSidebar = document.getElementById('toggleSidebar');
        const btnLocate = document.getElementById('btnLocate');
        const btnRefresh = document.getElementById('btnRefresh');
        const btnLayer = document.getElementById('btnLayer');
        const btnDirections = document.querySelectorAll('.btn-direction');
        const modal = document.getElementById('predictionModal');
        const closeModal = document.querySelector('.btn-close-modal');

        // Busca com debounce
        searchInput.addEventListener('input', (e) => {
            clearTimeout(this.state.searchDebounce);
            const value = e.target.value.trim();

            clearSearch.classList.toggle('hidden', value.length === 0);

            if (value.length >= 3) {
                this.state.searchDebounce = setTimeout(() => this.searchLines(value), 400);
            } else {
                this.hideSearchResults();
            }
        });

        // Limpar busca
        clearSearch.addEventListener('click', () => {
            searchInput.value = '';
            clearSearch.classList.add('hidden');
            this.hideSearchResults();
            searchInput.focus();
        });

        // Fechar linha selecionada
        closeLine.addEventListener('click', () => this.clearSelection());

        // Toggle sidebar (desktop)
        toggleSidebar.addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('collapsed');
        });

        // Localização do usuário
        btnLocate.addEventListener('click', () => this.locateUser());

        // Atualizar manualmente
        btnRefresh.addEventListener('click', () => {
            if (this.state.selectedLine) {
                this.refreshPositions();
            }
        });

        // Toggle legenda
        btnLayer.addEventListener('click', () => {
            const legend = document.getElementById('legend');
            legend.classList.toggle('hidden');
            btnLayer.classList.toggle('active');
        });

        // Filtros de direção
        btnDirections.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const dir = parseInt(e.currentTarget.dataset.dir);
                this.setDirectionFilter(dir);

                btnDirections.forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
            });
        });

        // Fechar modal
        closeModal.addEventListener('click', () => modal.classList.add('hidden'));
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.add('hidden');
        });

        // Detectar mobile para sidebar
        if (window.innerWidth <= 768) {
            this.initMobileSidebar();
        }
        window.addEventListener('resize', () => {
            if (window.innerWidth <= 768) {
                this.initMobileSidebar();
            }
        });
    }

    initMobileSidebar() {
        const sidebar = document.getElementById('sidebar');
        // Criar botão de menu mobile se não existir
        if (!document.getElementById('mobileMenuBtn')) {
            const btn = document.createElement('button');
            btn.id = 'mobileMenuBtn';
            btn.className = 'map-btn';
            btn.style.cssText = 'position:absolute;top:10px;left:10px;z-index:500;';
            btn.innerHTML = '<i class="fas fa-bars"></i>';
            btn.addEventListener('click', () => sidebar.classList.toggle('open'));
            document.getElementById('mapContainer').appendChild(btn);
        }
    }

    // ========================================
    // API Calls
    // ========================================

    async apiRequest(endpoint) {
        try {
            const response = await fetch(endpoint);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error('API Error:', error);
            this.setStatus('offline', 'Erro de conexão');
            throw error;
        }
    }

    async searchLines(term) {
        try {
            this.setStatus('updating', 'Buscando...');
            const results = await this.apiRequest(`/api/linhas?q=${encodeURIComponent(term)}`);
            this.renderSearchResults(results || []);
            this.setStatus('online', 'Conectado');
        } catch (error) {
            this.renderSearchResults([]);
        }
    }

    async selectLine(line) {
        this.showLoading(true);
        this.clearSelection(false);

        this.state.selectedLine = line;

        // Atualizar UI
        document.getElementById('lineNumber').textContent = line.lt;
        document.getElementById('lineDirection').textContent = line.tl === 10 ? 'Circular' : (line.sl === 1 ? 'Ida' : 'Volta');
        document.getElementById('lineName').textContent = line.tp;

        this.showElement('lineInfo', true);
        this.showElement('emptyState', false);

        // Carregar dados em paralelo
        await Promise.all([
            this.loadLineShapes(line.cl),
            this.loadLineStops(line.cl),
            this.loadLinePositions(line.cl)
        ]);

        // Iniciar polling
        this.startPolling();

        // Ajustar mapa para os veículos
        this.fitMapToBounds();

        this.showLoading(false);
        this.setStatus('online', 'Conectado');
    }

    async loadLineShapes(codigoLinha) {
        try {
            const shapes = await this.apiRequest(`/api/shape/${codigoLinha}`);
            this.state.shapes = Array.isArray(shapes) ? shapes : [];
            this.renderShapes();
        } catch (error) {
            this.state.shapes = [];
        }
    }

    async loadLineStops(codigoLinha) {
        try {
            const stops = await this.apiRequest(`/api/paradasPorLinha/${codigoLinha}`);
            this.state.stops = Array.isArray(stops) ? stops : [];
            this.renderStops();
        } catch (error) {
            this.state.stops = [];
        }
    }

    async loadLinePositions(codigoLinha) {
        try {
            const data = await this.apiRequest(`/api/posicao/${codigoLinha}`);
            this.state.vehicles = (data && data.vs) ? data.vs : [];
            this.renderVehicles();
            this.updateVehicleCount();
        } catch (error) {
            this.state.vehicles = [];
        }
    }

    async refreshPositions() {
        if (!this.state.selectedLine || this.state.isUpdating) return;

        this.state.isUpdating = true;
        this.setStatus('updating', 'Atualizando...');

        try {
            await this.loadLinePositions(this.state.selectedLine.cl);
            this.setStatus('online', 'Conectado');
        } catch (error) {
            // Erro já tratado
        } finally {
            this.state.isUpdating = false;
        }
    }

    async loadPrediction(codigoParada, codigoLinha) {
        try {
            const data = await this.apiRequest(`/api/previsao/${codigoParada}/${codigoLinha}`);
            this.renderPrediction(data);
        } catch (error) {
            this.showPredictionError();
        }
    }

    // ========================================
    // Renderização
    // ========================================

    renderSearchResults(results) {
        const container = document.getElementById('searchResults');

        if (results.length === 0) {
            container.innerHTML = '<div class="search-result-item"><span class="result-line-info"><span class="result-line-name">Nenhuma linha encontrada</span></span></div>';
            container.classList.add('active');
            return;
        }

        container.innerHTML = results.map(line => `
            <div class="search-result-item" data-codigo="${line.cl}">
                <span class="result-line-number">${line.lt}</span>
                <div class="result-line-info">
                    <div class="result-line-name">${line.tp}</div>
                    <div class="result-line-route">${line.ts}</div>
                </div>
            </div>
        `).join('');

        // Eventos de clique
        container.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', () => {
                const codigo = parseInt(item.dataset.codigo);
                const line = results.find(r => r.cl === codigo);
                if (line) this.selectLine(line);
                this.hideSearchResults();
            });
        });

        container.classList.add('active');
    }

    hideSearchResults() {
        document.getElementById('searchResults').classList.remove('active');
    }

    renderShapes() {
        this.layers.routes.clearLayers();

        this.state.shapes.forEach(shape => {
            if (!shape.shp || shape.shp.length < 2) return;

            const latlngs = shape.shp.map(point => [point.lat, point.lng]);
            const isIda = shape.sentido === 1;

            const polyline = L.polyline(latlngs, {
                color: isIda ? '#10b981' : '#f59e0b',
                weight: 4,
                opacity: 0.85,
                lineCap: 'round',
                lineJoin: 'round',
                dashArray: isIda ? null : '8, 6'
            });

            polyline.addTo(this.layers.routes);
        });
    }

    renderStops() {
        this.layers.stops.clearLayers();

        const filteredStops = this.getFilteredStops();
        if (filteredStops.length === 0) {
            this.showElement('stopsList', false);
            return;
        }

        const container = document.getElementById('stopsContainer');
        container.innerHTML = '';

        filteredStops.forEach(stop => {
            // Marcador no mapa
            const marker = L.marker([stop.py, stop.px], {
                icon: L.divIcon({
                    className: 'custom-stop-icon',
                    html: '<div class="stop-marker"></div>',
                    iconSize: [14, 14],
                    iconAnchor: [7, 14]
                })
            });

            marker.bindPopup(`
                <strong>${stop.np}</strong><br>
                <small>${stop.ed || ''}</small>
            `);

            marker.on('click', () => {
                if (this.state.selectedLine) {
                    this.loadPrediction(stop.cp, this.state.selectedLine.cl);
                }
            });

            marker.addTo(this.layers.stops);

            // Item na lista
            const item = document.createElement('div');
            item.className = 'stop-item';
            item.innerHTML = `
                <i class="fas fa-map-marker-alt" style="color: var(--danger);"></i>
                <div class="stop-info">
                    <div class="stop-name">${stop.np}</div>
                    <div class="stop-code">Parada ${stop.cp}</div>
                </div>
            `;
            item.addEventListener('click', () => {
                this.map.setView([stop.py, stop.px], 16);
                marker.openPopup();
                if (this.state.selectedLine) {
                    this.loadPrediction(stop.cp, this.state.selectedLine.cl);
                }
            });
            container.appendChild(item);
        });

        this.showElement('stopsList', true);
    }

    renderVehicles() {
        this.layers.vehicles.clearLayers();

        const filteredVehicles = this.getFilteredVehicles();
        if (filteredVehicles.length === 0) {
            this.showElement('vehiclesList', false);
            document.getElementById('vehicleCount').innerHTML = '<i class="fas fa-bus"></i> 0 ônibus';
            return;
        }

        const container = document.getElementById('vehiclesContainer');
        container.innerHTML = '';

        filteredVehicles.forEach(vehicle => {
            const isIda = vehicle.sl === 1;

            // Marcador no mapa
            const marker = L.marker([vehicle.py, vehicle.px], {
                icon: L.divIcon({
                    className: 'custom-bus-icon',
                    html: `<div class="bus-marker ${isIda ? 'ida' : 'volta'}">${vehicle.p}</div>`,
                    iconSize: [36, 36],
                    iconAnchor: [18, 18]
                }),
                rotationAngle: vehicle.a || 0
            });

            marker.bindPopup(`
                <strong>Ônibus ${vehicle.p}</strong><br>
                Sentido: ${isIda ? 'Ida' : 'Volta'}<br>
                <small>Atualizado: ${new Date().toLocaleTimeString()}</small>
            `);

            marker.addTo(this.layers.vehicles);

            // Item na lista
            const item = document.createElement('div');
            item.className = 'vehicle-item';
            item.innerHTML = `
                <div class="vehicle-icon ${isIda ? 'ida' : 'volta'}">${vehicle.p}</div>
                <div class="vehicle-info">
                    <div class="vehicle-plate">Prefixo ${vehicle.p}</div>
                    <div class="vehicle-status">${isIda ? 'Sentido Ida' : 'Sentido Volta'}</div>
                </div>
            `;
            item.addEventListener('click', () => {
                this.map.setView([vehicle.py, vehicle.px], 16);
                marker.openPopup();
            });
            container.appendChild(item);
        });

        this.showElement('vehiclesList', true);
        this.updateVehicleCount();
    }

    renderPrediction(data) {
        const modal = document.getElementById('predictionModal');
        const info = document.getElementById('predictionInfo');
        const list = document.getElementById('predictionList');

        if (!data || !data.p || !data.p.l) {
            this.showPredictionError();
            return;
        }

        const line = data.p.l[0];
        const stopName = data.p.np;

        info.innerHTML = `
            <p><strong>Parada:</strong> ${stopName}</p>
            <p><strong>Linha:</strong> ${line.c} - ${line.lt}</p>
        `;

        if (!line.vs || line.vs.length === 0) {
            list.innerHTML = '<div class="prediction-item"><span class="vehicle">Nenhum ônibus previsto</span></div>';
        } else {
            list.innerHTML = line.vs.map(v => {
                const minutes = Math.floor(v.t / 60);
                const seconds = v.t % 60;
                const timeText = minutes > 0 ? `${minutes} min ${seconds}s` : `${seconds}s`;
                const isClose = minutes === 0 && seconds < 60;

                return `
                    <div class="prediction-item">
                        <span class="vehicle">Ônibus ${v.p}</span>
                        <span class="time" style="color: ${isClose ? 'var(--danger)' : 'var(--accent)'}">${timeText}</span>
                    </div>
                `;
            }).join('');
        }

        modal.classList.remove('hidden');
    }

    showPredictionError() {
        const info = document.getElementById('predictionInfo');
        const list = document.getElementById('predictionList');
        info.innerHTML = '<p>Erro ao carregar previsão</p>';
        list.innerHTML = '';
        document.getElementById('predictionModal').classList.remove('hidden');
    }

    // ========================================
    // Filtros
    // ========================================

    setDirectionFilter(direction) {
        this.state.filterDirection = direction;
        this.renderVehicles();
        this.renderStops();
        this.renderShapes();
    }

    getFilteredVehicles() {
        if (this.state.filterDirection === 0) return this.state.vehicles;
        return this.state.vehicles.filter(v => v.sl === this.state.filterDirection);
    }

    getFilteredStops() {
        // A API não retorna sentido para paradas, então mostramos todas
        return this.state.stops;
    }

    // ========================================
    // Utilitários de UI
    // ========================================

    showElement(id, show) {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden', !show);
    }

    showLoading(show) {
        this.showElement('mapLoading', show);
    }

    updateVehicleCount() {
        const count = this.getFilteredVehicles().length;
        document.getElementById('vehicleCount').innerHTML = `<i class="fas fa-bus"></i> ${count} ônibus`;
        document.getElementById('lastUpdate').innerHTML = `<i class="fas fa-clock"></i> ${new Date().toLocaleTimeString()}`;
    }

    setStatus(type, text) {
        const dot = document.getElementById('connectionStatus');
        const label = document.getElementById('statusText');

        dot.className = 'status-dot ' + type;
        label.textContent = text;
    }

    async checkConnection() {
        try {
            await fetch('/api/posicao');
            this.setStatus('online', 'Conectado');
        } catch {
            this.setStatus('offline', 'Sem conexão');
        }
    }

    // ========================================
    // Mapa - Ajustes
    // ========================================

    fitMapToBounds() {
        const bounds = L.latLngBounds();

        this.state.vehicles.forEach(v => bounds.extend([v.py, v.px]));
        this.state.stops.forEach(s => bounds.extend([s.py, s.px]));
        this.state.shapes.forEach(shape => {
            shape.shp.forEach(p => bounds.extend([p.lat, p.lng]));
        });

        if (bounds.isValid()) {
            this.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
        }
    }

    locateUser() {
        if (!navigator.geolocation) {
            alert('Geolocalização não suportada pelo navegador');
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                this.map.setView([latitude, longitude], 15);

                L.marker([latitude, longitude], {
                    icon: L.divIcon({
                        className: 'user-location',
                        html: '<div style="width:16px;height:16px;background:#3b82f6;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>',
                        iconSize: [16, 16],
                        iconAnchor: [8, 8]
                    })
                }).addTo(this.map).bindPopup('Você está aqui').openPopup();
            },
            () => alert('Não foi possível obter sua localização')
        );
    }

    // ========================================
    // Polling
    // ========================================

    startPolling() {
        this.stopPolling();
        this.state.updateInterval = setInterval(() => {
            this.refreshPositions();
        }, 15000); // Atualiza a cada 15 segundos
    }

    stopPolling() {
        if (this.state.updateInterval) {
            clearInterval(this.state.updateInterval);
            this.state.updateInterval = null;
        }
    }

    // ========================================
    // Limpeza
    // ========================================

    clearSelection(resetUI = true) {
        this.stopPolling();

        this.state.selectedLine = null;
        this.state.vehicles = [];
        this.state.stops = [];
        this.state.shapes = [];
        this.state.filterDirection = 0;

        this.layers.vehicles.clearLayers();
        this.layers.stops.clearLayers();
        this.layers.routes.clearLayers();

        if (resetUI) {
            document.getElementById('searchInput').value = '';
            document.getElementById('clearSearch').classList.add('hidden');
            this.hideSearchResults();

            this.showElement('lineInfo', false);
            this.showElement('vehiclesList', false);
            this.showElement('stopsList', false);
            this.showElement('emptyState', true);

            // Resetar filtros
            document.querySelectorAll('.btn-direction').forEach((btn, i) => {
                btn.classList.toggle('active', i === 2); // "Todos" ativo
            });
        }
    }
}

// Inicializar aplicação quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    window.app = new BusTracker();
});

