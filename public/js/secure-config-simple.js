/**
 * Versão simplificada do secure-config para produção
 * Elimina erros de tentativas de conexão desnecessárias
 */

// Sistema de ocultação de logs para produção
if (typeof console !== 'undefined') {
    console.log = function() {};
    console.warn = function() {};
    console.error = function() {};
    console.info = function() {};
    console.debug = function() {};
}

// Configuração para produção - sem credenciais hardcoded
const STATIC_PRODUCTION_CONFIG = {
    supabase: {
        // Credenciais devem vir do servidor por segurança
        url: null,
        anon_key: null
    },
    apis: {
        backend: 'https://timepulseai.com.br:3001',
        backendDirect: 'https://api.timepulseai.com.br'
    },
    app: {
        name: 'TimePulse AI',
        domain: 'https://timepulseai.com.br',
        supportEmail: 'contato@timepulseai.com.br',
        version: '1.0.0'
    },
    features: {
        notifications: true,
        realTimeUpdates: true,
        mapIntegration: true,
        whatsappIntegration: true
    },
    environment: 'production',
    debug: false
};

// Sistema simplificado de configuração
class SimpleConfigManager {
    constructor() {
        this.config = null;
        this.initialized = false;
    }
    
    async init() {
        if (this.initialized) {
            return this.config;
        }
        
        const hostname = window.location.hostname;
        const isProduction = hostname === 'timepulseai.com.br' || hostname === 'www.timepulseai.com.br';
        
        if (isProduction) {
            console.log('🌐 Ambiente de produção - usando configuração estática');
            this.config = STATIC_PRODUCTION_CONFIG;
            this.initialized = true;
            return this.config;
        }
        
        // Em desenvolvimento, tentar API uma vez apenas
        try {
            const response = await fetch('/api/config', {
                credentials: 'include',
                headers: { 'Accept': 'application/json' }
            });
            
            if (response.ok) {
                this.config = await response.json();
                console.log('📋 Configuração carregada via API');
            } else {
                throw new Error('API não disponível');
            }
        } catch (error) {
            console.log('⚠️ Usando configuração fallback');
            this.config = {
                app: {
                    name: 'TimePulse AI',
                    domain: window.location.origin,
                    supportEmail: 'contato@timepulseai.com.br',
                    version: '1.0.0'
                },
                features: {
                    notifications: true,
                    realTimeUpdates: true,
                    mapIntegration: true,
                    whatsappIntegration: true
                },
                environment: 'development',
                debug: true
            };
        }
        
        this.initialized = true;
        return this.config;
    }
    
    getConfig() {
        return this.config;
    }
}

// Sistema simplificado de Supabase
class SimpleSupabaseManager {
    constructor() {
        this.client = null;
        this.initialized = false;
    }
    
    async getClient() {
        if (this.initialized) {
            return this.client;
        }
        
        const hostname = window.location.hostname;
        const isProduction = hostname === 'timepulseai.com.br' || hostname === 'www.timepulseai.com.br';
        
        if (isProduction) {
            // Em produção, usar configuração estática
            try {
                if (!window.supabase) {
                    const script = document.createElement('script');
                    script.src = 'https://unpkg.com/@supabase/supabase-js@2';
                    document.head.appendChild(script);
                    
                    await new Promise((resolve, reject) => {
                        script.onload = resolve;
                        script.onerror = reject;
                    });
                }
                
                const { createClient } = window.supabase;
                this.client = createClient(
                    STATIC_PRODUCTION_CONFIG.supabase.url,
                    STATIC_PRODUCTION_CONFIG.supabase.anon_key
                );
                
                console.log('✅ Supabase inicializado (produção)');
            } catch (error) {
                console.warn('⚠️ Erro ao inicializar Supabase:', error);
                this.client = null;
            }
        } else {
            // Em desenvolvimento, tentar API uma vez
            try {
                const response = await fetch('/api/config/supabase', {
                    credentials: 'include',
                    headers: { 'Accept': 'application/json' }
                });
                
                if (response.ok) {
                    const config = await response.json();
                    
                    if (!window.supabase) {
                        const script = document.createElement('script');
                        script.src = 'https://unpkg.com/@supabase/supabase-js@2';
                        document.head.appendChild(script);
                        
                        await new Promise((resolve, reject) => {
                            script.onload = resolve;
                            script.onerror = reject;
                        });
                    }
                    
                    const { createClient } = window.supabase;
                    this.client = createClient(config.url, config.anon_key);
                    console.log('✅ Supabase inicializado (desenvolvimento)');
                } else {
                    throw new Error('API Supabase não disponível');
                }
            } catch (error) {
                console.warn('⚠️ Supabase não disponível');
                this.client = null;
            }
        }
        
        this.initialized = true;
        return this.client;
    }
}

// Sistema simplificado de instâncias
const SIMPLE_INSTANCE_MANAGER = {
    isAuthenticated() {
        try {
            const token = document.cookie
                .split('; ')
                .find(row => row.startsWith('timepulse_instance_token='));
            return !!token;
        } catch {
            return false;
        }
    },
    
    setInstance(data) {
        try {
            document.cookie = `timepulse_instance_token=${JSON.stringify(data)}; path=/; secure; samesite=strict`;
            console.log('💾 Dados da instância salvos');
        } catch (error) {
            console.warn('⚠️ Erro ao salvar dados da instância:', error);
        }
    }
};

// Inicialização
const simpleConfig = new SimpleConfigManager();
const simpleSupabase = new SimpleSupabaseManager();

// Disponibilizar globalmente
window.simpleConfig = simpleConfig;
window.simpleSupabase = simpleSupabase;
window.SIMPLE_INSTANCE_MANAGER = SIMPLE_INSTANCE_MANAGER;

// Compatibilidade com código existente
window.SECURE_INSTANCE_MANAGER = SIMPLE_INSTANCE_MANAGER;

console.log('🔒 Sistema de configuração simplificado carregado');