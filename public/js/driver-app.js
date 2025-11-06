/**
 * Time Pulse AI - Driver Mobile App
 * Frontend JavaScript for delivery driver interface
 */

// Global state
let map;
let driverMarker;
let currentOrder = null;
let driverStatus = 'active';
let authToken = localStorage.getItem('driver_token');
let driverData = JSON.parse(localStorage.getItem('driver_data') || '{}');
let supabaseClient = null;
let ordersSubscription = null;
let availableOrders = [];
let currentDriverLocation = null; // Track driver's current location
let listLocationWatcher = null; // Track location updates for the orders list
let orderTimestamps = {}; // Track when each order first appeared on screen
let timerInterval = null; // Interval for updating timers

// Mapbox configuration
mapboxgl.accessToken = 'YOUR_MAPBOX_TOKEN'; // Will be loaded from server
let mapboxTokenLoaded = false;

// Promise to track Mapbox token loading
const mapboxTokenPromise = fetch('/api/config/mapbox')
    .then(res => res.json())
    .then(config => {
        if (config.accessToken) {
            mapboxgl.accessToken = config.accessToken;
            mapboxTokenLoaded = true;
            console.log('✅ Mapbox token loaded successfully');
            return config.accessToken;
        } else {
            console.error('❌ Mapbox token not found in config', config);
            throw new Error('Mapbox token not found');
        }
    })
    .catch(err => {
        console.error('❌ Failed to load Mapbox config:', err);
        throw err;
    });

// Initialize Supabase client
async function initializeSupabase() {
    try {
        const response = await fetch('/api/config/supabase');
        const config = await response.json();
        
        if (config.url && config.anonKey) {
            supabaseClient = supabase.createClient(config.url, config.anonKey);
            console.log('✅ Supabase client initialized');
            return true;
        }
    } catch (error) {
        console.error('❌ Failed to initialize Supabase:', error);
        return false;
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    // Check GPS permission first
    await checkGPSPermissionOnLoad();
    
    // Check if already logged in
    if (authToken && driverData.id) {
        await showDriverInterface();
    }
});

// GPS Permission Management
async function checkGPSPermissionOnLoad() {
    console.log('🔍 Verificando permissão GPS...');
    
    if (!('geolocation' in navigator)) {
        alert('Seu dispositivo não suporta geolocalização. Este app requer GPS para funcionar.');
        return;
    }
    
    try {
        // Check if Permissions API is available
        if ('permissions' in navigator) {
            const permissionStatus = await navigator.permissions.query({ name: 'geolocation' });
            
            console.log('📍 Status da permissão GPS:', permissionStatus.state);
            
            if (permissionStatus.state === 'granted') {
                console.log('✅ Permissão GPS concedida');
                hideGPSModal();
                return;
            } else if (permissionStatus.state === 'prompt') {
                console.log('⚠️ Permissão GPS não concedida ainda');
                await requestGPSPermission();
            } else if (permissionStatus.state === 'denied') {
                console.log('❌ Permissão GPS negada');
                showGPSModal();
            }
            
            // Listen for permission changes
            permissionStatus.onchange = () => {
                console.log('🔄 Status da permissão GPS mudou para:', permissionStatus.state);
                if (permissionStatus.state === 'granted') {
                    hideGPSModal();
                } else {
                    showGPSModal();
                }
            };
        } else {
            // Fallback: Try to get current position to check permission
            console.log('⚠️ Permissions API não disponível, tentando obter localização...');
            await requestGPSPermission();
        }
    } catch (error) {
        console.error('❌ Erro ao verificar permissão GPS:', error);
        // Try to request permission anyway
        await requestGPSPermission();
    }
}

async function requestGPSPermission() {
    console.log('📲 Solicitando permissão GPS ao usuário...');
    
    return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                console.log('✅ Permissão GPS concedida!');
                hideGPSModal();
                resolve(true);
            },
            (error) => {
                console.error('❌ Erro ao obter permissão GPS:', error);
                if (error.code === error.PERMISSION_DENIED) {
                    console.log('❌ Usuário negou a permissão GPS');
                    showGPSModal();
                } else if (error.code === error.POSITION_UNAVAILABLE) {
                    alert('GPS indisponível. Verifique se o GPS está ativado no seu dispositivo.');
                    showGPSModal();
                } else {
                    showGPSModal();
                }
                resolve(false);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    });
}

