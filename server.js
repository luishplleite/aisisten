const express = require("express");
const path = require("path");
const helmet = require("helmet");
const cors = require("cors");
const fs = require("fs");
const crypto = require("crypto");

// Polyfill para compatibilidade com Node.js 16
const fetch = require('node-fetch');
const { Headers, Request, Response } = fetch;

if (!globalThis.fetch) {
    globalThis.fetch = fetch;
    globalThis.Headers = Headers;
    globalThis.Request = Request;
    globalThis.Response = Response;
}

const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

// Configuração do pool PostgreSQL para banco de desenvolvimento
const devPool = new Pool({
    host: process.env.PGHOST,
    port: process.env.PGPORT,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD || process.env.DATABASE_PASSWORD,
    database: process.env.PGDATABASE,
    ssl: false
});

const app = express();
// Configuração de porta - usar 3001 para produção Docker, 5000 para Replit
const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = process.env.PORT || (NODE_ENV === 'production' ? 3001 : 5000);
const HOST = process.env.HOST || "0.0.0.0";

// Security middleware - Updated to fix COEP errors
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS configurado para produção
const corsOptions = {
    origin: function (origin, callback) {
        // Obter origens permitidas das variáveis de ambiente
        let allowedOrigins = [];

        // Se CORS_ORIGINS estiver configurado, usar ele
        if (process.env.CORS_ORIGINS) {
            allowedOrigins = process.env.CORS_ORIGINS.split(',').map(url => url.trim());
        } else {
            // Fallback para domínios configurados
            if (process.env.DOMAIN) {
                allowedOrigins.push(`https://${process.env.DOMAIN}`);
                allowedOrigins.push(`https://www.${process.env.DOMAIN}`);
            }
            if (process.env.API_DOMAIN && process.env.API_DOMAIN !== process.env.DOMAIN) {
                allowedOrigins.push(`https://${process.env.API_DOMAIN}`);
            }

            // Fallback para valores hardcoded se nenhuma env var estiver configurada
            if (allowedOrigins.length === 0) {
                allowedOrigins = [
                    'https://timepulseai.com.br',
                    'https://www.timepulseai.com.br'
                ];
            }
        }

        // Para desenvolvimento (Replit ou NODE_ENV não é production), permitir qualquer origem
        if (!origin || process.env.NODE_ENV !== 'production') {
            return callback(null, true);
        }

        // Verificar se a origem está na lista permitida
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.log(`❌ CORS bloqueado para origem: ${origin}`);
            console.log(`   Origens permitidas: ${allowedOrigins.join(', ')}`);
            callback(new Error('Não permitido pelo CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'X-CSRF-Token']
};

app.use(cors(corsOptions));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cache control middleware para evitar cache de HTML e assets críticos
app.use((req, res, next) => {
    // Para arquivos HTML, CSS e JS críticos, evitar cache
    if (req.url.endsWith('.html') || req.url.includes('configuracoes') || req.url.includes('secure-config')) {
        res.set({
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Surrogate-Control': 'no-store'
        });
        console.log(`🚫 No-cache headers aplicados para: ${req.url}`);
    }
    next();
});

// =================================================================
// SECURITY MIDDLEWARE FOR EVOLUTION API
// =================================================================

// Rate limiting store (simple in-memory implementation)
const rateLimitStore = new Map();

// Clean old rate limit entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, data] of rateLimitStore.entries()) {
        if (now - data.resetTime > 5 * 60 * 1000) {
            rateLimitStore.delete(key);
        }
    }
}, 5 * 60 * 1000);

// Authentication middleware for Evolution API endpoints
const authenticateEvolutionAPI = (req, res, next) => {
    try {
        console.log('🔐 Verificando autenticação para Evolution API...');

        // Função para extrair valor de cookie
        const getCookieValue = (cookies, name) => {
            if (!cookies) return null;
            const value = cookies.split('; ').find(row => row.startsWith(name + '='));
            return value ? decodeURIComponent(value.split('=')[1]) : null;
        };

        const cookies = req.headers.cookie || '';
        console.log('🔍 Debug cookies recebidos:', cookies ? 'Sim (' + cookies.length + ' chars)' : 'Nenhum');

        // Primeiro tentar extrair do cookie JSON padrão
        let sessionData = null;
        const jsonCookie = getCookieValue(cookies, 'timepulse_instance_token');
        
        console.log('🔍 JSON Cookie encontrado:', jsonCookie ? 'Sim' : 'Não');

        if (jsonCookie) {
            try {
                sessionData = JSON.parse(jsonCookie);
                console.log('✅ Cookie JSON parseado com sucesso:', {
                    hasInstanceId: !!sessionData.instanceId,
                    hasToken: !!sessionData.token,
                    hasRestaurantId: !!sessionData.restaurantId,
                    hasUserEmail: !!sessionData.userEmail,
                    instanceName: sessionData.instanceName
                });
            } catch (parseError) {
                console.log('⚠️ Erro ao parse do cookie JSON:', parseError.message);
                console.log('⚠️ Conteúdo do cookie:', jsonCookie ? jsonCookie.substring(0, 100) + '...' : 'vazio');
            }
        }

        // Fallback para cookies individuais
        if (!sessionData) {
            sessionData = {
                token: getCookieValue(cookies, 'timepulse_instance_token'),
                instanceId: getCookieValue(cookies, 'timepulse_instance_id'),
                instanceName: getCookieValue(cookies, 'timepulse_instance_name'),
                restaurantId: getCookieValue(cookies, 'timepulse_restaurant_id'),
                userEmail: getCookieValue(cookies, 'timepulse_user_email'),
                type: getCookieValue(cookies, 'timepulse_instance_type') || 'restaurant'
            };
            
            console.log('🔍 Usando cookies individuais:', {
                hasInstanceId: !!sessionData.instanceId,
                hasToken: !!sessionData.token,
                hasRestaurantId: !!sessionData.restaurantId,
                hasUserEmail: !!sessionData.userEmail,
                instanceName: sessionData.instanceName
            });
        }

        // Detectar ambiente de desenvolvimento
        const isDevelopment = req.headers.host && (
            req.headers.host.includes('replit') || 
            req.headers.host.includes('localhost') ||
            req.headers.host.includes('127.0.0.1') ||
            req.headers.host.includes('replit.dev') ||
            req.headers.host.includes('repl.co')
        );

        // Verificação mais rigorosa da autenticação (com bypass para desenvolvimento)
        const isAuthenticated = !!(sessionData && sessionData.restaurantId && sessionData.userEmail && sessionData.token);

        if (!isAuthenticated) {
            if (isDevelopment) {
                console.log('🛠️ BYPASS AUTH: Ambiente de desenvolvimento detectado, permitindo acesso');
                
                // Criar dados temporários para desenvolvimento
                sessionData = {
                    instanceId: 'dev-temp-instance',
                    instanceName: 'Restaurante Demo',
                    token: 'dev-temp-token',
                    type: 'restaurant',
                    userEmail: 'demo@timepulse.dev',
                    restaurantId: 'dev-restaurant-1'
                };
                
                req.session = sessionData;
                req.session.authenticated = true;
                
                console.log('✅ Sessão temporária criada para desenvolvimento');
                return next();
            }
            
            console.log('❌ Acesso negado: Dados de autenticação incompletos');
            console.log('❌ Verificação:', {
                hasRestaurantId: !!sessionData?.restaurantId,
                hasUserEmail: !!sessionData?.userEmail,
                hasToken: !!sessionData?.token,
                isDevelopment: isDevelopment
            });
            return res.status(401).json({
                error: "Acesso não autorizado",
                details: "Dados de autenticação incompletos ou expirados",
                authenticated: false,
                status: "error"
            });
        }

        // Adicionar dados da sessão ao request
        req.session = sessionData;
        req.session.authenticated = true;

        console.log(`✅ Usuário autenticado: ${sessionData.userEmail || sessionData.restaurantId || 'ID não disponível'}`);
        next();

    } catch (error) {
        console.error('❌ Erro na autenticação Evolution API:', error);
        res.status(500).json({
            error: "Erro interno de autenticação",
            details: error.message,
            status: "error"
        });
    }
};

// Rate limiting middleware
const rateLimitEvolutionAPI = (maxRequests = 30, windowMs = 60000) => {
    return (req, res, next) => {
        try {
            const identifier = req.session?.userEmail || req.session?.restaurantId || req.ip;
            const now = Date.now();
            const key = `evolution_${identifier}`;

            const current = rateLimitStore.get(key) || { count: 0, resetTime: now + windowMs };

            // Reset counter if window expired
            if (now > current.resetTime) {
                current.count = 0;
                current.resetTime = now + windowMs;
            }

            current.count++;
            rateLimitStore.set(key, current);

            // Set headers
            res.set({
                'X-RateLimit-Limit': maxRequests,
                'X-RateLimit-Remaining': Math.max(0, maxRequests - current.count),
                'X-RateLimit-Reset': new Date(current.resetTime).toISOString()
            });

            if (current.count > maxRequests) {
                console.log(`⚠️ Rate limit excedido para ${identifier}: ${current.count}/${maxRequests}`);
                return res.status(429).json({
                    error: "Muitas requisições",
                    details: `Limite de ${maxRequests} requisições por minuto excedido`,
                    resetTime: new Date(current.resetTime).toISOString(),
                    status: "error"
                });
            }

            console.log(`📊 Rate limit OK para ${identifier}: ${current.count}/${maxRequests}`);
            next();

        } catch (error) {
            console.error('❌ Erro no rate limiting:', error);
            next(); // Continue on error to avoid blocking legitimate requests
        }
    };
};

// Input validation functions
// IMPORTANTE: Nome da instância deve ser EXATO como está na tabela restaurants
// NUNCA modificar, remover ou sanitizar caracteres (incluindo espaços)
const validateInstanceName = (instanceName) => {
    if (!instanceName) {
        return { isValid: false, error: "Nome da instância é obrigatório" };
    }

    // Trim apenas espaços no início/fim (whitespace nas bordas)
    const trimmed = instanceName.trim();

    // Debug log
    console.log(`🔍 Validando nome EXATO da instância: "${trimmed}" (length: ${trimmed.length})`);

    // Validar apenas o tamanho (3 a 50 caracteres)
    // ACEITAR QUALQUER CARACTERE: espaços, acentos, símbolos, etc.
    if (trimmed.length < 3 || trimmed.length > 50) {
        return { 
            isValid: false, 
            error: `Nome da instância deve ter entre 3 e 50 caracteres (atual: ${trimmed.length})` 
        };
    }

    console.log(`✅ Nome da instância EXATO válido: "${trimmed}"`);
    // Retornar o nome EXATO sem modificações
    return { isValid: true, sanitized: trimmed };
};

const validateWebhookUrl = (webhookUrl) => {
    if (!webhookUrl) {
        return { isValid: true }; // Webhook URL is optional
    }

    try {
        const url = new URL(webhookUrl);

        // Allowlist of allowed webhook domains
        const allowedDomains = [
            'timepulseai.com.br',
            'www.timepulseai.com.br',
            'n8n.timepulseai.com.br',  // N8N webhook domain
            'localhost',
            '127.0.0.1',
            // Add your production domains here
        ];

        // For development, allow local URLs
        if (process.env.NODE_ENV !== 'production') {
            if (url.hostname === 'localhost' || 
                url.hostname === '127.0.0.1' || 
                url.hostname.endsWith('.replit.dev') ||
                url.hostname.endsWith('.repl.co')) {
                return { isValid: true, sanitized: webhookUrl };
            }
        }

        // Check if domain is in allowlist
        if (!allowedDomains.includes(url.hostname)) {
            return { 
                isValid: false, 
                error: `Domínio webhook não permitido: ${url.hostname}` 
            };
        }

        // Only allow HTTPS in production
        if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
            return { 
                isValid: false, 
                error: "Webhook deve usar HTTPS em produção" 
            };
        }

        return { isValid: true, sanitized: webhookUrl };

    } catch (error) {
        return { 
            isValid: false, 
            error: "URL de webhook inválida" 
        };
    }
};

// CSRF protection middleware for POST requests
const csrfProtection = (req, res, next) => {
    try {
        // Skip CSRF for GET requests
        if (req.method === 'GET') {
            return next();
        }

        const csrfToken = req.headers['x-csrf-token'] || req.body.csrfToken;

        if (!csrfToken) {
            console.log('❌ CSRF: Token não encontrado');
            return res.status(403).json({
                error: "Token CSRF obrigatório",
                details: "Inclua o token CSRF no header X-CSRF-Token ou no body",
                status: "error"
            });
        }

        // Validação CSRF melhorada
        if (!csrfToken.startsWith('csrf_')) {
            console.log('❌ CSRF: Token com formato inválido - deve começar com csrf_');
            return res.status(403).json({
                error: "Token CSRF inválido",
                details: "Formato do token não reconhecido",
                status: "error"
            });
        }

        // Validar que o token contém um identificador válido
        const tokenParts = csrfToken.split('_');
        if (tokenParts.length < 3) {
            console.log('❌ CSRF: Token com estrutura inválida');
            return res.status(403).json({
                error: "Token CSRF inválido",
                details: "Estrutura do token incorreta",
                status: "error"
            });
        }

        console.log('✅ CSRF: Token validado com sucesso');

        console.log('✅ CSRF: Token validado');
        next();

    } catch (error) {
        console.error('❌ Erro na validação CSRF:', error);
        res.status(500).json({
            error: "Erro interno na validação CSRF",
            details: error.message,
            status: "error"
        });
    }
};


// =================================================================
// END SECURITY MIDDLEWARE
// =================================================================

// Health check endpoint
app.get("/health", (req, res) => {
    res.json({
        status: "OK",
        timestamp: new Date().toISOString()
    });
});

// Endpoint para obter token CSRF
app.get("/api/csrf-token", (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    // Gerar token CSRF simples baseado na sessão
    const crypto = require('crypto');
    const sessionToken = req.headers.cookie?.split('timepulse_instance_token=')[1]?.split(';')[0];

    if (!sessionToken) {
        return res.status(401).json({
            error: "Sessão não encontrada",
            details: "É necessário estar logado para obter token CSRF"
        });
    }

    // Extrair dados da sessão para gerar token compatível
    let sessionData = null;
    try {
        sessionData = JSON.parse(decodeURIComponent(sessionToken));
    } catch (parseError) {
        console.log('⚠️ Erro ao parse do cookie para CSRF:', parseError.message);
        return res.status(401).json({
            error: "Sessão inválida",
            details: "Não foi possível processar dados da sessão"
        });
    }

    // Gerar token baseado na sessão compatível com middleware
    const userIdentifier = sessionData.userEmail || sessionData.restaurantId || 'anonymous';
    const timestamp = Date.now();
    const hash = crypto.createHash('sha256')
        .update(sessionToken + timestamp + 'timepulse-csrf-secret')
        .digest('hex')
        .substring(0, 16);

    // Formato esperado pelo middleware: csrf_{userIdentifier}_{hash}
    const csrfToken = `csrf_${userIdentifier}_${hash}`;

    res.json({
        csrfToken: csrfToken,
        timestamp: timestamp,
        status: "ok"
    });
});

// API Routes - removido, consolidado abaixo

// Suportar ambos os formatos de endpoint (com e sem barra final)
app.get(["/api/config", "/api/config/"], (req, res) => {
    // Definir headers no-cache fortes
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    try {
        const configData = fs.readFileSync("./api/config/index", "utf8");
        const config = JSON.parse(configData);

        // Adicionar timestamp para forçar atualizações
        config.timestamp = new Date().toISOString();
        config.forced_update = true;

        res.json(config);
    } catch (error) {
        console.error("Erro ao carregar configuração:", error);
        res.status(500).json({ error: "Configuration not found", details: error.message });
    }
});

app.get(["/api/config/supabase", "/api/config/supabase/"], (req, res) => {
    // Definir headers no-cache fortes
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    try {
        // ⚠️ CRITICAL SECURITY: Only expose safe, public-facing configuration
        // NEVER expose service_role keys or any admin credentials
        
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

        // Auto-detect and fix swapped environment variables
        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && supabaseAnonKey && supabaseAnonKey.startsWith('https://')) {
            console.log('🔄 Auto-detecting swapped SUPABASE_URL and SUPABASE_ANON_KEY - fixing automatically');
            const temp = supabaseUrl;
            supabaseUrl = supabaseAnonKey;
            supabaseAnonKey = temp;
        }

        // Validate URL format for security - allow both supabase.co and supabase.in URLs
        if (supabaseUrl && (!supabaseUrl.startsWith('https://') || (!supabaseUrl.includes('.supabase.co') && !supabaseUrl.includes('.supabase.in')))) {
            console.error("❌ SECURITY ERROR: SUPABASE_URL appears to be invalid or contains sensitive data");
            console.error(`   Received URL format: ${supabaseUrl.substring(0, 50)}...`);
            return res.status(500).json({ 
                error: "Configuration security error", 
                details: "Invalid URL format detected - must be https:// and from supabase.co or supabase.in domain",
                configured: false,
                status: "error"
            });
        }

        // Validate anon key format for security (should not be a URL or service_role key)
        if (supabaseAnonKey && supabaseAnonKey.startsWith('http')) {
            console.error("❌ SECURITY ERROR: SUPABASE_ANON_KEY appears to contain URL data");
            return res.status(500).json({ 
                error: "Configuration security error", 
                details: "Invalid anon key format detected",
                configured: false,
                status: "error"
            });
        }

        // CRITICAL SECURITY: Verify anon key is not actually a service_role key
        if (supabaseAnonKey) {
            try {
                const [, payload] = supabaseAnonKey.split('.');
                if (payload) {
                    // Convert base64url to base64 for proper decoding
                    let base64Payload = payload.replace(/-/g, '+').replace(/_/g, '/');
                    // Add padding if needed
                    while (base64Payload.length % 4) {
                        base64Payload += '=';
                    }
                    
                    const decoded = JSON.parse(Buffer.from(base64Payload, 'base64').toString());
                    if (decoded.role === 'service_role') {
                        console.error("🚨 CRITICAL SECURITY ERROR: SUPABASE_ANON_KEY contains service_role key!");
                        console.error("🚨 This would expose unrestricted database access to clients!");
                        console.error("🚨 Please configure SUPABASE_ANON_KEY with the anonymous key only!");
                        return res.status(500).json({ 
                            error: "Critical security configuration error", 
                            details: "SUPABASE_ANON_KEY must be set to anonymous key, not service_role key",
                            configured: false,
                            status: "error",
                            security_issue: true
                        });
                    }
                }
            } catch (decodeError) {
                // Fail closed on decode error - treat as potential security risk
                console.error("🚨 SECURITY WARNING: Could not decode SUPABASE_ANON_KEY - blocking exposure as precaution:", decodeError.message);
                return res.status(500).json({ 
                    error: "Configuration security error", 
                    details: "Could not validate anon key format - blocking for security",
                    configured: false,
                    status: "error",
                    security_issue: true
                });
            }
        }

        if (!supabaseUrl) {
            console.error("❌ ERRO: SUPABASE_URL não configurado ou inválido");
            return res.status(500).json({ 
                error: "Configuration incomplete", 
                details: "SUPABASE_URL not properly configured",
                configured: false,
                status: "error"
            });
        }

        // For now, allow operation without anon key but warn
        if (!supabaseAnonKey) {
            console.warn("⚠️ WARNING: SUPABASE_ANON_KEY not configured - some features may not work");
            return res.status(500).json({ 
                error: "Configuration incomplete", 
                details: "SUPABASE_ANON_KEY not configured",
                configured: false,
                status: "error"
            });
        }

        // Log only the URL (safe to log)
        console.log(`🔧 Servindo Supabase config: ${supabaseUrl}`);
        console.log(`🔐 Anonymous key configured: ${supabaseAnonKey ? 'YES' : 'NO'}`);

        const config = {
            "status": "ok",
            "configured": true,
            "environment": process.env.NODE_ENV || "production",
            "supabaseUrl": supabaseUrl,
            "supabaseAnonKey": supabaseAnonKey,
            "url": supabaseUrl,
            "anon_key": supabaseAnonKey,
            "project": {
                "ref": "sguirxaunajirfvlzbac",
                "region": "us-east-1"
            },
            "features": {
                "auth": true,
                "database": true,
                "storage": true,
                "realtime": true,
                "rls": true
            },
            "tables": {
                "users": true,
                "profiles": true,
                "sessions": true,
                "restaurants": true,
                "orders": true,
                "deliveries": true,
                "payments": true
            },
            "timestamp": new Date().toISOString(),
            "forced_update": true
        };

        res.json(config);
    } catch (error) {
        console.error("Erro ao carregar configuração Supabase:", error);
        res.status(500).json({ error: "Supabase configuration not found", details: error.message });
    }
});

app.get("/api/config/evolution", (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    try {
        const serverUrl = process.env.EVOLUTION_API_BASE_URL || process.env.EVOLUTION_API_URL || process.env.EVOLUTION_SERVER_URL;
        const apiKey = process.env.EVOLUTION_API_KEY;

        if (!serverUrl || !apiKey) {
            console.error("❌ ERRO: Variáveis de ambiente EVOLUTION_API_BASE_URL e EVOLUTION_API_KEY não configuradas");
            return res.status(500).json({ 
                error: "Configuration incomplete", 
                details: "Environment variables not configured",
                configured: false,
                status: "error"
            });
        }

        console.log(`🔧 Servindo Evolution config: ${serverUrl}`);

        const config = {
            "status": "ok",
            "configured": true,
            "environment": process.env.NODE_ENV || "production",
            "baseUrl": serverUrl,
            "serverUrl": serverUrl,
            "apiKey": apiKey ? '****' + apiKey.slice(-4) : null,
            // API key mantida segura no servidor - não exposta ao frontend
            "features": {
                "whatsapp": true,
                "webhook": true,
                "instance_management": true,
                "qr_code": true,
                "message_history": true,
                "group_management": true
            },
            "endpoints": {
                "instances": "/instance",
                "messages": "/message",
                "webhooks": "/webhook"
            },
            "timestamp": new Date().toISOString()
        };

        res.json(config);
    } catch (error) {
        console.error("Erro ao carregar configuração Evolution:", error);
        res.status(500).json({ error: "Evolution configuration not found", details: error.message });
    }
});

// Endpoint simplificado para criar instância Evolution (sem CSRF para testes)
app.post("/api/evolution/create-instance", async (req, res) => {
    try {
        const serverUrl = process.env.EVOLUTION_API_BASE_URL || process.env.EVOLUTION_API_URL || process.env.EVOLUTION_SERVER_URL;
        const apiKey = process.env.EVOLUTION_API_KEY;

        if (!serverUrl || !apiKey) {
            return res.status(500).json({
                error: "Evolution API não configurada",
                details: "Variáveis de ambiente EVOLUTION_API_BASE_URL e EVOLUTION_API_KEY são obrigatórias"
            });
        }

        const instanceConfig = req.body;

        console.log(`🚀 Criando instância Evolution: ${instanceConfig.instance || instanceConfig.instanceName}`);

        const makeRequest = () => {
            return new Promise((resolve, reject) => {
                const https = require('https');
                const http = require('http');

                const evolutionUrl = new URL(`${serverUrl}/instance/create`);
                const isHttps = evolutionUrl.protocol === 'https:';
                const requestModule = isHttps ? https : http;

                const postData = JSON.stringify(instanceConfig);

                const options = {
                    hostname: evolutionUrl.hostname,
                    port: evolutionUrl.port || (isHttps ? 443 : 80),
                    path: evolutionUrl.pathname,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData),
                        'apikey': apiKey
                    }
                };

                const req = requestModule.request(options, (evolutionResponse) => {
                    let data = '';

                    evolutionResponse.on('data', (chunk) => {
                        data += chunk;
                    });

                    evolutionResponse.on('end', () => {
                        try {
                            const jsonData = JSON.parse(data);
                            resolve({
                                status: evolutionResponse.statusCode,
                                data: jsonData
                            });
                        } catch (parseError) {
                            resolve({
                                status: evolutionResponse.statusCode,
                                data: { error: 'Invalid JSON response', raw: data }
                            });
                        }
                    });
                });

                req.on('error', (error) => {
                    reject(error);
                });

                req.write(postData);
                req.end();
            });
        };

        const result = await makeRequest();

        if (result.status >= 200 && result.status < 300) {
            console.log(`✅ Instância Evolution criada com sucesso: ${instanceConfig.instance || instanceConfig.instanceName}`);
            res.json(result.data);
        } else {
            console.log(`❌ Erro ao criar instância Evolution: ${result.status}`);
            console.log(`❌ Resposta da Evolution API:`, JSON.stringify(result.data));
            console.log(`❌ URL: ${serverUrl}/instance/create`);
            console.log(`❌ API Key presente: ${apiKey ? 'SIM' : 'NÃO'}`);
            res.status(result.status).json({
                error: result.data.error || 'Erro ao criar instância',
                details: result.data,
                status: result.status,
                message: result.data.message || 'Evolution API retornou erro'
            });
        }

    } catch (error) {
        console.error('❌ Erro ao criar instância Evolution:', error);
        res.status(500).json({ 
            error: "Erro interno no servidor",
            details: error.message,
            status: "error"
        });
    }
});

// Endpoint para verificar se instância existe no Evolution
app.get("/api/evolution/check-instance/:instanceName", async (req, res) => {
    try {
        const { instanceName } = req.params;
        const serverUrl = process.env.EVOLUTION_API_BASE_URL || process.env.EVOLUTION_API_URL || process.env.EVOLUTION_SERVER_URL;
        const apiKey = process.env.EVOLUTION_API_KEY;

        if (!serverUrl || !apiKey) {
            return res.status(500).json({
                error: "Evolution API não configurada",
                details: "Variáveis de ambiente EVOLUTION_API_BASE_URL e EVOLUTION_API_KEY são obrigatórias",
                exists: false
            });
        }

        if (!instanceName) {
            return res.status(400).json({
                error: "Nome da instância é obrigatório",
                exists: false
            });
        }

        console.log(`🔍 Verificando se instância "${instanceName}" existe no Evolution...`);
        console.log(`📍 URL Evolution: ${serverUrl}`);
        console.log(`🔑 API Key presente: ${apiKey ? 'SIM (****' + apiKey.slice(-4) + ')' : 'NÃO'}`);

        const makeRequest = () => {
            return new Promise((resolve, reject) => {
                const https = require('https');
                const http = require('http');

                const evolutionUrl = new URL(`${serverUrl}/instance/fetchInstances?instanceName=${instanceName}`);
                const isHttps = evolutionUrl.protocol === 'https:';
                const requestModule = isHttps ? https : http;

                const options = {
                    hostname: evolutionUrl.hostname,
                    port: evolutionUrl.port || (isHttps ? 443 : 80),
                    path: evolutionUrl.pathname + evolutionUrl.search,
                    method: 'GET',
                    headers: {
                        'apikey': apiKey
                    }
                };
                
                console.log(`📡 Fazendo requisição para: ${evolutionUrl.href}`);
                console.log(`📋 Headers:`, { ...options.headers, apikey: options.headers.apikey ? '****' + options.headers.apikey.slice(-4) : 'none' });

                const req = requestModule.request(options, (evolutionResponse) => {
                    let data = '';

                    evolutionResponse.on('data', (chunk) => {
                        data += chunk;
                    });

                    evolutionResponse.on('end', () => {
                        console.log(`📥 Resposta Evolution API - Status: ${evolutionResponse.statusCode}`);
                        console.log(`📥 Dados recebidos (primeiros 500 chars):`, data.substring(0, 500));
                        
                        try {
                            const jsonData = JSON.parse(data);
                            console.log(`✅ JSON parseado com sucesso. Tipo:`, Array.isArray(jsonData) ? 'Array' : typeof jsonData);
                            if (Array.isArray(jsonData)) {
                                console.log(`📊 Número de instâncias retornadas: ${jsonData.length}`);
                            }
                            resolve({
                                status: evolutionResponse.statusCode,
                                data: jsonData
                            });
                        } catch (parseError) {
                            console.log(`❌ Erro ao parsear JSON:`, parseError.message);
                            resolve({
                                status: evolutionResponse.statusCode,
                                data: []
                            });
                        }
                    });
                });

                req.on('error', (error) => {
                    reject(error);
                });

                req.end();
            });
        };

        const result = await makeRequest();

        if (result.status >= 200 && result.status < 300) {
            const instances = Array.isArray(result.data) ? result.data : [];
            
            // A Evolution API retorna instâncias com campo "name" ao invés de "instanceName"
            const instanceExists = instances.some(inst => 
                inst?.name === instanceName || 
                inst?.instance?.instanceName === instanceName || 
                inst?.instanceName === instanceName
            );

            if (instanceExists) {
                const instanceData = instances.find(inst => 
                    inst?.name === instanceName || 
                    inst?.instance?.instanceName === instanceName || 
                    inst?.instanceName === instanceName
                );
                console.log(`✅ Instância "${instanceName}" encontrada no Evolution`);
                console.log(`📊 Dados da instância:`, JSON.stringify(instanceData).substring(0, 200) + '...');
                res.json({
                    exists: true,
                    data: instanceData,
                    message: "Instância encontrada"
                });
            } else {
                console.log(`⚠️ Instância "${instanceName}" não encontrada no Evolution`);
                console.log(`📋 Instâncias disponíveis:`, instances.map(i => i.name || i.instanceName).join(', '));
                res.json({
                    exists: false,
                    data: null,
                    message: "Instância não encontrada"
                });
            }
        } else {
            console.log(`❌ Erro ao buscar instâncias Evolution: ${result.status}`);
            res.status(result.status).json({
                exists: false,
                error: "Erro ao buscar instâncias",
                details: result.data
            });
        }

    } catch (error) {
        console.error('❌ Erro ao verificar instância Evolution:', error);
        res.status(500).json({ 
            exists: false,
            error: "Erro interno no servidor",
            details: error.message
        });
    }
});

// Endpoint para verificar status de conexão da instância
app.get("/api/evolution/connection-state/:instanceName", async (req, res) => {
    try {
        const { instanceName } = req.params;
        const serverUrl = process.env.EVOLUTION_API_BASE_URL || process.env.EVOLUTION_API_URL || process.env.EVOLUTION_SERVER_URL;
        const apiKey = process.env.EVOLUTION_API_KEY;

        if (!serverUrl || !apiKey) {
            return res.status(500).json({
                error: "Evolution API não configurada",
                details: "Variáveis de ambiente EVOLUTION_API_BASE_URL e EVOLUTION_API_KEY são obrigatórias"
            });
        }

        if (!instanceName) {
            return res.status(400).json({
                error: "Nome da instância é obrigatório"
            });
        }

        console.log(`🔍 Verificando estado de conexão da instância "${instanceName}"...`);

        const makeRequest = () => {
            return new Promise((resolve, reject) => {
                const https = require('https');
                const http = require('http');

                const evolutionUrl = new URL(`${serverUrl}/instance/connectionState/${instanceName}`);
                const isHttps = evolutionUrl.protocol === 'https:';
                const requestModule = isHttps ? https : http;

                const options = {
                    hostname: evolutionUrl.hostname,
                    port: evolutionUrl.port || (isHttps ? 443 : 80),
                    path: evolutionUrl.pathname,
                    method: 'GET',
                    headers: {
                        'apikey': apiKey
                    }
                };

                console.log(`📡 Requisição para: ${evolutionUrl.href}`);

                const req = requestModule.request(options, (evolutionResponse) => {
                    let data = '';

                    evolutionResponse.on('data', (chunk) => {
                        data += chunk;
                    });

                    evolutionResponse.on('end', () => {
                        console.log(`📥 Status de conexão - HTTP: ${evolutionResponse.statusCode}`);
                        
                        try {
                            const jsonData = JSON.parse(data);
                            console.log(`✅ Estado da conexão:`, jsonData);
                            resolve({
                                status: evolutionResponse.statusCode,
                                data: jsonData
                            });
                        } catch (parseError) {
                            console.log(`❌ Erro ao parsear JSON:`, parseError.message);
                            resolve({
                                status: evolutionResponse.statusCode,
                                data: { state: 'error', error: data }
                            });
                        }
                    });
                });

                req.on('error', (error) => {
                    reject(error);
                });

                req.end();
            });
        };

        const result = await makeRequest();

        if (result.status >= 200 && result.status < 300) {
            // Resposta bem-sucedida
            const state = result.data?.instance?.state || result.data?.state || 'unknown';
            console.log(`✅ Estado da instância "${instanceName}": ${state}`);
            
            res.json({
                success: true,
                instanceName: instanceName,
                state: state, // "open", "close", "connecting"
                connected: state === 'open',
                data: result.data
            });
        } else {
            console.log(`❌ Erro ao verificar estado: ${result.status}`);
            res.status(result.status).json({
                success: false,
                error: "Erro ao verificar estado da conexão",
                details: result.data
            });
        }

    } catch (error) {
        console.error('❌ Erro ao verificar estado de conexão:', error);
        res.status(500).json({ 
            success: false,
            error: "Erro interno no servidor",
            details: error.message
        });
    }
});

