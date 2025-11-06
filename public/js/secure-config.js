// ===== CONFIGURAÇÃO SEGURA TIMEPULSE AI =====
// Sistema de configuração e cookies seguros
// NOTA: Logs desabilitados no arquivo principal assinaturas.html

class SecureConfigManager {
    constructor() {
        this.config = null;
        this.supabaseConfig = null;
        this.apisConfig = null;
        this.isInitialized = false;
        
        // Cache de configurações
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutos
        
        // Bind methods
        this.init = this.init.bind(this);
        this.fetchConfig = this.fetchConfig.bind(this);
    }
    
    // ===== INICIALIZAÇÃO =====
    async init() {
        if (this.isInitialized) {
            return this.config;
        }
        
        try {
            console.log('🔧 Inicializando configuração segura...');
            
            // 1. Carregar configurações básicas
            await this.fetchConfig();
            
            // 2. Aplicar configurações de segurança de cookies
            this.setupCookieSecurity();
            
            this.isInitialized = true;
            console.log('✅ Configuração segura inicializada');
            
            return this.config;
        } catch (error) {
            console.error('❌ Erro ao inicializar configuração segura:', error);
            throw error;
        }
    }
    
    
    // ===== BUSCAR CONFIGURAÇÕES DO SERVIDOR =====
    async fetchConfig() {
        const cacheKey = 'basic_config';
        const cached = this.getFromCache(cacheKey);
        
        if (cached) {
            this.config = cached;
            return cached;
        }
        
        try {
            // FORÇAR URL RELATIVA - NÃO CONSTRUIR URLs ABSOLUTAS
            const configUrl = '/api/config';
            
            console.log(`📋 Buscando configuração via URL relativa: ${configUrl}`);
            
            const response = await fetch(configUrl, {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            if (!response.ok) {
                // Se falhar, tentar URL alternativa na porta 5000
                if (response.status === 404) {
                    console.log(`⚠️ Endpoint ${configUrl} não encontrado. Tentando servidor na porta 5000...`);
                    
                    try {
                        // Detectar ambiente corretamente
                        const hostname = window.location.hostname;
                        const port = window.location.port;
                        
                        const isReplit = hostname.includes('replit') || 
                                       hostname.includes('repl.co') || 
                                       hostname.includes('replit.dev') ||
                                       port === '5000';
                        
                        const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
                        const isProduction = hostname === 'timepulseai.com.br' || hostname === 'www.timepulseai.com.br';
                        
                        console.log(`🔍 Detecção de ambiente:`, {
                            hostname,
                            port,
                            isReplit,
                            isLocalhost,
                            isProduction,
                            origin: window.location.origin
                        });
                        
                        // SEMPRE USAR URL RELATIVA - NUNCA CONSTRUIR URLs EXTERNAS (para evitar 429)
                        console.log(`🔄 FORÇANDO URL RELATIVA para evitar 429 - ambiente: ${hostname}`);
                        throw new Error('Pular tentativa de URL alternativa');
                        
                        // Detectar protocolo correto baseado no ambiente
                        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                        const protocol = isLocal ? 'http' : 'https';
                        const alternativeUrl = `${protocol}://${window.location.hostname}:5000/api/config`;
                        console.log(`🔄 Tentando URL alternativa (${protocol}): ${alternativeUrl}`);
                        
                        const altResponse = await fetch(alternativeUrl, {
                            method: 'GET',
                            credentials: 'include',
                            headers: {
                                'Accept': 'application/json'
                            }
                        });
                        
                        if (altResponse.ok) {
                            console.log(`✅ Conectado ao servidor de configuração na porta 5000`);
                            const config = await altResponse.json();
                            this.config = config;
                            this.setCache(cacheKey, config);
                            console.log('📋 Configuração básica carregada via porta 5000');
                            return config;
                        }
                    } catch (portError) {
                        console.log(`❌ Servidor de configuração na porta 5000 não disponível`);
                    }
                }
                
                throw new Error(`Erro ao carregar configuração: ${response.status}`);
            }
            
            const config = await response.json();
            this.config = config;
            
            // Cache da configuração
            this.setCache(cacheKey, config);
            
            console.log('📋 Configuração básica carregada');
            return config;
        } catch (error) {
            console.error('❌ Erro ao carregar configuração:', error);
            
            // Fallback para configuração mínima
            this.config = {
                app: {
                    name: 'TimePulse AI',
                    version: '1.0.0',
                    domain: window.location.origin
                },
                environment: 'development',
                debug: true,
                features: {
                    notifications: true,
                    realTimeUpdates: true,
                    mapIntegration: true,
                    whatsappIntegration: true
                }
            };
            
            return this.config;
        }
    }
    
    // ===== BUSCAR CONFIGURAÇÕES DO SUPABASE =====
    async getSupabaseConfig() {
        if (this.supabaseConfig) {
            return this.supabaseConfig;
        }
        
        const cacheKey = 'supabase_config';
        const cached = this.getFromCache(cacheKey);
        
        if (cached) {
            this.supabaseConfig = cached;
            return cached;
        }
        
        try {
            // Usar URL relativa para garantir que sempre aponte para o servidor correto
            const supabaseUrl = '/api/config/supabase';
            
            const response = await fetch(supabaseUrl, {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            if (!response.ok) {
                if (response.status === 401) {
                    console.warn('⚠️ Token de instância requerido para Supabase');
                    return null;
                }
                
                // Se falhar, tentar URL alternativa na porta 5000
                if (response.status === 404) {
                    console.log(`⚠️ Endpoint Supabase não encontrado. Tentando servidor na porta 5000...`);
                    
                    try {
                        // Detectar ambiente corretamente para Supabase
                        const hostname = window.location.hostname;
                        const port = window.location.port;
                        
                        const isReplit = hostname.includes('replit') || 
                                       hostname.includes('repl.co') || 
                                       hostname.includes('replit.dev') ||
                                       port === '5000';
                        
                        const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
                        const isProduction = hostname === 'timepulseai.com.br' || hostname === 'www.timepulseai.com.br';
                        
                        console.log(`🔍 Supabase - Detecção de ambiente:`, {
                            hostname,
                            port,
                            isReplit,
                            isLocalhost,
                            isProduction,
                            origin: window.location.origin
                        });
                        
                        // SEMPRE USAR URL RELATIVA PARA SUPABASE - NUNCA URLs EXTERNAS (para evitar 429)
                        console.log(`🔄 FORÇANDO URL RELATIVA SUPABASE para evitar 429 - ambiente: ${hostname}`);
                        throw new Error('Pular tentativa de URL alternativa');
                        
                        // Detectar protocolo correto baseado no ambiente
                        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                        const protocol = isLocal ? 'http' : window.location.protocol.replace(':', '');
                        const alternativeUrl = `${protocol}://${window.location.hostname}:5000/api/config/supabase`;
                        console.log(`🔄 Tentando URL alternativa Supabase (${protocol}): ${alternativeUrl}`);
                        
                        const altResponse = await fetch(alternativeUrl, {
                            method: 'GET',
                            credentials: 'include',
                            headers: {
                                'Accept': 'application/json'
                            }
                        });
                        
                        if (altResponse.ok) {
                            console.log(`✅ Conectado ao servidor Supabase na porta 5000`);
                            const supabaseConfig = await altResponse.json();
                            this.supabaseConfig = supabaseConfig;
                            this.setCache(cacheKey, supabaseConfig);
                            console.log('📊 Configuração do Supabase carregada via porta 5000');
                            return supabaseConfig;
                        }
                    } catch (portError) {
                        console.log(`❌ Servidor Supabase na porta 5000 não disponível`);
                    }
                }
                
                throw new Error(`Erro ao carregar config Supabase: ${response.status}`);
            }
            
            const supabaseConfig = await response.json();
            this.supabaseConfig = supabaseConfig;
            
            // Cache da configuração
            this.setCache(cacheKey, supabaseConfig);
            
            console.log('📊 Configuração do Supabase carregada');
            return supabaseConfig;
        } catch (error) {
            console.error('❌ Erro ao carregar configuração do Supabase:', error);
            return null;
        }
    }
    
    // ===== BUSCAR CONFIGURAÇÕES DAS APIS =====
    async getApisConfig() {
        if (this.apisConfig) {
            return this.apisConfig;
        }
        
        const cacheKey = 'apis_config';
        const cached = this.getFromCache(cacheKey);
        
        if (cached) {
            this.apisConfig = cached;
            return cached;
        }
        
        try {
            // Usar URL relativa para garantir que sempre aponte para o servidor correto
            const apisUrl = '/api/config/apis';
            
            const response = await fetch(apisUrl, {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            if (!response.ok) {
                if (response.status === 401) {
                    console.warn('⚠️ Token de instância requerido para APIs');
                    return null;
                }
                
                // Se falhar, tentar URL alternativa na porta 5000
                if (response.status === 404) {
                    console.log(`⚠️ Endpoint APIs não encontrado. Tentando servidor na porta 5000...`);
                    
                    try {
                        // Detectar protocolo correto baseado no ambiente
                        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                        const protocol = isLocal ? 'http' : window.location.protocol.replace(':', '');
                        const alternativeUrl = `${protocol}://${window.location.hostname}:5000/api/config/apis`;
                        console.log(`🔄 Tentando URL alternativa APIs (${protocol}): ${alternativeUrl}`);
                        
                        const altResponse = await fetch(alternativeUrl, {
                            method: 'GET',
                            credentials: 'include',
                            headers: {
                                'Accept': 'application/json'
                            }
                        });
                        
                        if (altResponse.ok) {
                            console.log(`✅ Conectado ao servidor APIs na porta 5000`);
                            const apisConfig = await altResponse.json();
                            this.apisConfig = apisConfig;
                            this.setCache(cacheKey, apisConfig);
                            console.log('🔌 Configuração das APIs carregada via porta 5000');
                            return apisConfig;
                        }
                    } catch (portError) {
                        console.log(`❌ Servidor APIs na porta 5000 não disponível`);
                    }
                }
                
                throw new Error(`Erro ao carregar config APIs: ${response.status}`);
            }
            
            const apisConfig = await response.json();
            this.apisConfig = apisConfig;
            
            // Cache da configuração
            this.setCache(cacheKey, apisConfig);
            
            console.log('🔌 Configuração das APIs carregada');
            return apisConfig;
        } catch (error) {
            console.error('❌ Erro ao carregar configuração das APIs:', error);
            return null;
        }
    }
    
    // ===== REQUISIÇÕES SEGURAS =====
    async secureFetch(url, options = {}) {
        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            ...options.headers
        };
        
        const secureOptions = {
            ...options,
            credentials: 'include', // SEMPRE incluir cookies
            headers
        };
        
        try {
            const response = await fetch(url, secureOptions);
            return response;
        } catch (error) {
            console.error('❌ Erro em requisição segura:', error);
            throw error;
        }
    }
    
    // ===== REQUISIÇÕES PARA APIS EXTERNAS =====
    async evolutionAPI(endpoint, data) {
        return await this.secureFetch(`/api/evolution/${endpoint}`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
    
    // Office Integrator removido
    
    // Nova função para APIs do Backend (traefik_orders-api)
    async backendAPI(endpoint, options = {}) {
        const { method = 'GET', data, params } = options;
        
        // Construir URL com parâmetros se fornecidos
        let url = `/api/backend${endpoint}`;
        if (params) {
            const searchParams = new URLSearchParams(params);
            url += `?${searchParams.toString()}`;
        }
        
        const fetchOptions = {
            method: method,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        };
        
        // Adicionar body para métodos que suportam
        if (['POST', 'PUT', 'PATCH'].includes(method) && data) {
            fetchOptions.body = JSON.stringify(data);
        }
        
        console.log(`🔄 Chamando Backend API: ${method} ${url}`);
        return await this.secureFetch(url, fetchOptions);
    }
    
    // ===== DETECÇÃO DE URL BASE =====
    getBaseUrl() {
        // SEMPRE usar a origem atual para garantir que funcione no ambiente Replit
        const baseUrl = window.location.origin;
        console.log(`🌐 Base URL detectada: ${baseUrl}`);
        return baseUrl;
    }
    
    // ===== CACHE MANAGEMENT =====
    getFromCache(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }
        this.cache.delete(key);
        return null;
    }
    
    setCache(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }
    
    clearCache() {
        this.cache.clear();
        console.log('🧹 Cache de configuração limpo');
    }
    
    // ===== CONFIGURAÇÃO DE SEGURANÇA DE COOKIES =====
    setupCookieSecurity() {
        const isReplit = window.location.hostname.includes('replit') || 
                        window.location.hostname.includes('localhost');
        
        if (isReplit) {
            console.log('🍪 Aplicando configuração de cookies para ambiente Replit');
            
            // Override do comportamento de cookies para desenvolvimento
            const originalCookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') || 
                                           Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
            
            if (originalCookieDescriptor && originalCookieDescriptor.set) {
                Object.defineProperty(document, 'cookie', {
                    get: originalCookieDescriptor.get,
                    set: function(cookieString) {
                        // Remover restrições de domínio para ambiente de desenvolvimento
                        const cleanedCookie = cookieString.replace(/;\s*domain=[^;]+/gi, '');
                        originalCookieDescriptor.set.call(this, cleanedCookie);
                    },
                    configurable: true
                });
            }
        }
    }
    
    // ===== UTILIDADES =====
    isAuthenticated() {
        // Verificar múltiplas formas de armazenamento para garantir compatibilidade com Replit
        const cookie = this.getCookie('timepulse_instance_token');
        const localStorage = window.localStorage.getItem('timepulse_instance_token');
        const sessionStorage = window.sessionStorage.getItem('timepulse_instance_token');
        
        // Detectar ambiente de desenvolvimento
        const isDevelopment = window.location.hostname.includes('replit') || 
                             window.location.hostname === 'localhost' || 
                             window.location.hostname === '127.0.0.1' ||
                             window.location.hostname.includes('replit.dev') ||
                             window.location.hostname.includes('repl.co');
        
        const hasAuth = !!(cookie || localStorage || sessionStorage);
        
        console.log('🔍 Verificação de autenticação:', {
            cookie: !!cookie,
            localStorage: !!localStorage,
            sessionStorage: !!sessionStorage,
            isDevelopment: isDevelopment,
            authenticated: hasAuth
        });
        
        return hasAuth;
    }
    
    getCookie(name) {
        const cookies = document.cookie.split(';');
        for (let cookie of cookies) {
            const [key, value] = cookie.trim().split('=');
            if (key === name) {
                return decodeURIComponent(value);
            }
        }
        return null;
    }
    
    getInstance() {
        // Tentar obter dados de autenticação de múltiplas fontes
        const getAuthData = (key) => {
            return this.getCookie(key) || 
                   window.localStorage.getItem(key) || 
                   window.sessionStorage.getItem(key);
        };
        
        // Se tiver token completo, decodificar JSON
        const fullToken = getAuthData('timepulse_instance_token');
        if (fullToken) {
            try {
                const decoded = JSON.parse(decodeURIComponent(fullToken));
                console.log('✅ Dados de instância encontrados:', decoded.instanceName || 'não definido');
                return decoded;
            } catch (error) {
                console.log('⚠️ Erro ao decodificar token, usando cookies individuais');
            }
        }
        
        // Fallback para cookies individuais (compatibilidade reversa)
        return {
            instanceId: getAuthData('timepulse_instance_id'),
            instanceName: getAuthData('timepulse_instance_name'),
            token: getAuthData('timepulse_instance_token'),
            type: getAuthData('timepulse_instance_type') || 'restaurant',
            userEmail: getAuthData('timepulse_user_email'),
            restaurantId: getAuthData('timepulse_restaurant_id')
        };
    }
}

// ===== GERENCIADOR DE SUPABASE SEGURO =====
class SecureSupabaseManager {
    constructor(configManager) {
        this.configManager = configManager;
        this.client = null;
        this.isInitialized = false;
    }
    
    async init() {
        if (this.isInitialized && this.client) {
            return this.client;
        }
        
        try {
            const supabaseConfig = await this.configManager.getSupabaseConfig();
            
            if (!supabaseConfig) {
                console.warn('⚠️ Configuração do Supabase não disponível');
                return null;
            }
            
            if (typeof window.supabase === 'undefined') {
                console.error('❌ Biblioteca do Supabase não carregada');
                return null;
            }
            
            this.client = window.supabase.createClient(
                supabaseConfig.url, 
                supabaseConfig.anon_key
            );
            
            this.isInitialized = true;
            console.log('✅ Cliente Supabase inicializado de forma segura');
            
            return this.client;
        } catch (error) {
            console.error('❌ Erro ao inicializar Supabase:', error);
            return null;
        }
    }
    
    async getClient() {
        return this.client || await this.init();
    }
    
    reset() {
        this.client = null;
        this.isInitialized = false;
    }
}

// ===== UTILITIES DE SEGURANÇA =====
const SecurityUtils = {
    // Sanitizar texto para prevenir XSS
    sanitizeText(text) {
        if (typeof text !== 'string') return text;
        
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    // Setar texto seguro em elemento (usar textContent)
    setSecureText(element, text) {
        if (element && typeof text === 'string') {
            element.textContent = text;
        }
    },
    
    // Setar HTML apenas para conteúdo conhecido e seguro
    setSecureHTML(element, html, allowedTags = []) {
        if (!element) return;
        
        if (allowedTags.length === 0) {
            element.textContent = html;
            return;
        }
        
        // Implementação básica de sanitização
        // Para produção, usar biblioteca como DOMPurify
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        
        // Remover scripts e outros elementos perigosos
        const scripts = tempDiv.querySelectorAll('script');
        scripts.forEach(script => script.remove());
        
        element.innerHTML = tempDiv.innerHTML;
    },
    
    // Validar email
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    },
    
    // Gerar ID único
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }
};

// ===== SISTEMA DE NOTIFICAÇÕES SEGURO =====
class SecureNotificationManager {
    constructor() {
        this.container = null;
        this.notifications = new Map();
        this.isReady = false;
        
        // Inicializar quando o DOM estiver pronto
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setupContainer());
        } else {
            this.setupContainer();
        }
    }
    
    setupContainer() {
        if (!document.body) {
            // Se document.body ainda não existe, aguardar um pouco mais
            setTimeout(() => this.setupContainer(), 10);
            return;
        }
        
        this.container = document.createElement('div');
        this.container.id = 'secure-notifications';
        this.container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            pointer-events: none;
        `;
        document.body.appendChild(this.container);
        this.isReady = true;
    }
    
    show(message, type = 'info', duration = 5000) {
        if (!this.isReady) {
            // Se ainda não está pronto, aguardar e tentar novamente
            setTimeout(() => this.show(message, type, duration), 100);
            return;
        }
        
        const id = SecurityUtils.generateId();
        const notification = document.createElement('div');
        
        notification.id = `notification-${id}`;
        notification.style.cssText = `
            background: ${this.getTypeColor(type)};
            color: white;
            padding: 12px 20px;
            margin-bottom: 10px;
            border-radius: 4px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            pointer-events: auto;
            cursor: pointer;
            transform: translateX(100%);
            transition: transform 0.3s ease;
            max-width: 300px;
            word-wrap: break-word;
        `;
        
        // Usar textContent para segurança
        SecurityUtils.setSecureText(notification, message);
        
        this.container.appendChild(notification);
        
        // Animar entrada
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 10);
        
        // Auto-remover
        const timeoutId = setTimeout(() => {
            this.remove(id);
        }, duration);
        
        // Remover ao clicar
        notification.addEventListener('click', () => {
            clearTimeout(timeoutId);
            this.remove(id);
        });
        
        this.notifications.set(id, {
            element: notification,
            timeoutId
        });
        
        return id;
    }
    
    remove(id) {
        const notification = this.notifications.get(id);
        if (notification) {
            clearTimeout(notification.timeoutId);
            notification.element.style.transform = 'translateX(100%)';
            
            setTimeout(() => {
                if (notification.element.parentNode) {
                    notification.element.parentNode.removeChild(notification.element);
                }
                this.notifications.delete(id);
            }, 300);
        }
    }
    
    getTypeColor(type) {
        const colors = {
            success: '#28a745',
            error: '#dc3545',
            warning: '#ffc107',
            info: '#17a2b8'
        };
        return colors[type] || colors.info;
    }
    
    clear() {
        this.notifications.forEach((_, id) => this.remove(id));
    }
}

// ===== INSTÂNCIAS GLOBAIS =====
const secureConfig = new SecureConfigManager();
const secureSupabase = new SecureSupabaseManager(secureConfig);
const secureNotifications = new SecureNotificationManager();

// ===== EXPORTAÇÕES GLOBAIS IMEDIATAS =====
// Definir objetos globais imediatamente para evitar erros de referência
window.secureConfig = secureConfig;
window.secureSupabase = secureSupabase;
window.secureNotifications = secureNotifications;
window.SecurityUtils = SecurityUtils;

// ===== INSTÂNCIA MANAGER ATUALIZADA =====
const SECURE_INSTANCE_MANAGER = {
    setInstance(instanceData) {
        const expiry = new Date();
        expiry.setTime(expiry.getTime() + (24 * 60 * 60 * 1000)); // 24 hours
        const cookieOptions = `expires=${expiry.toUTCString()}; path=/; SameSite=Lax; Secure=${location.protocol === 'https:'}`;
        
        document.cookie = `timepulse_instance_id=${instanceData.instanceId}; ${cookieOptions}`;
        document.cookie = `timepulse_instance_name=${encodeURIComponent(instanceData.instanceName)}; ${cookieOptions}`;
        document.cookie = `timepulse_instance_token=${instanceData.token}; ${cookieOptions}`;
        document.cookie = `timepulse_instance_type=${instanceData.type || 'restaurant'}; ${cookieOptions}`;
        document.cookie = `timepulse_user_email=${encodeURIComponent(instanceData.userEmail)}; ${cookieOptions}`;
        document.cookie = `timepulse_restaurant_id=${instanceData.restaurantId || ''}; ${cookieOptions}`;
        
        console.log('🔐 Dados da instância salvos com cookies seguros');
        
        // Limpar cache após mudança de instância
        secureConfig.clearCache();
        secureSupabase.reset();
    },
    
    getInstance() {
        return secureConfig.getInstance();
    },
    
    isAuthenticated() {
        return secureConfig.isAuthenticated();
    },
    
    requireAuth() {
        if (!this.isAuthenticated()) {
            window.location.href = 'login.html';
            return false;
        }
        return true;
    },
    
    logout() {
        const cookieNames = [
            'timepulse_instance_id',
            'timepulse_instance_name', 
            'timepulse_instance_token',
            'timepulse_instance_type',
            'timepulse_user_email',
            'timepulse_restaurant_id',
            'csrf_token'
        ];
        
        cookieNames.forEach(cookieName => {
            document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
        });
        
        // Limpar cache e resetar conexões
        secureConfig.clearCache();
        secureSupabase.reset();
        
        console.log('🚪 Logout realizado - dados limpos');
    }
};

// ===== COMPATIBILIDADE COM CÓDIGO EXISTENTE =====
window.SECURE_INSTANCE_MANAGER = SECURE_INSTANCE_MANAGER;
window.showNotification = (message, type) => secureNotifications.show(message, type);
window.INSTANCE_MANAGER = SECURE_INSTANCE_MANAGER;

// Função global para facilitar acesso às APIs do backend
window.backendAPI = async (endpoint, options = {}) => {
    return await secureConfig.backendAPI(endpoint, options);
};

// ===== INICIALIZAÇÃO AUTOMÁTICA =====
document.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log('🚀 Inicializando sistema de configuração segura...');
        await secureConfig.init();
        console.log('✅ Sistema seguro inicializado com sucesso');
    } catch (error) {
        console.error('❌ Erro na inicialização do sistema seguro:', error);
        secureNotifications.show(
            'Erro na inicialização do sistema. Algumas funcionalidades podem não funcionar.', 
            'error'
        );
    }
});

console.log('🔒 TimePulse AI - Sistema de Configuração Segura carregado');