function showGPSModal() {
    console.log('🚨 Mostrando modal de permissão GPS obrigatória');
    const modal = document.getElementById('gpsPermissionModal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

function hideGPSModal() {
    console.log('✅ Ocultando modal de permissão GPS');
    const modal = document.getElementById('gpsPermissionModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

async function recheckGPSPermission(event) {
    console.log('🔄 Verificando permissão GPS novamente...');
    
    let button = null;
    if (event && event.target) {
        button = event.target;
    }
    
    const originalText = button ? button.innerHTML : '';
    
    if (button) {
        button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Verificando...';
        button.disabled = true;
    }
    
    await checkGPSPermissionOnLoad();
    
    setTimeout(() => {
        if (button) {
            button.innerHTML = originalText;
            button.disabled = false;
        }
    }, 1000);
}

function openGPSSettings() {
    console.log('⚙️ Tentando abrir configurações do sistema...');
    
    // Para Android Chrome/WebView
    if (navigator.userAgent.match(/Android/i)) {
        // Mostra instruções imediatamente
        alert(
            '📱 IMPORTANTE - Ativar GPS Permanente:\n\n' +
            '⚠️ O navegador web não pode garantir GPS "sempre ativo".\n\n' +
            'Para melhor experiência:\n' +
            '1. Abra as CONFIGURAÇÕES do celular\n' +
            '2. Vá em "Apps" ou "Aplicativos"\n' +
            '3. Encontre seu navegador (Chrome/Firefox/etc)\n' +
            '4. Toque em "Permissões"\n' +
            '5. Toque em "Localização"\n' +
            '6. Selecione "Permitir sempre"\n\n' +
            '💡 DICA: Para GPS realmente permanente, instale o app na tela inicial.\n\n' +
            'Depois, volte e clique em "Verificar Novamente"'
        );
    } 
    // Para iOS Safari
    else if (navigator.userAgent.match(/iPhone|iPad|iPod/i)) {
        alert(
            '📱 Para ativar o GPS permanentemente:\n\n' +
            '1. Abra AJUSTES (Settings)\n' +
            '2. Role até encontrar "Safari" ou "Privacidade"\n' +
            '3. Toque em "Localização" ou "Serviços de Localização"\n' +
            '4. Procure por "Safari" ou este site\n' +
            '5. Selecione "Sempre" ou "Ao Usar o App"\n\n' +
            'Depois, volte ao app e clique em "Verificar Novamente"'
        );
    }
    // Para Desktop ou outros
    else {
        alert(
            '⚙️ Para permitir o acesso à localização:\n\n' +
            '1. Clique no ícone de cadeado 🔒 ou ⓘ na barra de endereço\n' +
            '2. Procure por "Localização" ou "Permissions"\n' +
            '3. Altere para "Permitir" ou "Allow"\n' +
            '4. Recarregue a página\n\n' +
            'Depois, clique em "Verificar Novamente"'
        );
    }
}

// Authentication functions
async function login() {
    const phone = document.getElementById('loginPhone').value;
    const password = document.getElementById('loginPassword').value;

    if (!phone || !password) {
        alert('Por favor, preencha todos os campos');
        return;
    }

    try {
        const response = await fetch('/api/driver/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, password })
        });

        const data = await response.json();

        if (data.success) {
            authToken = data.token;
            driverData = data.deliverer;
            localStorage.setItem('driver_token', authToken);
            localStorage.setItem('driver_data', JSON.stringify(driverData));
            await showDriverInterface();
            
            // Request push notification permission after login
            setTimeout(() => {
                if (typeof window.enablePushNotifications === 'function') {
                    window.enablePushNotifications();
                }
            }, 2000);
        } else {
            alert(data.error || 'Erro ao fazer login');
        }
    } catch (error) {
        console.error('Login error:', error);
        alert('Erro ao conectar com o servidor');
    }
}

async function register() {
    const name = document.getElementById('regName').value;
    const phone = document.getElementById('regPhone').value;
    const cpf = document.getElementById('regCPF').value;
    const plate = document.getElementById('regPlate').value;
    const password = document.getElementById('regPassword').value;

    if (!password || password.length < 6) {
        alert('A senha deve ter no mínimo 6 caracteres');
        return;
    }

    // Using the demo restaurant ID created in the database
    // In production, this would come from a selection or invitation
    const restaurant_id = 'dbb7dea5-5275-4bcf-b060-c7232444ed3a';

    try {
        const response = await fetch('/api/driver/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                name, 
                phone, 
                cpf, 
                motorcycle_plate: plate,
                restaurant_id,
                password
            })
        });

        const data = await response.json();

        if (data.success) {
            authToken = data.token;
            driverData = data.deliverer;
            localStorage.setItem('driver_token', authToken);
            localStorage.setItem('driver_data', JSON.stringify(driverData));
            await showDriverInterface();
            
            // Request push notification permission after registration
            setTimeout(() => {
                if (typeof window.enablePushNotifications === 'function') {
                    window.enablePushNotifications();
                }
            }, 2000);
        } else {
            alert(data.error || 'Erro ao criar conta');
        }
    } catch (error) {
        console.error('Registration error:', error);
        alert('Erro ao conectar com o servidor');
    }
}

function logout() {
    localStorage.removeItem('driver_token');
    localStorage.removeItem('driver_data');
    authToken = null;
    driverData = {};
    location.reload();
}

function showRegister() {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('registerForm').classList.remove('hidden');
}

function showLogin() {
    document.getElementById('registerForm').classList.add('hidden');
    document.getElementById('loginForm').classList.remove('hidden');
}

// Driver interface functions
async function showDriverInterface() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('driverInterface').classList.remove('hidden');
    
    // Wait for Mapbox token to be ready before starting location tracking
    try {
        await mapboxTokenPromise;
        startLocationTracking();
    } catch (err) {
        console.error('Failed to load Mapbox token:', err);
    }
    
    // Initialize Supabase and start real-time monitoring
    await initializeSupabase();
    await loadAvailableOrders();
    await loadActiveDeliveries();
    subscribeToOrders();
}

function startLocationTracking() {
    if (navigator.geolocation) {
        navigator.geolocation.watchPosition(position => {
            const { latitude, longitude } = position.coords;
            updateLocation(latitude, longitude);
        }, (error) => {
            console.error('Error tracking location:', error);
        }, { enableHighAccuracy: true });
    }
}

async function updateLocation(latitude, longitude) {
    try {
        await fetch('/api/driver/location', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ latitude, longitude })
        });
    } catch (error) {
        console.error('Error updating location:', error);
    }
}

