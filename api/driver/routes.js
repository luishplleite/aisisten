/**
 * TimePulse AI - Delivery Driver Mobile App API Routes
 * 
 * Backend API endpoints for the delivery driver mobile application
 * Integrates with existing restaurant management platform
 */

const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

let supabaseUrl = process.env.SUPABASE_URL;
let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
    const temp = supabaseUrl;
    supabaseUrl = process.env.SUPABASE_ANON_KEY;
    supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
}

// Validate required environment variables
if (!supabaseUrl || !supabaseKey) {
    console.error('❌ CRITICAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for driver authentication');
    throw new Error('Missing required Supabase configuration');
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ CRITICAL: SUPABASE_SERVICE_ROLE_KEY is required for driver authentication (RLS policies need service role)');
    throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is required');
}

// Ensure we're using SERVICE_ROLE_KEY, not anon key
if (supabaseKey.length < 200 || !supabaseKey.includes('eyJ')) {
    console.error('❌ CRITICAL: Driver auth requires SUPABASE_SERVICE_ROLE_KEY, not anon key');
    throw new Error('Invalid Supabase key configuration for driver auth');
}

console.log(`🔑 SERVICE_ROLE_KEY confirmed: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'YES' : 'NO'}`);

const supabase = createClient(supabaseUrl, supabaseKey, {
    db: { schema: 'public' },
    auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
    }
});
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const SALT_ROUNDS = 10;

