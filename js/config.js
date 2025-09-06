// Supabase Configuration  
const SUPABASE_CONFIG = {
    // Se estiver em desenvolvimento (Replit/localhost), usar banco local simulado
    url: (window.location.hostname.includes('replit') || window.location.hostname.includes('localhost')) 
        ? 'https://sguirxaunajirfvlzbac.supabase.co'  // Manter Supabase externo por enquanto
        : 'https://sguirxaunajirfvlzbac.supabase.co',
    anon_key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNndWlyeGF1bmFqaXJmdmx6YmFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAwOTQ4MDIsImV4cCI6MjA2NTY3MDgwMn0.5vQj3LmBbpP0WosMwreboRww97wZyXBByQqG8oaI59k'
};

// Initialize Supabase client (Singleton pattern)
let _supabaseClient = null;

function initializeSupabase() {
    // Return existing instance if already created
    if (_supabaseClient) {
        return _supabaseClient;
    }
    
    if (typeof window.supabase === 'undefined') {
        console.warn('Supabase library not loaded');
        return null;
    }
    
    try {
        _supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anon_key);
        console.log('✅ Supabase client initialized (singleton)');
        return _supabaseClient;
    } catch (error) {
        console.error('Error initializing Supabase:', error);
        return null;
    }
}

// Reset Supabase client (useful for testing)
function resetSupabaseClient() {
    _supabaseClient = null;
}

// Validate Supabase configuration
function validateSupabaseConfig() {
    return SUPABASE_CONFIG.url && SUPABASE_CONFIG.anon_key && 
           SUPABASE_CONFIG.url.includes('supabase.co');
}

// API Configuration
const API_CONFIG = {
    evolution: {
        serverUrl: 'https://evolution.timepulseai.com.br',
        apiKey: '47bcf64b538508dde3adbcab3b7cad89'
    },
    mapbox: {
        accessToken: window.MAPBOX_PUBLIC_KEY || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
            ? 'pk.eyJ1IjoidGltZXB1bHNlYWkiLCJhIjoiY2xoOXV5dXJhMDFndzNobzd3cjF3ZDR1ZCJ9.example' 
            : null)
    },
    openai: {
        // OpenAI key should be handled server-side for security
        baseUrl: 'https://api.openai.com/v1'
    },
    officeIntegrator: {
        apiKey: 'fc971663a1f7cd6e19b9b9b4ae4c1b895c4cc21fe19a51462469a1a069cd8235',
        baseUrl: 'https://api.office-integrator.com/writer/officeapi/v1',
        domain: 'timepulseai.com.br'
    },
    // Domínios e configurações da aplicação
    app: {
        domain: window.location.hostname.includes('replit') || window.location.hostname.includes('localhost') 
            ? `${window.location.protocol}//${window.location.host}`
            : 'https://timepulseai.com.br',
        name: 'TimePulseAI',
        supportEmail: 'contato@timepulseai.com.br'
    }
};

// Global configuration
const APP_CONFIG = {
    appName: 'TimePulse AI',
    version: '1.0.0',
    debug: true,
    port: 3001,
    nodeEnv: window.location.hostname.includes('replit') || window.location.hostname.includes('localhost') ? 'development' : 'production',
    sessionTimeout: 3600000,
    features: {
        notifications: true,
        realTimeUpdates: true,
        mapIntegration: true,
        whatsappIntegration: true
    }
};

// Cookie domain handler for Replit environment
function handleCookieDomain() {
    const isReplitOrLocal = window.location.hostname.includes('replit') || 
                           window.location.hostname.includes('localhost') || 
                           window.location.hostname.includes('127.0.0.1');
    
    if (isReplitOrLocal) {
        // Override document.cookie behavior to handle domain issues
        const originalCookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') || 
                                       Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
        
        if (originalCookieDescriptor && originalCookieDescriptor.set) {
            Object.defineProperty(document, 'cookie', {
                get: originalCookieDescriptor.get,
                set: function(cookieString) {
                    // Remove domain restrictions for development environment
                    const cleanedCookie = cookieString.replace(/;\s*domain=[^;]+/gi, '');
                    originalCookieDescriptor.set.call(this, cleanedCookie);
                },
                configurable: true
            });
        }
    }
}

// Initialize cookie domain handler
handleCookieDomain();