async function toggleStatus() {
    driverStatus = driverStatus === 'active' ? 'inactive' : 'active';
    
    try {
        await fetch('/api/driver/status', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ status: driverStatus })
        });
        
        const indicator = document.getElementById('statusIndicator');
        const btn = document.getElementById('statusBtn');
        
        if (driverStatus === 'active') {
            indicator.classList.remove('bg-gray-400');
            indicator.classList.add('bg-green-500', 'pulsing-dot');
            btn.textContent = 'Online';
            btn.classList.remove('text-gray-600');
            btn.classList.add('text-green-600');
        } else {
            indicator.classList.remove('bg-green-500', 'pulsing-dot');
            indicator.classList.add('bg-gray-400');
            btn.textContent = 'Offline';
            btn.classList.remove('text-green-600');
            btn.classList.add('text-gray-600');
        }
    } catch (error) {
        console.error('Error toggling status:', error);
    }
}

// Function to update all order timers
function updateOrderTimers() {
    const now = Date.now();
    
    availableOrders.forEach(order => {
        const timerElement = document.getElementById(`order-timer-${order.id}`);
        if (!timerElement) return;
        
        // Get or set timestamp for this order
        if (!orderTimestamps[order.id]) {
            orderTimestamps[order.id] = now;
        }
        
        // Calculate elapsed time in minutes
        const elapsedMs = now - orderTimestamps[order.id];
        const elapsedMinutes = Math.floor(elapsedMs / 60000);
        const elapsedSeconds = Math.floor((elapsedMs % 60000) / 1000);
        
        // Format time display
        const timeDisplay = `${String(elapsedMinutes).padStart(2, '0')}:${String(elapsedSeconds).padStart(2, '0')}`;
        timerElement.querySelector('.timer-text').textContent = timeDisplay;
        
        // Update background color based on elapsed time
        const timerBg = timerElement;
        timerBg.classList.remove('timer-green', 'timer-orange', 'timer-red', 'timer-blink');
        
        if (elapsedMinutes <= 10) {
            // 0-10 min: green
            timerBg.classList.add('timer-green');
        } else if (elapsedMinutes <= 30) {
            // 11-30 min: orange
            timerBg.classList.add('timer-orange');
        } else if (elapsedMinutes <= 60) {
            // 31-60 min: red
            timerBg.classList.add('timer-red');
        } else {
            // 61+ min: blinking red
            timerBg.classList.add('timer-red', 'timer-blink');
        }
    });
}

// Start timer updates
function startTimerUpdates() {
    if (timerInterval) {
        clearInterval(timerInterval);
    }
    timerInterval = setInterval(updateOrderTimers, 1000);
}

// Stop timer updates
function stopTimerUpdates() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