// Endpoint para atualizar configurações (settings) da instância WhatsApp
app.post("/api/evolution/update-settings/:instanceName", async (req, res) => {
    try {
        const { instanceName } = req.params;
        const settings = req.body; // Objeto com configurações a atualizar
        
        const serverUrl = process.env.EVOLUTION_API_BASE_URL || process.env.EVOLUTION_API_URL || process.env.EVOLUTION_SERVER_URL;
        const apiKey = process.env.EVOLUTION_API_KEY;

        if (!serverUrl || !apiKey) {
            return res.status(500).json({
                error: "Evolution API não configurada",
                details: "Variáveis de ambiente EVOLUTION_API_BASE_URL e EVOLUTION_API_KEY são obrigatórias"
            });
        }

        if (!instanceName) {
            return res.status(400).json({
                error: "Nome da instância é obrigatório"
            });
        }

        console.log(`⚙️ Atualizando configurações da instância "${instanceName}":`, settings);

        const makeRequest = () => {
            return new Promise((resolve, reject) => {
                const https = require('https');
                const http = require('http');

                // Endpoint correto: /settings/set/{instance} (instanceName vai na URL)
                const evolutionUrl = new URL(`${serverUrl}/settings/set/${instanceName}`);
                const isHttps = evolutionUrl.protocol === 'https:';
                const requestModule = isHttps ? https : http;

                // Body JSON apenas com as configurações
                const requestBody = JSON.stringify(settings);

                const options = {
                    hostname: evolutionUrl.hostname,
                    port: evolutionUrl.port || (isHttps ? 443 : 80),
                    path: evolutionUrl.pathname,
                    method: 'POST',
                    headers: {
                        'apikey': apiKey,
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(requestBody)
                    }
                };

                console.log(`📡 Enviando configurações para: ${evolutionUrl.href}`);

                const req = requestModule.request(options, (evolutionResponse) => {
                    let data = '';

                    evolutionResponse.on('data', (chunk) => {
                        data += chunk;
                    });

                    evolutionResponse.on('end', () => {
                        console.log(`📥 Resposta da atualização - HTTP: ${evolutionResponse.statusCode}`);
                        console.log(`📥 Resposta completa (raw):`, data);
                        
                        try {
                            const jsonData = JSON.parse(data);
                            console.log(`✅ Configurações atualizadas:`, JSON.stringify(jsonData, null, 2));
                            resolve({
                                status: evolutionResponse.statusCode,
                                data: jsonData
                            });
                        } catch (parseError) {
                            console.log(`❌ Erro ao parsear JSON:`, parseError.message);
                            resolve({
                                status: evolutionResponse.statusCode,
                                data: { error: data }
                            });
                        }
                    });
                });

                req.on('error', (error) => {
                    reject(error);
                });

                req.write(requestBody);
                req.end();
            });
        };

        const result = await makeRequest();

        if (result.status >= 200 && result.status < 300) {
            console.log(`✅ Configurações da instância "${instanceName}" atualizadas com sucesso`);
            res.json({
                success: true,
                message: "Configurações atualizadas com sucesso",
                data: result.data
            });
        } else {
            console.log(`❌ Erro ao atualizar configurações: ${result.status}`);
            res.status(result.status).json({
                success: false,
                error: "Erro ao atualizar configurações",
                details: result.data
            });
        }

    } catch (error) {
        console.error('❌ Erro ao atualizar configurações:', error);
        res.status(500).json({ 
            success: false,
            error: "Erro interno no servidor",
            details: error.message
        });
    }
});

// =================================================================
// MIDDLEWARE DE AUTENTICAÇÃO JWT SEGURA
// =================================================================

const authenticateJWT = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Token JWT requerido' });
        }
        
        const token = authHeader.substring(7);
        
        // Verificar token usando Supabase auth.getUser()
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        // Auto-detect and fix swapped environment variables
        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            console.log('🔄 JWT verification auto-detecting swapped SUPABASE_URL and SUPABASE_ANON_KEY - fixing automatically');
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        if (!supabaseUrl || !supabaseServiceKey) {
            console.error('❌ Configuração Supabase não encontrada para autenticação JWT');
            return res.status(500).json({ error: 'Erro de configuração do servidor' });
        }
        
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        
        const { data: { user }, error } = await supabase.auth.getUser(token);
        
        if (error || !user) {
            console.log('❌ Token JWT inválido:', error?.message);
            return res.status(401).json({ error: 'Token inválido ou expirado' });
        }
        
        // Adicionar dados do usuário na requisição
        req.user = user;
        req.session = {
            userId: user.id,
            userEmail: user.email,
            token: token
        };
        
        next();
    } catch (error) {
        console.error('❌ Erro na autenticação JWT:', error);
        res.status(500).json({ error: 'Erro interno de autenticação' });
    }
};

// Proxy seguro para Evolution API - connectionState
app.get("/api/evolution/connectionState/:instanceName", 
    authenticateEvolutionAPI,
    rateLimitEvolutionAPI(30, 60000),
    async (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    try {
        const { instanceName } = req.params;

        // Validar instanceName
        const validation = validateInstanceName(instanceName);
        if (!validation.isValid) {
            console.log(`❌ Validation error: ${validation.error}`);
            return res.status(400).json({
                error: validation.error,
                status: "error"
            });
        }
        const serverUrl = process.env.EVOLUTION_API_BASE_URL || process.env.EVOLUTION_API_URL || process.env.EVOLUTION_SERVER_URL;
        const apiKey = process.env.EVOLUTION_API_KEY;

        if (!serverUrl || !apiKey) {
            return res.status(500).json({ 
                error: "Evolution API não configurada",
                status: "error"
            });
        }

        if (!instanceName) {
            return res.status(400).json({
                error: "Nome da instância é obrigatório",
                status: "error"
            });
        }

        console.log(`🔍 Proxy Evolution: Verificando instância "${instanceName}"`);

        // Fazer chamada para Evolution API usando módulo correto baseado no protocolo
        const https = require('https');
        const http = require('http');
        const { URL } = require('url');

        const evolutionUrl = new URL(`${serverUrl}/instance/connectionState/${instanceName}`);
        const isHttps = evolutionUrl.protocol === 'https:';
        const requestModule = isHttps ? https : http;

        const options = {
            hostname: evolutionUrl.hostname,
            port: evolutionUrl.port || (isHttps ? 443 : 80),
            path: evolutionUrl.pathname,
            method: 'GET',
            headers: {
                'apikey': apiKey,
                'Content-Type': 'application/json'
            }
        };

        const makeRequest = () => {
            return new Promise((resolve, reject) => {
                const req = requestModule.request(options, (evolutionResponse) => {
                    let data = '';

                    evolutionResponse.on('data', (chunk) => {
                        data += chunk;
                    });

                    evolutionResponse.on('end', () => {
                        try {
                            const jsonData = JSON.parse(data);
                            resolve({
                                status: evolutionResponse.statusCode,
                                data: jsonData
                            });
                        } catch (parseError) {
                            resolve({
                                status: evolutionResponse.statusCode,
                                data: { error: 'Invalid JSON response', raw: data }
                            });
                        }
                    });
                });

                req.on('error', (error) => {
                    reject(error);
                });

                req.end();
            });
        };

        const result = await makeRequest();

        if (result.status >= 200 && result.status < 300) {
            console.log(`✅ Evolution: Instância "${instanceName}" - Status: ${result.data.instance?.state || 'unknown'}`);
            res.json(result.data);
        } else {
            console.log(`❌ Evolution: Erro ${result.status} para instância "${instanceName}"`);
            res.status(result.status).json(result.data);
        }

    } catch (error) {
        console.error('❌ Erro no proxy Evolution connectionState:', error);
        res.status(500).json({ 
            error: "Erro interno no servidor",
            details: error.message,
            status: "error"
        });
    }
});

// Proxy para criar instância Evolution API
app.post("/api/evolution/instance/create", 
    authenticateEvolutionAPI,
    rateLimitEvolutionAPI(10, 60000), // More restrictive for POST operations
    csrfProtection,
    async (req, res) => {
    try {
        const serverUrl = process.env.EVOLUTION_API_BASE_URL || process.env.EVOLUTION_API_URL || process.env.EVOLUTION_SERVER_URL;
        const apiKey = process.env.EVOLUTION_API_KEY;

        if (!serverUrl || !apiKey) {
            return res.status(500).json({
                error: "Evolution API não configurada",
                details: "Variáveis de ambiente EVOLUTION_API_BASE_URL e EVOLUTION_API_KEY são obrigatórias"
            });
        }

        const instanceConfig = req.body;

        // Validar instanceName
        if (instanceConfig.instanceName) {
            const validation = validateInstanceName(instanceConfig.instanceName);
            if (!validation.isValid) {
                console.log(`❌ Validation error: ${validation.error}`);
                return res.status(400).json({
                    error: validation.error,
                    status: "error"
                });
            }
        }

        // Validar webhook URL se fornecida
        if (instanceConfig.webhook && instanceConfig.webhook.url) {
            const webhookValidation = validateWebhookUrl(instanceConfig.webhook.url);
            if (!webhookValidation.isValid) {
                console.log(`❌ Webhook validation error: ${webhookValidation.error}`);
                return res.status(400).json({
                    error: webhookValidation.error,
                    status: "error"
                });
            }
            console.log(`✅ Webhook URL validada: ${instanceConfig.webhook.url}`);
        }

        console.log(`🚀 Criando instância Evolution (autenticado): ${instanceConfig.instanceName}`);

        const makeRequest = () => {
            return new Promise((resolve, reject) => {
                const https = require('https');
                const http = require('http');

                const evolutionUrl = new URL(`${serverUrl}/instance/create`);
                const isHttps = evolutionUrl.protocol === 'https:';
                const requestModule = isHttps ? https : http;

                const postData = JSON.stringify(instanceConfig);

                const options = {
                    hostname: evolutionUrl.hostname,
                    port: evolutionUrl.port || (isHttps ? 443 : 80),
                    path: evolutionUrl.pathname,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData),
                        'apikey': apiKey
                    }
                };

                const req = requestModule.request(options, (evolutionResponse) => {
                    let data = '';

                    evolutionResponse.on('data', (chunk) => {
                        data += chunk;
                    });

                    evolutionResponse.on('end', () => {
                        try {
                            const jsonData = JSON.parse(data);
                            resolve({
                                status: evolutionResponse.statusCode,
                                data: jsonData
                            });
                        } catch (parseError) {
                            resolve({
                                status: evolutionResponse.statusCode,
                                data: { error: 'Invalid JSON response', raw: data }
                            });
                        }
                    });
                });

                req.on('error', (error) => {
                    reject(error);
                });

                req.write(postData);
                req.end();
            });
        };

        const result = await makeRequest();

        if (result.status >= 200 && result.status < 300) {
            console.log(`✅ Instância Evolution criada: ${instanceConfig.instanceName}`);
            res.json(result.data);
        } else {
            console.log(`❌ Erro ao criar instância Evolution: ${result.status}`);
            res.status(result.status).json(result.data);
        }

    } catch (error) {
        console.error('❌ Erro no proxy Evolution create instance:', error);
        res.status(500).json({ 
            error: "Erro interno no servidor",
            details: error.message,
            status: "error"
        });
    }
});

// Proxy para buscar instâncias Evolution API
app.get("/api/evolution/instance/fetchInstances", 
    authenticateEvolutionAPI,
    rateLimitEvolutionAPI(30, 60000),
    async (req, res) => {
    try {
        const serverUrl = process.env.EVOLUTION_API_BASE_URL || process.env.EVOLUTION_API_URL || process.env.EVOLUTION_SERVER_URL;
        const apiKey = process.env.EVOLUTION_API_KEY;

        if (!serverUrl || !apiKey) {
            return res.status(500).json({
                error: "Evolution API não configurada",
                details: "Variáveis de ambiente EVOLUTION_API_BASE_URL e EVOLUTION_API_KEY são obrigatórias"
            });
        }

        const instanceName = req.query.instanceName;

        // Validar instanceName se fornecido
        if (instanceName) {
            const validation = validateInstanceName(instanceName);
            if (!validation.isValid) {
                console.log(`❌ Validation error: ${validation.error}`);
                return res.status(400).json({
                    error: validation.error,
                    status: "error"
                });
            }
        }
        const queryParam = instanceName ? `?instanceName=${instanceName}` : '';

        console.log(`🔍 Buscando instâncias Evolution${instanceName ? ` para: ${instanceName}` : ''}`);

        const makeRequest = () => {
            return new Promise((resolve, reject) => {
                const https = require('https');
                const http = require('http');

                const evolutionUrl = new URL(`${serverUrl}/instance/fetchInstances${queryParam}`);
                const isHttps = evolutionUrl.protocol === 'https:';
                const requestModule = isHttps ? https : http;

                const options = {
                    hostname: evolutionUrl.hostname,
                    port: evolutionUrl.port || (isHttps ? 443 : 80),
                    path: evolutionUrl.pathname + evolutionUrl.search,
                    method: 'GET',
                    headers: {
                        'apikey': apiKey
                    }
                };

                const req = requestModule.request(options, (evolutionResponse) => {
                    let data = '';

                    evolutionResponse.on('data', (chunk) => {
                        data += chunk;
                    });

                    evolutionResponse.on('end', () => {
                        try {
                            const jsonData = JSON.parse(data);
                            resolve({
                                status: evolutionResponse.statusCode,
                                data: jsonData
                            });
                        } catch (parseError) {
                            resolve({
                                status: evolutionResponse.statusCode,
                                data: { error: 'Invalid JSON response', raw: data }
                            });
                        }
                    });
                });

                req.on('error', (error) => {
                    reject(error);
                });

                req.end();
            });
        };

        const result = await makeRequest();

        if (result.status >= 200 && result.status < 300) {
            console.log(`✅ Instâncias Evolution encontradas`);
            res.json(result.data);
        } else {
            console.log(`❌ Erro ao buscar instâncias Evolution: ${result.status}`);
            res.status(result.status).json(result.data);
        }

    } catch (error) {
        console.error('❌ Erro no proxy Evolution fetchInstances:', error);
        res.status(500).json({ 
            error: "Erro interno no servidor",
            details: error.message,
            status: "error"
        });
    }
});

// Proxy para buscar configurações da instância Evolution API
app.get("/api/evolution/settings/find/:instanceName", 
    authenticateEvolutionAPI,
    rateLimitEvolutionAPI(30, 60000),
    async (req, res) => {
        try {
            const { instanceName } = req.params;

            // Validar instanceName
            const validation = validateInstanceName(instanceName);
            if (!validation.isValid) {
                console.log(`❌ Validation error: ${validation.error}`);
                return res.status(400).json({
                    error: validation.error,
                    status: "error"
                });
            }

            console.log(`🔍 Buscando configurações Evolution para instância: ${instanceName}`);

            const evolutionUrl = `${process.env.EVOLUTION_API_BASE_URL || process.env.EVOLUTION_API_URL || process.env.EVOLUTION_SERVER_URL}/settings/find/${instanceName}`;

            // Usar protocolo HTTP/HTTPS nativo do Node.js ao invés de fetch
            const makeRequest = () => {
                return new Promise((resolve, reject) => {
                    const https = require('https');
                    const http = require('http');

                    const urlObj = new URL(evolutionUrl);
                    const isHttps = urlObj.protocol === 'https:';
                    const requestModule = isHttps ? https : http;

                    const options = {
                        hostname: urlObj.hostname,
                        port: urlObj.port || (isHttps ? 443 : 80),
                        path: urlObj.pathname,
                        method: 'GET',
                        headers: {
                            'apikey': process.env.EVOLUTION_API_KEY,
                            'Accept': 'application/json'
                        }
                    };

                    const req = requestModule.request(options, (res) => {
                        let data = '';
                        res.on('data', chunk => data += chunk);
                        res.on('end', () => {
                            try {
                                const parsedData = data ? JSON.parse(data) : {};
                                resolve({
                                    status: res.statusCode,
                                    data: parsedData,
                                    ok: res.statusCode >= 200 && res.statusCode < 300
                                });
                            } catch (parseError) {
                                resolve({
                                    status: res.statusCode,
                                    data: { error: 'Invalid JSON response', raw: data },
                                    ok: false
                                });
                            }
                        });
                    });

                    // Timeout de 30 segundos
                    req.setTimeout(30000, () => {
                        req.destroy();
                        reject(new Error('Request timeout'));
                    });

                    req.on('error', reject);
                    req.end();
                });
            };

            const evolutionResponse = await makeRequest();

            if (!evolutionResponse.ok) {
                console.log(`❌ Erro Evolution API (settings/find): ${evolutionResponse.status}`);
                return res.status(evolutionResponse.status).json({
                    error: `Erro na Evolution API: ${evolutionResponse.status}`,
                    status: "error",
                    details: evolutionResponse.data
                });
            }

            const data = evolutionResponse.data;
            console.log(`✅ Configurações Evolution encontradas para: ${instanceName}`);

            res.json({
                status: "success",
                settings: data,
                instanceName: instanceName
            });

        } catch (error) {
            console.error('💥 Erro ao buscar configurações Evolution:', error);
            res.status(500).json({
                error: 'Erro interno do servidor',
                status: "error",
                message: error.message
            });
        }
    }
);

// Middleware de proteção CSRF alternativa para endpoints Evolution
const evolutionCSRFProtection = (req, res, next) => {
    // Verificar header X-Requested-With (proteção contra CSRF simples)
    const requestedWith = req.get('X-Requested-With');
    if (!requestedWith || requestedWith !== 'XMLHttpRequest') {
        console.log('❌ CSRF: Header X-Requested-With obrigatório');
        return res.status(403).json({
            error: 'Header X-Requested-With obrigatório',
            details: 'Inclua o header X-Requested-With: XMLHttpRequest',
            status: 'error'
        });
    }
    next();
};

// Proxy para definir configurações da instância Evolution API
app.post("/api/evolution/settings/set/:instanceName", 
    authenticateEvolutionAPI,
    rateLimitEvolutionAPI(15, 60000), // More restrictive for POST operations
    evolutionCSRFProtection,
    async (req, res) => {
        try {
            const { instanceName } = req.params;
            const settings = req.body;

            // Validar instanceName
            const validation = validateInstanceName(instanceName);
            if (!validation.isValid) {
                console.log(`❌ Validation error: ${validation.error}`);
                return res.status(400).json({
                    error: validation.error,
                    status: "error"
                });
            }

            console.log(`⚙️ Configurando Evolution para instância: ${instanceName}`);
            console.log(`📋 Configurações a aplicar:`, settings);

            // Endpoint correto: /settings/set/{instance} (instanceName vai na URL)
            const evolutionUrl = `${process.env.EVOLUTION_API_BASE_URL || process.env.EVOLUTION_API_URL || process.env.EVOLUTION_SERVER_URL}/settings/set/${instanceName}`;

            // Usar protocolo HTTP/HTTPS nativo do Node.js ao invés de fetch
            const makeRequest = () => {
                return new Promise((resolve, reject) => {
                    const https = require('https');
                    const http = require('http');

                    const urlObj = new URL(evolutionUrl);
                    const isHttps = urlObj.protocol === 'https:';
                    const requestModule = isHttps ? https : http;

                    // Body JSON apenas com as configurações
                    const postData = JSON.stringify(settings);

                    const options = {
                        hostname: urlObj.hostname,
                        port: urlObj.port || (isHttps ? 443 : 80),
                        path: urlObj.pathname,
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'apikey': process.env.EVOLUTION_API_KEY,
                            'Accept': 'application/json',
                            'Content-Length': Buffer.byteLength(postData)
                        }
                    };

                    const req = requestModule.request(options, (res) => {
                        let data = '';
                        res.on('data', chunk => data += chunk);
                        res.on('end', () => {
                            resolve({
                                status: res.statusCode,
                                data: data ? JSON.parse(data) : {},
                                ok: res.statusCode >= 200 && res.statusCode < 300
                            });
                        });
                    });

                    req.on('error', reject);
                    req.write(postData);
                    req.end();
                });
            };

            const evolutionResponse = await makeRequest();

            if (!evolutionResponse.ok) {
                console.log(`❌ Erro Evolution API (settings/set): ${evolutionResponse.status}`);
                return res.status(evolutionResponse.status).json({
                    error: `Erro na Evolution API: ${evolutionResponse.status}`,
                    status: "error",
                    details: evolutionResponse.data
                });
            }

            const data = evolutionResponse.data;
            console.log(`✅ Configurações Evolution aplicadas para: ${instanceName}`);

            res.json({
                status: "success",
                result: data,
                instanceName: instanceName,
                appliedSettings: settings
            });

        } catch (error) {
            console.error('💥 Erro ao aplicar configurações Evolution:', error);
            res.status(500).json({
                error: 'Erro interno do servidor',
                status: "error",
                message: error.message
            });
        }
    }
);

// Proxy para conectar instância Evolution API (gerar QR code)
app.get("/api/evolution/instance/connect/:instanceName", 
    authenticateEvolutionAPI,
    rateLimitEvolutionAPI(15, 60000), // More restrictive for QR generation
    async (req, res) => {
    try {
        const { instanceName } = req.params;

        // Validar instanceName
        const validation = validateInstanceName(instanceName);
        if (!validation.isValid) {
            console.log(`❌ Validation error: ${validation.error}`);
            return res.status(400).json({
                error: validation.error,
                status: "error"
            });
        }

        const serverUrl = process.env.EVOLUTION_API_BASE_URL || process.env.EVOLUTION_API_URL || process.env.EVOLUTION_SERVER_URL;
        const apiKey = process.env.EVOLUTION_API_KEY;

        if (!serverUrl || !apiKey) {
            return res.status(500).json({
                error: "Evolution API não configurada",
                details: "Variáveis de ambiente EVOLUTION_API_BASE_URL e EVOLUTION_API_KEY são obrigatórias"
            });
        }

        console.log(`📱 Conectando instância Evolution: ${instanceName}`);

        const makeRequest = () => {
            return new Promise((resolve, reject) => {
                const https = require('https');
                const http = require('http');

                const evolutionUrl = new URL(`${serverUrl}/instance/connect/${instanceName}`);
                const isHttps = evolutionUrl.protocol === 'https:';
                const requestModule = isHttps ? https : http;

                const options = {
                    hostname: evolutionUrl.hostname,
                    port: evolutionUrl.port || (isHttps ? 443 : 80),
                    path: evolutionUrl.pathname,
                    method: 'GET',
                    headers: {
                        'apikey': apiKey
                    }
                };

                const req = requestModule.request(options, (evolutionResponse) => {
                    let data = '';

                    evolutionResponse.on('data', (chunk) => {
                        data += chunk;
                    });

                    evolutionResponse.on('end', () => {
                        try {
                            const jsonData = JSON.parse(data);
                            resolve({
                                status: evolutionResponse.statusCode,
                                data: jsonData
                            });
                        } catch (parseError) {
                            resolve({
                                status: evolutionResponse.statusCode,
                                data: { error: 'Invalid JSON response', raw: data }
                            });
                        }
                    });
                });

                req.on('error', (error) => {
                    reject(error);
                });

                req.end();
            });
        };

        const result = await makeRequest();

        if (result.status >= 200 && result.status < 300) {
            console.log(`✅ QR Code gerado para instância: ${instanceName}`);
            res.json(result.data);
        } else {
            console.log(`❌ Erro ao conectar instância Evolution: ${result.status}`);
            res.status(result.status).json(result.data);
        }

    } catch (error) {
        console.error('❌ Erro no proxy Evolution connect:', error);
        res.status(500).json({ 
            error: "Erro interno no servidor",
            details: error.message,
            status: "error"
        });
    }
});