// Instance Management System
const INSTANCE_MANAGER = {
    // Cookie names
    COOKIES: {
        INSTANCE_ID: 'timepulse_instance_id',
        INSTANCE_NAME: 'timepulse_instance_name', 
        INSTANCE_TOKEN: 'timepulse_instance_token',
        INSTANCE_TYPE: 'timepulse_instance_type',
        USER_EMAIL: 'timepulse_user_email',
        RESTAURANT_ID: 'timepulse_restaurant_id'
    },

    // Set instance data in cookies
    setInstance(instanceData) {
        const expiry = new Date();
        expiry.setTime(expiry.getTime() + (24 * 60 * 60 * 1000)); // 24 hours
        const cookieOptions = `expires=${expiry.toUTCString()}; path=/; SameSite=Lax`;
        
        document.cookie = `${this.COOKIES.INSTANCE_ID}=${instanceData.instanceId}; ${cookieOptions}`;
        document.cookie = `${this.COOKIES.INSTANCE_NAME}=${encodeURIComponent(instanceData.instanceName)}; ${cookieOptions}`;
        document.cookie = `${this.COOKIES.INSTANCE_TOKEN}=${instanceData.token}; ${cookieOptions}`;
        document.cookie = `${this.COOKIES.INSTANCE_TYPE}=${instanceData.type || 'restaurant'}; ${cookieOptions}`;
        document.cookie = `${this.COOKIES.USER_EMAIL}=${encodeURIComponent(instanceData.userEmail)}; ${cookieOptions}`;
        document.cookie = `${this.COOKIES.RESTAURANT_ID}=${instanceData.restaurantId || ''}; ${cookieOptions}`;
        
        if (APP_CONFIG.debug) {
            console.log('Instance data saved to cookies:', instanceData);
        }
    },

    // Get instance data from cookies
    getInstance() {
        const cookies = this.getCookies();
        
        if (!cookies[this.COOKIES.INSTANCE_ID]) {
            return null;
        }
        
        return {
            instanceId: cookies[this.COOKIES.INSTANCE_ID],
            instanceName: decodeURIComponent(cookies[this.COOKIES.INSTANCE_NAME] || ''),
            token: cookies[this.COOKIES.INSTANCE_TOKEN],
            type: cookies[this.COOKIES.INSTANCE_TYPE] || 'restaurant',
            userEmail: decodeURIComponent(cookies[this.COOKIES.USER_EMAIL] || ''),
            restaurantId: cookies[this.COOKIES.RESTAURANT_ID] || ''
        };
    },

    // Check if user is authenticated with an instance
    isAuthenticated() {
        const instance = this.getInstance();
        return instance && instance.instanceId && instance.token;
    },

    // Logout and clear instance data
    logout() {
        const cookieNames = Object.values(this.COOKIES);
        cookieNames.forEach(cookieName => {
            document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
        });
        
        if (APP_CONFIG.debug) {
            console.log('Instance data cleared - user logged out');
        }
    },

    // Helper function to parse cookies
    getCookies() {
        const cookies = {};
        document.cookie.split(';').forEach(cookie => {
            const [name, value] = cookie.trim().split('=');
            if (name && value) {
                cookies[name] = value;
            }
        });
        return cookies;
    },

    // Redirect to login if not authenticated
    requireAuth() {
        if (!this.isAuthenticated()) {
            window.location.href = 'login.html';
            return false;
        }
        return true;
    },

    // Filter data by current instance
    filterByInstance(data, instanceField = 'instanceId') {
        const currentInstance = this.getInstance();
        if (!currentInstance || !data) return data;
        
        if (Array.isArray(data)) {
            return data.filter(item => item[instanceField] === currentInstance.instanceId);
        }
        
        return data[instanceField] === currentInstance.instanceId ? data : null;
    },

    // Add instance filter to API requests
    addInstanceFilter(params = {}) {
        const currentInstance = this.getInstance();
        if (currentInstance) {
            params.instanceId = currentInstance.instanceId;
            params.restaurantId = currentInstance.restaurantId;
        }
        return params;
    }
};

