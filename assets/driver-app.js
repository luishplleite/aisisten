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

// Load all available orders from all restaurants
async function loadAvailableOrders() {
    try {
        const response = await fetch('/api/driver/orders/available', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const data = await response.json();
        
        if (data.success) {
            availableOrders = data.orders;
            renderAvailableOrders();
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
        return `
            <div class="order-card" onclick="showOrderDetails('${order.id}')">
                <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center">
                        <div class="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mr-3">
                            <i class="fas fa-store text-green-600"></i>
                        </div>
                        <div>
                            <div class="font-bold text-gray-800">${order.restaurant_name || 'Restaurante'}</div>
                            <div class="text-xs text-gray-500">${itemsCount} ${itemsCount === 1 ? 'item' : 'itens'}</div>
                        </div>
                    </div>
                    <span class="badge badge-ready">${order.status}</span>
                </div>
                
                <div class="border-t border-gray-100 pt-3 space-y-2">
                    <div class="flex items-start text-sm">
                        <i class="fas fa-user text-gray-400 mt-1 mr-2"></i>
                        <span class="text-gray-700">${order.customer_name}</span>
                    </div>
                    <div class="flex items-start text-sm">
                        <i class="fas fa-map-marker-alt text-gray-400 mt-1 mr-2"></i>
                        <span class="text-gray-600 text-xs">${order.delivery_address}</span>
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
                <div><span class="text-gray-600">Cliente:</span> <strong>${order.customer_name}</strong></div>
                <div><span class="text-gray-600">Endereço:</span> <strong class="text-sm">${order.delivery_address}</strong></div>
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

// Show order details in modal
function showOrderDetails(orderId) {
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
    document.getElementById('modalRestaurantAddress').textContent = order.restaurant_address || '';
    document.getElementById('modalCustomerName').textContent = order.customer_name;
    document.getElementById('modalDeliveryAddress').textContent = order.delivery_address;
    document.getElementById('modalDeliveryFee').textContent = `R$ ${order.delivery_fee.toFixed(2)}`;
    document.getElementById('modalOrderTotal').textContent = `R$ ${order.total.toFixed(2)}`;
    document.getElementById('modalOrderItems').innerHTML = itemsHTML || '<p class="text-gray-500">Sem itens</p>';
    
    document.getElementById('orderModal').classList.add('active');
}

function closeOrderModal() {
    document.getElementById('orderModal').classList.remove('active');
    currentOrder = null;
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
                <div><span class="text-gray-600">Cliente:</span> <strong>${order.customer_name}</strong></div>
                <div><span class="text-gray-600">Endereço:</span> <strong class="text-sm">${order.delivery_address}</strong></div>
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