app.get("/api/config/supabase", (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    try {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

        if (!supabaseUrl || !supabaseAnonKey) {
            console.error("❌ ERRO: Variáveis de ambiente Supabase não configuradas");
            return res.status(500).json({ 
                error: "Configuration incomplete", 
                configured: false
            });
        }

        console.log(`🔧 Servindo Supabase config`);

        res.json({
            url: supabaseUrl,
            anonKey: supabaseAnonKey
        });
    } catch (error) {
        console.error("❌ Erro ao servir configuração Supabase:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get("/api/config/mapbox", (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    try {
        const accessToken = process.env.MAPBOX_TOKEN || process.env.MAPBOX_ACCESS_TOKEN || process.env.MAPBOX_API_KEY;

        if (!accessToken) {
            console.error("❌ ERRO: Variável de ambiente MAPBOX_TOKEN não configurada");
            return res.status(500).json({ 
                error: "Configuration incomplete", 
                details: "Environment variable not configured",
                configured: false,
                status: "error"
            });
        }

        console.log(`🔧 Servindo Mapbox config (token configurado)`);

        const config = {
            "status": "ok",
            "configured": true,
            "environment": process.env.NODE_ENV || "production",
            "accessToken": accessToken, // Mapbox public token is safe to expose for client-side use
            "features": {
                "maps": true,
                "geocoding": true,
                "directions": true,
                "places": true,
                "routing": true,
                "navigation": true
            },
            "services": {
                "geocoding": "https://api.mapbox.com/geocoding/v5",
                "directions": "https://api.mapbox.com/directions/v5",
                "static": "https://api.mapbox.com/styles/v1"
            },
            "timestamp": new Date().toISOString()
        };

        res.json(config);
    } catch (error) {
        console.error("Erro ao carregar configuração Mapbox:", error);
        res.status(500).json({ error: "Mapbox configuration not found", details: error.message });
    }
});

// TEST ENDPOINT: Geocode an address
app.get("/api/test/geocode", async (req, res) => {
    try {
        const address = req.query.address || "Avenida Senador César Lacerda de Vergueiro, 452, Ponta da Praia, Santos - SP";
        const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN;
        
        if (!MAPBOX_TOKEN) {
            return res.status(500).json({ error: "Mapbox token not configured" });
        }
        
        const encodedAddress = encodeURIComponent(address);
        const geocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedAddress}.json?access_token=${MAPBOX_TOKEN}&country=BR&limit=1`;
        
        console.log(`🧪 TEST GEOCODE: ${address}`);
        
        const response = await fetch(geocodeUrl);
        const data = await response.json();
        
        if (data.features && data.features.length > 0) {
            const [longitude, latitude] = data.features[0].center;
            const result = {
                address: address,
                mapbox_response: data.features[0],
                coordinates: {
                    longitude: longitude,
                    latitude: latitude
                },
                database_format: `(${latitude},${longitude})`,
                validation: {
                    is_valid_brazil: latitude >= -33 && latitude <= 5 && longitude >= -74 && longitude <= -34,
                    latitude_range: `${latitude >= -33 && latitude <= 5 ? '✅' : '❌'} (-33 to 5)`,
                    longitude_range: `${longitude >= -74 && longitude <= -34 ? '✅' : '❌'} (-74 to -34)`
                }
            };
            
            console.log(`✅ Geocoded: lat=${latitude}, lng=${longitude}`);
            console.log(`   Database format: (${latitude},${longitude})`);
            console.log(`   Valid for Brazil: ${result.validation.is_valid_brazil ? '✅' : '❌'}`);
            
            res.json(result);
        } else {
            res.status(404).json({ error: "No geocoding results found", query: address });
        }
    } catch (error) {
        console.error('❌ Geocoding test error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get("/api/config/openai", (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    try {
        const apiKey = process.env.OPENAI_API_KEY;

        if (!apiKey) {
            console.error("❌ ERRO: Variável de ambiente OPENAI_API_KEY não configurada");
            return res.status(500).json({ 
                error: "Configuration incomplete", 
                details: "OpenAI API key not configured",
                configured: false,
                status: "error"
            });
        }

        console.log(`🔧 Servindo GPT-5-mini config via OpenAI API (API key configurada)`);

        const config = {
            "status": "ok",
            "configured": true,
            "environment": process.env.NODE_ENV || "production",
            "baseUrl": "https://api.openai.com/v1",
            // API key not exposed to client for security
            "provider": "OpenAI API",
            "model": "gpt-5-mini",
            "features": {
                "chat": true,
                "completions": true,
                "embeddings": true,
                "images": false,
                "audio": false,
                "reasoning": true,
                "tools": true,
                "streaming": true
            },
            "models": {
                "chat": "gpt-5-mini",
                "completion": "gpt-5-mini",
                "embedding": "text-embedding-ada-002"
            },
            "parameters": {
                "reasoning_effort": "medium",
                "max_completion_tokens": 4096,
                "stream": false,
                "response_format": {"type": "text"}
            },
            "reasoning_levels": {
                "minimal": "Para instruções claras e diretas",
                "low": "Para tarefas simples com raciocínio básico", 
                "medium": "Equilíbrio entre qualidade e velocidade (padrão)",
                "high": "Para análises complexas e raciocínio aprofundado"
            },
            "limits": {
                "requests_per_minute": 60,
                "tokens_per_minute": 40000
            },
            "timestamp": new Date().toISOString()
        };

        res.json(config);
    } catch (error) {
        console.error("Erro ao carregar configuração OpenAI:", error);
        res.status(500).json({ error: "OpenAI configuration not found", details: error.message });
    }
});


app.get("/api/config/apis", (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    try {
        // Verificar se todas as variáveis de ambiente estão configuradas
        const mapboxKey = process.env.MAPBOX_TOKEN || process.env.MAPBOX_ACCESS_TOKEN || process.env.MAPBOX_API_KEY;
        const openaiApiKey = process.env.OPENAI_API_KEY;
        const evolutionUrl = process.env.EVOLUTION_API_BASE_URL || process.env.EVOLUTION_API_URL || process.env.EVOLUTION_SERVER_URL;

        console.log(`🔧 Servindo APIs config`);

        const config = {
            "status": "ok",
            "mapbox": {
                "enabled": !!mapboxKey,
                // Public key not exposed directly for security
                "version": "v2.15.0",
                "features": {
                    "navigation": true,
                    "geocoding": true,
                    "directions": true
                }
            },
            "openai": {
                "enabled": !!openaiApiKey,
                "baseUrl": "https://api.openai.com/v1",
                "provider": "OpenAI API",
                "model": "gpt-5-mini",
                "version": "5-mini",
                "configured": !!openaiApiKey,
                "features": {
                    "chat": true,
                    "completion": true,
                    "embeddings": true,
                    "reasoning": true,
                    "tools": true,
                    "streaming": true
                }
            },
            "evolution": {
                "enabled": !!evolutionUrl,
                "serverUrl": evolutionUrl || null,
                "version": "1.7.4",
                "configured": !!evolutionUrl,
                "features": {
                    "whatsapp": true,
                    "telegram": false,
                    "instagram": false
                }
            },
            "timestamp": new Date().toISOString()
        };

        res.json(config);
    } catch (error) {
        console.error("Erro ao carregar configuração APIs:", error);
        res.status(500).json({ error: "APIs configuration not found", details: error.message });
    }
});

app.get("/api/session", (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    try {
        console.log('🔍 Verificando sessão do usuário...');

        // Função para extrair valor de cookie
        const getCookieValue = (cookies, name) => {
            if (!cookies) return null;
            const value = cookies.split('; ').find(row => row.startsWith(name + '='));
            return value ? decodeURIComponent(value.split('=')[1]) : null;
        };

        const cookies = req.headers.cookie || '';
        console.log('🍪 Cookies recebidos:', cookies);

        // Primeiro tentar extrair do cookie JSON padrão
        let sessionData = null;
        const jsonCookie = getCookieValue(cookies, 'timepulse_instance_token');

        if (jsonCookie) {
            try {
                sessionData = JSON.parse(jsonCookie);
                console.log('✅ Session data extraída do cookie JSON:', sessionData);
            } catch (parseError) {
                console.log('⚠️ Erro ao parse do cookie JSON:', parseError.message);
            }
        }

        // Fallback para cookies individuais
        if (!sessionData) {
            sessionData = {
                token: getCookieValue(cookies, 'timepulse_instance_token'),
                instanceId: getCookieValue(cookies, 'timepulse_instance_id'),
                instanceName: getCookieValue(cookies, 'timepulse_instance_name'),
                restaurantId: getCookieValue(cookies, 'timepulse_restaurant_id'),
                userEmail: getCookieValue(cookies, 'timepulse_user_email'),
                type: getCookieValue(cookies, 'timepulse_instance_type') || 'restaurant'
            };
        }

        // Verificar se há pelo menos alguns dados básicos
        const isAuthenticated = !!(sessionData.restaurantId || sessionData.userEmail || sessionData.token);

        const response = {
            authenticated: isAuthenticated,
            restaurantId: sessionData.restaurantId || null,
            userEmail: sessionData.userEmail || null,
            instanceId: sessionData.instanceId || null,
            instanceName: sessionData.instanceName || null,
            type: sessionData.type || 'restaurant',
            timestamp: new Date().toISOString(),
            allCookies: cookies.split(';').map(c => c.trim()).filter(c => c.startsWith('timepulse_'))
        };

        console.log('📊 Dados da sessão retornados:', response);
        res.json(response);

    } catch (error) {
        console.error('❌ Erro ao verificar sessão:', error);
        res.status(500).json({ 
            authenticated: false,
            error: "Session check failed", 
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

app.get("/api/status", async (req, res) => {
    try {
        const startTime = Date.now();
        const timestamp = new Date().toISOString();
        
        // Initialize service statuses
        const services = {
            supabase: "checking",
            evolution: "checking", 
            mapbox: "checking",
            openai: "checking"
        };
        
        // Check Supabase connectivity
        try {
            const supabaseUrl = process.env.SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_ANON_KEY;
            
            if (supabaseUrl && supabaseKey) {
                const { createClient } = require('@supabase/supabase-js');
                const supabase = createClient(supabaseUrl, supabaseKey);
                
                // Simple connectivity test
                const { data, error } = await supabase.auth.getSession();
                services.supabase = error && error.message.includes('Invalid') ? "connected" : "connected";
            } else {
                services.supabase = "not_configured";
            }
        } catch (error) {
            services.supabase = "error";
            console.error("Supabase status check failed:", error.message);
        }
        
        // Check OpenAI connectivity  
        try {
            const openaiKey = process.env.OPENAI_API_KEY;
            if (openaiKey) {
                const OpenAI = require('openai');
                const openai = new OpenAI({ apiKey: openaiKey });
                
                // Simple model list check with timeout
                const modelsPromise = openai.models.list();
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('timeout')), 5000)
                );
                
                await Promise.race([modelsPromise, timeoutPromise]);
                services.openai = "connected";
            } else {
                services.openai = "not_configured";
            }
        } catch (error) {
            services.openai = error.message.includes('timeout') ? "timeout" : "error";
            console.error("OpenAI status check failed:", error.message);
        }
        
        // Check Evolution API connectivity
        try {
            const evolutionUrl = process.env.EVOLUTION_API_BASE_URL || process.env.EVOLUTION_API_URL || process.env.EVOLUTION_SERVER_URL;
            const evolutionKey = process.env.EVOLUTION_API_KEY;
            
            if (evolutionUrl && evolutionKey) {
                const fetch = require('node-fetch');
                const response = await Promise.race([
                    fetch(`${evolutionUrl}/manager/findInstances`, {
                        method: 'GET',
                        headers: { 'apikey': evolutionKey },
                        timeout: 5000
                    }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
                ]);
                
                services.evolution = response.ok ? "connected" : "error";
            } else {
                services.evolution = "not_configured";
            }
        } catch (error) {
            services.evolution = error.message.includes('timeout') ? "timeout" : "error";
            console.error("Evolution API status check failed:", error.message);
        }
        
        // Check Mapbox connectivity
        try {
            const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN || process.env.MAPBOX_TOKEN;
            if (mapboxToken) {
                const fetch = require('node-fetch');
                const response = await Promise.race([
                    fetch(`https://api.mapbox.com/tokens/v2?access_token=${mapboxToken}`, {
                        timeout: 5000
                    }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
                ]);
                
                services.mapbox = response.ok ? "connected" : "error";
            } else {
                services.mapbox = "not_configured";
            }
        } catch (error) {
            services.mapbox = error.message.includes('timeout') ? "timeout" : "error";
            console.error("Mapbox status check failed:", error.message);
        }
        
        const responseTime = Date.now() - startTime;
        const overallStatus = Object.values(services).every(s => s === "connected") ? "ok" : "partial";
        
        res.json({
            status: overallStatus,
            service: "TimePulse AI API",
            version: "1.0.0",
            environment: process.env.NODE_ENV || 'development',
            uptime: process.uptime(),
            timestamp: timestamp,
            response_time_ms: responseTime,
            services: services,
            database: services.supabase,
            cache: "connected"
        });
        
    } catch (error) {
        console.error("Erro ao verificar status:", error);
        res.status(500).json({ 
            status: "error", 
            error: "Status check failed", 
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Auth routes
app.post("/api/auth/login", (req, res) => {
    try {
        const loginData = fs.readFileSync("./api/auth/login", "utf8");
        const loginConfig = JSON.parse(loginData);
        res.json(loginConfig);
    } catch (error) {
        console.error("Erro ao carregar configuração login:", error);
        res.status(500).json({ error: "Login configuration not found", details: error.message });
    }
});

app.post("/api/auth/register", (req, res) => {
    try {
        const registerData = fs.readFileSync("./api/auth/register", "utf8");
        const registerConfig = JSON.parse(registerData);
        res.json(registerConfig);
    } catch (error) {
        console.error("Erro ao carregar configuração register:", error);
        res.status(500).json({ error: "Register configuration not found", details: error.message });
    }
});

// Endpoint para autenticação de revendedor
app.post("/api/auth/revendedor/login", async (req, res) => {
    try {
        const { email, cpfCnpj } = req.body;
        
        if (!email || !cpfCnpj) {
            return res.status(400).json({ 
                success: false,
                error: 'Email e CPF/CNPJ são obrigatórios' 
            });
        }
        
        // Normalizar CPF/CNPJ (remover pontos, traços, barras)
        const normalizedCpfCnpj = cpfCnpj.replace(/\D/g, '');
        
        // Verificar se supabaseAdmin está disponível
        if (!supabaseAdmin) {
            console.error('❌ supabaseAdmin não inicializado');
            return res.status(500).json({ 
                success: false,
                error: 'Configuração do banco de dados indisponível' 
            });
        }
        
        console.log(`🔍 Tentando autenticar revendedor: ${email} / CPF: ${normalizedCpfCnpj}`);
        
        // Buscar revendedor usando supabaseAdmin (bypassa RLS)
        const { data, error } = await supabaseAdmin
            .from('subcontas_asass')
            .select('*')
            .eq('email', email)
            .eq('cpfCnpj', normalizedCpfCnpj)
            .single();
        
        if (error) {
            console.error('❌ Erro ao buscar revendedor:', error);
            return res.status(401).json({ 
                success: false,
                error: 'Email ou CPF/CNPJ incorretos',
                details: error.message 
            });
        }
        
        if (!data) {
            console.log('❌ Revendedor não encontrado');
            return res.status(401).json({ 
                success: false,
                error: 'Email ou CPF/CNPJ incorretos' 
            });
        }
        
        console.log(`✅ Revendedor autenticado: ${data.name}`);
        
        // Retornar dados do revendedor (sem informações sensíveis como apiKey completa)
        res.json({
            success: true,
            data: {
                id: data.id,
                name: data.name,
                email: data.email,
                phone: data.phone,
                cpfCnpj: data.cpfCnpj,
                personType: data.personType,
                walletId: data.walletId,
                status: data.status,
                saldo_atual: data.saldo_atual,
                created_at: data.created_at
            }
        });
        
    } catch (error) {
        console.error('❌ Erro no login de revendedor:', error);
        res.status(500).json({ 
            success: false,
            error: 'Erro ao fazer login',
            details: error.message 
        });
    }
});

// Endpoint para listar restaurantes do revendedor
app.get("/api/revendedor/:revendedorId/restaurants", async (req, res) => {
    try {
        const { revendedorId } = req.params;
        
        console.log(`🔍 Buscando restaurantes do revendedor ID: ${revendedorId}`);
        
        // Verificar se supabaseAdmin está disponível
        if (!supabaseAdmin) {
            return res.status(500).json({ 
                success: false,
                error: 'Configuração do banco de dados indisponível' 
            });
        }
        
        // Buscar restaurantes usando supabaseAdmin
        const { data, error } = await supabaseAdmin
            .from('restaurants')
            .select('*')
            .eq('id_revendedor', revendedorId)
            .order('created_at', { ascending: false });
        
        if (error) {
            console.error('❌ Erro ao buscar restaurantes:', error);
            return res.status(500).json({ 
                success: false,
                error: 'Erro ao buscar restaurantes',
                details: error.message 
            });
        }
        
        console.log(`✅ Encontrados ${data?.length || 0} restaurantes do revendedor ${revendedorId}`);
        
        res.json({
            success: true,
            restaurants: data || [],
            count: data?.length || 0
        });
        
    } catch (error) {
        console.error('❌ Erro ao buscar restaurantes do revendedor:', error);
        res.status(500).json({ 
            success: false,
            error: 'Erro ao buscar restaurantes',
            details: error.message 
        });
    }
});

// =================================================================
// ENDPOINTS SISTEMA DE TESTE GRATUITO E ASSINATURAS
// =================================================================

// Endpoint público para verificar status do teste (sem autenticação para banner)
app.get('/api/trial-status/:restaurantId', rateLimitEvolutionAPI(10, 60000), async (req, res) => {
    try {
        const { restaurantId } = req.params;
        
        // Em modo desenvolvimento, permitir IDs de teste
        const isDevelopment = NODE_ENV !== 'production';
        const isDevId = restaurantId.startsWith('dev-');
        
        if (isDevelopment && isDevId) {
            // Retornar dados mockados para desenvolvimento
            console.log(`🛠️ Modo desenvolvimento: Retornando dados mockados para ${restaurantId}`);
            return res.json({
                status: 'ok',
                trial_enabled: true,
                trial_days_remaining: 15,
                subscription_status: 'trial',
                plan: 'trial',
                whatsapp_disconnected: false,
                is_development: true,
                restaurant_id: restaurantId
            });
        }
        
        // Validar que restaurantId é um UUID válido para produção
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(restaurantId)) {
            console.log(`❌ ID de restaurante inválido: ${restaurantId}`);
            return res.status(400).json({ error: 'ID de restaurante inválido' });
        }
        
        // Configurar cliente Supabase
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_ANON_KEY;

        // Auto-detect and fix swapped environment variables
        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && supabaseKey && supabaseKey.startsWith('https://')) {
            console.log('🔄 Trial status auto-detecting swapped SUPABASE_URL and SUPABASE_ANON_KEY');
            const temp = supabaseUrl;
            supabaseUrl = supabaseKey;
            supabaseKey = temp;
        }

        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).json({ error: 'Configuração do Supabase incompleta' });
        }

        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        // Buscar dados reais do restaurante
        const { data: restaurant, error: fetchError } = await supabaseClient
            .from('restaurants')
            .select(`
                id,
                name,
                trial_enabled,
                trial_start_date,
                trial_end_date,
                trial_days_remaining,
                subscription_status,
                subscription_start_date,
                subscription_end_date,
                whatsapp_disconnected_due_to_trial,
                plan,
                status
            `)
            .eq('id', restaurantId)
            .single();

        if (fetchError || !restaurant) {
            console.error('❌ Erro ao buscar dados do restaurante:', fetchError);
            return res.status(404).json({ error: 'Restaurante não encontrado' });
        }

        // Calcular dados do período de teste
        const now = new Date();
        const trialEndDate = restaurant.trial_end_date ? new Date(restaurant.trial_end_date) : null;
        const subscriptionEndDate = restaurant.subscription_end_date ? new Date(restaurant.subscription_end_date) : null;
        
        let subscriptionStatus = restaurant.subscription_status || 'trial';
        let trialDaysRemaining = 0;
        let isExpired = false;

        if (trialEndDate) {
            const timeDiff = trialEndDate.getTime() - now.getTime();
            trialDaysRemaining = Math.max(0, Math.ceil(timeDiff / (1000 * 60 * 60 * 24)));
            
            if (timeDiff <= 0 && subscriptionStatus === 'trial') {
                subscriptionStatus = 'expired';
                isExpired = true;
            }
        }

        // Verificar se assinatura ativa existe e está válida
        if (subscriptionEndDate && subscriptionEndDate > now) {
            subscriptionStatus = 'active';
            isExpired = false;
        }

        // Retornar apenas campos necessários para o banner (reduzir exposição de dados)
        const trialData = {
            trial_end_date: restaurant.trial_end_date,
            trial_days_remaining: trialDaysRemaining,
            subscription_status: subscriptionStatus,
            subscription_start_date: restaurant.subscription_start_date,
            subscription_end_date: restaurant.subscription_end_date,
            whatsapp_disconnected_due_to_trial: restaurant.whatsapp_disconnected_due_to_trial ?? false,
            plan: restaurant.plan || 'basic',
            is_expired: isExpired
        };
        
        console.log(`📊 Status do teste para restaurante ${restaurantId}: ${subscriptionStatus}, ${trialDaysRemaining} dias restantes`);
        res.json(trialData);
        
    } catch (error) {
        console.error('❌ Erro ao verificar status do teste:', error);
        res.status(500).json({ error: 'Erro ao verificar status do teste' });
    }
});

// Endpoint para buscar histórico de cobranças
app.get('/api/billing-history/:restaurantId', rateLimitEvolutionAPI(10, 60000), async (req, res) => {
    try {
        const { restaurantId } = req.params;
        
        // Validar que restaurantId é um UUID válido
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(restaurantId)) {
            console.log(`❌ ID de restaurante inválido: ${restaurantId}`);
            return res.status(400).json({ error: 'ID de restaurante inválido' });
        }
        
        // Configurar cliente Supabase com SERVICE_ROLE_KEY para bypassar RLS
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && supabaseKey && supabaseKey.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = supabaseKey;
            supabaseKey = temp;
        }

        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).json({ error: 'Configuração do Supabase incompleta' });
        }

        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        console.log('🔍 [DEBUG BILLING] Configuração:', { supabaseUrl, hasKey: !!supabaseKey });
        console.log('🔍 [DEBUG BILLING] Buscando para restaurantId:', restaurantId);
        
        // Primeiro: buscar TODOS os registros para debug
        const { data: allData, error: allError } = await supabaseClient
            .from('sessao_assinaturas')
            .select('*');
        
        if (allError) {
            console.error('❌ [DEBUG BILLING] Erro ao buscar TODOS os registros:', allError);
        }
        
        console.log('🔍 [DEBUG BILLING] Total de registros na tabela:', allData?.length || 0);
        if (allData && allData.length > 0) {
            console.log('🔍 [DEBUG BILLING] Primeiros registros:', JSON.stringify(allData.slice(0, 3), null, 2));
        } else if (!allError) {
            console.warn('⚠️ [DEBUG BILLING] Tabela vazia ou sem permissão de leitura (RLS ativo)');
        }
        
        // Buscar histórico de cobranças com filtro
        const { data: sessions, error } = await supabaseClient
            .from('sessao_assinaturas')
            .select('*')
            .eq('id_restaurante', restaurantId)
            .order('data_pagamento', { ascending: false });

        console.log('🔍 [DEBUG BILLING] Registros filtrados para', restaurantId, ':', sessions?.length || 0);
        
        if (error) {
            console.error('❌ Erro ao buscar histórico de cobranças:', error);
            return res.status(500).json({ 
                error: 'Erro ao buscar histórico', 
                details: error.message,
                code: error.code 
            });
        }

        console.log(`📊 Histórico de cobranças para ${restaurantId}: ${sessions?.length || 0} registros encontrados`);
        res.json({ 
            success: true, 
            data: sessions || [],
            count: sessions?.length || 0 
        });
        
    } catch (error) {
        console.error('❌ Erro ao buscar histórico de cobranças:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico de cobranças', details: error.message });
    }
});

// Endpoint para buscar dados de um restaurante específico
app.get('/api/restaurants/:restaurantId', rateLimitEvolutionAPI(10, 60000), async (req, res) => {
    try {
        const { restaurantId } = req.params;
        
        // Validar que restaurantId é um UUID válido
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(restaurantId)) {
            console.log(`❌ ID de restaurante inválido: ${restaurantId}`);
            return res.status(400).json({ error: 'ID de restaurante inválido' });
        }
        
        // Configurar cliente Supabase
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_ANON_KEY;

        // Auto-detect and fix swapped environment variables
        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && supabaseKey && supabaseKey.startsWith('https://')) {
            console.log('🔄 Restaurant endpoint auto-detecting swapped SUPABASE_URL and SUPABASE_ANON_KEY');
            const temp = supabaseUrl;
            supabaseUrl = supabaseKey;
            supabaseKey = temp;
        }

        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).json({ error: 'Configuração do Supabase incompleta' });
        }

        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        // Buscar dados do restaurante
        const { data: restaurant, error: fetchError } = await supabaseClient
            .from('restaurants')
            .select(`
                id,
                name,
                owner_email,
                owner_cpf,
                owner_phone,
                trial_enabled,
                trial_start_date,
                trial_end_date,
                subscription_status,
                plan,
                status
            `)
            .eq('id', restaurantId)
            .single();

        if (fetchError || !restaurant) {
            console.error('❌ Erro ao buscar dados do restaurante:', fetchError);
            return res.status(404).json({ error: 'Restaurante não encontrado' });
        }

        console.log(`📊 Dados do restaurante ${restaurantId} retornados com sucesso`);
        res.json(restaurant);
        
    } catch (error) {
        console.error('❌ Erro ao buscar dados do restaurante:', error);
        res.status(500).json({ error: 'Erro ao buscar dados do restaurante' });
    }
});

// Endpoint: Buscar tipos de negócio ativos
app.get('/api/business-types', async (req, res) => {
    try {
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        // Auto-detect and fix swapped environment variables
        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }

        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).json({ error: 'Configuração do banco de dados não encontrada' });
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        // Buscar tipos de negócio ativos ordenados por nome
        const { data: businessTypes, error } = await supabase
            .from('business_types')
            .select('id, name, description, is_food_business')
            .eq('active', true)
            .order('name', { ascending: true });

        if (error) {
            console.error('❌ Erro ao buscar tipos de negócio:', error);
            return res.status(500).json({ error: 'Erro ao buscar tipos de negócio' });
        }

        res.json({ businessTypes: businessTypes || [] });
    } catch (error) {
        console.error('❌ Erro interno ao buscar tipos de negócio:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Endpoint para desconectar WhatsApp quando teste expira
app.post('/api/disconnect-whatsapp-trial', authenticateJWT, async (req, res) => {
    try {
        const { restaurantId, reason } = req.body;
        
        console.log(`🔌 Desconectando WhatsApp para restaurante ${restaurantId} - Motivo: ${reason}`);
        
        // Buscar configurações do Evolution API das variáveis de ambiente
        const evolutionApiUrl = process.env.EVOLUTION_API_BASE_URL || process.env.EVOLUTION_API_URL || process.env.EVOLUTION_SERVER_URL;
        const evolutionApiKey = process.env.EVOLUTION_API_KEY;
        
        if (evolutionApiUrl && evolutionApiKey) {
            try {
                const logoutResponse = await fetch(`${evolutionApiUrl}/instance/logout/${restaurantId}`, {
                    method: 'POST',
                    headers: {
                        'apikey': evolutionApiKey,
                        'Content-Type': 'application/json'
                    }
                });
                
                if (logoutResponse.ok) {
                    console.log(`✅ WhatsApp desconectado com sucesso para restaurante ${restaurantId}`);
                    
                    // TODO: Atualizar no banco que foi desconectado
                    // await supabase.from('restaurants').update({ 
                    //     whatsapp_disconnected_due_to_trial: true 
                    // }).eq('id', restaurantId);
                    
                    res.json({ success: true, message: 'WhatsApp desconectado com sucesso' });
                } else {
                    throw new Error('Falha ao desconectar WhatsApp');
                }
            } catch (apiError) {
                console.error('❌ Erro na API Evolution:', apiError);
                res.status(500).json({ error: 'Erro ao comunicar com Evolution API' });
            }
        } else {
            console.log('⚠️ Configurações da Evolution API não encontradas');
            res.status(400).json({ error: 'Configurações da Evolution API não encontradas' });
        }
    } catch (error) {
        console.error('❌ Erro ao desconectar WhatsApp:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// =================================================================
// API Routes - Delivery Driver Mobile App
// =================================================================

// Mount driver API routes
try {
    const driverRoutes = require('./api/driver/routes');
    app.use('/api/driver', driverRoutes);
    console.log('🚗 Driver Mobile App API routes mounted at /api/driver/*');
    
    // Try to mount setup routes separately (also requires JWT_SECRET)
    try {
        const driverSetupRoutes = require('./api/driver/setup-password');
        app.use('/api/driver/auth', driverSetupRoutes);
        console.log('🔧 Driver password setup endpoint mounted (admin-only)');
    } catch (setupError) {
        console.error('⚠️ Failed to mount driver setup routes:', setupError.message);
        console.error('   Password setup for existing drivers will not be available until JWT_SECRET is configured.');
    }
} catch (error) {
    console.error('⚠️ Failed to mount driver routes (missing JWT_SECRET or SUPABASE_SERVICE_ROLE_KEY?):', error.message);
    console.error('   Driver authentication will not be available until configuration is fixed.');
}

// =================================================================
// Configuration Endpoints
// =================================================================

// Mapbox token endpoint (requires authentication)
app.get('/api/config/mapbox-token', (req, res) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Autenticação requerida' });
    }
    
    if (!process.env.MAPBOX_TOKEN) {
        return res.status(500).json({ error: 'Mapbox token não configurado' });
    }
    
    res.json({ token: process.env.MAPBOX_TOKEN });
});

// =================================================================
// Static Files & Express Configuration
// =================================================================

// Static files (somente diretório público por segurança) - com cache busting
app.use(express.static("public", {
    setHeaders: (res, path, stat) => {
        // Evitar cache em arquivos HTML e JS de configuração para garantir atualizações
        if (path.endsWith('.html') || 
            path.includes('js/config.js') || 
            path.includes('js/secure-config.js') || 
            path.includes('js/secure-config-simple.js')) {
            res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.set('Pragma', 'no-cache');
            res.set('Expires', '0');
        }
    }
}));

// Serve PWA files (config, service workers, etc)
app.use("/pwa", express.static("pwa", {
    setHeaders: (res, path, stat) => {
        if (path.endsWith('.js')) {
            res.set('Content-Type', 'application/javascript');
        }
    }
}));

// Serve assets files (driver-app.js, etc)
app.use("/assets", express.static("assets", {
    setHeaders: (res, path, stat) => {
        if (path.endsWith('.js')) {
            res.set('Content-Type', 'application/javascript');
        }
    }
}));

// Default route
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});


// =================================================================
// ADVANCED SECURITY MIDDLEWARE
// =================================================================

// Initialize Supabase Admin Client for JWT verification
let supabaseAdmin = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    supabaseAdmin = createClient(
        process.env.SUPABASE_URL, 
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    console.log('✅ Supabase Admin Client initialized for JWT verification');
} else {
    console.warn('⚠️ SUPABASE_SERVICE_ROLE_KEY not found. JWT admin verification will be limited.');
}

// JWT Supabase Authentication Middleware for Admin Endpoints
const authenticateAdmin = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.log('❌ Admin auth: No Bearer token provided');
            return res.status(401).json({ 
                error: 'Token de autorização requerido',
                details: 'Forneça um token Bearer válido'
            });
        }
        
        const token = authHeader.substring(7);
        
        // Fallback to old token for development/testing
        if (token === 'admin-timepulse-2025' && process.env.NODE_ENV !== 'production') {
            console.log('⚠️ Using fallback admin token (development only)');
            req.user = { role: 'admin', email: 'admin@timepulse.ai' };
            return next();
        }
        
        // Verificar token JWT admin personalizado 
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'timepulse_admin_secret_2025');
            
            if (decoded.role === 'admin') {
                req.user = {
                    admin_id: decoded.admin_id,
                    email: decoded.email,
                    role: 'admin'
                };
                return next();
            } else {
                console.log('❌ Admin auth: User does not have admin role');
                return res.status(403).json({ 
                    error: 'Permissões insuficientes',
                    details: 'Apenas administradores podem acessar este recurso'
                });
            }
        } catch (jwtError) {
            console.log('❌ Admin auth: Invalid JWT token:', jwtError.message);
            return res.status(401).json({ 
                error: 'Token JWT inválido',
                details: 'Token expirado ou inválido'
            });
        }
        
    } catch (error) {
        console.error('❌ Error in admin authentication:', error);
        res.status(500).json({ 
            error: 'Erro interno de autenticação',
            details: 'Falha na verificação do token'
        });
    }
};

// Endpoint para atualizar dados completos do restaurante via admin
app.put('/api/admin/restaurant/:restaurantId', authenticateAdmin, async (req, res) => {
    try {
        const { restaurantId } = req.params;
        const {
            name,
            owner_email,
            owner_phone,
            address,
            plan,
            status,
            subscription_status,
            trial_end_date,
            subscription_end_date,
            trial_extension_reason,
            manual_activation_reason,
            status_change_reason
        } = req.body;

        console.log(`📝 Atualizando restaurante ${restaurantId} com dados:`, {
            name,
            owner_email,
            owner_phone,
            address,
            plan,
            status,
            subscription_status,
            trial_end_date,
            subscription_end_date
        });

        // Configurar cliente Supabase
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        // Auto-detect and fix swapped environment variables
        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }

        const supabaseClient = createClient(supabaseUrl, supabaseKey);

        // Preparar dados para atualização
        const updateData = {
            updated_at: new Date().toISOString()
        };

        // Atualizar apenas campos fornecidos
        if (name) updateData.name = name;
        if (owner_email) updateData.owner_email = owner_email;
        if (owner_phone) updateData.owner_phone = owner_phone;
        if (address) updateData.address = address;
        if (plan) updateData.plan = plan;
        if (status) updateData.status = status;
        if (subscription_status) updateData.subscription_status = subscription_status;
        if (trial_extension_reason) updateData.trial_extension_reason = trial_extension_reason;
        if (manual_activation_reason) updateData.manual_activation_reason = manual_activation_reason;
        if (status_change_reason) updateData.status_change_reason = status_change_reason;

        // Processar datas especiais
        if (trial_end_date) {
            updateData.trial_end_date = new Date(trial_end_date).toISOString();
        }
        
        if (subscription_end_date) {
            updateData.subscription_end_date = new Date(subscription_end_date).toISOString();
            updateData.subscription_start_date = new Date().toISOString();
            // Só definir subscription_status='active' se não foi explicitamente fornecido
            if (!subscription_status) {
                updateData.subscription_status = 'active';
            }
        }

        // Atualizar no banco de dados
        const { data: updatedRestaurant, error: updateError } = await supabaseClient
            .from('restaurants')
            .update(updateData)
            .eq('id', restaurantId)
            .select('*')
            .single();

        if (updateError) {
            console.error('❌ Erro ao atualizar restaurante:', updateError);
            return res.status(500).json({ error: 'Erro ao atualizar dados do restaurante' });
        }

        // Log da ação administrativa
        await supabaseClient
            .from('activity_logs')
            .insert({
                restaurant_id: restaurantId,
                user_name: req.user.email,
                action: 'admin_update_restaurant',
                entity_type: 'restaurant',
                entity_id: restaurantId,
                description: `Restaurante atualizado via admin. Campos alterados: ${Object.keys(updateData).join(', ')}`
            });

        console.log(`✅ Admin ${req.user.email} atualizou restaurante ${restaurantId}`);
        
        res.json({
            success: true,
            restaurant: updatedRestaurant,
            message: 'Dados do restaurante atualizados com sucesso'
        });

    } catch (error) {
        console.error('❌ Erro ao atualizar restaurante:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Alias do endpoint com plural para compatibilidade
app.put('/api/admin/restaurants/:restaurantId', authenticateAdmin, async (req, res) => {
    // Redirecionar internamente para o endpoint singular
    req.url = `/api/admin/restaurant/${req.params.restaurantId}`;
    return app._router.handle(req, res, () => {});
});

// JWT Supabase Authentication Middleware for Regular Users (duplicado - removido)

// Alias for better semantic meaning
const authenticateUser = authenticateJWT;

// Combined security middleware for Evolution API
const secureEvolutionAPI = [
    authenticateJWT,
    rateLimitEvolutionAPI(30, 60000), // 30 requests per minute
    csrfProtection
];

// Subscription Status Verification Middleware
const requireActiveSubscription = async (req, res, next) => {
    try {
        // Get user info from previous authentication middleware
        const userId = req.session?.restaurantId || req.user?.id;
        const userEmail = req.session?.userEmail || req.user?.email;
        
        if (!userId && !userEmail) {
            return res.status(401).json({ 
                error: 'Usuário não identificado',
                details: 'Faça login primeiro'
            });
        }
        
        // TODO: Implement real subscription check with PostgreSQL
        // For now, simulate subscription check
        const hasActiveSubscription = await checkUserSubscription(userId || userEmail);
        
        if (!hasActiveSubscription.active) {
            return res.status(402).json({ 
                error: 'Assinatura necessária',
                details: 'Este recurso requer uma assinatura ativa',
                subscription_status: hasActiveSubscription.status,
                trial_expired: hasActiveSubscription.trial_expired
            });
        }
        
        req.subscription = hasActiveSubscription;
        next();
        
    } catch (error) {
        console.error('❌ Error checking subscription:', error);
        res.status(500).json({ 
            error: 'Erro ao verificar assinatura',
            details: error.message
        });
    }
};

// Mock function for subscription check (replace with real database query)
async function checkUserSubscription(userId) {
    try {
        // TODO: Replace with real PostgreSQL query
        // SELECT subscription_status, trial_end_date, subscription_end_date 
        // FROM restaurants WHERE id = $1 OR owner_email = $1
        
        // For now, return mock data
        const mockSubscription = {
            active: true,
            status: 'trial', // 'trial', 'active', 'expired', 'cancelled'
            trial_expired: false,
            subscription_end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
            plan: 'basic'
        };
        
        return mockSubscription;
    } catch (error) {
        console.error('Error checking subscription:', error);
        return { active: false, status: 'unknown', trial_expired: true };
    }
}

// Asaas Webhook Signature Validation
const validateAsaasWebhook = (req, res, next) => {
    try {
        const signature = req.headers['asaas-access-token'] || req.headers['x-asaas-signature'];
        const body = req.body;
        
        if (!signature) {
            console.log('❌ Asaas webhook: No signature header found');
            return res.status(401).json({ 
                error: 'Webhook não autorizado',
                details: 'Assinatura de webhook ausente'
            });
        }
        
        const webhookSecret = process.env.ASAAS_WEBHOOK_SECRET;
        if (!webhookSecret) {
            console.log('❌ Asaas webhook: ASAAS_WEBHOOK_SECRET not configured');
            return res.status(500).json({ 
                error: 'Configuração incompleta',
                details: 'Secret do webhook não configurado'
            });
        }
        
        // Create signature verification
        const payload = JSON.stringify(body);
        const expectedSignature = crypto
            .createHmac('sha256', webhookSecret)
            .update(payload)
            .digest('hex');
        
        const isValid = crypto.timingSafeEqual(
            Buffer.from(signature, 'hex'),
            Buffer.from(expectedSignature, 'hex')
        );
        
        if (!isValid) {
            console.log('❌ Asaas webhook: Invalid signature');
            return res.status(401).json({ 
                error: 'Webhook não autorizado',
                details: 'Assinatura inválida'
            });
        }
        
        console.log('✅ Asaas webhook signature verified');
        next();
        
    } catch (error) {
        console.error('❌ Error validating Asaas webhook:', error);
        res.status(500).json({ 
            error: 'Erro na validação do webhook',
            details: error.message
        });
    }
};

// =================================================================
// ENDPOINTS ADMINISTRATIVOS
// =================================================================

// Estatísticas gerais do sistema
app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
    try {
        console.log('📊 Carregando estatísticas administrativas...');

        // Criar cliente Supabase para consultas administrativas
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        // Auto-detect and fix swapped environment variables
        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            console.log('🔄 Admin endpoint auto-detecting swapped SUPABASE_URL and SUPABASE_ANON_KEY - fixing automatically');
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).json({ error: 'Configuração do Supabase incompleta' });
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        // Consultas reais ao PostgreSQL via Supabase
        const [restaurantsResult, ordersResult, subscriptionsResult] = await Promise.all([
            supabaseClient.from('restaurants').select('*'),
            supabaseClient.from('orders').select('*'),
            supabaseClient.from('subscriptions').select('*')
        ]);
        
        const restaurants = restaurantsResult.data || [];
        const orders = ordersResult.data || [];
        const subscriptions = subscriptionsResult.data || [];
        
        // Calcular estatísticas reais
        const totalRestaurants = restaurants.length;
        const activeTrials = restaurants.filter(r => r.subscription_status === 'trial').length;
        const activeSubscriptions = restaurants.filter(r => r.subscription_status === 'active').length;
        
        // Calcular receita do mês atual
        const currentMonth = new Date().getMonth();
        const currentYear = new Date().getFullYear();
        const monthlyOrders = orders.filter(order => {
            const orderDate = new Date(order.created_at);
            return orderDate.getMonth() === currentMonth && orderDate.getFullYear() === currentYear;
        });
        
        const monthlyRevenue = monthlyOrders.reduce((sum, order) => sum + (parseFloat(order.total_amount) || 0), 0);
        const averageOrderValue = monthlyOrders.length > 0 ? monthlyRevenue / monthlyOrders.length : 0;
        
        // Novos restaurantes este mês
        const newRestaurantsThisMonth = restaurants.filter(restaurant => {
            const createdDate = new Date(restaurant.created_at);
            return createdDate.getMonth() === currentMonth && createdDate.getFullYear() === currentYear;
        }).length;
        
        const stats = {
            totalRestaurants,
            activeTrials,
            activeSubscriptions,
            monthlyRevenue: parseFloat(monthlyRevenue.toFixed(2)),
            newRestaurantsThisMonth,
            conversionRate: activeTrials > 0 ? ((activeSubscriptions / (activeTrials + activeSubscriptions)) * 100).toFixed(1) : 0,
            churnRate: 3.5, // Calcular baseado em dados históricos
            averageOrderValue: parseFloat(averageOrderValue.toFixed(2)),
            totalOrders: orders.length,
            ordersThisMonth: monthlyOrders.length
        };

        console.log('✅ Estatísticas carregadas com sucesso:', stats);
        res.json(stats);
    } catch (error) {
        console.error('❌ Erro ao carregar estatísticas:', error);
        res.status(500).json({ error: 'Erro interno do servidor', details: error.message });
    }
});