// Utility functions
function showNotification(message, type = 'info') {
    if (APP_CONFIG.debug) {
        console.log(`[${type.toUpperCase()}] ${message}`);
    }
    
    // In a real implementation, you would show a toast notification here
    const notification = document.createElement('div');
    notification.className = `alert alert-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'error' ? '#dc3545' : type === 'success' ? '#28a745' : '#17a2b8'};
        color: white;
        padding: 12px 20px;
        border-radius: 4px;
        z-index: 9999;
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Add CSS for notification animation
const notificationStyles = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
`;

const styleSheet = document.createElement('style');
styleSheet.textContent = notificationStyles;
document.head.appendChild(styleSheet);

// ===== VISUAL THEME MANAGER =====
const THEME_MANAGER = {
    // Aplicar tema personalizado baseado nas configurações do restaurante
    async applyCustomTheme() {
        try {
            const instance = INSTANCE_MANAGER.getInstance();
            if (!instance || !instance.restaurantId) {
                console.log('No restaurant instance found, using default theme');
                return;
            }

            const supabase = initializeSupabase();
            if (!supabase) {
                console.warn('Supabase not available, using default theme');
                return;
            }

            // Buscar configurações visuais do restaurante
            const { data: restaurant, error } = await supabase
                .from('restaurants')
                .select('primary_color, logo_url, name')
                .eq('id', instance.restaurantId)
                .single();

            if (error) {
                console.warn('Error loading restaurant theme:', error);
                return;
            }

            if (restaurant) {
                this.applyThemeVariables(restaurant);
                this.updateBrandElements(restaurant);
                
                if (APP_CONFIG.debug) {
                    console.log('Custom theme applied:', restaurant);
                }
            }

        } catch (error) {
            console.error('Error applying custom theme:', error);
        }
    },

    // Aplicar variáveis CSS personalizadas
    applyThemeVariables(restaurant) {
        const root = document.documentElement;
        
        if (restaurant.primary_color) {
            // Cor primária
            root.style.setProperty('--primary-color', restaurant.primary_color);
            
            // Calcular cor mais escura para hover
            const darkerColor = this.darkenColor(restaurant.primary_color, 15);
            root.style.setProperty('--primary-dark', darkerColor);
            root.style.setProperty('--primary-color-dark', darkerColor);
            
            // Aplicar cor aos botões de sucesso também se for verde
            if (restaurant.primary_color.includes('28a745') || restaurant.primary_color.includes('green')) {
                root.style.setProperty('--success-color', restaurant.primary_color);
            }
        }
    },

    // Atualizar elementos de marca
    updateBrandElements(restaurant) {
        // Atualizar logo se especificado
        if (restaurant.logo_url) {
            const logoElements = document.querySelectorAll('.logo-image, .brand-logo');
            logoElements.forEach(logo => {
                if (logo.tagName === 'IMG') {
                    logo.src = restaurant.logo_url;
                    logo.alt = restaurant.name;
                } else {
                    logo.style.backgroundImage = `url(${restaurant.logo_url})`;
                    logo.style.backgroundSize = 'contain';
                    logo.style.backgroundRepeat = 'no-repeat';
                    logo.style.backgroundPosition = 'center';
                }
            });
        }

        // Atualizar nome da marca onde aplicável
        const brandNameElements = document.querySelectorAll('.brand-name, .restaurant-brand');
        brandNameElements.forEach(element => {
            if (restaurant.name) {
                element.textContent = restaurant.name;
            }
        });
    },

    // Função para escurecer cor (hexadecimal)
    darkenColor(hex, percent) {
        // Remover # se presente
        hex = hex.replace('#', '');
        
        // Converter para RGB
        const num = parseInt(hex, 16);
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        
        // Aplicar escurecimento
        const factor = (100 - percent) / 100;
        const newR = Math.round(r * factor);
        const newG = Math.round(g * factor);
        const newB = Math.round(b * factor);
        
        // Converter de volta para hex
        return `#${((newR << 16) | (newG << 8) | newB).toString(16).padStart(6, '0')}`;
    },

    // Aplicar tema imediatamente se o DOM estiver pronto
    init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.applyCustomTheme());
        } else {
            this.applyCustomTheme();
        }
    },

    // Escutar mudanças de configuração e reaplicar tema
    watchForChanges() {
        // Escutar eventos personalizados de mudança de tema
        document.addEventListener('themeChanged', () => {
            this.applyCustomTheme();
        });

        // Escutar mudanças de instância
        const originalSetInstance = INSTANCE_MANAGER.setInstance;
        INSTANCE_MANAGER.setInstance = function(instanceData) {
            originalSetInstance.call(this, instanceData);
            // Aplicar novo tema após mudança de instância
            setTimeout(() => THEME_MANAGER.applyCustomTheme(), 100);
        };
    }
};

// Inicializar o gerenciador de temas
THEME_MANAGER.init();
THEME_MANAGER.watchForChanges();

// Export for global use
window.initializeSupabase = initializeSupabase;
window.resetSupabaseClient = resetSupabaseClient;
window.validateSupabaseConfig = validateSupabaseConfig;
window.showNotification = showNotification;
window.APP_CONFIG = APP_CONFIG;
window.API_CONFIG = API_CONFIG;
window.SUPABASE_CONFIG = SUPABASE_CONFIG;
window.INSTANCE_MANAGER = INSTANCE_MANAGER;
window.THEME_MANAGER = THEME_MANAGER;

console.log('TimePulse AI Configuration loaded with Supabase integration');
if (APP_CONFIG.nodeEnv === 'development') {
    console.log('Development mode: Cookie domain restrictions have been disabled for Replit compatibility');
}