// Validate JWT secret
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === 'timepulse_driver_secret_2025') {
    console.error('❌ CRITICAL: JWT_SECRET environment variable must be set to a strong secret (not the default)');
    console.error('   Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
    throw new Error('JWT_SECRET must be configured with a strong secret');
}

// =================================================================
// MAPBOX GEOCODING HELPER FUNCTION
// =================================================================

/**
 * Geocode address using Mapbox Geocoding API
 * Converts address string to coordinates (latitude, longitude)
 */
async function geocodeAddress(address, city = '', state = '') {
    try {
        const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN;
        if (!MAPBOX_TOKEN) {
            console.warn('⚠️ MAPBOX_TOKEN not configured, skipping geocoding');
            return null;
        }

        // Build full address for better accuracy
        const fullAddress = `${address}, ${city}, ${state}, Brasil`.trim();
        const encodedAddress = encodeURIComponent(fullAddress);
        
        const geocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedAddress}.json?access_token=${MAPBOX_TOKEN}&country=BR&limit=1`;
        
        const response = await fetch(geocodeUrl);
        const data = await response.json();
        
        if (data.features && data.features.length > 0) {
            const [longitude, latitude] = data.features[0].center;
            console.log(`✅ Geocoded: "${fullAddress}" → (${latitude}, ${longitude})`);
            return { latitude, longitude };
        } else {
            console.warn(`⚠️ No geocoding results for: ${fullAddress}`);
            return null;
        }
    } catch (error) {
        console.error('❌ Geocoding error:', error);
        return null;
    }
}

/**
 * Parse delivery_coordinates field (format: "(lat,lng)")
 */
function parseCoordinates(coordString) {
    if (!coordString) return null;
    
    const match = coordString.match(/\(([^,]+),([^)]+)\)/);
    if (match) {
        const latitude = parseFloat(match[1].trim());
        const longitude = parseFloat(match[2].trim());
        if (!isNaN(latitude) && !isNaN(longitude)) {
            return { latitude, longitude };
        }
    }
    return null;
}

// NOTE: This implementation uses a driver_credentials table to store passwords
// User needs to create this table in Supabase with: id (uuid), deliverer_id (uuid), password_hash (text)
// SQL: Run the create_driver_credentials_table.sql file in your Supabase SQL Editor

// =================================================================
// AUTHENTICATION ENDPOINTS
// =================================================================

/**
 * POST /api/driver/auth/login
 * Driver login - authenticate using phone number and password/PIN
 */
router.post('/auth/login', async (req, res) => {
    try {
        const { phone, password } = req.body;

        if (!phone || !password) {
            return res.status(400).json({ 
                error: 'Telefone e senha são obrigatórios' 
            });
        }

        // Find deliverer by phone
        const { data: deliverer, error: delivererError } = await supabase
            .from('deliverers')
            .select('*')
            .eq('phone', phone)
            .eq('status', 'active')
            .single();

        if (delivererError || !deliverer) {
            return res.status(401).json({ 
                error: 'Credenciais inválidas' 
            });
        }

        // Get password hash from driver_credentials table
        const { data: credentials, error: credError } = await supabase
            .from('driver_credentials')
            .select('password_hash')
            .eq('deliverer_id', deliverer.id)
            .single();

        // MIGRATION SUPPORT: If credentials don't exist yet, return a specific error
        // This allows frontend to prompt for password setup
        if (credError || !credentials) {
            console.log('⚠️ Entregador sem credenciais cadastradas:', deliverer.id);
            return res.status(403).json({ 
                error: 'Primeira configuração necessária',
                code: 'SETUP_REQUIRED',
                deliverer_id: deliverer.id,
                message: 'Por favor, configure uma senha para sua conta'
            });
        }

        // Verify password
        const passwordMatch = await bcrypt.compare(password, credentials.password_hash);

        if (!passwordMatch) {
            return res.status(401).json({ 
                error: 'Credenciais inválidas' 
            });
        }

        const token = jwt.sign(
            { 
                deliverer_id: deliverer.id,
                restaurant_id: deliverer.restaurant_id,
                phone: deliverer.phone,
                role: 'deliverer'
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            success: true,
            token,
            deliverer: {
                id: deliverer.id,
                name: deliverer.name,
                phone: deliverer.phone,
                type: deliverer.type,
                balance: deliverer.balance,
                rating: deliverer.rating,
                total_deliveries: deliverer.total_deliveries
            }
        });

    } catch (error) {
        console.error('❌ Erro no login do entregador:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

/**
 * POST /api/driver/auth/register
 * Register new delivery driver
 */
router.post('/auth/register', async (req, res) => {
    try {
        const { name, phone, cpf, email, motorcycle_plate, restaurant_id, password } = req.body;

        if (!name || !phone || !restaurant_id || !password) {
            return res.status(400).json({ 
                error: 'Nome, telefone, senha e ID do restaurante são obrigatórios' 
            });
        }

        // Validate password strength
        if (password.length < 6) {
            return res.status(400).json({
                error: 'A senha deve ter no mínimo 6 caracteres'
            });
        }

        // Check if phone already exists
        const { data: existing } = await supabase
            .from('deliverers')
            .select('id')
            .eq('phone', phone)
            .single();

        if (existing) {
            return res.status(400).json({ error: 'Telefone já cadastrado' });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        // Create deliverer
        const { data: deliverer, error: delivererError } = await supabase
            .from('deliverers')
            .insert({
                restaurant_id,
                name,
                phone,
                cpf,
                email,
                motorcycle_plate,
                type: 'third-party',
                status: 'active',
                balance: 0,
                rating: 5.0,
                total_deliveries: 0
            })
            .select()
            .single();

        if (delivererError) {
            console.error('❌ Erro ao registrar entregador:', delivererError);
            return res.status(400).json({ error: 'Erro ao registrar entregador' });
        }

        // Store password hash using REST API directly to bypass Supabase client RLS issues
        // This uses SERVICE_ROLE_KEY in Authorization header which guarantees RLS bypass
        console.log(`🔐 Salvando credenciais para deliverer_id: ${deliverer.id}`);
        try {
            const response = await fetch(`${supabaseUrl}/rest/v1/driver_credentials`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify({
                    deliverer_id: deliverer.id,
                    password_hash: passwordHash
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Erro REST API ao salvar credenciais:', errorText);
                throw new Error(`REST API error: ${response.status} - ${errorText}`);
            }
            
            console.log('✅ Credenciais salvas com sucesso via REST API!');
        } catch (credError) {
            console.error('❌ Erro ao salvar credenciais:', credError);
            // Rollback: delete the deliverer record
            await supabase.from('deliverers').delete().eq('id', deliverer.id);
            return res.status(500).json({ error: 'Erro ao criar conta: ' + credError.message });
        }

        const token = jwt.sign(
            { 
                deliverer_id: deliverer.id,
                restaurant_id: deliverer.restaurant_id,
                phone: deliverer.phone,
                role: 'deliverer'
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            success: true,
            token,
            deliverer: {
                id: deliverer.id,
                name: deliverer.name,
                phone: deliverer.phone,
                type: deliverer.type,
                balance: deliverer.balance
            }
        });

    } catch (error) {
        console.error('❌ Erro no registro do entregador:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// =================================================================
// ORDER MANAGEMENT ENDPOINTS
// =================================================================

/**
 * GET /api/driver/orders/available
 * Get list of ALL available orders from ALL restaurants (not accepted yet)
 * Only includes orders with delivery-ready statuses: 'pronto', 'aceito', 'preparo'
 * FILTERS: Only third-party deliveries (delivery_type = 'third-party')
 */
router.get('/orders/available', authenticateDriver, async (req, res) => {
    try {
        // Buscar APENAS pedidos de terceiros (third-party) de TODOS os restaurantes
        // Whitelist de status válidos para pedidos disponíveis (prontos para entrega)
        const validStatuses = ['pronto', 'aceito', 'preparo'];
        
        // Primeiro buscar os pedidos - APENAS THIRD-PARTY
        const { data: orders, error: ordersError } = await supabase
            .from('orders')
            .select('*')
            .in('status', validStatuses)
            .eq('delivery_type', 'third-party')
            .is('deliverer_id', null)
            .order('created_at', { ascending: true });

        if (ordersError) {
            console.error('❌ Erro ao buscar pedidos disponíveis:', ordersError);
            return res.status(500).json({ error: 'Erro ao buscar pedidos' });
        }

        // Para cada pedido, buscar os itens
        const ordersWithItems = await Promise.all(orders.map(async (order) => {
            const { data: items, error: itemsError } = await supabase
                .from('order_items')
                .select('*')
                .eq('order_id', order.id);

            if (itemsError) {
                console.error('❌ Erro ao buscar itens do pedido:', itemsError);
            }

            // Buscar dados do restaurante
            const { data: restaurant, error: restaurantError } = await supabase
                .from('restaurants')
                .select('name, address, city, state, latitude, longitude')
                .eq('id', order.restaurant_id)
                .single();

            if (restaurantError) {
                console.error('❌ Erro ao buscar restaurante:', restaurantError);
            }

            // Geocodificar coordenadas do restaurante se não disponíveis
            let restaurantLat = restaurant?.latitude;
            let restaurantLng = restaurant?.longitude;
            
            if (!restaurantLat || !restaurantLng) {
                console.log(`🗺️ Geocodificando endereço do restaurante: ${restaurant?.name}`);
                const coords = await geocodeAddress(restaurant?.address || '', restaurant?.city || '', restaurant?.state || '');
                if (coords) {
                    restaurantLat = coords.latitude;
                    restaurantLng = coords.longitude;
                    
                    // Atualizar coordenadas no banco para próximas requisições
                    await supabase
                        .from('restaurants')
                        .update({ latitude: coords.latitude, longitude: coords.longitude })
                        .eq('id', order.restaurant_id);
                }
            }

            // Geocodificar coordenadas de entrega se não disponíveis
            let deliveryLat = null;
            let deliveryLng = null;
            
            // Primeiro tentar parsear delivery_coordinates existentes
            const parsedCoords = parseCoordinates(order.delivery_coordinates);
            if (parsedCoords) {
                deliveryLat = parsedCoords.latitude;
                deliveryLng = parsedCoords.longitude;
                
                // Validar se as coordenadas estão no Brasil (latitude: -33 a 5, longitude: -74 a -34)
                const isValidBrazil = deliveryLat >= -33 && deliveryLat <= 5 && deliveryLng >= -74 && deliveryLng <= -34;
                
                console.log(`📍 Coordenadas do banco - Pedido ${order.id}:`);
                console.log(`   delivery_coordinates: ${order.delivery_coordinates}`);
                console.log(`   Parseado: lat=${deliveryLat}, lng=${deliveryLng}`);
                console.log(`   Válido para Brasil? ${isValidBrazil ? '✅' : '❌'}`);
                
                if (!isValidBrazil) {
                    console.warn(`⚠️ Coordenadas inválidas (fora do Brasil)! Re-geocodificando...`);
                    deliveryLat = null;
                    deliveryLng = null;
                }
            }
            
            if (!deliveryLat || !deliveryLng) {
                if (order.delivery_address) {
                    // Se não tem coordenadas ou estão inválidas, geocodificar o endereço
                    console.log(`🗺️ Geocodificando endereço de entrega: ${order.delivery_address}`);
                    const coords = await geocodeAddress(order.delivery_address, '', '');
                    if (coords) {
                        deliveryLat = coords.latitude;
                        deliveryLng = coords.longitude;
                        
                        console.log(`✅ Novo geocoding: lat=${deliveryLat}, lng=${deliveryLng}`);
                        
                        // Atualizar coordenadas no banco
                        const coordsString = `(${coords.latitude},${coords.longitude})`;
                        await supabase
                            .from('orders')
                            .update({ delivery_coordinates: coordsString })
                            .eq('id', order.id);
                        
                        console.log(`💾 Coordenadas salvas no banco: ${coordsString}`);
                    }
                }
            }

            // Construir coordenadas do restaurante se disponíveis
            let restaurantCoordinates = null;
            if (restaurantLat && restaurantLng) {
                restaurantCoordinates = `(${restaurantLat},${restaurantLng})`;
            }

            return {
                id: order.id,
                customer_name: order.customer_name,
                customer_phone: order.customer_phone,
                delivery_address: order.delivery_address,
                delivery_coordinates: order.delivery_coordinates,
                delivery_latitude: deliveryLat,
                delivery_longitude: deliveryLng,
                delivery_fee: order.delivery_fee,
                delivery_distance: order.delivery_distance,
                delivery_duration: order.delivery_duration,
                subtotal: order.subtotal,
                total: order.total,
                status: order.status,
                created_at: order.created_at,
                restaurant_name: restaurant?.name || 'Restaurante',
                restaurant_address: restaurant?.address || '',
                restaurant_city: restaurant?.city || '',
                restaurant_coordinates: restaurantCoordinates,
                restaurant_latitude: restaurantLat,
                restaurant_longitude: restaurantLng,
                order_items: items || []
            };
        }));

        res.json({
            success: true,
            orders: ordersWithItems
        });

    } catch (error) {
        console.error('❌ Erro ao listar pedidos disponíveis:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

/**
 * GET /api/driver/orders/available-with-items
 * Get list of ALL orders with order items (except status 'aguardando')
 */
router.get('/orders/available-with-items', authenticateDriver, async (req, res) => {
    try {
        const { deliverer_id, restaurant_id } = req.driver;

        const { data: orders, error } = await supabase
            .from('orders')
            .select(`
                *,
                restaurants (name, address, city, state, latitude, longitude)
            `)
            .eq('restaurant_id', restaurant_id)
            .neq('status', 'aguardando')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('❌ Erro ao buscar pedidos:', error);
            return res.status(500).json({ error: 'Erro ao buscar pedidos' });
        }

        // Fetch order items for each order
        const ordersWithItems = await Promise.all(orders.map(async (order) => {
            const { data: items } = await supabase
                .from('order_items')
                .select('*')
                .eq('order_id', order.id);

            // Construir coordenadas do restaurante se disponíveis
            let restaurantCoordinates = null;
            if (order.restaurants?.latitude && order.restaurants?.longitude) {
                restaurantCoordinates = `(${order.restaurants.latitude},${order.restaurants.longitude})`;
            }

            return {
                id: order.id,
                customer_name: order.customer_name,
                customer_phone: order.customer_phone,
                delivery_address: order.delivery_address,
                delivery_coordinates: order.delivery_coordinates,
                delivery_fee: order.delivery_fee,
                subtotal: order.subtotal,
                total: order.total,
                status: order.status,
                created_at: order.created_at,
                payment_method: order.payment_method,
                notes: order.notes,
                restaurant_name: order.restaurants?.name,
                restaurant_address: order.restaurants?.address,
                restaurant_city: order.restaurants?.city,
                restaurant_coordinates: restaurantCoordinates,
                restaurant_latitude: order.restaurants?.latitude || null,
                restaurant_longitude: order.restaurants?.longitude || null,
                items: items || []
            };
        }));

        res.json({
            success: true,
            orders: ordersWithItems
        });

    } catch (error) {
        console.error('❌ Erro ao listar pedidos disponíveis:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

/**
 * POST /api/driver/orders/:orderId/accept
 * Accept a delivery order
 */
router.post('/orders/:orderId/accept', authenticateDriver, async (req, res) => {
    try {
        const { orderId } = req.params;
        const { deliverer_id } = req.driver;

        const { data: order, error } = await supabase
            .from('orders')
            .update({
                deliverer_id,
                status: 'saiu_entrega',
                updated_at: new Date().toISOString()
            })
            .eq('id', orderId)
            .is('deliverer_id', null)
            .select()
            .single();

        if (error || !order) {
            return res.status(400).json({ 
                error: 'Pedido não disponível ou já foi aceito por outro entregador' 
            });
        }

        await supabase
            .from('deliverers')
            .update({ status: 'busy' })
            .eq('id', deliverer_id);

        res.json({
            success: true,
            message: 'Pedido aceito com sucesso',
            order: {
                id: order.id,
                delivery_address: order.delivery_address,
                delivery_coordinates: order.delivery_coordinates,
                delivery_fee: order.delivery_fee,
                status: order.status
            }
        });

    } catch (error) {
        console.error('❌ Erro ao aceitar pedido:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

/**
 * POST /api/driver/orders/:orderId/reject
 * Reject a delivery order
 */
router.post('/orders/:orderId/reject', authenticateDriver, async (req, res) => {
    try {
        const { orderId } = req.params;

        res.json({
            success: true,
            message: 'Pedido recusado'
        });

    } catch (error) {
        console.error('❌ Erro ao recusar pedido:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

/**
 * GET /api/driver/orders/active
 * Get driver's active deliveries
 */
router.get('/orders/active', authenticateDriver, async (req, res) => {
    try {
        const { deliverer_id } = req.driver;

        // Buscar pedidos sem joins problemáticos
        const { data: orders, error: ordersError } = await supabase
            .from('orders')
            .select('*')
            .eq('deliverer_id', deliverer_id)
            .in('status', ['saiu_entrega'])
            .order('created_at', { ascending: true });

        if (ordersError) {
            console.error('❌ Erro ao buscar entregas ativas:', ordersError);
            return res.status(500).json({ error: 'Erro ao buscar entregas' });
        }

        // Para cada pedido, buscar os itens e dados do restaurante
        const ordersWithDetails = await Promise.all(orders.map(async (order) => {
            // Buscar itens do pedido
            const { data: items, error: itemsError } = await supabase
                .from('order_items')
                .select('*')
                .eq('order_id', order.id);

            if (itemsError) {
                console.error('❌ Erro ao buscar itens do pedido:', itemsError);
            }

            // Buscar dados do restaurante
            const { data: restaurant, error: restaurantError } = await supabase
                .from('restaurants')
                .select('name, address, city, state, latitude, longitude')
                .eq('id', order.restaurant_id)
                .single();

            if (restaurantError) {
                console.error('❌ Erro ao buscar restaurante:', restaurantError);
            }

            // Construir coordenadas do restaurante se disponíveis
            let restaurantCoordinates = null;
            if (restaurant?.latitude && restaurant?.longitude) {
                restaurantCoordinates = `(${restaurant.latitude},${restaurant.longitude})`;
            }

            return {
                id: order.id,
                customer_name: order.customer_name,
                customer_phone: order.customer_phone,
                pickup_address: restaurant?.address || '',
                restaurant_name: restaurant?.name || 'Restaurante',
                restaurant_address: restaurant?.address || '',
                restaurant_city: restaurant?.city || '',
                restaurant_coordinates: restaurantCoordinates,
                restaurant_latitude: restaurant?.latitude || null,
                restaurant_longitude: restaurant?.longitude || null,
                delivery_address: order.delivery_address,
                delivery_coordinates: order.delivery_coordinates,
                delivery_fee: order.delivery_fee,
                subtotal: order.subtotal,
                total: order.total,
                status: order.status,
                created_at: order.created_at,
                order_items: items || []
            };
        }));

        res.json({
            success: true,
            orders: ordersWithDetails
        });

    } catch (error) {
        console.error('❌ Erro ao listar entregas ativas:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

/**
 * PUT /api/driver/orders/:orderId/status
 * Update order status (picked_up, delivered, etc.)
 */
router.put('/orders/:orderId/status', authenticateDriver, async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status } = req.body;
        const { deliverer_id } = req.driver;

        if (!status) {
            return res.status(400).json({ error: 'Status é obrigatório' });
        }

        const validStatuses = ['saiu_entrega', 'entregue'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Status inválido' });
        }

        const updateData = {
            status,
            updated_at: new Date().toISOString()
        };

        if (status === 'entregue') {
            updateData.delivery_time = new Date().toISOString();
        }

        const { data: order, error } = await supabase
            .from('orders')
            .update(updateData)
            .eq('id', orderId)
            .eq('deliverer_id', deliverer_id)
            .select()
            .single();

        if (error || !order) {
            return res.status(400).json({ error: 'Pedido não encontrado' });
        }

        if (status === 'entregue') {
            const { data: deliverer } = await supabase
                .from('deliverers')
                .select('balance, total_deliveries')
                .eq('id', deliverer_id)
                .single();

            await supabase
                .from('deliverers')
                .update({
                    balance: (deliverer.balance || 0) + (order.delivery_fee || 0),
                    total_deliveries: (deliverer.total_deliveries || 0) + 1,
                    status: 'active'
                })
                .eq('id', deliverer_id);
        }

        res.json({
            success: true,
            message: `Pedido marcado como ${status}`,
            order: {
                id: order.id,
                status: order.status
            }
        });

    } catch (error) {
        console.error('❌ Erro ao atualizar status do pedido:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// =================================================================
// LOCATION TRACKING ENDPOINTS
// =================================================================

/**
 * PUT /api/driver/location
 * Update driver's current location (GPS tracking)
 */
router.put('/location', authenticateDriver, async (req, res) => {
    try {
        const { latitude, longitude } = req.body;
        const { deliverer_id } = req.driver;

        if (!latitude || !longitude) {
            return res.status(400).json({ 
                error: 'Latitude e longitude são obrigatórias' 
            });
        }

        const { error } = await supabase
            .from('deliverers')
            .update({
                last_location: `(${longitude},${latitude})`,
                last_seen: new Date().toISOString()
            })
            .eq('id', deliverer_id);

        if (error) {
            console.error('❌ Erro ao atualizar localização:', error);
            return res.status(500).json({ error: 'Erro ao atualizar localização' });
        }

        res.json({
            success: true,
            message: 'Localização atualizada'
        });

    } catch (error) {
        console.error('❌ Erro ao atualizar localização:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

/**
 * PUT /api/driver/status
 * Update driver's online/offline status
 */
router.put('/status', authenticateDriver, async (req, res) => {
    try {
        const { status } = req.body;
        const { deliverer_id } = req.driver;

        const validStatuses = ['active', 'inactive', 'busy'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Status inválido' });
        }

        const { error } = await supabase
            .from('deliverers')
            .update({
                status,
                last_seen: new Date().toISOString()
            })
            .eq('id', deliverer_id);

        if (error) {
            console.error('❌ Erro ao atualizar status:', error);
            return res.status(500).json({ error: 'Erro ao atualizar status' });
        }

        res.json({
            success: true,
            message: `Status atualizado para ${status}`
        });

    } catch (error) {
        console.error('❌ Erro ao atualizar status:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// =================================================================
// FINANCIAL ENDPOINTS
// =================================================================

/**
 * GET /api/driver/earnings
 * Get driver's earnings and balance
 */
router.get('/earnings', authenticateDriver, async (req, res) => {
    try {
        const { deliverer_id } = req.driver;

        const { data: deliverer, error: delivererError } = await supabase
            .from('deliverers')
            .select('balance, total_deliveries, rating, commission')
            .eq('id', deliverer_id)
            .single();

        if (delivererError) {
            console.error('❌ Erro ao buscar dados do entregador:', delivererError);
            return res.status(500).json({ error: 'Erro ao buscar dados' });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const { data: todayOrders, error: todayError } = await supabase
            .from('orders')
            .select('delivery_fee')
            .eq('deliverer_id', deliverer_id)
            .eq('status', 'entregue')
            .gte('delivery_time', today.toISOString());

        const todayEarnings = todayOrders?.reduce((sum, order) => 
            sum + (order.delivery_fee || 0), 0) || 0;

        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay());

        const { data: weekOrders, error: weekError } = await supabase
            .from('orders')
            .select('delivery_fee')
            .eq('deliverer_id', deliverer_id)
            .eq('status', 'entregue')
            .gte('delivery_time', weekStart.toISOString());

        const weekEarnings = weekOrders?.reduce((sum, order) => 
            sum + (order.delivery_fee || 0), 0) || 0;

        res.json({
            success: true,
            earnings: {
                balance: deliverer.balance || 0,
                today: todayEarnings,
                week: weekEarnings,
                total_deliveries: deliverer.total_deliveries || 0,
                rating: deliverer.rating || 5.0
            }
        });

    } catch (error) {
        console.error('❌ Erro ao buscar ganhos:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

/**
 * GET /api/driver/history
 * Get delivery history
 */
router.get('/history', authenticateDriver, async (req, res) => {
    try {
        const { deliverer_id } = req.driver;
        const { limit = 50, offset = 0 } = req.query;

        const { data: orders, error } = await supabase
            .from('orders')
            .select(`
                id,
                customer_name,
                delivery_address,
                delivery_fee,
                total,
                status,
                created_at,
                delivery_time
            `)
            .eq('deliverer_id', deliverer_id)
            .eq('status', 'entregue')
            .order('delivery_time', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            console.error('❌ Erro ao buscar histórico:', error);
            return res.status(500).json({ error: 'Erro ao buscar histórico' });
        }

        res.json({
            success: true,
            history: orders
        });

    } catch (error) {
        console.error('❌ Erro ao buscar histórico:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

/**
 * POST /api/driver/withdrawal
 * Request withdrawal to Asaas account
 */
router.post('/withdrawal', authenticateDriver, async (req, res) => {
    try {
        const { amount } = req.body;
        const { deliverer_id } = req.driver;

        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Valor inválido' });
        }

        const { data: deliverer, error: delivererError } = await supabase
            .from('deliverers')
            .select('balance, name, cpf, email')
            .eq('id', deliverer_id)
            .single();

        if (delivererError || !deliverer) {
            return res.status(404).json({ error: 'Entregador não encontrado' });
        }

        if (deliverer.balance < amount) {
            return res.status(400).json({ 
                error: 'Saldo insuficiente',
                balance: deliverer.balance
            });
        }

        const { error: updateError } = await supabase
            .from('deliverers')
            .update({
                balance: deliverer.balance - amount
            })
            .eq('id', deliverer_id);

        if (updateError) {
            return res.status(500).json({ error: 'Erro ao processar saque' });
        }

        res.json({
            success: true,
            message: 'Saque solicitado com sucesso',
            withdrawal: {
                amount,
                new_balance: deliverer.balance - amount,
                status: 'pending'
            }
        });

    } catch (error) {
        console.error('❌ Erro ao processar saque:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// =================================================================
// HEAT MAP ENDPOINT
// =================================================================

/**
 * GET /api/driver/heatmap
 * Get order density heat map data for strategic positioning
 */
router.get('/heatmap', authenticateDriver, async (req, res) => {
    try {
        const { restaurant_id } = req.driver;

        const last24Hours = new Date();
        last24Hours.setHours(last24Hours.getHours() - 24);

        const { data: orders, error } = await supabase
            .from('orders')
            .select('delivery_coordinates, created_at')
            .eq('restaurant_id', restaurant_id)
            .not('delivery_coordinates', 'is', null)
            .gte('created_at', last24Hours.toISOString());

        if (error) {
            console.error('❌ Erro ao buscar dados do mapa de calor:', error);
            return res.status(500).json({ error: 'Erro ao buscar dados' });
        }

        const heatmapData = orders.map(order => {
            const coords = order.delivery_coordinates.match(/\(([^,]+),([^)]+)\)/);
            if (coords) {
                return {
                    longitude: parseFloat(coords[1]),
                    latitude: parseFloat(coords[2]),
                    weight: 1
                };
            }
            return null;
        }).filter(Boolean);

        res.json({
            success: true,
            heatmap: heatmapData,
            count: heatmapData.length
        });

    } catch (error) {
        console.error('❌ Erro ao gerar mapa de calor:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// =================================================================
// MIDDLEWARE
// =================================================================

function authenticateDriver(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Token de autenticação requerido' });
        }
        
        const token = authHeader.substring(7);
        const jwt = require('jsonwebtoken');
        
        const decoded = jwt.verify(
            token, 
            process.env.JWT_SECRET || 'timepulse_driver_secret_2025'
        );
        
        if (decoded.role !== 'deliverer') {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        
        req.driver = {
            deliverer_id: decoded.deliverer_id,
            restaurant_id: decoded.restaurant_id,
            phone: decoded.phone
        };
        
        next();
    } catch (error) {
        console.error('❌ Erro na autenticação do entregador:', error);
        res.status(401).json({ error: 'Token inválido ou expirado' });
    }
}

module.exports = router;