// Listar todos os restaurantes
app.get('/api/admin/restaurants', authenticateAdmin, async (req, res) => {
    try {
        console.log('🏪 Carregando lista de restaurantes...');

        // Criar cliente Supabase para consultas administrativas
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        // Auto-detect and fix swapped environment variables
        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            console.log('🔄 Admin endpoint auto-detecting swapped SUPABASE_URL and SUPABASE_ANON_KEY - fixing automatically');
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).json({ error: 'Configuração do Supabase incompleta' });
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        // Consulta real aos restaurantes no PostgreSQL
        const { data: restaurants, error } = await supabaseClient
            .from('restaurants')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) {
            console.error('❌ Erro na consulta Supabase:', error);
            return res.status(500).json({ error: 'Erro ao consultar restaurantes', details: error.message });
        }
        
        // Buscar último login dos usuários associados
        const enrichedRestaurants = await Promise.all(
            (restaurants || []).map(async (restaurant) => {
                try {
                    // Buscar informações do usuário no auth.users se possível
                    const { data: authData } = await supabaseClient.auth.admin.listUsers();
                    const user = authData?.users?.find(u => u.email === restaurant.owner_email);
                    
                    return {
                        ...restaurant,
                        last_login: user?.last_sign_in_at || null,
                        subscription_status: restaurant.subscription_status || 'trial'
                    };
                } catch (authError) {
                    // Se não conseguir buscar dados do auth, retorna apenas os dados do restaurante
                    return {
                        ...restaurant,
                        last_login: null,
                        subscription_status: restaurant.subscription_status || 'trial'
                    };
                }
            })
        );

        console.log(`✅ ${enrichedRestaurants.length} restaurantes carregados`);
        res.json({ restaurants: enrichedRestaurants });
    } catch (error) {
        console.error('❌ Erro ao carregar restaurantes:', error);
        res.status(500).json({ error: 'Erro interno do servidor', details: error.message });
    }
});

// Listar testes gratuitos ativos
app.get('/api/admin/trials', authenticateAdmin, async (req, res) => {
    try {
        console.log('🕐 Carregando testes gratuitos ativos...');

        // Criar cliente Supabase para consultas administrativas
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        // Auto-detect and fix swapped environment variables
        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            console.log('🔄 Admin endpoint auto-detecting swapped SUPABASE_URL and SUPABASE_ANON_KEY - fixing automatically');
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).json({ error: 'Configuração do Supabase incompleta' });
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        // Consulta real aos restaurantes em período de teste
        const { data: restaurants, error } = await supabaseClient
            .from('restaurants')
            .select('*')
            .eq('subscription_status', 'trial')
            .order('created_at', { ascending: false });
        
        if (error) {
            console.error('❌ Erro na consulta Supabase:', error);
            return res.status(500).json({ error: 'Erro ao consultar testes gratuitos', details: error.message });
        }
        
        // Calcular informações do período de teste
        const trials = (restaurants || []).map(restaurant => {
            const trialStartDate = new Date(restaurant.created_at);
            const trialEndDate = new Date(trialStartDate);
            trialEndDate.setDate(trialEndDate.getDate() + 7); // 7 dias de teste
            
            const now = new Date();
            const trialDaysRemaining = Math.max(0, Math.ceil((trialEndDate - now) / (1000 * 60 * 60 * 24)));
            
            return {
                restaurant_id: restaurant.id,
                restaurant_name: restaurant.name,
                owner_email: restaurant.owner_email,
                trial_start_date: trialStartDate.toISOString(),
                trial_end_date: trialEndDate.toISOString(),
                trial_days_remaining: trialDaysRemaining,
                subscription_status: restaurant.subscription_status,
                is_expired: trialDaysRemaining <= 0
            };
        });

        console.log(`✅ ${trials.length} testes ativos carregados`);
        res.json({ trials });
    } catch (error) {
        console.error('❌ Erro ao carregar testes:', error);
        res.status(500).json({ error: 'Erro interno do servidor', details: error.message });
    }
});

// Listar assinaturas ativas
app.get('/api/admin/subscriptions', authenticateAdmin, async (req, res) => {
    try {
        console.log('💳 Carregando assinaturas ativas...');

        // Criar cliente Supabase para consultas administrativas
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        // Auto-detect and fix swapped environment variables
        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            console.log('🔄 Admin endpoint auto-detecting swapped SUPABASE_URL and SUPABASE_ANON_KEY - fixing automatically');
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).json({ error: 'Configuração do Supabase incompleta' });
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        // Consulta na view admin_restaurants_detailed filtrando por subscription_status = 'active'
        const { data: subscriptions, error } = await supabaseClient
            .from('admin_restaurants_detailed')
            .select('*')
            .eq('subscription_status', 'active')
            .order('created_at', { ascending: false });
        
        if (error) {
            console.error('❌ Erro na consulta Supabase:', error);
            return res.status(500).json({ error: 'Erro ao consultar assinaturas', details: error.message });
        }

        console.log(`✅ ${subscriptions?.length || 0} assinaturas carregadas`);
        res.json({ subscriptions: subscriptions || [] });
    } catch (error) {
        console.error('❌ Erro ao carregar assinaturas:', error);
        res.status(500).json({ error: 'Erro interno do servidor', details: error.message });
    }
});

// =================================================================
// ENDPOINTS ADMINISTRATIVOS ADICIONAIS
// =================================================================

// Login administrativo simplificado para desenvolvimento
app.post('/api/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email e senha são obrigatórios' });
        }
        
        // Login administrativo simplificado para desenvolvimento
        if (email === 'luishplleite@gmail.com' && password === '@Lucas281178@') {
            
            // Gerar JWT
            const jwt = require('jsonwebtoken');
            const token = jwt.sign(
                { admin_id: 1, email: email, role: 'admin' },
                process.env.JWT_SECRET || 'timepulse_admin_secret_2025',
                { expiresIn: '8h' }
            );
            
            res.json({
                success: true,
                token: token,
                admin: {
                    id: 1,
                    name: 'Lucas Administrator',
                    email: email,
                    role: 'admin'
                }
            });
            
            console.log(`✅ Login administrativo realizado para ${email}`);
            return;
        }
        
        // Credenciais inválidas
        return res.status(401).json({ error: 'Credenciais inválidas' });
        
    } catch (error) {
        console.error('❌ Erro no login admin:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Verificar token administrativo
app.get('/api/admin/verify', authenticateAdmin, (req, res) => {
    res.json({
        success: true,
        admin: {
            email: req.user.email,
            role: req.user.role || 'admin'
        }
    });
});

// CSRF token para administradores
app.get('/api/admin/csrf-token', authenticateAdmin, (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    const crypto = require('crypto');
    const adminId = req.user.admin_id || req.user.id || 'admin';
    const timestamp = Date.now();
    const hash = crypto.createHash('sha256')
        .update(adminId + timestamp + 'timepulse-admin-csrf-secret')
        .digest('hex')
        .substring(0, 16);

    const csrfToken = `csrf_admin_${adminId}_${hash}`;

    res.json({
        csrfToken: csrfToken,
        timestamp: timestamp,
        status: "ok"
    });
});

// Chat do assistente para administradores
app.post('/api/admin/assistant/chat', authenticateAdmin, async (req, res) => {
    try {
        const { messages, model, reasoning_effort, max_completion_tokens, temperature, restaurant_id, session_id } = req.body;

        // Configurar parâmetros padrão para administradores - OBRIGATORIAMENTE gpt-5-mini
        const finalModel = 'gpt-5-mini'; // Sempre gpt-5-mini, jamais outro modelo
        const finalReasoningEffort = reasoning_effort || 'medium';
        const finalMaxTokens = max_completion_tokens || 4096;
        const finalSessionId = session_id || `admin-${Date.now()}`;

        console.log(`🤖 Admin chat request: ${finalModel}, reasoning: ${finalReasoningEffort}`);

        // Verificar se a API key está configurada
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            console.error('❌ OPENAI_API_KEY não configurada');
            return res.status(500).json({
                error: 'OpenAI API não configurada',
                details: 'Chave da API não encontrada'
            });
        }

        // Fazer requisição para OpenAI API
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: finalModel,
                messages: messages,
                max_completion_tokens: finalMaxTokens,
                stream: false
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            console.error('❌ Erro da OpenAI API:', response.status, errorData);
            return res.status(response.status).json({
                error: 'Erro na OpenAI API',
                details: `Status ${response.status}: ${errorData}`
            });
        }

        const data = await response.json();
        
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            console.error('❌ Resposta inválida da OpenAI API:', data);
            return res.status(500).json({
                error: 'Resposta inválida da API',
                details: 'Formato de resposta inesperado'
            });
        }

        const aiResponse = data.choices[0].message.content;

        console.log(`✅ Admin chat response: ${aiResponse.length} chars`);

        res.json({
            response: aiResponse,
            model_used: finalModel,
            reasoning_effort: finalReasoningEffort,
            session_id: finalSessionId,
            admin_mode: true,
            usage: data.usage || {},
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro no chat admin:', error);
        res.status(500).json({
            error: 'Erro interno do servidor',
            details: error.message
        });
    }
});

// Endpoints para gerenciar prompts personalizados do assistente (Admin)
app.get('/api/admin/system-prompt', authenticateAdmin, async (req, res) => {
    try {
        const { restaurant_id } = req.query;
        
        if (!restaurant_id) {
            return res.status(400).json({
                error: 'restaurant_id é obrigatório',
                status: 'validation_error'
            });
        }
        
        console.log(`📖 [Admin] Carregando prompt personalizado para restaurante ${restaurant_id}...`);
        
        // Criar cliente Supabase para operações administrativas
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).json({ error: 'Configuração do Supabase incompleta' });
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        const { data: prompt, error } = await supabaseClient
            .from('ai_system_prompts')
            .select('*')
            .eq('restaurant_id', restaurant_id)
            .eq('is_active', true)
            .single();
        
        if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
            console.error('❌ [Admin] Erro ao carregar prompt:', error);
            return res.status(500).json({ 
                error: 'Erro ao carregar prompt personalizado',
                hasCustomPrompt: false 
            });
        }
        
        if (!prompt) {
            console.log('📖 [Admin] Nenhum prompt personalizado encontrado, usando padrão');
            return res.json({ 
                hasCustomPrompt: false,
                prompt: null,
                status: 'using_default'
            });
        }
        
        console.log(`✅ [Admin] Prompt personalizado carregado para restaurante ${restaurant_id}`);
        res.json({
            hasCustomPrompt: true,
            prompt: prompt.content,
            promptId: prompt.id,
            createdBy: prompt.created_by,
            updatedAt: prompt.updated_at,
            status: 'loaded'
        });
        
    } catch (error) {
        console.error('❌ [Admin] Erro ao carregar prompt personalizado:', error);
        res.status(500).json({ 
            error: 'Erro interno ao carregar prompt',
            status: 'server_error'
        });
    }
});

app.post('/api/admin/system-prompt', 
    authenticateAdmin, 
    // Usar middleware CSRF administrativo
    (req, res, next) => {
        // Validar CSRF token para admin
        const csrfToken = req.headers['x-csrf-token'];
        if (!csrfToken || !csrfToken.startsWith('csrf_admin_')) {
            return res.status(403).json({
                error: "Token CSRF administrativo inválido",
                details: "Use o endpoint /api/admin/csrf-token para obter um token válido"
            });
        }
        next();
    },
    async (req, res) => {
    try {
        const { prompt, restaurant_id } = req.body;
        
        if (!restaurant_id) {
            return res.status(400).json({
                error: 'restaurant_id é obrigatório',
                status: 'validation_error'
            });
        }
        
        if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
            return res.status(400).json({
                error: 'Prompt é obrigatório e deve ser uma string não vazia',
                status: 'validation_error'
            });
        }
        
        if (prompt.length > 16384) { // Limite de ~4096 tokens (16k caracteres)
            return res.status(400).json({
                error: 'Prompt muito longo (máximo 4096 tokens / 16.384 caracteres)',
                status: 'validation_error'
            });
        }
        
        console.log(`💾 [Admin] Salvando prompt personalizado para restaurante ${restaurant_id}...`);
        
        // Criar cliente Supabase para operações administrativas
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).json({ error: 'Configuração do Supabase incompleta' });
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        // Desativar prompt anterior (se existir)
        await supabaseClient
            .from('ai_system_prompts')
            .update({ is_active: false })
            .eq('restaurant_id', restaurant_id);
        
        // Inserir novo prompt
        const { data, error } = await supabaseClient
            .from('ai_system_prompts')
            .insert({
                restaurant_id: restaurant_id,
                content: prompt.trim(),
                created_by: req.user.email || 'admin',
                is_active: true
            })
            .select()
            .single();
        
        if (error) {
            console.error('❌ [Admin] Erro ao salvar prompt:', error);
            return res.status(500).json({ 
                error: 'Erro ao salvar prompt personalizado',
                details: error.message 
            });
        }
        
        console.log(`✅ [Admin] Prompt personalizado salvo com sucesso! ID: ${data.id}`);
        res.json({
            success: true,
            message: 'Prompt personalizado salvo com sucesso!',
            promptId: data.id,
            updatedAt: data.updated_at,
            status: 'saved'
        });
        
    } catch (error) {
        console.error('❌ [Admin] Erro ao salvar prompt personalizado:', error);
        res.status(500).json({ 
            error: 'Erro interno ao salvar prompt',
            status: 'server_error'
        });
    }
});

// ===== ENDPOINTS PARA GERENCIAR PROMPTS POR TIPO DE NEGÓCIO =====

// Endpoint para obter prompt por tipo de negócio
app.get('/api/admin/business-type-prompt', authenticateAdmin, async (req, res) => {
    try {
        const { tipo_negocio } = req.query;
        
        if (!tipo_negocio) {
            return res.status(400).json({
                error: 'tipo_negocio é obrigatório',
                status: 'validation_error'
            });
        }
        
        console.log(`📖 [Admin] Carregando prompt para tipo de negócio: ${tipo_negocio}...`);
        
        // Criar cliente Supabase para operações administrativas
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).json({ error: 'Configuração do Supabase incompleta' });
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        const { data: prompt, error } = await supabaseClient
            .from('prompit')
            .select('*')
            .eq('tipo_negocio', tipo_negocio)
            .single();
        
        if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
            console.error('❌ [Admin] Erro ao carregar prompt por tipo de negócio:', error);
            return res.status(500).json({ 
                error: 'Erro ao carregar prompt por tipo de negócio',
                hasPrompt: false 
            });
        }
        
        if (!prompt) {
            console.log(`📖 [Admin] Nenhum prompt encontrado para tipo de negócio: ${tipo_negocio}`);
            return res.json({ 
                hasPrompt: false,
                prompt: null,
                status: 'not_found'
            });
        }
        
        console.log(`✅ [Admin] Prompt carregado para tipo de negócio: ${tipo_negocio}`);
        res.json({
            hasPrompt: true,
            prompt: prompt.prompt,
            promptId: prompt.id,
            tipoNegocio: prompt.tipo_negocio,
            updatedAt: prompt.updated_at,
            status: 'loaded'
        });
        
    } catch (error) {
        console.error('❌ [Admin] Erro ao carregar prompt por tipo de negócio:', error);
        res.status(500).json({ 
            error: 'Erro interno ao carregar prompt',
            status: 'server_error'
        });
    }
});

// Endpoint para salvar prompt por tipo de negócio
app.post('/api/admin/business-type-prompt', 
    authenticateAdmin, 
    // Usar middleware CSRF administrativo
    (req, res, next) => {
        const csrfToken = req.headers['x-csrf-token'];
        if (!csrfToken || !csrfToken.startsWith('csrf_admin_')) {
            return res.status(403).json({
                error: "Token CSRF administrativo inválido",
                details: "Use o endpoint /api/admin/csrf-token para obter um token válido"
            });
        }
        next();
    },
    async (req, res) => {
    try {
        const { tipo_negocio, prompt } = req.body;
        
        if (!tipo_negocio) {
            return res.status(400).json({
                error: 'tipo_negocio é obrigatório',
                status: 'validation_error'
            });
        }
        
        if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
            return res.status(400).json({
                error: 'Prompt é obrigatório e deve ser uma string não vazia',
                status: 'validation_error'
            });
        }
        
        if (prompt.length > 16384) { // Limite de ~4096 tokens (16k caracteres)
            return res.status(400).json({
                error: 'Prompt muito longo (máximo 4096 tokens / 16.384 caracteres)',
                status: 'validation_error'
            });
        }
        
        console.log(`💾 [Admin] Salvando prompt para tipo de negócio: ${tipo_negocio}...`);
        
        // Criar cliente Supabase para operações administrativas
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).json({ error: 'Configuração do Supabase incompleta' });
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        // Verificar se já existe um prompt para este tipo de negócio
        const { data: existingPrompt } = await supabaseClient
            .from('prompit')
            .select('id')
            .eq('tipo_negocio', tipo_negocio)
            .single();
        
        let data, error;
        
        if (existingPrompt) {
            // Atualizar prompt existente
            ({ data, error } = await supabaseClient
                .from('prompit')
                .update({ 
                    prompt: prompt.trim(),
                    updated_at: new Date().toISOString()
                })
                .eq('tipo_negocio', tipo_negocio)
                .select()
                .single());
        } else {
            // Inserir novo prompt
            ({ data, error } = await supabaseClient
                .from('prompit')
                .insert({
                    tipo_negocio: tipo_negocio,
                    prompt: prompt.trim()
                })
                .select()
                .single());
        }
        
        if (error) {
            console.error('❌ [Admin] Erro ao salvar prompt por tipo de negócio:', error);
            return res.status(500).json({ 
                error: 'Erro ao salvar prompt por tipo de negócio',
                details: error.message 
            });
        }
        
        console.log(`✅ [Admin] Prompt salvo para tipo de negócio: ${tipo_negocio}! ID: ${data.id}`);
        res.json({
            success: true,
            message: `Prompt para ${tipo_negocio} salvo com sucesso!`,
            promptId: data.id,
            tipoNegocio: data.tipo_negocio,
            updatedAt: data.updated_at,
            status: 'saved'
        });
        
    } catch (error) {
        console.error('❌ [Admin] Erro ao salvar prompt por tipo de negócio:', error);
        res.status(500).json({ 
            error: 'Erro interno ao salvar prompt',
            status: 'server_error'
        });
    }
});

// Endpoint para listar todos os prompts por tipo de negócio
app.get('/api/admin/business-types-prompts', authenticateAdmin, async (req, res) => {
    try {
        console.log(`📖 [Admin] Carregando lista de prompts por tipo de negócio...`);
        
        // Criar cliente Supabase para operações administrativas
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).json({ error: 'Configuração do Supabase incompleta' });
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        const { data: prompts, error } = await supabaseClient
            .from('prompit')
            .select('*')
            .order('tipo_negocio', { ascending: true });
        
        if (error) {
            console.error('❌ [Admin] Erro ao carregar lista de prompts:', error);
            return res.status(500).json({ 
                error: 'Erro ao carregar lista de prompts',
                prompts: []
            });
        }
        
        console.log(`✅ [Admin] Lista de prompts carregada: ${prompts?.length || 0} tipos configurados`);
        res.json({
            success: true,
            prompts: prompts || [],
            count: prompts?.length || 0,
            status: 'loaded'
        });
        
    } catch (error) {
        console.error('❌ [Admin] Erro ao carregar lista de prompts:', error);
        res.status(500).json({ 
            error: 'Erro interno ao carregar lista',
            status: 'server_error'
        });
    }
});

// Endpoint para obter prompt baseado no tipo de negócio do restaurante (para o assistente)
app.get('/api/assistant/business-type-prompt', async (req, res) => {
    try {
        const { restaurant_id } = req.query;
        
        if (!restaurant_id) {
            return res.status(400).json({
                error: 'restaurant_id é obrigatório',
                status: 'validation_error'
            });
        }
        
        console.log(`📖 [Assistant] Carregando prompt baseado no tipo de negócio para restaurante: ${restaurant_id}...`);
        
        // Criar cliente Supabase 
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).json({ error: 'Configuração do Supabase incompleta' });
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        // Primeiro, buscar o tipo de negócio do restaurante
        const { data: restaurant, error: restaurantError } = await supabaseClient
            .from('restaurants')
            .select('business_type')
            .eq('id', restaurant_id)
            .single();
        
        if (restaurantError || !restaurant) {
            console.warn(`⚠️ [Assistant] Restaurante não encontrado: ${restaurant_id}`);
            return res.json({ 
                hasPrompt: false,
                prompt: null,
                businessType: null,
                status: 'restaurant_not_found'
            });
        }
        
        const businessType = restaurant.business_type;
        
        if (!businessType) {
            console.log(`📖 [Assistant] Restaurante ${restaurant_id} não tem tipo de negócio definido`);
            return res.json({ 
                hasPrompt: false,
                prompt: null,
                businessType: null,
                status: 'no_business_type'
            });
        }
        
        // Buscar prompt para este tipo de negócio
        const { data: prompt, error: promptError } = await supabaseClient
            .from('prompit')
            .select('*')
            .eq('tipo_negocio', businessType)
            .single();
        
        if (promptError && promptError.code !== 'PGRST116') {
            console.error('❌ [Assistant] Erro ao carregar prompt por tipo de negócio:', promptError);
            return res.status(500).json({ 
                error: 'Erro ao carregar prompt por tipo de negócio',
                hasPrompt: false 
            });
        }
        
        if (!prompt) {
            console.log(`📖 [Assistant] Nenhum prompt encontrado para tipo de negócio: ${businessType}`);
            return res.json({ 
                hasPrompt: false,
                prompt: null,
                businessType: businessType,
                status: 'no_prompt_for_business_type'
            });
        }
        
        console.log(`✅ [Assistant] Prompt carregado para tipo de negócio: ${businessType}`);
        res.json({
            hasPrompt: true,
            prompt: prompt.prompt,
            promptId: prompt.id,
            businessType: businessType,
            updatedAt: prompt.updated_at,
            status: 'loaded'
        });
        
    } catch (error) {
        console.error('❌ [Assistant] Erro ao carregar prompt por tipo de negócio:', error);
        res.status(500).json({ 
            error: 'Erro interno ao carregar prompt',
            status: 'server_error'
        });
    }
});