// Load all available orders from all restaurants
async function loadAvailableOrders() {
    try {
        const response = await fetch('/api/driver/orders/available', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const data = await response.json();
        
        if (data.success) {
            const now = Date.now();
            
            // Add timestamp for new orders
            data.orders.forEach(order => {
                if (!orderTimestamps[order.id]) {
                    orderTimestamps[order.id] = now;
                }
            });
            
            // Remove timestamps for orders that are no longer available
            const currentOrderIds = data.orders.map(o => o.id);
            Object.keys(orderTimestamps).forEach(orderId => {
                if (!currentOrderIds.includes(orderId)) {
                    delete orderTimestamps[orderId];
                }
            });
            
            availableOrders = data.orders;
            renderAvailableOrders();
            
            // Start timer updates if there are orders
            if (availableOrders.length > 0) {
                startTimerUpdates();
            } else {
                stopTimerUpdates();
            }
        }
    } catch (error) {
        console.error('Error loading available orders:', error);
    }
}

// Load active deliveries for this driver
async function loadActiveDeliveries() {
    try {
        const response = await fetch('/api/driver/orders/active', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const data = await response.json();
        
        if (data.success && data.orders.length > 0) {
            renderActiveDeliveries(data.orders);
        } else {
            renderEmptyActiveDeliveries();
        }
    } catch (error) {
        console.error('Error loading active deliveries:', error);
    }
}

// Subscribe to real-time changes in orders table
function subscribeToOrders() {
    if (!supabaseClient) {
        console.warn('Supabase not initialized, cannot subscribe to orders');
        return;
    }

    // Subscribe to INSERT, UPDATE, DELETE events on orders table
    ordersSubscription = supabaseClient
        .channel('orders-changes')
        .on('postgres_changes', 
            { event: '*', schema: 'public', table: 'orders' },
            (payload) => {
                console.log('📦 Order changed:', payload);
                // Reload orders when there's a change
                loadAvailableOrders();
                loadActiveDeliveries();
            }
        )
        .subscribe();
    
    console.log('✅ Subscribed to real-time order updates');
}

// Render available orders in the list
function renderAvailableOrders() {
    const container = document.getElementById('ordersList');
    const countElement = document.getElementById('deliveriesCount');
    
    if (!availableOrders || availableOrders.length === 0) {
        container.innerHTML = `
            <div class="empty-state py-16">
                <div class="text-center">
                    <div class="w-32 h-32 mx-auto mb-6 bg-green-50 rounded-full flex items-center justify-center">
                        <i class="fas fa-check-circle text-green-500 text-6xl"></i>
                    </div>
                    <h3 class="text-xl font-bold text-gray-800 mb-2">Aguardando pedido</h3>
                    <p class="text-gray-600 mb-6">Bom trabalho!</p>
                    <button onclick="loadAvailableOrders()" class="bg-green-500 text-white px-6 py-3 rounded-xl font-semibold">
                        <i class="fas fa-sync-alt mr-2"></i> Atualizar
                    </button>
                </div>
            </div>
        `;
        countElement.textContent = 'Minhas entregas (0)';
        return;
    }
    
    countElement.textContent = `Pedidos disponíveis (${availableOrders.length})`;
    
    const ordersHTML = availableOrders.map(order => {
        const itemsCount = order.order_items?.length || 0;
        const distance = order.delivery_distance ? `${order.delivery_distance.toFixed(1)} km` : '--';
        const duration = order.delivery_duration ? `${Math.round(order.delivery_duration)} min` : '--';
        
        // Calculate distance from driver to restaurant
        let driverToRestaurantDistance = '--';
        if (currentDriverLocation && order.restaurant_latitude && order.restaurant_longitude) {
            const dist = calculateDistance(
                currentDriverLocation.latitude,
                currentDriverLocation.longitude,
                order.restaurant_latitude,
                order.restaurant_longitude
            );
            driverToRestaurantDistance = `${dist.toFixed(1)} km`;
        }
        
        return `
            <div class="order-card" onclick="showOrderDetails('${order.id}')">
                <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center">
                        <div class="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mr-3">
                            <i class="fas fa-store text-green-600"></i>
                        </div>
                        <div class="flex-1">
                            <div id="order-timer-${order.id}" class="order-timer mb-2 px-3 py-1 rounded-lg inline-block">
                                <i class="fas fa-clock mr-1"></i>
                                <span class="timer-text font-mono font-bold">00:00</span>
                            </div>
                            <div class="font-bold text-gray-800">${order.restaurant_name || 'Restaurante'}</div>
                            <div class="text-xs text-gray-600">${order.restaurant_address || order.restaurant_city || 'Endereço do restaurante'}</div>
                            <div class="text-xs text-gray-500 mt-1">
                                ${itemsCount} ${itemsCount === 1 ? 'item' : 'itens'}
                                <span class="font-semibold ml-2" style="color: #00B172;" id="driver-distance-inline-${order.id}">${driverToRestaurantDistance}</span>
                            </div>
                        </div>
                    </div>
                    <span class="badge badge-ready">${order.status}</span>
                </div>
                
                <div class="border-t border-gray-100 pt-3 space-y-2">
                    <div class="flex items-start text-sm">
                        <i class="fas fa-map-marker-alt text-gray-400 mt-1 mr-2"></i>
                        <span class="text-gray-600 text-xs">${order.delivery_address}</span>
                    </div>
                    <div class="flex items-center space-x-4 mt-2">
                        <div class="flex items-center text-xs text-gray-600">
                            <i class="fas fa-route text-blue-500 mr-1"></i>
                            <span>${distance}</span>
                        </div>
                        <div class="flex items-center text-xs text-gray-600">
                            <i class="fas fa-clock text-orange-500 mr-1"></i>
                            <span>${duration}</span>
                        </div>
                    </div>
                </div>
                
                <div class="border-t border-gray-100 mt-3 pt-3 flex items-center justify-between">
                    <div class="text-xs text-gray-500">Taxa de entrega</div>
                    <div class="text-xl font-bold text-green-600">R$ ${order.delivery_fee.toFixed(2)}</div>
                </div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = ordersHTML;
    
    // Start tracking driver location for the list
    startDriverLocationTrackingForList();
}

// Track driver location and update distances in real-time for orders list
function startDriverLocationTrackingForList() {
    // Stop previous watcher if exists
    if (listLocationWatcher) {
        navigator.geolocation.clearWatch(listLocationWatcher);
        listLocationWatcher = null;
    }
    
    if (!navigator.geolocation) {
        console.warn('Geolocation not available');
        return;
    }
    
    // Start watching position
    listLocationWatcher = navigator.geolocation.watchPosition(
        (position) => {
            currentDriverLocation = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
                timestamp: Date.now()
            };
            
            console.log('📍 Localização do entregador atualizada:', currentDriverLocation);
            
            // Update distances for all orders in the list
            availableOrders.forEach(order => {
                if (order.restaurant_latitude && order.restaurant_longitude) {
                    const dist = calculateDistance(
                        currentDriverLocation.latitude,
                        currentDriverLocation.longitude,
                        order.restaurant_latitude,
                        order.restaurant_longitude
                    );
                    
                    // Update the inline distance element
                    const inlineDistanceEl = document.getElementById(`driver-distance-inline-${order.id}`);
                    if (inlineDistanceEl) {
                        inlineDistanceEl.textContent = `${dist.toFixed(1)} km`;
                    }
                }
            });
        },
        (error) => {
            console.error('Erro ao obter localização:', error);
        },
        {
            enableHighAccuracy: true,
            maximumAge: 10000,
            timeout: 5000
        }
    );
}

// Render active deliveries
function renderActiveDeliveries(orders) {
    const container = document.getElementById('activeDelivery');
    
    if (!orders || orders.length === 0) {
        renderEmptyActiveDeliveries();
        return;
    }
    
    const activeOrdersHTML = orders.map(order => `
        <div class="order-card">
            <div class="flex items-center justify-between mb-4">
                <h3 class="text-lg font-bold text-gray-800">Entrega Ativa</h3>
                <span class="badge badge-ready">Em andamento</span>
            </div>
            
            <div class="bg-gray-50 rounded-lg p-4 space-y-3 mb-4">
                <div><span class="text-gray-600">Restaurante:</span> <strong>${order.restaurant_name || 'Restaurante'}</strong></div>
                <div><span class="text-gray-600">Endereço de Entrega:</span> <strong class="text-sm">${order.delivery_address}</strong></div>
                <div><span class="text-gray-600">Valor:</span> <strong class="text-green-600">R$ ${order.delivery_fee.toFixed(2)}</strong></div>
            </div>
            
            <button onclick="markAsDelivered('${order.id}')" class="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white py-3 rounded-lg font-semibold shadow-lg">
                <i class="fas fa-check-circle mr-2"></i> Marcar como Entregue
            </button>
        </div>
    `).join('');
    
    container.innerHTML = activeOrdersHTML;
}

function renderEmptyActiveDeliveries() {
    const container = document.getElementById('activeDelivery');
    container.innerHTML = `
        <div class="empty-state py-16">
            <div class="text-center">
                <div class="w-32 h-32 mx-auto mb-6 bg-gray-50 rounded-full flex items-center justify-center">
                    <i class="fas fa-motorcycle text-gray-400 text-6xl"></i>
                </div>
                <h3 class="text-xl font-bold text-gray-800 mb-2">Nenhuma entrega em andamento</h3>
                <p class="text-gray-600">Aceite um pedido para começar</p>
            </div>
        </div>
    `;
}

// Global map variable for modal
let modalMapInstance = null;
let driverLocationWatcher = null;

// Calculate distance between two points (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Load all delivery addresses from available orders
async function loadAllDeliveryAddresses() {
    try {
        const response = await fetch('/api/driver/orders/available', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        return data.orders || [];
    } catch (error) {
        console.error('Error loading delivery addresses:', error);
        return [];
    }
}

// Geocode address to coordinates using Mapbox Geocoding API
async function geocodeAddress(address, city = null, state = null) {
    try {
        console.log('🔍 Geocodificando endereço:', address);
        
        // Build full address with city and state for better precision
        let fullAddress = address;
        
        // If city/state not in address, try to add them
        if (city && !address.toLowerCase().includes(city.toLowerCase())) {
            fullAddress += `, ${city}`;
        }
        if (state && !address.toLowerCase().includes(state.toLowerCase())) {
            fullAddress += ` - ${state}`;
        }
        if (!address.toLowerCase().includes('brasil') && !address.toLowerCase().includes('brazil')) {
            fullAddress += ', Brasil';
        }
        
        console.log('📍 Endereço completo para geocodificação:', fullAddress);
        
        // Encode address for URL
        const encodedAddress = encodeURIComponent(fullAddress);
        
        // Call Mapbox Geocoding API with parameters for better precision
        // limit=1: return only best match
        // country=BR: prioritize Brazil
        // types=address: focus on street addresses
        const geocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedAddress}.json?country=BR&types=address,poi&limit=1&language=pt&access_token=${mapboxgl.accessToken}`;
        const response = await fetch(geocodeUrl);
        const data = await response.json();
        
        if (data.features && data.features.length > 0) {
            const location = data.features[0];
            const [longitude, latitude] = location.center;
            const placeName = location.place_name;
            console.log('✅ Coordenadas encontradas:', { 
                latitude, 
                longitude, 
                placeName,
                relevance: location.relevance 
            });
            return { latitude, longitude, placeName };
        } else {
            console.warn('❌ Nenhuma coordenada encontrada para o endereço:', fullAddress);
            return null;
        }
    } catch (error) {
        console.error('❌ Erro ao geocodificar endereço:', error);
        return null;
    }
}

// Initialize map in modal with all delivery points
async function initModalMap(order) {
    // Wait for Mapbox token to be loaded
    await mapboxTokenPromise;
    
    // Remove existing map if any
    if (modalMapInstance) {
        modalMapInstance.remove();
        modalMapInstance = null;
    }
    
    // SEMPRE geocodificar endereços a partir do texto para garantir precisão máxima
    // (coordenadas do banco podem estar desatualizadas ou incorretas)
    let restaurantLat = order.restaurant_latitude;
    let restaurantLng = order.restaurant_longitude;
    let deliveryLat = null;
    let deliveryLng = null;
    
    // Show loading message
    document.getElementById('modalMap').innerHTML = '<div class="flex items-center justify-center h-full bg-gray-100"><p class="text-gray-500"><i class="fas fa-spinner fa-spin mr-2"></i>Localizando endereços no mapa...</p></div>';
    
    // Extract city and state from delivery address for better geocoding
    let deliveryCity = order.delivery_city || null;
    let deliveryState = order.delivery_state || null;
    
    // Try to extract from address if not available
    if (!deliveryCity || !deliveryState) {
        const addressParts = order.delivery_address?.split(',') || [];
        addressParts.forEach(part => {
            const trimmed = part.trim();
            // Check for state patterns (SP, RJ, MG, etc)
            if (trimmed.match(/^[A-Z]{2}$/) || trimmed.match(/\s-\s[A-Z]{2}$/)) {
                deliveryState = trimmed.replace(/\s-\s/, '').trim();
            }
            // Check for city names (common cities in Brazil)
            if (trimmed.match(/Santos|São Paulo|Rio de Janeiro|Praia Grande|Guarujá/i)) {
                deliveryCity = trimmed;
            }
        });
    }
    
    console.log('🏙️ Cidade/Estado detectados:', { deliveryCity, deliveryState });
    
    // Geocode restaurant if coordinates are missing
    if ((!restaurantLat || !restaurantLng) && order.restaurant_address) {
        console.log('🔍 Geocodificando endereço do restaurante:', order.restaurant_address);
        
        const restaurantCity = order.restaurant_city || null;
        const restaurantState = order.restaurant_state || null;
        
        const geocoded = await geocodeAddress(order.restaurant_address, restaurantCity, restaurantState);
        if (geocoded) {
            restaurantLat = geocoded.latitude;
            restaurantLng = geocoded.longitude;
            order.restaurant_latitude = restaurantLat;
            order.restaurant_longitude = restaurantLng;
            
            console.log('✅ Restaurante localizado:', geocoded.placeName);
        } else {
            console.error('❌ Falha ao geocodificar endereço do restaurante');
        }
    }
    
    // SEMPRE geocodificar endereço de entrega (IGNORAR coordenadas do banco)
    if (order.delivery_address) {
        console.log('🔍 Geocodificando endereço de ENTREGA:', order.delivery_address);
        
        const geocoded = await geocodeAddress(order.delivery_address, deliveryCity, deliveryState);
        if (geocoded) {
            deliveryLat = geocoded.latitude;
            deliveryLng = geocoded.longitude;
            order.delivery_latitude = deliveryLat;
            order.delivery_longitude = deliveryLng;
            
            console.log('✅ LOCAL DE ENTREGA LOCALIZADO:', {
                endereco: order.delivery_address,
                localizado: geocoded.placeName,
                lat: deliveryLat,
                lng: deliveryLng
            });
        } else {
            console.error('❌ FALHA ao geocodificar endereço de entrega:', order.delivery_address);
        }
    }
    
    // Check if we have valid coordinates after geocoding attempts
    if (!restaurantLat || !restaurantLng || !deliveryLat || !deliveryLng) {
        console.warn('❌ Coordenadas insuficientes para exibir mapa');
        document.getElementById('modalMap').innerHTML = '<div class="flex items-center justify-center h-full bg-gray-100"><p class="text-gray-500">⚠️ Não foi possível localizar os endereços no mapa.</p></div>';
        return;
    }
    
    // Calculate center point between restaurant and delivery
    const centerLat = (restaurantLat + deliveryLat) / 2;
    const centerLng = (restaurantLng + deliveryLng) / 2;
    
    // Initialize map
    modalMapInstance = new mapboxgl.Map({
        container: 'modalMap',
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [centerLng, centerLat],
        zoom: 12
    });
    
    // Add navigation controls
    modalMapInstance.addControl(new mapboxgl.NavigationControl(), 'top-right');
    
    // Create restaurant marker (store icon)
    const restaurantEl = document.createElement('div');
    restaurantEl.className = 'restaurant-marker';
    restaurantEl.innerHTML = '<i class="fas fa-store" style="font-size: 24px; color: #00B172;"></i>';
    restaurantEl.style.width = '48px';
    restaurantEl.style.height = '48px';
    restaurantEl.style.backgroundColor = 'white';
    restaurantEl.style.borderRadius = '50%';
    restaurantEl.style.display = 'flex';
    restaurantEl.style.alignItems = 'center';
    restaurantEl.style.justifyContent = 'center';
    restaurantEl.style.border = '3px solid #00B172';
    restaurantEl.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
    
    // Add marker for restaurant (Point A)
    new mapboxgl.Marker({ element: restaurantEl })
        .setLngLat([restaurantLng, restaurantLat])
        .setPopup(new mapboxgl.Popup().setHTML(`
            <div style="padding: 8px;">
                <strong style="color: #00B172;">🏪 ${order.restaurant_name || 'Restaurante'}</strong><br>
                <span style="font-size: 12px;">${order.restaurant_address || ''}</span>
            </div>
        `))
        .addTo(modalMapInstance);
    
    // Create delivery marker for current order (house icon)
    const currentDeliveryEl = document.createElement('div');
    currentDeliveryEl.innerHTML = '<i class="fas fa-home" style="font-size: 24px; color: #3B82F6;"></i>';
    currentDeliveryEl.style.width = '48px';
    currentDeliveryEl.style.height = '48px';
    currentDeliveryEl.style.backgroundColor = 'white';
    currentDeliveryEl.style.borderRadius = '50%';
    currentDeliveryEl.style.display = 'flex';
    currentDeliveryEl.style.alignItems = 'center';
    currentDeliveryEl.style.justifyContent = 'center';
    currentDeliveryEl.style.border = '3px solid #3B82F6';
    currentDeliveryEl.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
    
    // Add marker for current delivery location
    new mapboxgl.Marker({ element: currentDeliveryEl })
        .setLngLat([deliveryLng, deliveryLat])
        .setPopup(new mapboxgl.Popup().setHTML(`
            <div style="padding: 8px;">
                <strong style="color: #3B82F6;">🏠 Entrega Atual</strong><br>
                <span style="font-size: 12px;">${order.delivery_address}</span>
            </div>
        `))
        .addTo(modalMapInstance);
    
    // Load and add all other delivery addresses
    const allOrders = await loadAllDeliveryAddresses();
    allOrders.forEach(otherOrder => {
        if (otherOrder.id !== order.id && otherOrder.delivery_latitude && otherOrder.delivery_longitude) {
            const otherDeliveryEl = document.createElement('div');
            otherDeliveryEl.innerHTML = '<i class="fas fa-home" style="font-size: 18px; color: #9CA3AF;"></i>';
            otherDeliveryEl.style.width = '36px';
            otherDeliveryEl.style.height = '36px';
            otherDeliveryEl.style.backgroundColor = 'white';
            otherDeliveryEl.style.borderRadius = '50%';
            otherDeliveryEl.style.display = 'flex';
            otherDeliveryEl.style.alignItems = 'center';
            otherDeliveryEl.style.justifyContent = 'center';
            otherDeliveryEl.style.border = '2px solid #9CA3AF';
            otherDeliveryEl.style.boxShadow = '0 1px 4px rgba(0,0,0,0.2)';
            otherDeliveryEl.style.opacity = '0.7';
            
            new mapboxgl.Marker({ element: otherDeliveryEl })
                .setLngLat([otherOrder.delivery_longitude, otherOrder.delivery_latitude])
                .setPopup(new mapboxgl.Popup().setHTML(`
                    <div style="padding: 8px;">
                        <strong style="color: #6B7280;">🏠 Outro Pedido</strong><br>
                        <span style="font-size: 12px;">${otherOrder.delivery_address}</span>
                    </div>
                `))
                .addTo(modalMapInstance);
        }
    });
    
    // Draw route line when map loads
    modalMapInstance.on('load', async () => {
        try {
            // Get route from Mapbox Directions API
            const directionsUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${restaurantLng},${restaurantLat};${deliveryLng},${deliveryLat}?geometries=geojson&access_token=${mapboxgl.accessToken}`;
            const response = await fetch(directionsUrl);
            const data = await response.json();
            
            if (data.routes && data.routes.length > 0) {
                const route = data.routes[0].geometry;
                
                // Add route layer
                modalMapInstance.addLayer({
                    id: 'route',
                    type: 'line',
                    source: {
                        type: 'geojson',
                        data: {
                            type: 'Feature',
                            properties: {},
                            geometry: route
                        }
                    },
                    layout: {
                        'line-join': 'round',
                        'line-cap': 'round'
                    },
                    paint: {
                        'line-color': '#00B172',
                        'line-width': 4,
                        'line-opacity': 0.75
                    }
                });
                
                // Fit map to show restaurant and delivery points only (not driver location)
                const bounds = new mapboxgl.LngLatBounds();
                bounds.extend([restaurantLng, restaurantLat]);
                bounds.extend([deliveryLng, deliveryLat]);
                
                modalMapInstance.fitBounds(bounds, { 
                    padding: 80,
                    maxZoom: 15,
                    duration: 1000
                });
            }
        } catch (error) {
            console.error('Error loading route:', error);
        }
    });
}

// Note: Driver real-time location tracking removed
// Map now shows only restaurant → delivery route (not driver location)

// Show order details in modal
async function showOrderDetails(orderId) {
    const order = availableOrders.find(o => o.id === orderId);
    if (!order) {
        console.error('Order not found:', orderId);
        return;
    }
    
    currentOrder = order;
    
    // Render order items
    let itemsHTML = '';
    if (order.order_items && order.order_items.length > 0) {
        itemsHTML = order.order_items.map(item => `
            <div class="flex justify-between py-2 border-b border-gray-100">
                <div>
                    <span class="font-semibold">${item.quantity}x</span>
                    <span class="ml-2">${item.product_name}</span>
                </div>
                <span class="text-gray-600">R$ ${item.price.toFixed(2)}</span>
            </div>
        `).join('');
    }
    
    document.getElementById('modalRestaurantName').textContent = order.restaurant_name || 'Restaurante';
    document.getElementById('modalRestaurantAddress').textContent = order.restaurant_address || order.restaurant_city || '';
    document.getElementById('modalCustomerName').textContent = '****'; // Ocultar nome do cliente
    document.getElementById('modalDeliveryAddress').textContent = order.delivery_address;
    document.getElementById('modalDeliveryFee').textContent = `R$ ${order.delivery_fee.toFixed(2)}`;
    document.getElementById('modalOrderTotal').textContent = `R$ ${order.total.toFixed(2)}`;
    document.getElementById('modalOrderItems').innerHTML = itemsHTML || '<p class="text-gray-500">Sem itens</p>';
    
    // Atualizar distância do restaurante até o cliente no modal
    const distance = order.delivery_distance ? `${order.delivery_distance.toFixed(1)} km` : '-- km';
    const distanceElement = document.getElementById('modalDeliveryDistance');
    if (distanceElement) {
        distanceElement.textContent = distance;
    }
    
    document.getElementById('orderModal').classList.add('active');
    
    // Initialize map with order coordinates
    setTimeout(() => initModalMap(order), 100);
}

function closeOrderModal() {
    document.getElementById('orderModal').classList.remove('active');
    currentOrder = null;
    
    // Clean up map instance
    if (modalMapInstance) {
        modalMapInstance.remove();
        modalMapInstance = null;
    }
}

async function acceptOrder() {
    if (!currentOrder) return;
    
    const acceptBtn = event?.target;
    if (acceptBtn) {
        acceptBtn.disabled = true;
        acceptBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Aceitando...';
    }
    
    try {
        const response = await fetch(`/api/driver/orders/${currentOrder.id}/accept`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const data = await response.json();
        
        if (data.success) {
            closeOrderModal();
            // Switch to "Em Andamento" tab
            switchTab('inProgress');
            // Reload orders to update lists
            await loadAvailableOrders();
            await loadActiveDeliveries();
            alert('✅ Pedido aceito com sucesso!');
        } else {
            alert(data.error || 'Erro ao aceitar pedido');
            if (acceptBtn) {
                acceptBtn.disabled = false;
                acceptBtn.innerHTML = '<i class="fas fa-check mr-2"></i> Aceitar Pedido';
            }
        }
    } catch (error) {
        console.error('Error accepting order:', error);
        alert('Erro ao conectar com o servidor');
        if (acceptBtn) {
            acceptBtn.disabled = false;
            acceptBtn.innerHTML = '<i class="fas fa-check mr-2"></i> Aceitar Pedido';
        }
    }
}

function showActiveDelivery(order) {
    const cardHTML = `
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <h3 class="text-xl font-bold text-gray-800">Entrega Ativa</h3>
                <span class="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-semibold">
                    Em andamento
                </span>
            </div>
            
            <div class="bg-gray-50 rounded-lg p-4 space-y-2">
                <div><span class="text-gray-600">Restaurante:</span> <strong>${order.restaurant_name || 'Restaurante'}</strong></div>
                <div><span class="text-gray-600">Endereço de Entrega:</span> <strong class="text-sm">${order.delivery_address}</strong></div>
                <div><span class="text-gray-600">Valor:</span> <strong class="text-green-600">R$ ${order.delivery_fee.toFixed(2)}</strong></div>
            </div>
            
            <button onclick="markAsDelivered()" class="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white py-3 rounded-lg font-semibold shadow-lg">
                <i class="fas fa-check-circle mr-2"></i> Marcar como Entregue
            </button>
        </div>
    `;
    
    document.getElementById('cardContent').innerHTML = cardHTML;
    document.getElementById('infoCard').classList.remove('hidden');
}

async function markAsDelivered(orderId) {
    if (!orderId) return;
    
    if (!confirm('Confirmar que o pedido foi entregue?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/driver/orders/${orderId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ status: 'entregue' })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('✅ Entrega finalizada com sucesso!');
            // Reload lists
            await loadAvailableOrders();
            await loadActiveDeliveries();
            // Switch to deliveries tab
            switchTab('deliveries');
        } else {
            alert(data.error || 'Erro ao marcar como entregue');
        }
    } catch (error) {
        console.error('Error marking as delivered:', error);
        alert('Erro ao conectar com o servidor');
    }
}

function switchTab(tabName) {
    // Hide all tabs
    document.getElementById('deliveriesTab').classList.add('hidden');
    document.getElementById('inProgressTab').classList.add('hidden');
    document.getElementById('historyTab').classList.add('hidden');
    document.getElementById('accountTab').classList.add('hidden');
    
    // Show selected tab
    document.getElementById(tabName + 'Tab').classList.remove('hidden');
    
    // Update tab bar
    document.querySelectorAll('.tab-item').forEach(item => {
        item.classList.remove('active');
    });
    event?.target?.closest('.tab-item')?.classList.add('active');
    
    // Stop location tracking if leaving deliveries tab
    if (tabName !== 'deliveries' && listLocationWatcher) {
        navigator.geolocation.clearWatch(listLocationWatcher);
        listLocationWatcher = null;
        console.log('🛑 Rastreamento de localização pausado (fora da aba de entregas)');
    }
    
    // Reload data based on tab
    if (tabName === 'deliveries') {
        loadAvailableOrders();
    } else if (tabName === 'inProgress') {
        loadActiveDeliveries();
    }
}

async function showEarnings() {
    try {
        const response = await fetch('/api/driver/earnings', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const data = await response.json();
        
        if (data.success) {
            const earningsHTML = `
                <div class="grid grid-cols-2 gap-4">
                    <div class="bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg p-4 text-white">
                        <div class="text-sm opacity-90">Saldo</div>
                        <div class="text-2xl font-bold">R$ ${data.earnings.balance.toFixed(2)}</div>
                    </div>
                    <div class="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg p-4 text-white">
                        <div class="text-sm opacity-90">Hoje</div>
                        <div class="text-2xl font-bold">R$ ${data.earnings.today.toFixed(2)}</div>
                    </div>
                    <div class="bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg p-4 text-white">
                        <div class="text-sm opacity-90">Semana</div>
                        <div class="text-2xl font-bold">R$ ${data.earnings.week.toFixed(2)}</div>
                    </div>
                    <div class="bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg p-4 text-white">
                        <div class="text-sm opacity-90">Entregas</div>
                        <div class="text-2xl font-bold">${data.earnings.total_deliveries}</div>
                    </div>
                </div>
                
                <div class="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-center">
                    <i class="fas fa-star text-yellow-500 text-2xl mr-3"></i>
                    <div>
                        <div class="text-sm text-gray-600">Avaliação</div>
                        <div class="text-xl font-bold text-gray-800">${data.earnings.rating.toFixed(1)} ⭐</div>
                    </div>
                </div>
            `;
            
            document.getElementById('earningsContent').innerHTML = earningsHTML;
            document.getElementById('earningsModal').classList.add('active');
        }
    } catch (error) {
        console.error('Error fetching earnings:', error);
    }
}

function closeEarnings() {
    document.getElementById('earningsModal').classList.remove('active');
}

async function requestWithdrawal() {
    const amount = prompt('Digite o valor do saque (disponível: R$ ' + driverData.balance + '):');
    
    if (!amount || isNaN(amount) || amount <= 0) return;
    
    try {
        const response = await fetch('/api/driver/withdrawal', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ amount: parseFloat(amount) })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('Saque solicitado com sucesso! O valor será transferido em breve.');
            closeEarnings();
        } else {
            alert(data.error || 'Erro ao solicitar saque');
        }
    } catch (error) {
        console.error('Error requesting withdrawal:', error);
    }
}