// Estender período de teste
app.post('/api/admin/extend-trial', authenticateAdmin, async (req, res) => {
    try {
        const { restaurant_id, days, reason } = req.body;
        
        if (!restaurant_id || !days || days < 1) {
            return res.status(400).json({ error: 'ID do restaurante e número de dias são obrigatórios' });
        }
        
        // Criar cliente Supabase para operações administrativas
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        // Auto-detect and fix swapped environment variables
        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            console.log('🔄 Admin operation auto-detecting swapped SUPABASE_URL and SUPABASE_ANON_KEY - fixing automatically');
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).json({ error: 'Configuração do Supabase incompleta' });
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        // Buscar restaurante atual
        const { data: restaurant, error: fetchError } = await supabaseClient
            .from('restaurants')
            .select('id, name, trial_end_date')
            .eq('id', restaurant_id)
            .single();
        
        if (fetchError || !restaurant) {
            return res.status(404).json({ error: 'Restaurante não encontrado' });
        }
        
        // Calcular nova data de fim do teste
        const currentTrialEnd = new Date(restaurant.trial_end_date);
        const newTrialEnd = new Date(currentTrialEnd.getTime() + (days * 24 * 60 * 60 * 1000));
        
        // Atualizar período de teste
        const updateData = { 
            trial_end_date: newTrialEnd.toISOString(),
            updated_at: new Date().toISOString()
        };
        
        // Adicionar motivo da extensão se fornecido
        if (reason && reason.trim()) {
            updateData.trial_extension_reason = reason.trim();
        }
        
        const { data: updatedRestaurant, error: updateError } = await supabaseClient
            .from('restaurants')
            .update(updateData)
            .eq('id', restaurant_id)
            .select('id, name, trial_end_date, trial_extension_reason')
            .single();
        
        if (updateError) {
            return res.status(500).json({ error: 'Erro ao atualizar período de teste' });
        }
        
        // Log da ação administrativa
        await supabaseClient
            .from('admin_action_logs')
            .insert({
                admin_id: req.user.admin_id || 0,
                action_type: 'extend_trial',
                target_id: restaurant_id,
                target_type: 'restaurant',
                description: `Estendido teste por ${days} dias. Motivo: ${reason || 'N/A'}`
            });
        
        console.log(`✅ Admin ${req.user.email} estendeu teste em ${days} dias para restaurante ${restaurant_id}`);
        
        res.json({
            success: true,
            restaurant: updatedRestaurant,
            message: `Período de teste estendido por ${days} dias`
        });
        
    } catch (error) {
        console.error('❌ Erro ao estender teste:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Alterar status do restaurante
app.post('/api/admin/change-status', authenticateAdmin, async (req, res) => {
    try {
        const { restaurant_id, status, reason } = req.body;
        
        if (!restaurant_id || !status) {
            return res.status(400).json({ error: 'ID do restaurante e status são obrigatórios' });
        }
        
        if (!['active', 'inactive', 'suspended'].includes(status)) {
            return res.status(400).json({ error: 'Status inválido' });
        }
        
        // Criar cliente Supabase para operações administrativas
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        // Auto-detect and fix swapped environment variables
        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            console.log('🔄 Admin operation auto-detecting swapped SUPABASE_URL and SUPABASE_ANON_KEY - fixing automatically');
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).json({ error: 'Configuração do Supabase incompleta' });
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        // Atualizar status do restaurante
        const { data: updatedRestaurant, error: updateError } = await supabaseClient
            .from('restaurants')
            .update({ 
                status: status,
                updated_at: new Date().toISOString()
            })
            .eq('id', restaurant_id)
            .select('id, name, status')
            .single();
        
        if (updateError || !updatedRestaurant) {
            return res.status(404).json({ error: 'Restaurante não encontrado' });
        }
        
        // Log da ação administrativa
        await supabaseClient
            .from('admin_action_logs')
            .insert({
                admin_id: req.user.admin_id || 0,
                action_type: 'change_status',
                target_id: restaurant_id,
                target_type: 'restaurant',
                description: `Status alterado para ${status}. Motivo: ${reason || 'N/A'}`
            });
        
        console.log(`✅ Admin ${req.user.email} alterou status para ${status} do restaurante ${restaurant_id}`);
        
        res.json({
            success: true,
            restaurant: updatedRestaurant,
            message: `Status alterado para ${status}`
        });
        
    } catch (error) {
        console.error('❌ Erro ao alterar status:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Ativação manual de assinatura
app.post('/api/admin/activate-subscription', authenticateAdmin, async (req, res) => {
    try {
        const { restaurant_id, end_date, reason } = req.body;
        
        if (!restaurant_id || !end_date || !reason) {
            return res.status(400).json({ 
                error: 'ID do restaurante, data de fim da assinatura e motivo são obrigatórios' 
            });
        }
        
        // Validar formato UUID do restaurant_id
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(restaurant_id)) {
            return res.status(400).json({ error: 'ID do restaurante deve ser um UUID válido' });
        }
        
        // Validar formato da data
        const subscriptionEndDate = new Date(end_date);
        if (isNaN(subscriptionEndDate.getTime())) {
            return res.status(400).json({ error: 'Data de fim da assinatura inválida' });
        }
        
        // Verificar se a data é futura
        if (subscriptionEndDate <= new Date()) {
            return res.status(400).json({ error: 'Data de fim da assinatura deve ser futura' });
        }
        
        // Criar cliente Supabase para operações administrativas
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        // Auto-detect and fix swapped environment variables
        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            console.log('🔄 Admin operation auto-detecting swapped SUPABASE_URL and SUPABASE_ANON_KEY - fixing automatically');
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).json({ error: 'Configuração do Supabase incompleta' });
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        // Buscar restaurante para verificar se existe
        const { data: restaurant, error: fetchError } = await supabaseClient
            .from('restaurants')
            .select('id, name, subscription_status')
            .eq('id', restaurant_id)
            .single();
        
        if (fetchError || !restaurant) {
            return res.status(404).json({ error: 'Restaurante não encontrado' });
        }
        
        // Atualizar assinatura do restaurante
        const updateData = {
            subscription_status: 'active',
            subscription_start_date: new Date().toISOString(),
            subscription_end_date: subscriptionEndDate.toISOString(),
            manual_activation_reason: reason.trim(),
            updated_at: new Date().toISOString()
        };
        
        const { data: updatedRestaurant, error: updateError } = await supabaseClient
            .from('restaurants')
            .update(updateData)
            .eq('id', restaurant_id)
            .select('id, name, subscription_status, subscription_end_date')
            .single();
        
        if (updateError || !updatedRestaurant) {
            console.error('❌ Erro ao ativar assinatura:', updateError);
            return res.status(500).json({ error: 'Erro ao ativar assinatura' });
        }
        
        // Log da ação administrativa
        await supabaseClient
            .from('admin_action_logs')
            .insert({
                admin_id: req.user.admin_id || 0,
                action_type: 'activate_subscription',
                target_id: restaurant_id,
                target_type: 'restaurant',
                description: `Assinatura ativada manualmente até ${end_date}. Motivo: ${reason}`
            });
        
        console.log(`✅ Admin ${req.user.email} ativou assinatura manual para restaurante ${restaurant_id} até ${end_date}`);
        
        res.json({
            success: true,
            restaurant: updatedRestaurant,
            message: `Assinatura ativada com sucesso até ${subscriptionEndDate.toLocaleDateString('pt-BR')}`
        });
        
    } catch (error) {
        console.error('❌ Erro ao ativar assinatura manual:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Logs de ações administrativas
app.get('/api/admin/logs', authenticateAdmin, async (req, res) => {
    try {
        const { limit = 100, offset = 0 } = req.query;
        
        // Criar cliente Supabase para operações administrativas
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        // Auto-detect and fix swapped environment variables
        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            console.log('🔄 Admin operation auto-detecting swapped SUPABASE_URL and SUPABASE_ANON_KEY - fixing automatically');
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).json({ error: 'Configuração do Supabase incompleta' });
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        const { data: logs, error } = await supabaseClient
            .from('admin_action_logs')
            .select(`
                *,
                system_administrators(name, email)
            `)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);
        
        if (error) {
            console.error('❌ Erro ao buscar logs:', error);
            return res.status(500).json({ error: 'Erro ao buscar logs' });
        }
        
        res.json(logs || []);
        
    } catch (error) {
        console.error('❌ Erro ao buscar logs:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

console.log('🛡️ Endpoints administrativos adicionais configurados');

// =================================================================
// ENDPOINTS CONFIGURAÇÃO DE ASSINATURA
// =================================================================

// Buscar todos os planos de assinatura
app.get('/api/admin/subscription-plans', authenticateAdmin, async (req, res) => {
    try {
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        const { data: plans, error } = await supabaseClient
            .from('subscription_plans')
            .select('*')
            .eq('active', true)
            .order('price', { ascending: true });
        
        if (error) {
            console.error('❌ Erro ao buscar planos:', error);
            return res.status(500).json({ error: 'Erro ao buscar planos' });
        }
        
        res.json(plans || []);
    } catch (error) {
        console.error('❌ Erro ao buscar planos:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Atualizar preços dos planos
app.post('/api/admin/subscription-plans/prices', authenticateAdmin, async (req, res) => {
    try {
        const { prices } = req.body;
        
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        // Atualizar cada plano
        for (const [planName, price] of Object.entries(prices)) {
            if (planName !== 'trial') { // Trial sempre é gratuito
                await supabaseClient
                    .from('subscription_plans')
                    .update({ 
                        price: parseFloat(price),
                        updated_at: new Date().toISOString()
                    })
                    .eq('name', planName);
            }
        }
        
        // Registrar auditoria
        await supabaseClient
            .from('subscription_config_audit')
            .insert({
                action_type: 'update_prices',
                new_value: prices,
                changed_by: req.user.admin_id || null,
                ip_address: req.ip
            });
        
        console.log(`✅ Preços dos planos atualizados por ${req.user.email}`);
        res.json({ success: true, message: 'Preços atualizados com sucesso' });
        
    } catch (error) {
        console.error('❌ Erro ao atualizar preços:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Buscar configuração de bloqueio de um plano
app.get('/api/admin/subscription-config/:planName', authenticateAdmin, async (req, res) => {
    try {
        const { planName } = req.params;
        
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        const { data: config, error } = await supabaseClient
            .from('vw_subscription_blocking_details')
            .select('*')
            .eq('plan_name', planName);
        
        if (error) {
            console.error('❌ Erro ao buscar configuração:', error);
            return res.status(500).json({ error: 'Erro ao buscar configuração' });
        }
        
        res.json(config || []);
    } catch (error) {
        console.error('❌ Erro ao buscar configuração:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Salvar configuração de bloqueio de um plano
app.post('/api/admin/subscription-config/:planName', authenticateAdmin, async (req, res) => {
    try {
        const { planName } = req.params;
        const { config } = req.body;
        
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        // Buscar plan_id
        const { data: plan } = await supabaseClient
            .from('subscription_plans')
            .select('id')
            .eq('name', planName)
            .single();
        
        if (!plan) {
            return res.status(404).json({ error: 'Plano não encontrado' });
        }
        
        // Processar cada elemento da configuração
        for (const [elementHtmlId, elementConfig] of Object.entries(config)) {
            // Buscar element_id
            const { data: element } = await supabaseClient
                .from('blockable_elements')
                .select('id')
                .eq('element_id', elementHtmlId)
                .single();
            
            if (element) {
                // Upsert (insert or update) na tabela de configuração
                await supabaseClient
                    .from('subscription_blocking_config')
                    .upsert({
                        plan_id: plan.id,
                        element_id: element.id,
                        block_after_days: parseInt(elementConfig.blockAfterDays),
                        is_blocked: elementConfig.blocked,
                        updated_at: new Date().toISOString()
                    }, {
                        onConflict: 'plan_id,element_id'
                    });
            }
        }
        
        // Registrar auditoria
        await supabaseClient
            .from('subscription_config_audit')
            .insert({
                action_type: 'update_blocking_config',
                plan_id: plan.id,
                new_value: config,
                changed_by: req.user.admin_id || null,
                ip_address: req.ip
            });
        
        console.log(`✅ Configuração do plano ${planName} salva por ${req.user.email}`);
        res.json({ success: true, message: 'Configuração salva com sucesso' });
        
    } catch (error) {
        console.error('❌ Erro ao salvar configuração:', error);
        res.status(500).json({ error: 'Erro interno do servidor', details: error.message });
    }
});

// Buscar configuração Asaas
app.get('/api/admin/asaas-config', authenticateAdmin, async (req, res) => {
    try {
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        const { data: config, error } = await supabaseClient
            .from('asaas_config')
            .select('environment, webhook_url, active, config_data')
            .eq('active', true)
            .single();
        
        if (error && error.code !== 'PGRST116') {
            console.error('❌ Erro ao buscar config Asaas:', error);
            return res.status(500).json({ error: 'Erro ao buscar configuração Asaas' });
        }
        
        res.json(config || { environment: 'sandbox', active: false });
    } catch (error) {
        console.error('❌ Erro ao buscar config Asaas:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Salvar configuração Asaas
app.post('/api/admin/asaas-config', authenticateAdmin, async (req, res) => {
    try {
        const { environment, api_key, webhook_url, active } = req.body;
        
        // Usar variável de ambiente se API key não for fornecida
        const finalApiKey = api_key || process.env.ASAAS_API_KEY;
        
        if (!finalApiKey) {
            return res.status(400).json({ 
                error: 'API Key não fornecida. Configure ASAAS_API_KEY nas variáveis de ambiente.' 
            });
        }
        
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        // Validar admin_id se existir (deve ser UUID válido)
        let createdBy = null;
        if (req.user.admin_id) {
            // Regex para validar UUID
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (uuidRegex.test(req.user.admin_id)) {
                createdBy = req.user.admin_id;
            }
        }
        
        // Upsert na tabela asaas_config
        const { error } = await supabaseClient
            .from('asaas_config')
            .upsert({
                environment: environment || 'sandbox',
                api_key_encrypted: finalApiKey,
                webhook_url: webhook_url,
                active: active !== undefined ? active : true,
                config_data: {
                    api_url: (environment || 'sandbox') === 'sandbox' 
                        ? 'https://sandbox.asaas.com/api/v3' 
                        : 'https://api.asaas.com/v3',
                    description: (environment || 'sandbox') === 'sandbox' 
                        ? 'Ambiente de testes com dados fictícios' 
                        : 'Ambiente de produção com dados reais'
                },
                updated_at: new Date().toISOString(),
                created_by: createdBy
            }, {
                onConflict: 'environment'
            });
        
        if (error) {
            console.error('❌ Erro ao salvar config Asaas:', error);
            return res.status(500).json({ error: 'Erro ao salvar configuração Asaas' });
        }
        
        console.log(`✅ Configuração Asaas (${environment || 'sandbox'}) salva por ${req.user.email}`);
        res.json({ success: true, message: 'Configuração Asaas salva com sucesso' });
        
    } catch (error) {
        console.error('❌ Erro ao salvar config Asaas:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Testar conexão Asaas
app.post('/api/admin/asaas-test', authenticateAdmin, async (req, res) => {
    try {
        const { environment, api_key } = req.body;
        
        const apiUrl = environment === 'sandbox' 
            ? 'https://sandbox.asaas.com/api/v3' 
            : 'https://api.asaas.com/v3';
        
        const response = await fetch(`${apiUrl}/customers?limit=1`, {
            headers: {
                'access_token': api_key,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            res.json({ 
                success: true, 
                message: 'Conexão com Asaas estabelecida com sucesso!',
                environment: environment 
            });
        } else {
            const error = await response.text();
            res.status(400).json({ 
                success: false, 
                message: 'Falha na conexão com Asaas',
                error: error 
            });
        }
        
    } catch (error) {
        console.error('❌ Erro ao testar Asaas:', error);
        res.status(500).json({ 
            success: false,
            message: 'Erro ao testar conexão',
            error: error.message 
        });
    }
});

// ========== ENDPOINTS ASAAS CHECKOUT E ASSINATURAS ==========

// Obter configuração Asaas ativa
app.get('/api/asaas/active-config', async (req, res) => {
    try {
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        const { data: config, error } = await supabaseClient
            .from('asaas_config')
            .select('*')
            .eq('active', true)
            .single();
        
        if (error && error.code !== 'PGRST116') {
            console.error('❌ Erro ao buscar config Asaas ativa:', error);
            return res.status(500).json({ error: 'Erro ao buscar configuração ativa' });
        }
        
        if (!config) {
            return res.status(404).json({ error: 'Nenhuma configuração Asaas ativa encontrada' });
        }
        
        // Não retornar a API key para o frontend
        const { api_key_encrypted, ...safeConfig } = config;
        res.json(safeConfig);
        
    } catch (error) {
        console.error('❌ Erro ao buscar config Asaas ativa:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Criar cliente no Asaas
app.post('/api/asaas/create-customer', async (req, res) => {
    try {
        const { restaurantId } = req.body;
        
        if (!restaurantId) {
            return res.status(400).json({ error: 'restaurantId é obrigatório' });
        }
        
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        // Buscar dados do restaurante do Supabase
        const { data: restaurant, error: restaurantError } = await supabaseClient
            .from('restaurants')
            .select('*')
            .eq('id', restaurantId)
            .single();
        
        if (restaurantError || !restaurant) {
            console.error('❌ Erro ao buscar restaurante:', restaurantError);
            return res.status(404).json({ error: 'Restaurante não encontrado' });
        }
        
        console.log('📊 Dados do restaurante encontrados:', {
            id: restaurant.id,
            name: restaurant.name,
            owner_name: restaurant.owner_name,
            owner_email: restaurant.owner_email,
            owner_cpf: restaurant.owner_cpf,
            owner_phone: restaurant.owner_phone
        });
        
        // Buscar configuração Asaas ativa
        const { data: config, error: configError } = await supabaseClient
            .from('asaas_config')
            .select('*')
            .eq('active', true)
            .single();
        
        if (configError || !config || !config.api_key_encrypted) {
            console.error('❌ Erro ao buscar config Asaas:', configError);
            return res.status(400).json({ error: 'Configuração Asaas não encontrada ou API key ausente' });
        }
        
        console.log('🔧 Configuração Asaas encontrada:', {
            environment: config.environment,
            api_url: config.config_data?.api_url,
            hasApiKey: !!config.api_key_encrypted
        });
        
        // Preparar dados do cliente para Asaas
        const cleanCpf = restaurant.owner_cpf?.replace(/\D/g, '');
        const cleanPhone = restaurant.owner_phone?.replace(/\D/g, '');
        
        const customerData = {
            name: restaurant.owner_name || restaurant.name,
            externalReference: `restaurant_${restaurantId}`
        };
        
        // Adicionar campos opcionais apenas se válidos
        if (restaurant.owner_email && restaurant.owner_email.includes('@')) {
            customerData.email = restaurant.owner_email;
        }
        
        // CPF/CNPJ deve ter 11 (CPF) ou 14 (CNPJ) dígitos
        if (cleanCpf && (cleanCpf.length === 11 || cleanCpf.length === 14)) {
            customerData.cpfCnpj = cleanCpf;
        }
        
        // Telefone brasileiro deve ter 10 ou 11 dígitos
        if (cleanPhone && (cleanPhone.length === 10 || cleanPhone.length === 11)) {
            customerData.phone = cleanPhone;
            customerData.mobilePhone = cleanPhone;
        }
        
        console.log('📋 Dados do cliente para Asaas:', {
            name: customerData.name,
            email: customerData.email || 'não informado',
            cpfCnpj: customerData.cpfCnpj ? `***${customerData.cpfCnpj.slice(-3)}` : 'não informado',
            phone: customerData.phone ? `***${customerData.phone.slice(-4)}` : 'não informado'
        });
        
        // Criar cliente no Asaas
        const apiUrl = config.config_data.api_url;
        const response = await fetch(`${apiUrl}/customers`, {
            method: 'POST',
            headers: {
                'access_token': config.api_key_encrypted,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(customerData)
        });
        
        const responseText = await response.text();
        let data;
        
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            console.error('❌ Erro ao fazer parse da resposta Asaas:', responseText);
            return res.status(500).json({ 
                error: 'Erro na resposta da API Asaas', 
                details: responseText.substring(0, 200) 
            });
        }
        
        if (!response.ok) {
            console.error('❌ Erro ao criar cliente no Asaas:', {
                status: response.status,
                statusText: response.statusText,
                data: data
            });
            return res.status(400).json({ 
                error: data.errors?.[0]?.description || data.message || 'Erro ao criar cliente no Asaas',
                details: data
            });
        }
        
        // Salvar customer_id no restaurante (se campo existir)
        const { error: updateError } = await supabaseClient
            .from('restaurants')
            .update({ 
                updated_at: new Date().toISOString()
            })
            .eq('id', restaurantId);
        
        if (updateError) {
            console.warn('⚠️ Aviso ao atualizar restaurante:', updateError);
        }
        
        console.log(`✅ Cliente criado no Asaas: ${data.id} para restaurante ${restaurantId}`);
        res.json({ success: true, customer: data });
        
    } catch (error) {
        console.error('❌ Erro ao criar cliente no Asaas:', error);
        res.status(500).json({ error: 'Erro interno do servidor', message: error.message });
    }
});

// Criar assinatura no Asaas
app.post('/api/asaas/create-subscription', async (req, res) => {
    try {
        const { customerId, planId, value, cycle } = req.body;
        
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        // Buscar configuração ativa
        const { data: config } = await supabaseClient
            .from('asaas_config')
            .select('*')
            .eq('active', true)
            .single();
        
        if (!config || !config.api_key_encrypted) {
            return res.status(400).json({ error: 'Configuração Asaas não encontrada' });
        }
        
        // Criar assinatura no Asaas
        const apiUrl = config.config_data.api_url;
        const response = await fetch(`${apiUrl}/subscriptions`, {
            method: 'POST',
            headers: {
                'access_token': config.api_key_encrypted,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                customer: customerId,
                billingType: 'UNDEFINED', // Cliente escolhe na hora do pagamento
                value: value,
                nextDueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 dias
                cycle: cycle || 'MONTHLY',
                description: `Assinatura ${planId}`
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            console.error('❌ Erro ao criar assinatura no Asaas:', data);
            return res.status(400).json({ error: data.errors || 'Erro ao criar assinatura' });
        }
        
        console.log(`✅ Assinatura criada no Asaas: ${data.id}`);
        res.json({ success: true, subscription: data });
        
    } catch (error) {
        console.error('❌ Erro ao criar assinatura:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Criar checkout transparente
app.post('/api/asaas/create-checkout', async (req, res) => {
    try {
        const { paymentId, planName, value } = req.body;
        
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        // Buscar configuração ativa e métodos de pagamento
        const { data: config } = await supabaseClient
            .from('asaas_config')
            .select('*')
            .eq('active', true)
            .single();
        
        if (!config || !config.api_key_encrypted) {
            return res.status(400).json({ error: 'Configuração Asaas não encontrada' });
        }
        
        // Determinar métodos de pagamento habilitados
        const checkoutMethods = config.config_data.checkout_methods || {
            credit_card: true,
            pix: true,
            boleto: true
        };
        
        const billingTypes = [];
        if (checkoutMethods.credit_card) billingTypes.push('CREDIT_CARD');
        if (checkoutMethods.pix) billingTypes.push('PIX');
        if (checkoutMethods.boleto) billingTypes.push('BOLETO');
        
        // Criar checkout no Asaas
        const apiUrl = config.config_data.api_url;
        const response = await fetch(`${apiUrl}/payments/${paymentId}/checkout`, {
            method: 'POST',
            headers: {
                'access_token': config.api_key_encrypted,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                billingTypes: billingTypes,
                successUrl: `${req.protocol}://${req.get('host')}/assinaturas.html?payment=success`,
                cancelUrl: `${req.protocol}://${req.get('host')}/assinaturas.html?payment=cancel`
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            console.error('❌ Erro ao criar checkout:', data);
            return res.status(400).json({ error: data.errors || 'Erro ao criar checkout' });
        }
        
        console.log(`✅ Checkout criado para pagamento: ${paymentId}`);
        res.json({ success: true, checkout: data });
        
    } catch (error) {
        console.error('❌ Erro ao criar checkout:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Listar histórico de cobranças
app.get('/api/asaas/billing-history/:restaurantId', async (req, res) => {
    try {
        const { restaurantId } = req.params;
        
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        // Buscar customer_id do restaurante
        const { data: restaurant } = await supabaseClient
            .from('restaurants')
            .select('asaas_customer_id')
            .eq('id', restaurantId)
            .single();
        
        if (!restaurant || !restaurant.asaas_customer_id) {
            return res.json({ payments: [] }); // Retorna vazio se não tiver customer
        }
        
        // Buscar configuração ativa
        const { data: config } = await supabaseClient
            .from('asaas_config')
            .select('*')
            .eq('active', true)
            .single();
        
        if (!config || !config.api_key_encrypted) {
            return res.status(400).json({ error: 'Configuração Asaas não encontrada' });
        }
        
        // Buscar pagamentos do cliente no Asaas
        const apiUrl = config.config_data.api_url;
        const response = await fetch(`${apiUrl}/payments?customer=${restaurant.asaas_customer_id}&limit=50`, {
            headers: {
                'access_token': config.api_key_encrypted,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            console.error('❌ Erro ao buscar pagamentos:', data);
            return res.status(400).json({ error: 'Erro ao buscar histórico' });
        }
        
        console.log(`✅ Histórico de ${data.data?.length || 0} pagamentos carregado para restaurante ${restaurantId}`);
        res.json({ payments: data.data || [] });
        
    } catch (error) {
        console.error('❌ Erro ao buscar histórico:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Salvar configuração de checkout transparente
app.post('/api/admin/checkout-config', authenticateAdmin, async (req, res) => {
    try {
        const { credit_card, pix, boleto } = req.body;
        
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        // Upsert na tabela asaas_config para incluir checkout config
        const { data: existingConfig, error: fetchError } = await supabaseClient
            .from('asaas_config')
            .select('*')
            .limit(1)
            .single();
        
        const checkoutConfig = {
            credit_card: credit_card !== false,
            pix: pix !== false,
            boleto: boleto !== false
        };
        
        const configData = existingConfig?.config_data || {};
        configData.checkout_methods = checkoutConfig;
        
        const { error } = await supabaseClient
            .from('asaas_config')
            .upsert({
                environment: existingConfig?.environment || 'sandbox',
                api_key_encrypted: existingConfig?.api_key_encrypted || null,
                webhook_url: existingConfig?.webhook_url || null,
                active: existingConfig?.active || false,
                config_data: configData,
                updated_at: new Date().toISOString(),
                created_by: req.user.admin_id || null
            }, {
                onConflict: 'environment'
            });
        
        if (error) {
            console.error('❌ Erro ao salvar checkout config:', error);
            return res.status(500).json({ error: 'Erro ao salvar configuração de checkout' });
        }
        
        console.log(`✅ Configuração de checkout salva por ${req.user.email}:`, checkoutConfig);
        res.json({ success: true, message: 'Configuração de checkout salva com sucesso', config: checkoutConfig });
        
    } catch (error) {
        console.error('❌ Erro ao salvar checkout config:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Buscar configuração de checkout transparente
app.get('/api/admin/checkout-config', authenticateAdmin, async (req, res) => {
    try {
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        const { data: config, error } = await supabaseClient
            .from('asaas_config')
            .select('config_data')
            .limit(1)
            .single();
        
        if (error && error.code !== 'PGRST116') {
            console.error('❌ Erro ao buscar checkout config:', error);
            return res.status(500).json({ error: 'Erro ao buscar configuração' });
        }
        
        const checkoutConfig = config?.config_data?.checkout_methods || {
            credit_card: true,
            pix: true,
            boleto: true
        };
        
        res.json(checkoutConfig);
    } catch (error) {
        console.error('❌ Erro ao buscar checkout config:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

console.log('⚙️ Endpoints de configuração de assinatura configurados');
console.log('🛒 Endpoints de checkout transparente configurados');

// =================================================================
// ENDPOINT PÚBLICO - BUSCAR PLANOS DE ASSINATURA ATIVOS
// =================================================================

// Endpoint público para restaurantes visualizarem os planos disponíveis
app.get('/api/subscription-plans', async (req, res) => {
    try {
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        // Buscar apenas planos ativos (active = true)
        const { data: plans, error } = await supabaseClient
            .from('subscription_plans')
            .select('*')
            .eq('active', true)
            .order('price', { ascending: true });
        
        if (error) {
            console.error('❌ Erro ao buscar planos:', error);
            return res.status(500).json({ error: 'Erro ao buscar planos' });
        }
        
        console.log(`✅ ${plans?.length || 0} planos ativos retornados`);
        res.json(plans || []);
    } catch (error) {
        console.error('❌ Erro ao buscar planos:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// =================================================================
// ENDPOINT PÚBLICO - BUSCAR CONFIGURAÇÕES DE BLOQUEIO POR RESTAURANTE
// =================================================================

// Buscar configurações de bloqueio para aplicar no dashboard
app.get('/api/blocking-config', async (req, res) => {
    try {
        const { restaurantId } = req.query;
        
        if (!restaurantId) {
            return res.status(400).json({ error: 'restaurantId é obrigatório' });
        }
        
        // Criar cliente Supabase
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).json({ error: 'Configuração do Supabase incompleta' });
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        // Buscar restaurante no Supabase (dados reais do usuário)
        const { data: restaurant, error: supabaseError } = await supabaseClient
            .from('restaurants')
            .select('id, plan, subscription_status, trial_start_date, trial_end_date')
            .eq('id', restaurantId)
            .single();
        
        if (supabaseError || !restaurant) {
            console.log('❌ Restaurante não encontrado no Supabase:', restaurantId);
            return res.status(404).json({ error: 'Restaurante não encontrado' });
        }
        
        console.log('✅ Restaurante encontrado:', restaurant.id, 'Status:', restaurant.subscription_status);
        
        // Usar subscription_status para definir qual plano de bloqueio aplicar
        // Se está em trial, usar configurações de trial, senão usar o plano atual
        const blockingPlan = restaurant.subscription_status === 'trial' ? 'trial' : (restaurant.plan || 'trial');
        
        console.log('🔒 Aplicando configurações de bloqueio do plano:', blockingPlan);
        
        // Buscar configurações de bloqueio do plano usando a view
        const configQuery = `
            SELECT element_id, element_name, page, is_blocked, block_after_days
            FROM public.vw_subscription_blocking_details
            WHERE plan_name = $1
            ORDER BY page, element_name
        `;
        
        const configResult = await devPool.query(configQuery, [blockingPlan]);
        
        // Formatar resposta para o frontend
        const response = {
            restaurant_id: restaurant.id,
            plan: restaurant.plan || 'trial',
            subscription_status: restaurant.subscription_status,
            trial_start_date: restaurant.trial_start_date,
            trial_end_date: restaurant.trial_end_date,
            blocking_config: configResult.rows
        };
        
        res.json(response);
        
    } catch (error) {
        console.error('❌ Erro ao buscar configuração de bloqueio:', error);
        res.status(500).json({ error: 'Erro interno do servidor', details: error.message });
    }
});

console.log('🔒 Endpoint de bloqueio dinâmico configurado');

// =================================================================
// ENDPOINTS INTEGRAÇÃO ASAAS
// =================================================================

// Criar nova assinatura no Asaas
app.post('/api/asaas/create-subscription', async (req, res) => {
    try {
        const { plan, restaurantId, customerEmail, restaurantName } = req.body;
        
        console.log(`💳 Criando assinatura ${plan} para restaurante ${restaurantId}`);

        // Validar dados de entrada
        if (!plan || !restaurantId || !customerEmail) {
            return res.status(400).json({ 
                success: false, 
                error: 'Dados obrigatórios: plan, restaurantId, customerEmail' 
            });
        }

        // Configurações dos planos
        const planConfigs = {
            premium: {
                value: 49.00,
                cycle: 'MONTHLY',
                description: 'Plano Premium TimePulse AI'
            },
            enterprise: {
                value: 99.00,
                cycle: 'MONTHLY', 
                description: 'Plano Empresarial TimePulse AI'
            }
        };

        const planConfig = planConfigs[plan];
        if (!planConfig) {
            return res.status(400).json({ 
                success: false, 
                error: 'Plano inválido' 
            });
        }

        // Simular resposta da API Asaas
        // TODO: Implementar integração real com Asaas API
        const mockAsaasResponse = {
            success: true,
            subscriptionId: 'sub_' + Date.now(),
            checkoutUrl: 'https://checkout.asaas.com/c/' + Date.now(),
            customer: {
                id: 'cus_' + Date.now(),
                email: customerEmail
            }
        };

        console.log('✅ Assinatura criada com sucesso (simulada)');
        res.json(mockAsaasResponse);

    } catch (error) {
        console.error('❌ Erro ao criar assinatura:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erro interno do servidor' 
        });
    }
});

// Buscar histórico de cobrança
app.get('/api/asaas/billing-history/:restaurantId', async (req, res) => {
    try {
        const { restaurantId } = req.params;
        
        console.log(`📄 Buscando histórico de cobrança para ${restaurantId}`);

        // Simular dados de histórico
        // TODO: Implementar consulta real na API Asaas
        const mockInvoices = [
            {
                date: '2025-09-01T00:00:00Z',
                description: 'Plano Premium - Setembro 2025',
                amount: 49.00,
                status: 'paid',
                invoiceUrl: 'https://asaas.com/invoice/123'
            }
        ];

        res.json({ 
            success: true, 
            invoices: mockInvoices 
        });

    } catch (error) {
        console.error('❌ Erro ao buscar histórico:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erro interno do servidor' 
        });
    }
});

// Cancelar assinatura
app.post('/api/asaas/cancel-subscription', async (req, res) => {
    try {
        const { restaurantId } = req.body;
        
        console.log(`❌ Cancelando assinatura para restaurante ${restaurantId}`);

        // TODO: Implementar cancelamento real na API Asaas
        // 1. Buscar subscription_id do restaurante no banco
        // 2. Fazer chamada para API Asaas para cancelar
        // 3. Atualizar status no banco de dados

        res.json({ 
            success: true, 
            message: 'Assinatura cancelada com sucesso' 
        });

    } catch (error) {
        console.error('❌ Erro ao cancelar assinatura:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erro interno do servidor' 
        });
    }
});

// Webhook para receber notificações do Asaas
// Real Subscription State Endpoint
app.get('/api/me/subscription-state', authenticateJWT, async (req, res) => {
    try {
        console.log('🔍 Checking subscription state for user:', req.session.userEmail);
        
        const userId = req.session?.restaurantId || req.session?.userEmail;
        if (!userId) {
            return res.status(401).json({ 
                error: 'Usuário não identificado',
                authenticated: false
            });
        }
        
        // Get real subscription status
        const subscriptionData = await checkUserSubscription(userId);
        
        // Calculate trial days remaining
        let trialDaysRemaining = 0;
        if (subscriptionData.status === 'trial' && subscriptionData.subscription_end_date) {
            const now = new Date();
            const endDate = new Date(subscriptionData.subscription_end_date);
            const diffTime = endDate - now;
            trialDaysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
        }
        
        const response = {
            authenticated: true,
            subscription_status: subscriptionData.status,
            is_active: subscriptionData.active,
            is_trial: subscriptionData.status === 'trial',
            trial_expired: subscriptionData.trial_expired,
            trial_days_remaining: trialDaysRemaining,
            subscription_end_date: subscriptionData.subscription_end_date,
            plan: subscriptionData.plan || 'basic',
            features_enabled: {
                whatsapp_integration: subscriptionData.active,
                evolution_api: subscriptionData.active,
                premium_support: subscriptionData.active && subscriptionData.plan !== 'basic',
                advanced_analytics: subscriptionData.active && subscriptionData.plan === 'premium'
            },
            timestamp: new Date().toISOString()
        };
        
        console.log(`✅ Subscription state for ${userId}:`, {
            status: response.subscription_status,
            active: response.is_active,
            trial_days: response.trial_days_remaining
        });
        
        res.json(response);
        
    } catch (error) {
        console.error('❌ Error checking subscription state:', error);
        res.status(500).json({ 
            error: 'Erro ao verificar status da assinatura',
            details: error.message,
            authenticated: true
        });
    }
});

// Create or update subscription session
app.post('/api/subscription-session', async (req, res) => {
    try {
        const { instance_id, restaurant_id, plan_name, plan_display_name, plan_price, pix_payload, invoice_number, session_data } = req.body;
        
        console.log('💾 Salvando sessão de assinatura:', { instance_id, plan_name });
        
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        // Upsert (insert ou update) a sessão
        const { data, error } = await supabaseClient
            .from('subscription_sessions')
            .upsert({
                instance_id,
                restaurant_id,
                plan_name,
                plan_display_name,
                plan_price,
                pix_payload,
                invoice_number,
                session_data,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'instance_id'
            })
            .select()
            .single();
        
        if (error) {
            console.error('❌ Erro ao salvar sessão:', error);
            return res.status(500).json({ 
                error: 'Erro ao salvar sessão',
                details: error.message
            });
        }
        
        console.log('✅ Sessão salva com sucesso:', data.id);
        res.json({ success: true, session: data });
        
    } catch (error) {
        console.error('❌ Erro ao salvar sessão de assinatura:', error);
        res.status(500).json({ 
            error: 'Erro interno do servidor',
            details: error.message
        });
    }
});

// Get subscription session data by instance ID
app.get('/api/subscription-session/:instanceId', async (req, res) => {
    try {
        const { instanceId } = req.params;
        
        console.log('🔍 Buscando sessão de assinatura para instância:', instanceId);
        
        // Buscar sessão no banco de dados
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = process.env.SUPABASE_ANON_KEY;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        const { data: session, error } = await supabaseClient
            .from('subscription_sessions')
            .select('*')
            .eq('instance_id', instanceId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
        
        if (error || !session) {
            console.log('❌ Sessão não encontrada:', error?.message || 'Sem dados');
            return res.status(404).json({ 
                error: 'Sessão de assinatura não encontrada',
                instanceId: instanceId
            });
        }
        
        // Buscar dados do restaurante se disponível
        let restaurantData = null;
        if (session.restaurant_id) {
            const { data: restaurant } = await supabaseClient
                .from('restaurants')
                .select('*')
                .eq('id', session.restaurant_id)
                .single();
            
            restaurantData = restaurant;
        }
        
        console.log('✅ Sessão encontrada:', {
            instance_id: session.instance_id,
            plan: session.plan_name,
            restaurant: restaurantData?.name || 'N/A'
        });
        
        res.json({
            session: session,
            restaurant: restaurantData
        });
        
    } catch (error) {
        console.error('❌ Erro ao buscar sessão de assinatura:', error);
        res.status(500).json({ 
            error: 'Erro interno do servidor',
            details: error.message
        });
    }
});

app.post('/api/asaas/webhook', express.raw({ type: 'application/json' }), validateAsaasWebhook, async (req, res) => {
    try {
        console.log('📢 Webhook Asaas recebido e validado com sucesso');
        
        const event = JSON.parse(req.body.toString());
        const eventType = event.event;
        const payment = event.payment;
        
        console.log(`🎯 Processando evento: ${eventType}`, {
            payment_id: payment?.id,
            customer_id: payment?.customer,
            status: payment?.status,
            value: payment?.value
        });
        
        // Process different webhook events
        switch (eventType) {
            case 'PAYMENT_RECEIVED':
            case 'PAYMENT_CONFIRMED':
                await handlePaymentConfirmed(payment);
                break;
                
            case 'PAYMENT_OVERDUE':
            case 'PAYMENT_DELETED':
                await handlePaymentFailed(payment);
                break;
                
            case 'PAYMENT_REFUNDED':
                await handlePaymentRefunded(payment);
                break;
                
            default:
                console.log(`ℹ️ Evento não processado: ${eventType}`);
        }
        
        res.status(200).send('OK');
        
    } catch (error) {
        console.error('❌ Erro ao processar webhook Asaas:', error);
        res.status(500).send('Erro no processamento');
    }
});

// Webhook event handlers
async function handlePaymentConfirmed(payment) {
    try {
        console.log(`✅ Pagamento confirmado: ${payment.id}`);
        
        // TODO: Update subscription status in PostgreSQL
        // UPDATE restaurants SET subscription_status = 'active', 
        //                      subscription_end_date = DATE_ADD(NOW(), INTERVAL 1 MONTH)
        // WHERE asaas_customer_id = payment.customer
        
        // For now, log the event
        console.log(`💳 Ativando assinatura para customer ${payment.customer}`);
        
    } catch (error) {
        console.error('❌ Erro ao processar pagamento confirmado:', error);
    }
}

async function handlePaymentFailed(payment) {
    try {
        console.log(`❌ Pagamento falhou: ${payment.id}`);
        
        // TODO: Update subscription status in PostgreSQL
        // UPDATE restaurants SET subscription_status = 'overdue' 
        // WHERE asaas_customer_id = payment.customer
        
        console.log(`⚠️ Suspendendo assinatura para customer ${payment.customer}`);
        
    } catch (error) {
        console.error('❌ Erro ao processar falha de pagamento:', error);
    }
}

async function handlePaymentRefunded(payment) {
    try {
        console.log(`🔄 Pagamento reembolsado: ${payment.id}`);
        
        // TODO: Update subscription status in PostgreSQL
        // UPDATE restaurants SET subscription_status = 'cancelled',
        //                      subscription_end_date = NOW()
        // WHERE asaas_customer_id = payment.customer
        
        console.log(`❌ Cancelando assinatura para customer ${payment.customer}`);
        
    } catch (error) {
        console.error('❌ Erro ao processar reembolso:', error);
    }
}

// =================================================================
// ENDPOINTS ASSISTENTE VIRTUAL ANA
// =================================================================

// Endpoint para chat com GPT-5-mini (com integração MCP e histórico do banco)
app.post('/api/assistant/chat', authenticateEvolutionAPI, rateLimitEvolutionAPI(30, 60000), async (req, res) => {
    try {
        const { messages, model, reasoning_effort, max_completion_tokens, temperature, restaurant_id, session_id } = req.body;

        // Verificar se o usuário tem acesso a este restaurante
        if (restaurant_id && req.session.restaurantId !== restaurant_id) {
            console.log(`❌ Acesso negado: Usuário ${req.session.userEmail} tentou usar chat para restaurante ${restaurant_id}, mas está autenticado para ${req.session.restaurantId}`);
            return res.status(403).json({
                error: "Acesso não autorizado",
                details: "Você não tem permissão para usar o assistente para este restaurante"
            });
        }
        
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'Mensagens são obrigatórias' });
        }

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            console.error('❌ OPENAI_API_KEY não configurada');
            return res.status(500).json({ error: 'Configuração da OpenAI API não encontrada' });
        }

        console.log(`🤖 Ana processando mensagem para restaurante ${restaurant_id}`);

        // 📚 CARREGAR HISTÓRICO DO BANCO DE DADOS
        let chatHistory = [];
        if (session_id) {
            chatHistory = await loadChatHistory(session_id);
            console.log(`📚 Histórico carregado do banco: ${chatHistory.length} mensagens para session ${session_id}`);
        }

        // 👤 BUSCAR DADOS DO CLIENTE ANTES DE PROCESSAR (RECONHECIMENTO)
        let customerData = null;
        if (session_id && restaurant_id) {
            try {
                // Extrair telefone do session_id (ex: 5513991292600@s.whatsapp.net -> 5513991292600)
                const phoneNumber = session_id.replace('@s.whatsapp.net', '').replace('@c.us', '');
                console.log(`👤 Buscando cliente com telefone extraído: ${phoneNumber.substring(0, 4)}****${phoneNumber.slice(-4)}`);
                
                // Buscar cliente usando função MCP
                const customerResult = await executeSupabaseQuery('customers_data', { 
                    phone: phoneNumber,
                    restaurant_id: restaurant_id 
                });
                
                if (customerResult && customerResult.data && customerResult.data.length > 0) {
                    customerData = customerResult.data[0];
                    console.log(`✅ Cliente RECONHECIDO: ${customerData.name} (${customerData.phone})`);
                    console.log(`📍 Endereço: ${customerData.address || 'não cadastrado'}`);
                } else {
                    console.log(`ℹ️ Cliente não encontrado no banco (novo cliente)`);
                }
            } catch (customerError) {
                console.error('⚠️ Erro ao buscar cliente:', customerError.message);
                // Continuar sem dados do cliente
            }
        }

        // Combinar histórico do banco com mensagem do system prompt
        const systemMessage = messages.find(m => m.role === 'system');
        const userMessages = messages.filter(m => m.role !== 'system');
        
        // Construir array de mensagens: system + histórico do banco + mensagens novas
        let allMessages = [];
        if (systemMessage) {
            // 🎯 ADICIONAR DADOS DO CLIENTE AO SYSTEM PROMPT (RECONHECIMENTO)
            let enhancedSystemMessage = { ...systemMessage };
            
            if (customerData) {
                // Adicionar informações do cliente ao contexto do sistema
                const customerContext = `

════════════════════════════════════════════════════════════════════════
👤 DADOS DO CLIENTE IDENTIFICADO (USE PARA PERSONALIZAR RESPOSTA):
════════════════════════════════════════════════════════════════════════
✅ CLIENTE CADASTRADO: ${customerData.name}
📞 Telefone: ${customerData.phone}
📍 Endereço cadastrado: ${customerData.address || 'Não informado'}
${customerData.city ? `🏙️ Cidade: ${customerData.city}` : ''}
${customerData.zip_code ? `📮 CEP: ${customerData.zip_code}` : ''}
📊 Total de pedidos: ${customerData.total_orders || 0}
💰 Valor total gasto: R$ ${customerData.total_spent || '0.00'}

⚠️ IMPORTANTE: 
- SEMPRE cumprimente o cliente pelo NOME na primeira mensagem
- Confirme o endereço cadastrado ANTES de criar pedido
- Use tom familiar e acolhedor, como se já conhecesse o cliente
════════════════════════════════════════════════════════════════════════
`;
                enhancedSystemMessage.content = systemMessage.content + customerContext;
                console.log(`✅ Dados do cliente ${customerData.name} adicionados ao contexto da OpenAI`);
            } else {
                console.log(`ℹ️ Nenhum dado de cliente adicionado (cliente novo ou não identificado)`);
            }
            
            allMessages.push(enhancedSystemMessage);
        }
        
        // Adicionar histórico do banco (se houver)
        if (chatHistory.length > 0) {
            allMessages.push(...chatHistory);
            console.log(`✅ ${chatHistory.length} mensagens do histórico adicionadas ao contexto da OpenAI`);
        }
        
        // Adicionar mensagens novas (apenas user/assistant, sem system)
        allMessages.push(...userMessages);

        // 🔧 INTEGRAÇÃO MCP: Verificar se a última mensagem contém palavras-chave MCP
        let mcpData = null;
        let mcpActivated = false;
        const lastMessage = allMessages[allMessages.length - 1];
        if (lastMessage && lastMessage.role === 'user' && detectMCPKeywords(lastMessage.content)) {
            console.log('🔧 Palavras-chave MCP detectadas, executando consulta...');
            try {
                // Determinar comando MCP baseado na mensagem
                let queryCommand = 'list_tables';
                const msg = lastMessage.content.toLowerCase();
                
                if (msg.includes('restaurante') || msg.includes('restaurant')) {
                    queryCommand = 'restaurants_data';
                } else if (msg.includes('pedido') || msg.includes('order')) {
                    queryCommand = 'orders_data';
                } else if (msg.includes('cliente') || msg.includes('customer')) {
                    queryCommand = 'customers_data';
                } else if (msg.includes('produto') || msg.includes('product')) {
                    queryCommand = 'products_data';
                } else if (msg.includes('entregador') || msg.includes('deliverer')) {
                    queryCommand = 'deliverers_data';
                } else if (msg.includes('cupom') || msg.includes('coupon')) {
                    queryCommand = 'coupons_data';
                }
                
                // Executar consulta MCP
                mcpData = await executeSupabaseQuery(queryCommand, { restaurant_id: restaurant_id });
                mcpActivated = true;
                
                // Adicionar dados MCP ao contexto da mensagem
                if (mcpData) {
                    const mcpContext = `\n\n📊 DADOS DO SISTEMA MCP:
${typeof mcpData === 'string' ? mcpData : JSON.stringify(mcpData, null, 2)}

Use esses dados para responder à pergunta do usuário de forma precisa e útil.`;
                    
                    // Modificar a última mensagem para incluir o contexto MCP
                    allMessages[allMessages.length - 1].content += mcpContext;
                    console.log('✅ Dados MCP adicionados ao contexto do assistente');
                }
            } catch (mcpError) {
                console.error('❌ Erro ao executar MCP:', mcpError);
                // Continuar sem MCP em caso de erro
            }
        }

        // Chamar OpenAI API com GPT-5-mini (com histórico completo)
        const gptResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-5-mini',
                messages: allMessages,
                max_completion_tokens: max_completion_tokens || 4096,
                temperature: temperature || 0.7,
                stream: false
            })
        });

        if (!gptResponse.ok) {
            const errorData = await gptResponse.text();
            console.error('❌ Erro na OpenAI API:', errorData);
            return res.status(500).json({ error: 'Erro no processamento da IA' });
        }

        const data = await gptResponse.json();
        const responseMessage = data.choices?.[0]?.message?.content || 'Desculpe, não consegui processar sua mensagem.';

        // 💾 SALVAR MENSAGENS NO HISTÓRICO DO BANCO
        if (session_id) {
            // Salvar mensagem do usuário
            const userMessage = userMessages[userMessages.length - 1];
            if (userMessage) {
                await saveChatMessage(session_id, userMessage.role, userMessage.content);
            }
            
            // Salvar resposta do assistente
            await saveChatMessage(session_id, 'assistant', responseMessage);
            console.log(`💾 Mensagens salvas no banco para session ${session_id}`);
        }

        console.log(`✅ Ana respondeu para ${session_id}${mcpActivated ? ' (com dados MCP)' : ''}`);

        res.json({
            response: responseMessage,
            model_used: 'gpt-5-mini',
            reasoning_effort: reasoning_effort || 'medium',
            mcp_activated: mcpActivated,
            mcp_data: mcpActivated ? mcpData : null
        });

    } catch (error) {
        console.error('❌ Erro no endpoint do assistente:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Endpoint para buscar cardápio para o assistente
app.get('/api/assistant/menu/:restaurantId', authenticateEvolutionAPI, rateLimitEvolutionAPI(30, 60000), async (req, res) => {
    try {
        const { restaurantId } = req.params;
        
        // Verificar se o usuário tem acesso a este restaurante
        if (req.session.restaurantId !== restaurantId) {
            console.log(`❌ Acesso negado: Usuário ${req.session.userEmail} tentou acessar restaurante ${restaurantId}, mas está autenticado para ${req.session.restaurantId}`);
            return res.status(403).json({
                error: "Acesso não autorizado",
                details: "Você não tem permissão para acessar este restaurante"
            });
        }
        
        // Configurar cliente Supabase
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_ANON_KEY;

        // Auto-detect and fix swapped environment variables
        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && supabaseKey && supabaseKey.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = supabaseKey;
            supabaseKey = temp;
        }

        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).json({ error: 'Configuração do Supabase incompleta' });
        }

        const supabaseClient = createClient(supabaseUrl, supabaseKey);

        // Buscar produtos e categorias
        const { data: products, error: productsError } = await supabaseClient
            .from('products')
            .select(`
                id,
                name,
                description,
                price,
                category_id,
                product_categories (
                    name
                )
            `)
            .eq('restaurant_id', restaurantId)
            .eq('active', true)
            .order('category_id')
            .order('name');

        if (productsError) {
            console.error('❌ Erro ao buscar produtos:', productsError);
            return res.status(500).json({ error: 'Erro ao buscar cardápio' });
        }

        console.log(`📋 Ana buscou cardápio para restaurante ${restaurantId}: ${products?.length || 0} produtos`);

        res.json({
            products: products || [],
            restaurant_id: restaurantId,
            total_items: products?.length || 0
        });

    } catch (error) {
        console.error('❌ Erro ao buscar cardápio para assistente:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Endpoint para criar pedido pelo assistente
app.post('/api/assistant/create-order', authenticateEvolutionAPI, rateLimitEvolutionAPI(10, 60000), async (req, res) => {
    try {
        const { 
            restaurant_id, 
            customer_name, 
            customer_phone, 
            customer_address,
            order_items,
            payment_method,
            notes,
            session_id
        } = req.body;

        if (!restaurant_id || !customer_phone) {
            return res.status(400).json({ error: 'Dados obrigatórios não fornecidos' });
        }

        // Verificar se o usuário tem acesso a este restaurante
        if (req.session.restaurantId !== restaurant_id) {
            console.log(`❌ Acesso negado: Usuário ${req.session.userEmail} tentou criar pedido para restaurante ${restaurant_id}, mas está autenticado para ${req.session.restaurantId}`);
            return res.status(403).json({
                error: "Acesso não autorizado",
                details: "Você não tem permissão para criar pedidos para este restaurante"
            });
        }

        // Configurar cliente Supabase
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_ANON_KEY;

        // Auto-detect and fix swapped environment variables
        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && supabaseKey && supabaseKey.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = supabaseKey;
            supabaseKey = temp;
        }

        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).json({ error: 'Configuração do Supabase incompleta' });
        }

        const supabaseClient = createClient(supabaseUrl, supabaseKey);

        // Calcular total do pedido
        const total = order_items?.reduce((sum, item) => {
            return sum + (parseFloat(item.unit_price || 0) * (item.quantity || 1));
        }, 0) || 0;

        // Criar pedido com status "novo"
        const orderData = {
            restaurant_id,
            customer_name: customer_name || 'Cliente',
            customer_phone,
            customer_address: customer_address || '',
            order_type: 'delivery',
            status: 'novo',  // Status obrigatório conforme solicitado
            total: total,
            payment_method: payment_method || 'PIX',
            notes: notes || `Pedido criado via Ana - Assistente Virtual\nSession ID: ${session_id}`,
            created_at: new Date().toISOString()
        };

        const { data: order, error: orderError } = await supabaseClient
            .from('orders')
            .insert([orderData])
            .select()
            .single();

        if (orderError) {
            console.error('❌ Erro ao criar pedido:', orderError);
            return res.status(500).json({ error: 'Erro ao criar pedido' });
        }

        // Criar itens do pedido se existirem
        if (order_items && order_items.length > 0) {
            const orderItemsData = order_items.map(item => ({
                order_id: order.id,
                product_name: item.product_name || item.name || 'Produto',
                quantity: item.quantity || 1,
                unit_price: parseFloat(item.unit_price || 0),
                total_price: parseFloat(item.unit_price || 0) * (item.quantity || 1),
                additionals: item.additionals || []
            }));

            const { error: itemsError } = await supabaseClient
                .from('order_items')
                .insert(orderItemsData);

            if (itemsError) {
                console.error('❌ Erro ao criar itens do pedido:', itemsError);
                // Continuar mesmo com erro nos itens, o pedido já foi criado
            }
        }

        console.log(`✅ Ana criou pedido ${order.id} para ${customer_name} (${customer_phone})`);

        res.json({
            success: true,
            order_id: order.id,
            order_number: String(order.id).slice(-8).toUpperCase(),
            total: total,
            status: 'novo',
            created_at: order.created_at
        });

    } catch (error) {
        console.error('❌ Erro ao criar pedido pelo assistente:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Endpoint para buscar informações do produto com adicionais
app.post('/api/assistant/product-info', authenticateEvolutionAPI, rateLimitEvolutionAPI(30, 60000), async (req, res) => {
    try {
        const { restaurant_id, produto_nome, remoteid_cliente } = req.body;

        if (!restaurant_id || !produto_nome) {
            return res.status(400).json({ error: 'Restaurant ID e nome do produto são obrigatórios' });
        }

        // Configurar cliente Supabase
        const { createClient } = require('@supabase/supabase-js');
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_ANON_KEY;

        // Auto-detect and fix swapped environment variables
        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && supabaseKey && supabaseKey.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = supabaseKey;
            supabaseKey = temp;
        }

        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).json({ error: 'Configuração do Supabase incompleta' });
        }

        const supabaseClient = createClient(supabaseUrl, supabaseKey);

        // Buscar produto por nome
        const { data: product, error: productError } = await supabaseClient
            .from('products')
            .select('*')
            .eq('restaurant_id', restaurant_id)
            .ilike('name', `%${produto_nome}%`)
            .eq('active', true)
            .limit(1)
            .single();

        if (productError || !product) {
            return res.json({
                found: false,
                message: `Produto "${produto_nome}" não encontrado.`
            });
        }

        // Buscar adicionais do produto (se houver tabela de adicionais)
        // Para este exemplo, vamos simular alguns adicionais comuns
        const mockAdditionals = [
            { nome: 'Nutella', preco: '4.00' },
            { nome: 'Granola', preco: '2.50' },
            { nome: 'Leite Condensado', preco: '3.00' },
            { nome: 'Chocolate', preco: '3.50' }
        ];

        const response = {
            found: true,
            produto: {
                nome: product.name,
                preco: parseFloat(product.price).toFixed(2),
                descricao: product.description || ''
            },
            adicionais: mockAdditionals,
            restaurant_id,
            remoteid_cliente
        };

        console.log(`🔍 Ana encontrou produto "${produto_nome}" para ${remoteid_cliente}`);

        res.json(response);

    } catch (error) {
        console.error('❌ Erro ao buscar informações do produto:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// =================================================================
// ENDPOINTS PARA GERENCIAR PROMPTS PERSONALIZADOS DO ASSISTENTE
// =================================================================

// Endpoint para carregar prompt personalizado do sistema
app.get('/api/assistant/system-prompt', authenticateEvolutionAPI, rateLimitEvolutionAPI(30, 60000), async (req, res) => {
    try {
        console.log('📖 Carregando prompt personalizado do sistema...');
        
        const { data: prompt, error } = await supabaseAdmin
            .from('ai_system_prompts')
            .select('*')
            .eq('restaurant_id', req.session.restaurantId)
            .eq('is_active', true)
            .single();
        
        if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
            console.error('❌ Erro ao carregar prompt:', error);
            return res.status(500).json({ 
                error: 'Erro ao carregar prompt personalizado',
                hasCustomPrompt: false 
            });
        }
        
        if (!prompt) {
            console.log('📖 Nenhum prompt personalizado encontrado, usando padrão');
            return res.json({ 
                hasCustomPrompt: false,
                prompt: null,
                status: 'using_default'
            });
        }
        
        console.log(`✅ Prompt personalizado carregado para restaurante ${req.session.restaurantId}`);
        res.json({
            hasCustomPrompt: true,
            prompt: prompt.content,
            updatedAt: prompt.updated_at,
            status: 'custom_loaded'
        });
        
    } catch (error) {
        console.error('❌ Erro ao carregar prompt personalizado:', error);
        res.status(500).json({ 
            error: 'Erro interno ao carregar prompt',
            hasCustomPrompt: false 
        });
    }
});

// Endpoint para salvar prompt personalizado do sistema
app.post('/api/assistant/system-prompt', 
    authenticateEvolutionAPI, 
    rateLimitEvolutionAPI(5, 60000), // Mais restritivo para saves
    csrfProtection,
    async (req, res) => {
    try {
        const { prompt } = req.body;
        
        if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
            return res.status(400).json({
                error: 'Prompt é obrigatório e deve ser uma string não vazia',
                status: 'validation_error'
            });
        }
        
        if (prompt.length > 16384) { // Limite de ~4096 tokens (16k caracteres)
            return res.status(400).json({
                error: 'Prompt muito longo (máximo 4096 tokens / 16.384 caracteres)',
                status: 'validation_error'
            });
        }
        
        console.log(`💾 Salvando prompt personalizado para restaurante ${req.session.restaurantId}...`);
        
        // Desativar prompt anterior (se existir)
        await supabaseAdmin
            .from('ai_system_prompts')
            .update({ is_active: false })
            .eq('restaurant_id', req.session.restaurantId);
        
        // Inserir novo prompt
        const { data, error } = await supabaseAdmin
            .from('ai_system_prompts')
            .insert({
                restaurant_id: req.session.restaurantId,
                content: prompt.trim(),
                created_by: req.session.userEmail,
                is_active: true
            })
            .select()
            .single();
        
        if (error) {
            console.error('❌ Erro ao salvar prompt:', error);
            return res.status(500).json({ 
                error: 'Erro ao salvar prompt personalizado',
                details: error.message 
            });
        }
        
        console.log(`✅ Prompt personalizado salvo com sucesso! ID: ${data.id}`);
        res.json({
            success: true,
            message: 'Prompt personalizado salvo com sucesso!',
            promptId: data.id,
            updatedAt: data.updated_at,
            status: 'saved'
        });
        
    } catch (error) {
        console.error('❌ Erro ao salvar prompt personalizado:', error);
        res.status(500).json({ 
            error: 'Erro interno ao salvar prompt',
            status: 'server_error'
        });
    }
});

// =================================================================
// ENDPOINTS PARA GERENCIAR HISTÓRICO DE CHAT
// =================================================================

// Endpoint para carregar histórico de chat
app.get('/api/assistant/chat-history/:sessionId', authenticateEvolutionAPI, rateLimitEvolutionAPI(30, 60000), async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        if (!sessionId) {
            return res.status(400).json({ error: 'Session ID é obrigatório' });
        }

        console.log(`📚 Carregando histórico de chat para session: ${sessionId}`);
        
        const history = await loadChatHistory(sessionId);
        
        res.json({
            success: true,
            session_id: sessionId,
            messages: history,
            count: history.length
        });
        
    } catch (error) {
        console.error('❌ Erro ao carregar histórico de chat:', error);
        res.status(500).json({ 
            error: 'Erro ao carregar histórico',
            success: false
        });
    }
});

// Endpoint para salvar mensagem no histórico
app.post('/api/assistant/save-message', authenticateEvolutionAPI, rateLimitEvolutionAPI(60, 60000), async (req, res) => {
    try {
        const { session_id, role, content } = req.body;
        
        if (!session_id || !role || !content) {
            return res.status(400).json({ 
                error: 'session_id, role e content são obrigatórios' 
            });
        }

        if (!['user', 'assistant'].includes(role)) {
            return res.status(400).json({ 
                error: 'role deve ser "user" ou "assistant"' 
            });
        }

        console.log(`💾 Salvando mensagem no histórico: ${session_id} (${role})`);
        
        const saved = await saveChatMessage(session_id, role, content);
        
        if (saved) {
            res.json({
                success: true,
                message: 'Mensagem salva com sucesso',
                session_id,
                role
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Falha ao salvar mensagem'
            });
        }
        
    } catch (error) {
        console.error('❌ Erro ao salvar mensagem:', error);
        res.status(500).json({ 
            error: 'Erro ao salvar mensagem',
            success: false
        });
    }
});

// Endpoint para limpar histórico antigo
app.delete('/api/assistant/clean-history', authenticateEvolutionAPI, rateLimitEvolutionAPI(5, 60000), async (req, res) => {
    try {
        console.log('🧹 Limpando histórico antigo de chat...');
        
        const cleaned = await cleanOldChatHistory();
        
        if (cleaned) {
            res.json({
                success: true,
                message: 'Histórico antigo limpo com sucesso'
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Falha ao limpar histórico'
            });
        }
        
    } catch (error) {
        console.error('❌ Erro ao limpar histórico:', error);
        res.status(500).json({ 
            error: 'Erro ao limpar histórico',
            success: false
        });
    }
});

// ===== WEBHOOK ENDPOINT PARA EVOLUTION API - ASSISTENTE ANA =====

// Array para armazenar as últimas mensagens recebidas (máximo 10)
let latestEvolutionMessages = [];

// Armazenamento detalhado de todos os webhooks recebidos
let webhookDetailedLog = [];
let webhookStats = {
    total: 0,
    processed: 0,
    ignored: 0,
    errors: 0
};

// Função para adicionar entrada no log detalhado
function addWebhookLogEntry(logData) {
    // Adicionar timestamp se não existir
    if (!logData.timestamp) {
        logData.timestamp = new Date().toISOString();
    }
    
    // Adicionar no início do array
    webhookDetailedLog.unshift(logData);
    
    // Manter apenas os últimos 100 logs para performance
    if (webhookDetailedLog.length > 100) {
        webhookDetailedLog = webhookDetailedLog.slice(0, 100);
    }
    
    // Atualizar estatísticas
    webhookStats.total++;
    if (logData.status === 'processed') {
        webhookStats.processed++;
    } else if (logData.status === 'ignored') {
        webhookStats.ignored++;
    } else if (logData.status === 'error') {
        webhookStats.errors++;
    }
}

// Função para adicionar mensagem ao histórico
function addMessageToHistory(messageData) {
    // Adicionar nova mensagem no início do array
    latestEvolutionMessages.unshift(messageData);
    
    // Manter apenas as últimas 10 mensagens
    if (latestEvolutionMessages.length > 10) {
        latestEvolutionMessages = latestEvolutionMessages.slice(0, 10);
    }
}

// Endpoint GET para buscar as 10 últimas mensagens
app.get('/api/webhook/evolution', async (req, res) => {
    try {
        res.json({
            status: 'ok',
            messages: latestEvolutionMessages,
            count: latestEvolutionMessages.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Erro ao buscar mensagens:', error);
        res.status(500).json({ 
            error: 'Erro ao buscar mensagens',
            status: 'error' 
        });
    }
});

// Endpoint GET para buscar o log detalhado dos webhooks
app.get('/api/webhook/evolution/log', async (req, res) => {
    try {
        res.json({
            status: 'ok',
            logs: webhookDetailedLog,
            stats: webhookStats,
            count: webhookDetailedLog.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Erro ao buscar log do webhook:', error);
        res.status(500).json({ 
            error: 'Erro ao buscar log do webhook',
            status: 'error' 
        });
    }
});

// Endpoint DELETE para limpar o log dos webhooks
app.delete('/api/webhook/evolution/log', async (req, res) => {
    try {
        webhookDetailedLog = [];
        webhookStats = {
            total: 0,
            processed: 0,
            ignored: 0,
            errors: 0
        };
        
        console.log('🧹 Log do webhook Evolution API foi limpo');
        
        res.json({
            status: 'ok',
            message: 'Log do webhook foi limpo com sucesso',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Erro ao limpar log do webhook:', error);
        res.status(500).json({ 
            error: 'Erro ao limpar log do webhook',
            status: 'error' 
        });
    }
});

// Endpoint webhook para receber mensagens do Evolution API e processar com Ana
app.post('/api/webhook/evolution', async (req, res) => {
    try {
        const webhookData = req.body;
        const receivedAt = new Date().toISOString();
        
        // Log webhook de forma segura (sem expor API keys)
        const safeWebhookData = {
            event: webhookData.event,
            instance: webhookData.instance,
            messageType: webhookData.data?.messageType,
            hasMessage: !!webhookData.data?.message,
            fromMe: webhookData.data?.key?.fromMe,
            pushName: webhookData.data?.pushName || 'Anônimo'
        };
        console.log('📨 Webhook Evolution API recebido:', JSON.stringify(safeWebhookData, null, 2));
        
        // Validar estrutura básica do webhook
        if (!webhookData.instance || !webhookData.data || !webhookData.data.message) {
            console.log('⚠️ Webhook inválido: estrutura incorreta');
            
            // Adicionar ao log detalhado
            addWebhookLogEntry({
                status: 'ignored',
                reason: 'invalid_structure',
                timestamp: receivedAt,
                rawData: webhookData,
                instance: webhookData.instance || 'N/A',
                messageType: webhookData.data?.messageType || 'N/A'
            });
            
            return res.status(200).json({ status: 'ignored', reason: 'invalid_structure' });
        }
        
        const { instance } = webhookData;
        const { key, message, messageType, pushName } = webhookData.data;
        const body = message.conversation || message.body;
        
        // Ignorar mensagens do próprio bot
        if (key.fromMe === true) {
            console.log('🤖 Ignorando mensagem própria do bot');
            
            // Adicionar ao log detalhado
            addWebhookLogEntry({
                status: 'ignored',
                reason: 'own_message',
                timestamp: receivedAt,
                rawData: webhookData,
                instance: instance,
                messageType: messageType,
                pushName: pushName,
                body: body,
                remoteJid: key.remoteJid
            });
            
            return res.status(200).json({ status: 'ignored', reason: 'own_message' });
        }
        
        // Processar apenas mensagens de texto
        if (messageType !== 'textMessage' && messageType !== 'conversation') {
            console.log('📝 Ignorando mensagem não textual:', messageType);
            
            // Adicionar ao log detalhado
            addWebhookLogEntry({
                status: 'ignored',
                reason: 'not_text_message',
                timestamp: receivedAt,
                rawData: webhookData,
                instance: instance,
                messageType: messageType,
                pushName: pushName,
                body: body,
                remoteJid: key.remoteJid
            });
            
            return res.status(200).json({ status: 'ignored', reason: 'not_text_message' });
        }
        
        if (!body || body.trim() === '') {
            console.log('📭 Mensagem vazia ignorada');
            
            // Adicionar ao log detalhado
            addWebhookLogEntry({
                status: 'ignored',
                reason: 'empty_message',
                timestamp: receivedAt,
                rawData: webhookData,
                instance: instance,
                messageType: messageType,
                pushName: pushName,
                body: body || '',
                remoteJid: key.remoteJid
            });
            
            return res.status(200).json({ status: 'ignored', reason: 'empty_message' });
        }
        
        console.log(`💬 Mensagem de ${pushName || 'Usuário'} na instância ${instance}: ${body}`);
        
        // Armazenar mensagem no histórico
        const messageData = {
            id: key.id || Date.now().toString(),
            timestamp: new Date().toISOString(),
            instance: instance,
            messageType: messageType,
            body: body,
            pushName: pushName || 'Usuário Anônimo',
            remoteJid: key.remoteJid,
            fromMe: key.fromMe
        };
        
        addMessageToHistory(messageData);
        console.log(`📝 Mensagem armazenada no histórico. Total: ${latestEvolutionMessages.length}`);
        
        // Buscar restaurante pela instância (name = instance)
        const { createClient } = require('@supabase/supabase-js');
        
        // Auto-detect and fix swapped environment variables (same logic as other endpoints)
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && supabaseAnonKey && supabaseAnonKey.startsWith('https://')) {
            console.log('🔄 Webhook auto-detecting swapped SUPABASE_URL and SUPABASE_ANON_KEY - fixing automatically');
            const temp = supabaseUrl;
            supabaseUrl = supabaseAnonKey;
            supabaseAnonKey = temp;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;
        }
        
        if (!supabaseUrl || !supabaseKey) {
            console.error('❌ Configuração do Supabase não encontrada para webhook');
            return res.status(500).json({ error: 'Database configuration missing' });
        }
        
        const supabase = createClient(supabaseUrl, supabaseKey);
        
        // Buscar restaurante pela coluna name (que corresponde à instância)
        const { data: restaurant, error: restaurantError } = await supabase
            .from('restaurants')
            .select('*')
            .eq('name', instance)
            .single();
            
        if (restaurantError || !restaurant) {
            console.log(`⚠️ Restaurante não encontrado para instância: ${instance}`);
            
            // Adicionar ao log detalhado
            addWebhookLogEntry({
                status: 'ignored',
                reason: 'restaurant_not_found',
                timestamp: receivedAt,
                rawData: webhookData,
                instance: instance,
                messageType: messageType,
                pushName: pushName,
                body: body,
                remoteJid: key.remoteJid
            });
            
            return res.status(200).json({ status: 'ignored', reason: 'restaurant_not_found' });
        }
        
        console.log(`🏪 Restaurante encontrado: ${restaurant.name} (ID: ${restaurant.id})`);  // Mantém variável restaurant do webhook
        
        // 🔍 Buscar contexto completo usando MCP
        console.log('🔍 Buscando contexto completo via MCP...');
        let context = {
            customer: null,
            restaurant: restaurant,
            menu: null,
            channel: {
                instance: instance,
                remoteJid: key.remoteJid,
                pushName: pushName
            }
        };
        
        try {
            // Normalizar telefone do WhatsApp antes da consulta
            const normalizedPhone = normalizeWhatsAppJid(key.remoteJid);
            console.log(`📞 Telefone normalizado: ${key.remoteJid} -> ${normalizedPhone}`);
            
            // Gerar múltiplos formatos de telefone para busca
            const phoneFormats = [
                normalizedPhone,                                    // +5513991292600
                normalizedPhone.replace('+', ''),                   // 5513991292600
                normalizedPhone.replace('+55', ''),                 // 13991292600
                normalizedPhone.replace(/[^0-9]/g, ''),            // Apenas números
                normalizedPhone.replace(/[^0-9]/g, '').substring(2) // Remove código do país
            ];
            
            console.log(`📞 Buscando cliente em ${phoneFormats.length} formatos de telefone`);
            
            // Buscar dados do cliente por telefone em múltiplos formatos
            let customerData = null;
            for (const phoneFormat of phoneFormats) {
                try {
                    customerData = await executeSupabaseQuery('customers_data', { 
                        phone: phoneFormat,
                        restaurant_id: restaurant.id 
                    });
                    
                    if (customerData && customerData.customer) {
                        context.customer = customerData.customer;
                        console.log(`👤 Cliente encontrado: ${customerData.customer.name} (formato: ${phoneFormat})`);
                        break;
                    }
                } catch (err) {
                    // Continuar tentando outros formatos
                    console.log(`⚠️ Formato ${phoneFormat} não encontrou cliente`);
                }
            }
            
            if (!context.customer) {
                console.log(`👤 Cliente não encontrado em nenhum formato de telefone`);
            }
            
            // Buscar cardápio do restaurante
            const menuData = await executeSupabaseQuery('products_data', { restaurant_id: restaurant.id });  // Usa restaurant do webhook
            if (menuData && menuData.categories) {
                context.menu = menuData;
                console.log(`📝 Cardápio carregado: ${menuData.total_categories} categorias, ${menuData.total_products} produtos`);
            } else {
                console.log(`📝 Nenhum cardápio encontrado para restaurante: ${restaurant.id}`);  // Usa restaurant do webhook
            }
            
        } catch (mcpError) {
            console.error('⚠️ Erro ao buscar contexto via MCP:', mcpError);
            // Continuar mesmo com erro no contexto
        }
        
        // 💾 Salvar mensagem do usuário no histórico
        const sessionId = key.remoteJid;
        await saveChatMessage(sessionId, 'user', body);
        
        // 📚 Carregar histórico de conversas
        const chatHistory = await loadChatHistory(sessionId);
        
        // Processar mensagem com Ana usando contexto completo e histórico
        const aiResponse = await processMessageWithAna(body, context, chatHistory);
        
        if (!aiResponse) {
            console.log('🤖 Ana não retornou resposta');
            
            // Adicionar ao log detalhado
            addWebhookLogEntry({
                status: 'processed',
                reason: 'no_ai_response',
                timestamp: receivedAt,
                rawData: webhookData,
                instance: instance,
                messageType: messageType,
                pushName: pushName,
                body: body,
                remoteJid: key.remoteJid,
                restaurant: restaurant.name,  // Usa restaurant do webhook
                hasCustomer: !!context?.customer,
                hasMenu: !!context?.menu
            });
            
            return res.status(200).json({ status: 'processed', reason: 'no_ai_response' });
        }
        
        // 💾 Salvar resposta da OpenAI no histórico
        await saveChatMessage(sessionId, 'assistant', aiResponse);
        
        // Enviar resposta via Evolution API
        const sendSuccess = await sendEvolutionMessage(instance, key.remoteJid, aiResponse);
        
        if (sendSuccess) {
            console.log('✅ Resposta enviada com sucesso via Evolution API');
            
            // Adicionar ao log detalhado como sucesso completo
            addWebhookLogEntry({
                status: 'processed',
                reason: 'success',
                timestamp: receivedAt,
                rawData: webhookData,
                instance: instance,
                messageType: messageType,
                pushName: pushName,
                body: body,
                remoteJid: key.remoteJid,
                restaurant: restaurant.name,  // Usa restaurant do webhook
                hasCustomer: !!context?.customer,
                hasMenu: !!context?.menu,
                aiResponse: aiResponse,
                messageSent: true
            });
            
            return res.status(200).json({ status: 'processed', message_sent: true });
        } else {
            console.log('❌ Erro ao enviar resposta via Evolution API');
            
            // Adicionar ao log detalhado como processado mas com erro de envio
            addWebhookLogEntry({
                status: 'processed',
                reason: 'send_error',
                timestamp: receivedAt,
                rawData: webhookData,
                instance: instance,
                messageType: messageType,
                pushName: pushName,
                body: body,
                remoteJid: key.remoteJid,
                restaurant: restaurant.name,  // Usa restaurant do webhook
                hasCustomer: !!context?.customer,
                hasMenu: !!context?.menu,
                aiResponse: aiResponse,
                messageSent: false
            });
            
            return res.status(200).json({ status: 'processed', message_sent: false });
        }
        
    } catch (error) {
        console.error('❌ Erro no webhook Evolution API:', error);
        
        // Adicionar erro ao log detalhado
        try {
            addWebhookLogEntry({
                status: 'error',
                error: error.message,
                timestamp: receivedAt || new Date().toISOString(),
                rawData: webhookData || {},
                instance: webhookData?.instance || 'N/A',
                messageType: webhookData?.data?.messageType || 'N/A'
            });
        } catch (logError) {
            console.error('❌ Erro ao adicionar erro no log:', logError);
        }
        
        return res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// =================================================================
// FUNÇÕES DE MEMÓRIA DE CHAT (SUPABASE)
// =================================================================

// Função para salvar mensagem no histórico do Supabase
async function saveChatMessage(sessionId, role, content) {
    try {
        const { createClient } = require('@supabase/supabase-js');
        
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && supabaseAnonKey && supabaseAnonKey.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = supabaseAnonKey;
            supabaseAnonKey = temp;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;
        }
        
        const supabase = createClient(supabaseUrl, supabaseKey);
        
        const { error } = await supabase
            .from('chat_histories')
            .insert({
                session_id: sessionId,
                message: { role, content }
            });
        
        if (error) {
            console.error('❌ Erro ao salvar mensagem no histórico:', error);
            return false;
        }
        
        console.log(`💾 Mensagem salva no histórico: ${sessionId} (${role})`);
        return true;
        
    } catch (error) {
        console.error('❌ Erro ao salvar mensagem:', error);
        return false;
    }
}

// Função para carregar histórico de chat do Supabase
async function loadChatHistory(sessionId) {
    try {
        const { createClient } = require('@supabase/supabase-js');
        
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && supabaseAnonKey && supabaseAnonKey.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = supabaseAnonKey;
            supabaseAnonKey = temp;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;
        }
        
        const supabase = createClient(supabaseUrl, supabaseKey);
        
        // Buscar últimas 50 mensagens (histórico recente) ordenadas por ID
        const { data, error } = await supabase
            .from('chat_histories')
            .select('message')
            .eq('session_id', sessionId)
            .order('id', { ascending: true })
            .limit(50);
        
        if (error) {
            console.error('❌ Erro ao carregar histórico:', error);
            return [];
        }
        
        const messages = data.map(row => row.message);
        console.log(`📚 Histórico carregado: ${messages.length} mensagens para ${sessionId}`);
        console.log(`✅ CONFIRMAÇÃO: OpenAI está consultando a tabela chat_histories do Supabase!`);
        console.log(`📊 Dados do histórico consultado:`, {
            sessionId: sessionId,
            totalMessages: messages.length,
            table: 'chat_histories',
            timeRange: 'últimas 24 horas',
            hasMessages: messages.length > 0
        });
        return messages;
        
    } catch (error) {
        console.error('❌ Erro ao carregar histórico:', error);
        return [];
    }
}

// Função para limpar mensagens antigas (>24 horas)
async function cleanOldChatHistory() {
    try {
        const { createClient } = require('@supabase/supabase-js');
        
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && supabaseAnonKey && supabaseAnonKey.startsWith('https://')) {
            const temp = supabaseUrl;
            supabaseUrl = supabaseAnonKey;
            supabaseAnonKey = temp;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;
        }
        
        const supabase = createClient(supabaseUrl, supabaseKey);
        
        // Manter apenas as últimas 100 mensagens de cada sessão
        const { data: sessions } = await supabase
            .from('chat_histories')
            .select('session_id')
            .order('session_id');
        
        if (!sessions) return true;
        
        const uniqueSessions = [...new Set(sessions.map(s => s.session_id))];
        
        for (const sessionId of uniqueSessions) {
            // Buscar IDs das mensagens antigas (manter últimas 100)
            const { data: oldMessages } = await supabase
                .from('chat_histories')
                .select('id')
                .eq('session_id', sessionId)
                .order('id', { ascending: false })
                .range(100, 1000); // Pegar da 101ª mensagem em diante
            
            if (oldMessages && oldMessages.length > 0) {
                const idsToDelete = oldMessages.map(m => m.id);
                await supabase
                    .from('chat_histories')
                    .delete()
                    .in('id', idsToDelete);
            }
        }
        
        const { error } = { error: null };
        
        if (error) {
            console.error('❌ Erro ao limpar histórico antigo:', error);
            return false;
        }
        
        console.log('🧹 Histórico antigo limpo com sucesso');
        return true;
        
    } catch (error) {
        console.error('❌ Erro ao limpar histórico:', error);
        return false;
    }
}

// Executar limpeza de histórico a cada 6 horas
setInterval(cleanOldChatHistory, 6 * 60 * 60 * 1000);

// Função para processar mensagem com Ana (simulando o comportamento do assistente.js)
async function processMessageWithAna(messageText, context, chatHistory = []) {
    try {
        console.log('🤖 Processando mensagem com Ana...');
        console.log(`📚 Usando histórico de ${chatHistory.length} mensagens`);
        
        // Buscar prompt personalizado baseado no business_type do restaurante
        const { createClient } = require('@supabase/supabase-js');
        
        // Auto-detect and fix swapped environment variables
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && supabaseAnonKey && supabaseAnonKey.startsWith('https://')) {
            console.log('🔄 processMessageWithAna auto-detecting swapped SUPABASE_URL and SUPABASE_ANON_KEY - fixing automatically');
            const temp = supabaseUrl;
            supabaseUrl = supabaseAnonKey;
            supabaseAnonKey = temp;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;
        }
        
        const supabase = createClient(supabaseUrl, supabaseKey);
        
        let customPrompt = null;
        const businessType = context?.restaurant?.business_type || 'restaurante';
        
        console.log(`🎯 Buscando prompt para tipo de negócio: ${businessType}`);
        
        const { data: promptData, error: promptError } = await supabase
            .from('prompit')
            .select('prompt')
            .eq('tipo_negocio', businessType)
            .eq('active', true)
            .single();
            
        if (promptError) {
            console.log(`⚠️ Prompt específico não encontrado para "${businessType}", usando padrão`);
        } else if (promptData) {
            customPrompt = promptData.prompt;
            console.log(`✅ Prompt personalizado carregado para tipo: ${businessType}`);
        }
        
        // 🔧 INTEGRAÇÃO MCP: Verificar se a mensagem contém palavras-chave MCP
        let mcpData = null;
        let mcpActivated = false;
        if (detectMCPKeywords(messageText)) {
            console.log('🔧 Palavras-chave MCP detectadas no WhatsApp, executando consulta...');
            try {
                // Determinar comando MCP baseado na mensagem
                let queryCommand = 'list_tables';
                const msg = messageText.toLowerCase();
                
                if (msg.includes('restaurante') || msg.includes('restaurant')) {
                    queryCommand = 'restaurants_data';
                } else if (msg.includes('pedido') || msg.includes('order')) {
                    queryCommand = 'orders_data';
                } else if (msg.includes('cliente') || msg.includes('customer')) {
                    queryCommand = 'customers_data';
                } else if (msg.includes('produto') || msg.includes('product')) {
                    queryCommand = 'products_data';
                } else if (msg.includes('entregador') || msg.includes('deliverer')) {
                    queryCommand = 'deliverers_data';
                } else if (msg.includes('cupom') || msg.includes('coupon')) {
                    queryCommand = 'coupons_data';
                } else if (msg.includes('dados') || msg.includes('consulta') || msg.includes('database')) {
                    queryCommand = 'list_tables';
                }
                
                // Executar consulta MCP
                mcpData = await executeSupabaseQuery(queryCommand, { restaurant_id: context.restaurant.id });
                mcpActivated = true;
                console.log('✅ Dados MCP obtidos com sucesso no WhatsApp');
                
            } catch (mcpError) {
                console.error('❌ Erro ao executar MCP no WhatsApp:', mcpError);
                // Continuar sem MCP em caso de erro
            }
        }

        // 🚨 PROMPT MESTRE DA ANA - SEGUIR À RISCA
        const anaBasePrompt = `### **[PROMPT MESTRE PARA ASSISTENTE DE RESTAURANTE: ANA]**

**Você é Ana, uma assistente virtual especialista em atendimento para restaurantes via WhatsApp.** Sua missão é proporcionar uma experiência de pedido fluida, eficiente e, acima de tudo, humana e calorosa para cada cliente.

## 1. PERSONA E DIRETRIZES GERAIS

* **Nome:** Ana
* **Tom:** Humanizado, usando português brasileiro coloquial e amigável. Use contrações como "tá", "pra", "a gente". Seja calorosa ("Que alegria te ver por aqui!", "Opa, que delícia!"), mas sempre eficiente e clara.

## 🚨 REGRA CRÍTICA OBRIGATÓRIA: PROCESSO INTERNO INVISÍVEL

**❌ NUNCA MOSTRE AO USUÁRIO:**
- "Vou pegar suas informações..."
- "🔍 Consultando dados..."
- "Um momentinho..."
- "Aguarde..."
- Qualquer indicação de que está processando ou consultando

**✅ SEMPRE FAÇA:**
- Use os dados já consultados que estão no contexto
- Responda DIRETAMENTE com as informações já disponíveis
- Seja natural e fluida na conversa

## DADOS DISPONÍVEIS NO CONTEXTO (JÁ CONSULTADOS):

**Restaurante:**
- Nome: ${context.restaurant.name}
- Tipo: ${context.restaurant.business_type || 'restaurante'}
- Horário: ${context.restaurant.opening_hours || '8h'} às ${context.restaurant.closing_hours || '22h'}

**Cliente:**
${context.customer ? 
`- Nome: ${context.customer.name}
- Telefone: ${context.customer.phone}
- Endereço: ${context.customer.address || 'não cadastrado'}
- Cidade: ${context.customer.city || ''}
- CEP: ${context.customer.zip_code || ''}
- Cliente CADASTRADO: SIM` 
: 
`- WhatsApp: ${context.channel.pushName}
- Telefone: ${context.channel.remoteJid}
- Cliente CADASTRADO: NÃO`}

**Cardápio:**
${context.menu ? 
`${context.menu.categories.map(cat => 
    `\n🍽️ ${cat.name}:\n${cat.products.map(prod => 
        `  • ${prod.name} - R$ ${prod.price}${prod.description ? ` (${prod.description})` : ''}`
    ).join('\n')}`
).join('\n')}`
: 'Cardápio não disponível no momento'}

## FLUXO OBRIGATÓRIO:

### SE CLIENTE CADASTRADO (context.customer existe):
**PRIMEIRA MENSAGEM:**
"Oi, ${context.customer?.name}! Que alegria te ver por aqui! 😊 

Só pra confirmar, seu endereço para entrega ainda é:
📍 ${context.customer?.address || 'endereço não cadastrado'}

Tá certo? 

A gente tá aberto das ${context.restaurant.opening_hours || '8h'} às ${context.restaurant.closing_hours || '22h'}."

### SE CLIENTE NÃO CADASTRADO (context.customer não existe):
**PRIMEIRA MENSAGEM:**
"Olá! Seja muito bem-vindo(a) ao ${context.restaurant.name}! 😊 

Para a gente começar, preciso de algumas informações:

📝 **Nome completo:**
📍 **Endereço de entrega completo** (rua, número, bairro, cidade e CEP):

Estamos abertos das ${context.restaurant.opening_hours || '8h'} às ${context.restaurant.closing_hours || '22h'}."

## CARDÁPIO:
${context.menu ? 
`Quando cliente pedir cardápio, mostre TODAS as categorias e TODOS os produtos:

📋 **CARDÁPIO COMPLETO - ${context.restaurant.name}**
${context.menu.categories.map((cat, catIdx) => 
    `\n${cat.emoji || '🍽️'} **${cat.name}**\n────────────────────\n${cat.products.map((prod, prodIdx) => 
        `${catIdx * 10 + prodIdx + 1}️⃣ **${prod.name}** - R$ ${prod.price}${prod.description ? `\n   ${prod.description}` : ''}`
    ).join('\n\n')}`
).join('\n\n')}
\n────────────────────\nQual vai ser? Pode me dizer o número ou o nome! 😊`
: 'Cardápio não disponível'}

## REGRAS CRÍTICAS:
1. ✅ Use SEMPRE os dados já disponíveis no contexto
2. ❌ NUNCA diga que está "consultando" ou "verificando"
3. ✅ Responda de forma DIRETA e natural
4. ✅ Mostre TODOS os produtos do cardápio (não omita nada)
5. ✅ Sempre confirme endereço antes de prosseguir
6. ✅ Sempre pergunte forma de pagamento antes de finalizar

Lembre-se: Os dados já foram consultados! Use-os diretamente sem mencionar o processo.`;

        let systemPrompt = customPrompt || anaBasePrompt;

        // Adicionar dados MCP ao contexto se disponíveis
        let userMessage = messageText;
        if (mcpActivated && mcpData) {
            const mcpContext = `\n\n📊 DADOS DO SISTEMA MCP:
${typeof mcpData === 'string' ? mcpData : JSON.stringify(mcpData, null, 2)}

Use esses dados para responder à pergunta do usuário de forma precisa e útil.`;
            userMessage += mcpContext;
            console.log('✅ Dados MCP adicionados ao contexto do WhatsApp');
        }

        // 📚 Construir array de mensagens com histórico
        const messages = [
            {
                role: "system",
                content: systemPrompt
            }
        ];
        
        // Adicionar histórico de conversas (máximo 10 mensagens para não exceder tokens)
        const recentHistory = chatHistory.slice(-10);
        messages.push(...recentHistory);
        
        // Adicionar mensagem atual do usuário
        messages.push({
            role: "user", 
            content: userMessage
        });

        // Chamar OpenAI API
        const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini', // Usar modelo disponível
                messages: messages,
                max_completion_tokens: 500,
                temperature: 0.7
            })
        });

        if (!openaiResponse.ok) {
            console.error('❌ Erro na OpenAI API:', openaiResponse.status);
            return 'Desculpe, estou com problemas técnicos no momento. Tente novamente em instantes.';
        }

        const openaiData = await openaiResponse.json();
        const aiResponse = openaiData.choices[0]?.message?.content || 'Desculpe, não consegui processar sua mensagem.';
        
        console.log(`✅ Ana processou a mensagem${mcpActivated ? ' (com dados MCP)' : ''}:`, aiResponse.substring(0, 100) + '...');
        return aiResponse;
        
    } catch (error) {
        console.error('❌ Erro ao processar com Ana:', error);
        return 'Desculpe, tive um problema técnico. Nossa equipe foi notificada.';
    }
}

// Função para enviar mensagem via Evolution API
async function sendEvolutionMessage(instance, remoteJid, message) {
    try {
        const evolutionApiUrl = process.env.EVOLUTION_API_BASE_URL || process.env.EVOLUTION_API_URL || process.env.EVOLUTION_SERVER_URL;
        const evolutionApiKey = process.env.EVOLUTION_API_KEY;
        
        if (!evolutionApiUrl || !evolutionApiKey) {
            console.error('❌ Evolution API não configurada');
            return false;
        }
        
        const sendEndpoint = `${evolutionApiUrl}/message/sendText/${instance}`;
        
        // Limpar o número - remover @s.whatsapp.net se presente
        const cleanNumber = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '');
        
        const payload = {
            number: cleanNumber,
            text: message
        };
        
        console.log('📤 Enviando mensagem via Evolution API:', { instance, remoteJid, cleanNumber, messageLength: message.length });
        
        const response = await fetch(sendEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': evolutionApiKey
            },
            body: JSON.stringify(payload)
        });
        
        if (response.ok) {
            console.log('✅ Mensagem enviada com sucesso via Evolution API');
            return true;
        } else {
            console.error('❌ Erro ao enviar mensagem:', response.status, await response.text());
            return false;
        }
        
    } catch (error) {
        console.error('❌ Erro ao enviar via Evolution API:', error);
        return false;
    }
}


// =================================================================
// MCP (Model Context Protocol) INTEGRATION
// =================================================================

// Função para normalizar números de telefone do WhatsApp para E.164
function normalizeWhatsAppJid(remoteJid) {
    try {
        // Extrair apenas os dígitos do JID (remove @s.whatsapp.net, etc)
        const phoneDigits = remoteJid.replace(/[^0-9]/g, '');
        
        // Se já tem código do país (começa com 55 para Brasil), manter
        if (phoneDigits.startsWith('55') && phoneDigits.length >= 12) {
            return '+' + phoneDigits;
        }
        
        // Se não tem código do país, assumir Brasil (+55)
        if (phoneDigits.length >= 10) {
            return '+55' + phoneDigits;
        }
        
        // Se muito curto, retornar como está com prefixo
        return '+55' + phoneDigits;
        
    } catch (error) {
        console.error('❌ Erro ao normalizar telefone:', remoteJid, error);
        return remoteJid; // Retornar original em caso de erro
    }
}

// Função para mascarar telefone para logs (segurança e privacidade)
function maskPhoneForLog(phone) {
    try {
        if (!phone) return phone;
        
        // Extrair apenas dígitos
        const digits = phone.replace(/[^0-9]/g, '');
        
        if (digits.length >= 8) {
            // Mascarar todos exceto últimos 4 dígitos
            const masked = '*'.repeat(digits.length - 4) + digits.slice(-4);
            // Substituir dígitos originais pelos mascarados na string original
            return phone.replace(/\d+/g, masked);
        }
        
        return phone; // Retornar original se muito curto
    } catch (error) {
        return '****'; // Fallback seguro
    }
}

// Função para gerar múltiplos formatos de telefone para busca (otimizada)
function generatePhoneFormats(phone) {
    try {
        // Limpar o telefone primeiro
        const cleanPhone = phone.replace(/[^0-9]/g, '');
        
        // Validação mínima - se muito curto, retornar vazio para forçar fallback
        if (cleanPhone.length < 8) {
            return [];
        }
        
        const formats = [];
        
        // Formato 1: +5513991292600 (completo com +55)
        if (cleanPhone.startsWith('55') && cleanPhone.length >= 12) {
            formats.push('+' + cleanPhone);
            formats.push(cleanPhone);
            // Extrair apenas DDD + número (remove 55)
            const ddcNumber = cleanPhone.substring(2);
            if (ddcNumber.length >= 10) {
                formats.push(ddcNumber);
            }
        } else if (cleanPhone.length >= 10) {
            // Formato com código do país
            formats.push('+55' + cleanPhone);
            formats.push('55' + cleanPhone);
            // Formato só DDD + número
            formats.push(cleanPhone);
        }
        
        // Remover duplicatas e retornar apenas formatos limpos
        return [...new Set(formats)];
        
    } catch (error) {
        console.error('❌ Erro ao gerar formatos de telefone:', maskPhoneForLog(phone || ''), error.message);
        return []; // Retornar array vazio em caso de erro
    }
}

// Cache simples para cardápios (memória, TTL 10 minutos)
const menuCache = new Map();
const MENU_CACHE_TTL = 10 * 60 * 1000; // 10 minutos em millisegundos

function getFromMenuCache(restaurantId) {
    const cached = menuCache.get(restaurantId);
    if (cached && Date.now() - cached.timestamp < MENU_CACHE_TTL) {
        console.log('📦 Cardápio carregado do cache para restaurante:', restaurantId);
        return cached.data;
    }
    return null;
}

function setMenuCache(restaurantId, data) {
    menuCache.set(restaurantId, {
        data: data,
        timestamp: Date.now()
    });
    console.log('📦 Cardápio salvo no cache para restaurante:', restaurantId);
}

// Função para detectar palavras-chave MCP
function detectMCPKeywords(message) {
    const mcpKeywords = [
        'mcp', 'database', 'banco de dados', 'consulta', 'query', 
        'tabela', 'dados', 'sql', 'supabase', 'buscar dados', 
        'verificar banco', 'consultar base', 'dados do sistema',
        'restaurante', 'restaurant', 'pedido', 'order', 'cliente', 'customer',
        'produto', 'product', 'entregador', 'deliverer', 'delivery',
        'cupom', 'coupon', 'desconto', 'notificacao', 'notification',
        'log', 'atividade', 'activity', 'chat', 'conversa', 'message',
        'prompt', 'prompit', 'administrador', 'admin', 'usuario', 'user',
        'tipo negocio', 'business type', 'relatorio', 'report', 'estatistica',
        // Palavras-chave para criação de pedidos
        'criar pedido', 'novo pedido', 'fazer pedido', 'create order', 'new order',
        'pedido delivery', 'pedido balcao', 'balcão', 'counter order', 'delivery order',
        'finalizar pedido', 'processar pedido', 'salvar pedido', 'complete order'
    ];
    
    const messageNormalized = message.toLowerCase().trim();
    return mcpKeywords.some(keyword => messageNormalized.includes(keyword));
}

// Função para consultar dados do Supabase (simulação MCP simplificada)
async function executeSupabaseQuery(command, params = {}) {
    try {
        console.log('🔧 Executando consulta Supabase:', command, params);
        
        // Criar cliente Supabase
        const { createClient } = require('@supabase/supabase-js');
        
        // Auto-detect and fix swapped environment variables
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
        let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;

        if (supabaseUrl && supabaseUrl.startsWith('eyJ') && supabaseAnonKey && supabaseAnonKey.startsWith('https://')) {
            console.log('🔄 executeSupabaseQuery auto-detecting swapped SUPABASE_URL and SUPABASE_ANON_KEY - fixing automatically');
            const temp = supabaseUrl;
            supabaseUrl = supabaseAnonKey;
            supabaseAnonKey = temp;
            supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;
        }
        
        if (!supabaseUrl || !supabaseKey) {
            throw new Error('Configuração Supabase incompleta');
        }
        
        const supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        let result = null;
        
        // Comandos baseados no schema completo do TimePulse AI
        switch (command) {
            case 'list_tables':
                result = {
                    message: 'Tabelas disponíveis no TimePulse AI Database',
                    tables: [
                        'activity_logs', 'add_on_categories', 'admin_action_logs', 'buffer_mensagem',
                        'business_types', 'chat_histories', 'coupon_usage', 'coupons',
                        'custom_payment_methods', 'customers', 'deliverers', 'delivery_baixa_dia',
                        'notifications', 'order_items', 'orders', 'product_add_on_categories_link',
                        'product_add_ons', 'product_categories', 'product_to_product_add_ons_link',
                        'products', 'prompit', 'provisional_order_items', 'restaurants',
                        'system_administrators', 'system_settings', 'withdrawal_requests'
                    ],
                    categories: {
                        'core': ['restaurants', 'orders', 'order_items', 'customers'],
                        'products': ['products', 'product_categories', 'product_add_ons', 'add_on_categories'],
                        'delivery': ['deliverers', 'delivery_baixa_dia', 'withdrawal_requests'],
                        'business': ['coupons', 'coupon_usage', 'custom_payment_methods', 'business_types'],
                        'system': ['activity_logs', 'admin_action_logs', 'notifications', 'system_administrators', 'system_settings'],
                        'chat': ['chat_histories', 'prompit', 'buffer_mensagem'],
                        'temp': ['provisional_order_items']
                    }
                };
                break;
                
            case 'restaurants_data':
                if (params.instance) {
                    // Busca por instância específica (usado no webhook)
                    console.log('🔍 Buscando restaurante por instância:', params.instance);
                    
                    const { data: restaurant, error: restaurantError } = await supabaseClient
                        .from('restaurants')
                        .select(`
                            id, name, owner_name, owner_phone, business_type, 
                            city, status, plan, subscription_status, 
                            trial_days_remaining, delivery_fee,
                            opening_hours, business_phone, business_address
                        `)
                        .eq('name', params.instance)
                        .single();
                        
                    if (restaurantError && restaurantError.code !== 'PGRST116') {
                        console.log('⚠️ Erro ao buscar restaurante:', restaurantError);
                        throw restaurantError;
                    }
                    
                    result = { 
                        restaurant: restaurant,
                        found: !!restaurant
                    };
                } else {
                    // Busca geral (usado no admin)
                    const { data: restaurants, error: restaurantsError } = await supabaseClient
                        .from('restaurants')
                        .select('id, name, owner_name, owner_phone, business_type, city, status, plan, subscription_status, trial_days_remaining')
                        .limit(params.limit || 5);
                        
                    if (restaurantsError) throw restaurantsError;
                    result = { count: restaurants?.length || 0, data: restaurants };
                }
                break;
                
            case 'orders_data':
                const { data: orders, error: ordersError } = await supabaseClient
                    .from('orders')
                    .select('id, restaurant_id, customer_name, customer_phone, status, total, payment_method, payment_status, created_at')
                    .limit(params.limit || 5)
                    .order('created_at', { ascending: false });
                    
                if (ordersError) throw ordersError;
                result = { count: orders?.length || 0, data: orders };
                break;
                
            case 'order_items_data':
                const { data: orderItems, error: orderItemsError } = await supabaseClient
                    .from('order_items')
                    .select('id, order_id, product_name, quantity, price, selected_add_ons, status')
                    .limit(params.limit || 5);
                    
                if (orderItemsError) throw orderItemsError;
                result = { count: orderItems?.length || 0, data: orderItems };
                break;
                
            case 'customers_data':
                if (params.phone) {
                    // Busca por telefone específico (usado no webhook)
                    const normalizedPhone = normalizeWhatsAppJid(params.phone);
                    const phoneFormats = generatePhoneFormats(params.phone)
                        .filter(format => format !== params.phone); // Remove formato original para evitar JID
                    
                    // Máscara universal do telefone para logs (segurança)
                    const maskedPhone = maskPhoneForLog(normalizedPhone);
                    console.log('🔍 Buscando cliente por telefone:', maskedPhone);
                    console.log('📞 Tentando', phoneFormats.length, 'formatos de telefone');
                    
                    let customer = null;
                    
                    // SEGURANÇA: Verificar se restaurant_id é obrigatório
                    if (!params.restaurant_id) {
                        throw new Error('restaurant_id é obrigatório para busca de clientes');
                    }
                    
                    // Busca otimizada: uma única query com múltiplos formatos (se disponíveis)
                    if (phoneFormats.length > 0) {
                        try {
                            const { data: customers, error: searchError } = await supabaseClient
                                .from('customers')
                                .select(`
                                    id, restaurant_id, name, phone, email, address, 
                                    total_orders, total_spent, created_at
                                `)
                                .eq('restaurant_id', params.restaurant_id)
                                .in('phone', phoneFormats)
                                .limit(1);
                            
                            if (searchError) {
                                console.log('⚠️ Erro na busca otimizada:', searchError.message);
                            } else if (customers && customers.length > 0) {
                                customer = customers[0];
                                console.log(`✅ Cliente encontrado via busca otimizada`);
                            }
                        } catch (error) {
                            console.log('⚠️ Erro na busca principal:', error.message);
                        }
                    }
                    
                    // Fallback: busca com LIKE se não encontrou OU não há formatos válidos
                    if (!customer) {
                        try {
                            if (!params.restaurant_id) {
                                console.log('⚠️ Pulando busca LIKE: restaurant_id obrigatório');
                            } else {
                                const cleanDigits = params.phone.replace(/[^0-9]/g, '');
                                // Usar apenas últimos 9-11 dígitos para fallback mais seguro
                                const searchDigits = cleanDigits.slice(-11).slice(-9);
                                
                                const { data: likeResults, error: likeError } = await supabaseClient
                                    .from('customers')
                                    .select(`
                                        id, restaurant_id, name, phone, email, address, 
                                        total_orders, total_spent, created_at
                                    `)
                                    .eq('restaurant_id', params.restaurant_id)
                                    .ilike('phone', `%${searchDigits}%`)
                                    .limit(1);
                                    
                                if (likeResults && likeResults.length > 0) {
                                    customer = likeResults[0];
                                    console.log(`✅ Cliente encontrado via busca LIKE fallback`);
                                }
                            }
                        } catch (error) {
                            console.log('⚠️ Erro na busca LIKE:', error.message);
                        }
                    }
                    
                    result = { 
                        customer: customer,
                        found: !!customer,
                        normalizedPhone: normalizedPhone,
                        searchedFormats: phoneFormats.length
                    };
                } else {
                    // Busca geral (usado no admin)
                    const { data: customers, error: customersError } = await supabaseClient
                        .from('customers')
                        .select('id, restaurant_id, name, phone, email, total_orders, total_spent, created_at')
                        .limit(params.limit || 5);
                        
                    if (customersError) throw customersError;
                    result = { count: customers?.length || 0, data: customers };
                }
                break;
                
            case 'products_data':
                if (params.restaurant_id) {
                    // Busca cardápio completo para um restaurante (usado no webhook)
                    console.log('🔍 Buscando cardápio completo para restaurante:', params.restaurant_id);
                    
                    // Verificar cache primeiro
                    const cachedMenu = getFromMenuCache(params.restaurant_id);
                    if (cachedMenu) {
                        result = cachedMenu;
                        break;
                    }
                    
                    // Buscar categorias ativas
                    const { data: categories, error: categoriesError } = await supabaseClient
                        .from('product_categories')
                        .select('id, name, description, active')
                        .eq('restaurant_id', params.restaurant_id)
                        .eq('active', true)
                        .order('name');
                    
                    if (categoriesError) throw categoriesError;
                    
                    // Buscar produtos ativos com categorias
                    const { data: products, error: productsError } = await supabaseClient
                        .from('products')
                        .select(`
                            id, name, description, price, active, 
                            preparation_time, category_id,
                            category:product_categories(id, name)
                        `)
                        .eq('restaurant_id', params.restaurant_id)
                        .eq('active', true)
                        .not('category_id', 'is', null)
                        .order('name');
                        
                    if (productsError) throw productsError;
                    
                    // Buscar links de categorias de adicionais para produtos (consulta simplificada)
                    const { data: addOnLinks, error: addOnLinksError } = await supabaseClient
                        .from('product_add_on_categories_link')
                        .select(`
                            product_id,
                            add_on_category_id
                        `)
                        .in('product_id', products.map(p => p.id));
                        
                    if (addOnLinksError) {
                        console.warn('⚠️ Erro ao buscar links de adicionais:', addOnLinksError);
                        // Continuar sem adicionais em caso de erro
                    }
                    
                    // Organizar cardápio por categorias com produtos (sem adicionais por enquanto)
                    const menuStructure = {
                        categories: categories.map(cat => ({
                            ...cat,
                            products: products
                                .filter(prod => prod.category_id === cat.id)
                                .map(prod => ({
                                    ...prod,
                                    add_on_categories: addOnLinks && !addOnLinksError 
                                        ? addOnLinks.filter(link => link.product_id === prod.id).map(link => ({ id: link.add_on_category_id }))
                                        : []
                                }))
                        })).filter(cat => cat.products.length > 0),
                        total_products: products.length,
                        total_categories: categories.length
                    };
                    
                    // Salvar no cache
                    setMenuCache(params.restaurant_id, menuStructure);
                    
                    result = menuStructure;
                } else {
                    // Busca geral (usado no admin)
                    const { data: products, error: productsError } = await supabaseClient
                        .from('products')
                        .select('id, restaurant_id, name, description, price, active, preparation_time, category_id')
                        .limit(params.limit || 5);
                        
                    if (productsError) throw productsError;
                    result = { count: products?.length || 0, data: products };
                }
                break;
                
            case 'deliverers_data':
                const { data: deliverers, error: deliverersError } = await supabaseClient
                    .from('deliverers')
                    .select('id, restaurant_id, name, phone, type, status, balance, total_deliveries, rating')
                    .limit(params.limit || 5);
                    
                if (deliverersError) throw deliverersError;
                result = { count: deliverers?.length || 0, data: deliverers };
                break;
                
            case 'coupons_data':
                const { data: coupons, error: couponsError } = await supabaseClient
                    .from('coupons')
                    .select('id, restaurant_id, code, name, discount_type, discount_value, usage_count, active, valid_until')
                    .limit(params.limit || 5);
                    
                if (couponsError) throw couponsError;
                result = { count: coupons?.length || 0, data: coupons };
                break;
                
            case 'notifications_data':
                const { data: notifications, error: notificationsError } = await supabaseClient
                    .from('notifications')
                    .select('id, restaurant_id, title, message, type, read_at, created_at')
                    .limit(params.limit || 5)
                    .order('created_at', { ascending: false });
                    
                if (notificationsError) throw notificationsError;
                result = { count: notifications?.length || 0, data: notifications };
                break;
                
            case 'activity_logs_data':
                const { data: activityLogs, error: activityLogsError } = await supabaseClient
                    .from('activity_logs')
                    .select('id, restaurant_id, user_name, action, entity_type, description, created_at')
                    .limit(params.limit || 5)
                    .order('created_at', { ascending: false });
                    
                if (activityLogsError) throw activityLogsError;
                result = { count: activityLogs?.length || 0, data: activityLogs };
                break;
                
            case 'chat_histories_data':
                const { data: chatHistories, error: chatHistoriesError } = await supabaseClient
                    .from('chat_histories')
                    .select('id, session_id, message')
                    .limit(params.limit || 5);
                    
                if (chatHistoriesError) throw chatHistoriesError;
                result = { count: chatHistories?.length || 0, data: chatHistories };
                break;
                
            case 'prompit_data':
                const { data: prompit, error: prompitError } = await supabaseClient
                    .from('prompit')
                    .select('id, tipo_negocio, prompt, active, created_at')
                    .limit(params.limit || 5);
                    
                if (prompitError) throw prompitError;
                result = { count: prompit?.length || 0, data: prompit };
                break;
                
            case 'business_types_data':
                const { data: businessTypes, error: businessTypesError } = await supabaseClient
                    .from('business_types')
                    .select('id, name, description, active, created_at')
                    .limit(params.limit || 5);
                    
                if (businessTypesError) throw businessTypesError;
                result = { count: businessTypes?.length || 0, data: businessTypes };
                break;
                
            case 'system_administrators_data':
                const { data: admins, error: adminsError } = await supabaseClient
                    .from('system_administrators')
                    .select('id, email, name, role, last_login, active, created_at')
                    .limit(params.limit || 5);
                    
                if (adminsError) throw adminsError;
                result = { count: admins?.length || 0, data: admins };
                break;
                
            case 'add_on_categories_data':
                const { data: addOnCategories, error: addOnCategoriesError } = await supabaseClient
                    .from('add_on_categories')
                    .select('id, restaurant_id, name, description, selection_type, min_selection, max_selection')
                    .limit(params.limit || 5);
                    
                if (addOnCategoriesError) throw addOnCategoriesError;
                result = { count: addOnCategories?.length || 0, data: addOnCategories };
                break;
                
            case 'product_categories_data':
                const { data: productCategories, error: productCategoriesError } = await supabaseClient
                    .from('product_categories')
                    .select('id, restaurant_id, name, description, display_order, active')
                    .limit(params.limit || 5);
                    
                if (productCategoriesError) throw productCategoriesError;
                result = { count: productCategories?.length || 0, data: productCategories };
                break;
                
            case 'product_add_ons_data':
                const { data: productAddOns, error: productAddOnsError } = await supabaseClient
                    .from('product_add_ons')
                    .select('id, add_on_category_id, restaurant_id, name, price, active')
                    .limit(params.limit || 5);
                    
                if (productAddOnsError) throw productAddOnsError;
                result = { count: productAddOns?.length || 0, data: productAddOns };
                break;
                
            case 'custom_payment_methods_data':
                const { data: paymentMethods, error: paymentMethodsError } = await supabaseClient
                    .from('custom_payment_methods')
                    .select('id, restaurant_id, name, description, enabled, requires_change, icon')
                    .limit(params.limit || 5);
                    
                if (paymentMethodsError) throw paymentMethodsError;
                result = { count: paymentMethods?.length || 0, data: paymentMethods };
                break;
                
            case 'system_settings_data':
                const { data: systemSettings, error: systemSettingsError } = await supabaseClient
                    .from('system_settings')
                    .select('id, restaurant_id, setting_key, setting_value, description, updated_at')
                    .limit(params.limit || 5);
                    
                if (systemSettingsError) throw systemSettingsError;
                result = { count: systemSettings?.length || 0, data: systemSettings };
                break;
                
            case 'withdrawal_requests_data':
                const { data: withdrawalRequests, error: withdrawalRequestsError } = await supabaseClient
                    .from('withdrawal_requests')
                    .select('id, restaurant_id, deliverer_id, amount, status, bank_name, account_holder, created_at')
                    .limit(params.limit || 5);
                    
                if (withdrawalRequestsError) throw withdrawalRequestsError;
                result = { count: withdrawalRequests?.length || 0, data: withdrawalRequests };
                break;
                
            case 'delivery_baixa_dia_data':
                const { data: deliveryBaixa, error: deliveryBaixaError } = await supabaseClient
                    .from('delivery_baixa_dia')
                    .select('id, restaurant_id, deliverer_id, order_id, data_baixa, valor_pago, status')
                    .limit(params.limit || 5);
                    
                if (deliveryBaixaError) throw deliveryBaixaError;
                result = { count: deliveryBaixa?.length || 0, data: deliveryBaixa };
                break;
                
            case 'buffer_mensagem_data':
                const { data: bufferMessages, error: bufferMessagesError } = await supabaseClient
                    .from('buffer_mensagem')
                    .select('id, cell, message, idMessage, timestamp, created_at')
                    .limit(params.limit || 5)
                    .order('created_at', { ascending: false });
                    
                if (bufferMessagesError) throw bufferMessagesError;
                result = { count: bufferMessages?.length || 0, data: bufferMessages };
                break;
                
            // Comandos para criação de pedidos
            case 'create_delivery_order':
                // Validar restaurant_id da sessão (crítico para segurança multi-tenant)
                if (!params.restaurant_id) {
                    throw new Error('Restaurant ID da sessão não encontrado - falha de autenticação');
                }
                
                // Validar parâmetros obrigatórios para delivery
                if (!params.customer_name || !params.customer_phone || !params.delivery_address) {
                    throw new Error('Parâmetros obrigatórios: customer_name, customer_phone, delivery_address');
                }
                
                if (!params.items || !Array.isArray(params.items) || params.items.length === 0) {
                    throw new Error('É necessário incluir pelo menos um item no pedido');
                }
                
                // Validações de sanidade dos itens (delivery)
                for (let i = 0; i < params.items.length; i++) {
                    const item = params.items[i];
                    const quantity = parseInt(item.quantity) || 0;
                    const price = parseFloat(item.price || item.unit_price) || 0;
                    
                    if (quantity <= 0) {
                        throw new Error(`Item ${i + 1}: Quantidade deve ser maior que zero`);
                    }
                    if (price < 0) {
                        throw new Error(`Item ${i + 1}: Preço não pode ser negativo`);
                    }
                    if (!item.name && !item.product_name) {
                        throw new Error(`Item ${i + 1}: Nome do produto é obrigatório`);
                    }
                }
                
                // Criar pedido de delivery
                const deliveryOrderData = {
                    restaurant_id: params.restaurant_id, // Sempre da sessão autenticada
                    customer_name: params.customer_name.trim(),
                    customer_phone: params.customer_phone.trim(),
                    delivery_address: params.delivery_address.trim(),
                    zip_code: params.zip_code || null,
                    delivery_fee: parseFloat(params.delivery_fee) || 5.00,
                    payment_method: params.payment_method || 'PIX',
                    notes: params.notes || 'Pedido criado via MCP - Assistente Ana',
                    subtotal: params.subtotal || 0,
                    total: params.total_amount || (params.subtotal || 0) + (parseFloat(params.delivery_fee) || 5.00),
                    cash_received: params.cash_received || null,
                    status: 'novo',
                    order_type: 'delivery',
                    created_at: new Date().toISOString()
                };
                
                const { data: newDeliveryOrder, error: deliveryOrderError } = await supabaseClient
                    .from('orders')
                    .insert([deliveryOrderData])
                    .select()
                    .single();
                    
                if (deliveryOrderError) throw deliveryOrderError;
                
                // Inserir itens do pedido
                const deliveryOrderItems = params.items.map(item => ({
                    order_id: newDeliveryOrder.id,
                    product_name: item.name || item.product_name,
                    quantity: parseInt(item.quantity) || 1,
                    unit_price: parseFloat(item.price || item.unit_price) || 0,
                    total_price: (parseFloat(item.price || item.unit_price) || 0) * (parseInt(item.quantity) || 1),
                    notes: item.notes || null
                }));
                
                const { error: deliveryItemsError } = await supabaseClient
                    .from('order_items')
                    .insert(deliveryOrderItems);
                    
                if (deliveryItemsError) {
                    // Rollback: remover pedido se falha ao inserir itens
                    await supabaseClient.from('orders').delete().eq('id', newDeliveryOrder.id);
                    throw deliveryItemsError;
                }
                
                result = {
                    success: true,
                    message: 'Pedido de delivery criado com sucesso!',
                    order: newDeliveryOrder,
                    items: deliveryOrderItems
                };
                break;
                
            case 'create_counter_order':
                // Validar restaurant_id da sessão (crítico para segurança multi-tenant)
                if (!params.restaurant_id) {
                    throw new Error('Restaurant ID da sessão não encontrado - falha de autenticação');
                }
                
                // Validar parâmetros mínimos para balcão
                if (!params.items || !Array.isArray(params.items) || params.items.length === 0) {
                    throw new Error('É necessário incluir pelo menos um item no pedido');
                }
                
                // Validações de sanidade dos itens (balcão)
                for (let i = 0; i < params.items.length; i++) {
                    const item = params.items[i];
                    const quantity = parseInt(item.quantity) || 0;
                    const price = parseFloat(item.price || item.unit_price) || 0;
                    
                    if (quantity <= 0) {
                        throw new Error(`Item ${i + 1}: Quantidade deve ser maior que zero`);
                    }
                    if (price < 0) {
                        throw new Error(`Item ${i + 1}: Preço não pode ser negativo`);
                    }
                    if (!item.name && !item.product_name) {
                        throw new Error(`Item ${i + 1}: Nome do produto é obrigatório`);
                    }
                }
                
                // Criar pedido de balcão
                const counterOrderData = {
                    restaurant_id: params.restaurant_id, // Sempre da sessão autenticada
                    customer_name: params.customer_name?.trim() || 'Cliente de Balcão',
                    customer_phone: params.customer_phone?.trim() || 'N/A',
                    delivery_address: 'Balcão',
                    delivery_fee: 0,
                    payment_method: params.payment_method || 'money',
                    notes: params.notes || 'Pedido de balcão criado via MCP - Assistente Ana',
                    subtotal: params.subtotal || 0,
                    total: params.total_amount || params.subtotal || 0,
                    cash_received: params.cash_received || null,
                    status: 'novo',
                    order_type: 'balcao',
                    created_at: new Date().toISOString()
                };
                
                const { data: newCounterOrder, error: counterOrderError } = await supabaseClient
                    .from('orders')
                    .insert([counterOrderData])
                    .select()
                    .single();
                    
                if (counterOrderError) throw counterOrderError;
                
                // Inserir itens do pedido
                const counterOrderItems = params.items.map(item => ({
                    order_id: newCounterOrder.id,
                    product_name: item.name || item.product_name,
                    quantity: parseInt(item.quantity) || 1,
                    unit_price: parseFloat(item.price || item.unit_price) || 0,
                    total_price: (parseFloat(item.price || item.unit_price) || 0) * (parseInt(item.quantity) || 1),
                    notes: item.notes || null
                }));
                
                const { error: counterItemsError } = await supabaseClient
                    .from('order_items')
                    .insert(counterOrderItems);
                    
                if (counterItemsError) {
                    // Rollback: remover pedido se falha ao inserir itens
                    await supabaseClient.from('orders').delete().eq('id', newCounterOrder.id);
                    throw counterItemsError;
                }
                
                result = {
                    success: true,
                    message: 'Pedido de balcão criado com sucesso!',
                    order: newCounterOrder,
                    items: counterOrderItems
                };
                break;
                
            default:
                result = { 
                    message: 'Comando não reconhecido. Tools disponíveis:',
                    tools: [
                        'list_tables', 'restaurants_data', 'orders_data', 'order_items_data',
                        'customers_data', 'products_data', 'deliverers_data', 'coupons_data',
                        'notifications_data', 'activity_logs_data', 'chat_histories_data',
                        'prompit_data', 'business_types_data', 'system_administrators_data',
                        'add_on_categories_data', 'product_categories_data', 'product_add_ons_data',
                        'custom_payment_methods_data', 'system_settings_data', 'withdrawal_requests_data',
                        'delivery_baixa_dia_data', 'buffer_mensagem_data',
                        // Comandos para criação de pedidos
                        'create_delivery_order', 'create_counter_order'
                    ],
                    order_creation: {
                        delivery: {
                            command: 'create_delivery_order',
                            required: ['customer_name', 'customer_phone', 'delivery_address', 'items'],
                            optional: ['delivery_fee', 'payment_method', 'notes', 'zip_code']
                        },
                        counter: {
                            command: 'create_counter_order',
                            required: ['items'],
                            optional: ['customer_name', 'customer_phone', 'payment_method', 'notes']
                        }
                    }
                };
        }
        
        console.log('✅ Consulta Supabase executada com sucesso');
        return result;
        
    } catch (error) {
        console.error('❌ Erro ao consultar Supabase:', error);
        throw error;
    }
}

// Endpoint para ativar MCP via palavra-chave
app.post('/api/mcp/activate', authenticateEvolutionAPI, rateLimitEvolutionAPI(10), csrfProtection, async (req, res) => {
    try {
        const { message } = req.body;
        
        console.log('🔧 Tentativa de ativação MCP:', { message });
        
        // Verificar se a mensagem contém palavras-chave MCP
        if (message && !detectMCPKeywords(message)) {
            return res.json({
                mcpActivated: false,
                response: 'Nenhuma palavra-chave de database detectada. Tente: "dados", "consulta", "banco de dados"',
                keywords: ['mcp', 'database', 'banco de dados', 'consulta', 'dados']
            });
        }
        
        // Determinar comando seguro baseado na mensagem (não aceitar comando arbitrário)
        let queryCommand = 'list_tables';
        let queryParams = { limit: 5 };
        
        if (message) {
            const msg = message.toLowerCase();
            
            // Prioridade 1: Comandos de criação de pedidos
            if (msg.includes('criar pedido') || msg.includes('novo pedido') || msg.includes('fazer pedido') || 
                msg.includes('create order') || msg.includes('new order') || msg.includes('finalizar pedido')) {
                
                if (msg.includes('delivery') || msg.includes('entrega')) {
                    queryCommand = 'create_delivery_order';
                } else if (msg.includes('balcao') || msg.includes('balcão') || msg.includes('counter')) {
                    queryCommand = 'create_counter_order';
                } else {
                    // Se não especificar tipo, assumir delivery como padrão
                    queryCommand = 'create_delivery_order';
                }
                
            // Prioridade 2: Consultas de dados existentes
            } else if (msg.includes('restaurante') || msg.includes('restaurant')) {
                queryCommand = 'restaurants_data';
            } else if (msg.includes('pedido') || msg.includes('order')) {
                queryCommand = 'orders_data';
            } else if (msg.includes('item') || msg.includes('product') || msg.includes('produto')) {
                if (msg.includes('pedido') || msg.includes('order')) {
                    queryCommand = 'order_items_data';
                } else {
                    queryCommand = 'products_data';
                }
            } else if (msg.includes('cliente') || msg.includes('customer')) {
                queryCommand = 'customers_data';
            } else if (msg.includes('entregador') || msg.includes('deliverer') || msg.includes('delivery')) {
                queryCommand = 'deliverers_data';
            } else if (msg.includes('cupom') || msg.includes('coupon') || msg.includes('desconto')) {
                queryCommand = 'coupons_data';
            } else if (msg.includes('notifica') || msg.includes('notification')) {
                queryCommand = 'notifications_data';
            } else if (msg.includes('log') || msg.includes('atividade') || msg.includes('activity')) {
                queryCommand = 'activity_logs_data';
            } else if (msg.includes('chat') || msg.includes('conversa') || msg.includes('message')) {
                queryCommand = 'chat_histories_data';
            } else if (msg.includes('prompt') || msg.includes('prompit') || msg.includes('negocio')) {
                queryCommand = 'prompit_data';
            } else if (msg.includes('tipo') && msg.includes('negocio')) {
                queryCommand = 'business_types_data';
            } else if (msg.includes('admin') || msg.includes('administrador')) {
                queryCommand = 'system_administrators_data';
            } else if (msg.includes('usuario') || msg.includes('user')) {
                queryCommand = 'customers_data';
            }
        }
        
        // Adicionar restaurant_id da sessão de forma segura para comandos que precisam
        if (queryCommand.includes('create_') || queryCommand.includes('_data')) {
            if (!req.session?.restaurantId) {
                return res.status(401).json({
                    mcpActivated: false,
                    error: 'Sessão de restaurante não encontrada',
                    details: 'É necessário estar logado em um restaurante para usar o MCP'
                });
            }
            queryParams.restaurant_id = req.session.restaurantId;
        }
        
        // Executar consulta Supabase
        let queryResult = null;
        try {
            queryResult = await executeSupabaseQuery(queryCommand, queryParams);
        } catch (queryError) {
            console.error('❌ Erro na consulta Supabase:', queryError);
            return res.json({
                mcpActivated: true,
                response: 'Erro ao consultar dados do banco. Tente novamente.',
                error: queryError.message
            });
        }
        
        // Resposta no formato esperado pelo frontend
        const formattedData = queryResult ? JSON.stringify(queryResult, null, 2) : 'Nenhum dado encontrado';
        
        res.json({
            mcpActivated: true,
            response: `🔧 **Database Query Ativado**\n\nConsulta: ${queryCommand}\nResultados:\n\`\`\`\n${formattedData}\n\`\`\`\n\nComo posso ajudar com esses dados?`,
            data: queryResult,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Erro ao ativar MCP:', error);
        res.status(500).json({
            error: 'Erro interno ao ativar MCP',
            details: error.message
        });
    }
});

// Endpoint para processar mensagem com MCP integrado
app.post('/api/mcp/process', authenticateEvolutionAPI, rateLimitEvolutionAPI(20), csrfProtection, async (req, res) => {
    try {
        const { message } = req.body; // Remover restaurantId do body para evitar spoofing
        
        console.log('💬 Processando mensagem com MCP:', { message, sessionRestaurantId: req.session?.restaurantId });
        
        // Verificar se deve ativar MCP
        const shouldActivateMCP = detectMCPKeywords(message);
        let mcpData = null;
        
        if (shouldActivateMCP) {
            console.log('🔧 Palavra-chave MCP detectada, ativando...');
            
            try {
                // Determinar comando baseado na mensagem
                let queryCommand = 'list_tables';
                let queryParams = { limit: 5 };
                
                const msg = message.toLowerCase();
                // Prioridade 1: Comandos de criação de pedidos
                if (msg.includes('criar pedido') || msg.includes('novo pedido') || msg.includes('fazer pedido') || 
                    msg.includes('create order') || msg.includes('new order') || msg.includes('finalizar pedido')) {
                    
                    if (msg.includes('delivery') || msg.includes('entrega')) {
                        queryCommand = 'create_delivery_order';
                    } else if (msg.includes('balcao') || msg.includes('balcão') || msg.includes('counter')) {
                        queryCommand = 'create_counter_order';
                    } else {
                        // Se não especificar tipo, assumir delivery como padrão
                        queryCommand = 'create_delivery_order';
                    }
                    
                // Prioridade 2: Consultas de dados existentes
                } else if (msg.includes('restaurante') || msg.includes('restaurant')) {
                    queryCommand = 'restaurants_data';
                } else if (msg.includes('pedido') || msg.includes('order')) {
                    queryCommand = 'orders_data';
                } else if (msg.includes('item') || msg.includes('produto') || msg.includes('product')) {
                    if (msg.includes('pedido') || msg.includes('order')) {
                        queryCommand = 'order_items_data';
                    } else {
                        queryCommand = 'products_data';
                    }
                } else if (msg.includes('cliente') || msg.includes('customer')) {
                    queryCommand = 'customers_data';
                } else if (msg.includes('entregador') || msg.includes('deliverer') || msg.includes('delivery')) {
                    queryCommand = 'deliverers_data';
                } else if (msg.includes('cupom') || msg.includes('coupon') || msg.includes('desconto')) {
                    queryCommand = 'coupons_data';
                } else if (msg.includes('notifica') || msg.includes('notification')) {
                    queryCommand = 'notifications_data';
                } else if (msg.includes('log') || msg.includes('atividade') || msg.includes('activity')) {
                    queryCommand = 'activity_logs_data';
                } else if (msg.includes('chat') || msg.includes('conversa') || msg.includes('message')) {
                    queryCommand = 'chat_histories_data';
                } else if (msg.includes('prompt') || msg.includes('prompit') || msg.includes('negocio')) {
                    queryCommand = 'prompit_data';
                } else if (msg.includes('tipo') && msg.includes('negocio')) {
                    queryCommand = 'business_types_data';
                } else if (msg.includes('admin') || msg.includes('administrador')) {
                    queryCommand = 'system_administrators_data';
                } else if (msg.includes('usuario') || msg.includes('user')) {
                    queryCommand = 'customers_data';
                }
                
                // Adicionar restaurant_id da sessão de forma segura para comandos que precisam
                if (queryCommand.includes('create_') || queryCommand.includes('_data')) {
                    if (!req.session?.restaurantId) {
                        throw new Error('Sessão de restaurante não encontrada - necessário estar logado');
                    }
                    queryParams.restaurant_id = req.session.restaurantId;
                }
                
                mcpData = await executeSupabaseQuery(queryCommand, queryParams);
                
            } catch (mcpError) {
                console.warn('⚠️ Erro ao executar MCP, continuando sem dados:', mcpError.message);
                mcpData = `Erro ao consultar dados: ${mcpError.message}`;
            }
        }
        
        // Processar mensagem normalmente, mas incluir dados MCP se disponível
        let responseMessage;
        
        if (shouldActivateMCP && mcpData) {
            responseMessage = `🔧 **MCP Ativado** 

Dados consultados no banco:
${typeof mcpData === 'string' ? mcpData : JSON.stringify(mcpData, null, 2)}

Como posso ajudar você com esses dados?`;
        } else {
            // Processar como mensagem normal
            responseMessage = `Recebi sua mensagem: "${message}". ${shouldActivateMCP ? 'Palavras-chave de database detectadas, mas não foi possível consultar os dados no momento.' : 'Como posso ajudar?'}`;
        }
        
        res.json({
            response: responseMessage,
            mcpActivated: shouldActivateMCP,
            mcpData: mcpData,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Erro ao processar chat com MCP:', error);
        res.status(500).json({
            error: 'Erro ao processar mensagem',
            details: error.message
        });
    }
});

// Endpoint para configurar MCP
app.get('/api/mcp/config', (req, res) => {
    res.json({
        status: 'available',
        version: '2.0',
        description: 'TimePulse AI MCP Server - Acesso completo ao banco de dados',
        keywords: [
            'mcp', 'database', 'banco de dados', 'consulta', 'query', 
            'tabela', 'dados', 'sql', 'supabase', 'buscar dados', 
            'verificar banco', 'consultar base', 'dados do sistema',
            'restaurante', 'restaurant', 'pedido', 'order', 'cliente', 'customer',
            'produto', 'product', 'entregador', 'deliverer', 'delivery',
            'cupom', 'coupon', 'desconto', 'notificacao', 'notification',
            'log', 'atividade', 'activity', 'chat', 'conversa', 'message',
            'prompt', 'prompit', 'administrador', 'admin', 'usuario', 'user',
            'tipo negocio', 'business type', 'relatorio', 'report', 'estatistica'
        ],
        tools: [
            'list_tables', 'restaurants_data', 'orders_data', 'order_items_data',
            'customers_data', 'products_data', 'deliverers_data', 'coupons_data',
            'notifications_data', 'activity_logs_data', 'chat_histories_data',
            'prompit_data', 'business_types_data', 'system_administrators_data',
            'add_on_categories_data', 'product_categories_data', 'product_add_ons_data',
            'custom_payment_methods_data', 'system_settings_data', 'withdrawal_requests_data',
            'delivery_baixa_dia_data', 'buffer_mensagem_data'
        ],
        supabaseConfigured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
        projectRef: process.env.SUPABASE_URL?.split('//')[1]?.split('.')[0] || 'sguirxaunajirfvlzbac',
        timestamp: new Date().toISOString()
    });
});

// =================================================================
// END MCP INTEGRATION
// =================================================================

// =================================================================
// SISTEMA DE VERIFICAÇÃO AUTOMÁTICA DE ASSINATURAS VENCIDAS
// =================================================================

/**
 * Verifica assinaturas vencidas e atualiza status automaticamente
 * - Verifica restaurants com subscription_status = 'active'
 * - Usa timezone America/Sao_Paulo
 * - Se passaram 2 dias do vencimento → muda para 'expired'
 */
async function checkExpiredSubscriptions() {
    try {
        console.log('🔍 [SUBSCRIPTION CHECK] Iniciando verificação de assinaturas vencidas...');
        
        // Data atual no timezone America/Sao_Paulo
        const nowBrazil = new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
        const currentDate = new Date(nowBrazil);
        
        console.log(`📅 [SUBSCRIPTION CHECK] Data atual (America/Sao_Paulo): ${currentDate.toISOString()}`);
        
        // Buscar todos os restaurantes com assinatura ativa
        const { data: restaurants, error } = await supabaseAdmin
            .from('restaurants')
            .select('id, name, subscription_status, subscription_end_date')
            .eq('subscription_status', 'active');
        
        if (error) {
            console.error('❌ [SUBSCRIPTION CHECK] Erro ao buscar restaurantes:', error);
            return;
        }
        
        if (!restaurants || restaurants.length === 0) {
            console.log('ℹ️ [SUBSCRIPTION CHECK] Nenhum restaurante com assinatura ativa encontrado');
            return;
        }
        
        console.log(`📋 [SUBSCRIPTION CHECK] Verificando ${restaurants.length} restaurante(s) com assinatura ativa`);
        
        let expiredCount = 0;
        
        // Verificar cada restaurante
        for (const restaurant of restaurants) {
            if (!restaurant.subscription_end_date) {
                console.log(`⚠️ [SUBSCRIPTION CHECK] Restaurante ${restaurant.name} (${restaurant.id}) sem data de vencimento`);
                continue;
            }
            
            const endDate = new Date(restaurant.subscription_end_date);
            
            // Calcular diferença em dias
            const diffTime = currentDate - endDate;
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            
            console.log(`   📊 ${restaurant.name}: vencimento ${endDate.toLocaleDateString('pt-BR')}, diferença: ${diffDays} dias`);
            
            // Se passaram 2 ou mais dias após o vencimento
            if (diffDays >= 2) {
                console.log(`   ⏰ ${restaurant.name}: VENCIDO há ${diffDays} dias - atualizando status para 'expired'`);
                
                // Atualizar status para expired
                const { error: updateError } = await supabaseAdmin
                    .from('restaurants')
                    .update({ 
                        subscription_status: 'expired',
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', restaurant.id);
                
                if (updateError) {
                    console.error(`   ❌ Erro ao atualizar ${restaurant.name}:`, updateError);
                } else {
                    console.log(`   ✅ ${restaurant.name}: Status atualizado para 'expired'`);
                    expiredCount++;
                }
            } else if (diffDays >= 0) {
                console.log(`   ⚠️ ${restaurant.name}: Vencido há ${diffDays} dia(s) - aguardando 2 dias para expirar`);
            } else {
                console.log(`   ✅ ${restaurant.name}: Ativo, vence em ${Math.abs(diffDays)} dia(s)`);
            }
        }
        
        console.log(`✅ [SUBSCRIPTION CHECK] Verificação concluída: ${expiredCount} assinatura(s) expirada(s)`);
        
    } catch (error) {
        console.error('❌ [SUBSCRIPTION CHECK] Erro na verificação:', error);
    }
}

// Endpoint manual para verificar assinaturas vencidas (útil para testes)
app.post('/api/admin/check-expired-subscriptions', async (req, res) => {
    try {
        await checkExpiredSubscriptions();
        res.json({ 
            success: true, 
            message: 'Verificação de assinaturas vencidas executada com sucesso',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Endpoint para verificar vencimento de assinatura individual
app.post('/api/admin/check-subscription-expiration/:restaurantId', async (req, res) => {
    try {
        const { restaurantId } = req.params;
        
        console.log(`🔍 [INDIVIDUAL CHECK] Verificando vencimento do restaurante: ${restaurantId}`);
        
        // Data atual no timezone America/Sao_Paulo
        const nowBrazil = new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
        const currentDate = new Date(nowBrazil);
        
        // Buscar restaurante específico
        const { data: restaurant, error } = await supabaseAdmin
            .from('restaurants')
            .select('id, name, subscription_status, subscription_end_date')
            .eq('id', restaurantId)
            .single();
        
        if (error) {
            console.error('❌ [INDIVIDUAL CHECK] Erro ao buscar restaurante:', error);
            return res.status(404).json({ 
                success: false,
                error: 'Restaurante não encontrado',
                details: error.message 
            });
        }
        
        if (!restaurant) {
            return res.status(404).json({ 
                success: false,
                error: 'Restaurante não encontrado' 
            });
        }
        
        console.log(`📋 [INDIVIDUAL CHECK] Restaurante: ${restaurant.name}, Status: ${restaurant.subscription_status}`);
        
        // Se não for assinatura ativa, apenas informar
        if (restaurant.subscription_status !== 'active') {
            return res.json({
                success: true,
                updated: false,
                message: `Assinatura não está ativa. Status atual: ${restaurant.subscription_status}`,
                currentStatus: restaurant.subscription_status
            });
        }
        
        // Verificar data de vencimento
        if (!restaurant.subscription_end_date) {
            return res.json({
                success: true,
                updated: false,
                message: 'Assinatura ativa sem data de vencimento definida',
                currentStatus: restaurant.subscription_status
            });
        }
        
        const endDate = new Date(restaurant.subscription_end_date);
        const diffTime = currentDate - endDate;
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        
        console.log(`📅 [INDIVIDUAL CHECK] Data de vencimento: ${endDate.toLocaleDateString('pt-BR')}, Diferença: ${diffDays} dias`);
        
        // Se passaram 2 ou mais dias após o vencimento, marcar como expirada
        if (diffDays >= 2) {
            console.log(`⏰ [INDIVIDUAL CHECK] VENCIDO há ${diffDays} dias - atualizando para 'expired'`);
            
            const { error: updateError } = await supabaseAdmin
                .from('restaurants')
                .update({ 
                    subscription_status: 'expired',
                    updated_at: new Date().toISOString()
                })
                .eq('id', restaurant.id);
            
            if (updateError) {
                console.error('❌ [INDIVIDUAL CHECK] Erro ao atualizar status:', updateError);
                throw updateError;
            }
            
            console.log(`✅ [INDIVIDUAL CHECK] Status atualizado para 'expired'`);
            
            return res.json({
                success: true,
                updated: true,
                message: `Assinatura vencida há ${diffDays} dias`,
                daysExpired: diffDays,
                previousStatus: 'active',
                newStatus: 'expired',
                expirationDate: endDate.toLocaleDateString('pt-BR')
            });
        } else {
            const daysUntilExpiration = Math.abs(diffDays);
            const message = diffDays < 0 
                ? `Assinatura ativa, vence em ${daysUntilExpiration} dia(s)` 
                : `Assinatura venceu há ${diffDays} dia(s), aguardando prazo de 2 dias`;
            
            console.log(`✅ [INDIVIDUAL CHECK] ${message}`);
            
            return res.json({
                success: true,
                updated: false,
                message: message,
                daysUntilExpiration: diffDays < 0 ? daysUntilExpiration : null,
                daysExpired: diffDays >= 0 ? diffDays : null,
                currentStatus: restaurant.subscription_status,
                expirationDate: endDate.toLocaleDateString('pt-BR')
            });
        }
        
    } catch (error) {
        console.error('❌ [INDIVIDUAL CHECK] Erro na verificação:', error);
        res.status(500).json({ 
            success: false,
            error: 'Erro ao verificar vencimento',
            details: error.message 
        });
    }
});

// Executar verificação a cada 6 horas (21600000 ms)
const SUBSCRIPTION_CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 horas

// Executar primeira verificação após 1 minuto do servidor iniciar
setTimeout(() => {
    console.log('🚀 [SUBSCRIPTION CHECK] Executando primeira verificação de assinaturas...');
    checkExpiredSubscriptions();
}, 60000);

// Agendar verificações periódicas
setInterval(() => {
    console.log('⏰ [SUBSCRIPTION CHECK] Executando verificação periódica de assinaturas...');
    checkExpiredSubscriptions();
}, SUBSCRIPTION_CHECK_INTERVAL);

console.log('⏱️ [SUBSCRIPTION CHECK] Sistema de verificação automática configurado (a cada 6 horas)');

// =================================================================
// END SUBSCRIPTION CHECK SYSTEM
// =================================================================

// Inicialização do servidor
app.listen(PORT, HOST, () => {
    console.log(`✅ Servidor TimePulse AI rodando em http://${HOST}:${PORT}`);
    console.log(`   Servidor iniciado em: ${new Date().toLocaleString()}`);
    console.log(`📊 Ambiente: ${NODE_ENV || 'development'}`);
    console.log(`🔒 Modo de segurança: ${(NODE_ENV || 'development') === 'production' ? 'Produção' : 'Desenvolvimento'}`);
    console.log(`🛡️ Sistema administrativo: Endpoints /api/admin/* disponíveis`);
    console.log(`💳 Sistema de assinaturas: Endpoints /api/asaas/* disponíveis`);
    console.log(`🔧 Sistema MCP: Endpoints /api/mcp/* disponíveis`);
    console.log(`📅 Sistema de verificação de assinaturas: Ativo (a cada 6 horas)`);
});