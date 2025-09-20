#!/bin/bash

# =============================================================================
# TimePulse AI - Script de Instalação Completa VPS Docker
# Versão: 2.0 - Projeto Completo com Todas as APIs
# =============================================================================

set -euo pipefail

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Funções de log
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${PURPLE}[STEP]${NC} $1"
}

# Banner
echo -e "${BLUE}"
cat << "EOF"
 ╔═══════════════════════════════════════════════════════╗
 ║               TimePulse AI Installer                 ║
 ║          Instalação Completa Docker VPS              ║
 ║              com Todas as APIs                       ║
 ╚═══════════════════════════════════════════════════════╝
EOF
echo -e "${NC}"

# Verificações iniciais
log_info "Verificando sistema operacional..."
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    log_error "Este script funciona apenas no Linux"
    exit 1
fi

# Verificar se é Debian/Ubuntu e detectar versão
log_info "Verificando distribuição Linux..."
if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    log_info "Distribuição detectada: $NAME $VERSION"
    if [[ "$ID" =~ ^(debian|ubuntu)$ ]]; then
        if [[ "$ID" == "debian" && "$VERSION_ID" == "12" ]]; then
            log_success "Debian 12 (Bookworm) detectado - totalmente suportado"
            DEBIAN_BOOKWORM=true
        elif [[ "$ID" == "ubuntu" && "$VERSION_ID" =~ ^(20|22|24)\.04$ ]]; then
            log_success "Ubuntu LTS detectado - suportado"
            DEBIAN_BOOKWORM=false
        else
            log_warning "Versão do sistema pode não ser totalmente testada"
            DEBIAN_BOOKWORM=false
        fi
    else
        log_warning "Distribuição não testada - pode haver problemas de compatibilidade"
        DEBIAN_BOOKWORM=false
    fi
else
    log_warning "Não foi possível detectar a distribuição"
    DEBIAN_BOOKWORM=false
fi

# Verificar se está rodando como root
if [[ $EUID -eq 0 ]]; then
    log_warning "Rodando como root. Criando usuário dedicado..."
    useradd -m -s /bin/bash timepulse || true
    usermod -aG sudo timepulse || true
fi

# Funções de verificação Docker
check_docker_installation() {
    log_step "Verificando instalação do Docker..."
    
    if command -v docker &> /dev/null; then
        DOCKER_VERSION=$(docker --version | cut -d' ' -f3 | cut -d',' -f1)
        log_success "Docker já instalado - Versão: $DOCKER_VERSION"
        return 0
    else
        log_warning "Docker não encontrado - será instalado"
        return 1
    fi
}

check_docker_compose_installation() {
    log_step "Verificando Docker Compose..."
    
    # Verificar Docker Compose v2 (plugin) primeiro
    if docker compose version &> /dev/null; then
        COMPOSE_VERSION=$(docker compose version --short 2>/dev/null || docker compose version | head -1 | cut -d' ' -f4)
        log_success "Docker Compose v2 (plugin) já instalado - Versão: $COMPOSE_VERSION"
        USE_COMPOSE_V2=true
        return 0
    # Fallback para Docker Compose v1 (legacy)
    elif command -v docker-compose &> /dev/null; then
        COMPOSE_VERSION=$(docker-compose --version | cut -d' ' -f3 | cut -d',' -f1)
        log_success "Docker Compose v1 (legacy) encontrado - Versão: $COMPOSE_VERSION"
        USE_COMPOSE_V2=false
        return 0
    else
        log_warning "Docker Compose não encontrado - será instalado"
        USE_COMPOSE_V2=true
        return 1
    fi
}

check_docker_daemon() {
    log_step "Verificando daemon do Docker..."
    
    if systemctl is-active --quiet docker; then
        log_success "Docker daemon está ativo"
        return 0
    elif service docker status &> /dev/null; then
        log_success "Docker daemon está ativo (usando service)"
        return 0
    else
        log_warning "Docker daemon não está ativo - tentando iniciar..."
        systemctl start docker || service docker start || {
            log_error "Não foi possível iniciar o Docker daemon"
            exit 1
        }
        return 1
    fi
}

check_portainer_instance() {
    log_step "Verificando instância do Portainer..."
    
    # Verificar se há containers do Portainer rodando
    if docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -i portainer | head -5; then
        log_success "Instância do Portainer encontrada"
        
        # Verificar se há networks existentes que possamos usar
        EXISTING_NETWORKS=$(docker network ls --format "{{.Name}}" | grep -v bridge | grep -v host | grep -v none)
        if [[ -n "$EXISTING_NETWORKS" ]]; then
            log_info "Networks Docker existentes encontradas:"
            echo "$EXISTING_NETWORKS" | while read network; do
                log_info "  - $network"
            done
        fi
        
        # Verificar se o Portainer tem alguma rede específica
        PORTAINER_NETWORKS=$(docker inspect $(docker ps --filter name=portainer --format "{{.Names}}" | head -1) 2>/dev/null | jq -r '.[0].NetworkSettings.Networks | keys[]' 2>/dev/null || echo "")
        if [[ -n "$PORTAINER_NETWORKS" ]]; then
            log_info "Redes do Portainer detectadas:"
            echo "$PORTAINER_NETWORKS" | while read network; do
                log_info "  - $network"
            done
        fi
        
        return 0
    else
        log_warning "Portainer não encontrado - TimePulse AI será instalado sem integração direta"
        return 1
    fi
}

get_portainer_integration_settings() {
    log_step "Configurando integração com ambiente Docker existente..."
    
    # Detectar rede principal (primeira rede que não seja as padrões)
    MAIN_NETWORK=$(docker network ls --format "{{.Name}}" | grep -v -E '^(bridge|host|none)$' | head -1)
    
    if [[ -n "$MAIN_NETWORK" ]]; then
        log_info "Usando rede existente: $MAIN_NETWORK"
        USE_EXISTING_NETWORK="yes"
        NETWORK_NAME="$MAIN_NETWORK"
    else
        log_info "Criando nova rede para TimePulse AI: timepulse-network"
        USE_EXISTING_NETWORK="no"
        NETWORK_NAME="timepulse-network"
    fi
    
    # Detectar e analisar Traefik em detalhes
    detect_traefik_details
    
    # Detectar outros proxies reversos se Traefik não estiver ativo
    if [[ $REVERSE_PROXY != "traefik" ]]; then
        if docker ps --format "{{.Names}}" | grep -i nginx-proxy; then
            REVERSE_PROXY="nginx-proxy"
            log_info "Nginx Proxy Manager detectado"
        elif docker ps --format "{{.Names}}" | grep -i caddy; then
            REVERSE_PROXY="caddy"
            log_info "Caddy detectado como proxy reverso"
        else
            REVERSE_PROXY="internal"
            log_info "Nenhum proxy reverso detectado - usando Nginx interno"
        fi
    fi
}

detect_traefik_details() {
    log_step "Analisando configuração do Traefik..."
    
    # Verificar se há containers Traefik rodando
    TRAEFIK_CONTAINERS=$(docker ps --filter name=traefik --format "{{.Names}}" 2>/dev/null)
    
    if [[ -z "$TRAEFIK_CONTAINERS" ]]; then
        log_warning "Traefik não encontrado ou não está rodando"
        REVERSE_PROXY="internal"
        return 1
    fi
    
    # Pegar o primeiro container Traefik encontrado
    TRAEFIK_CONTAINER=$(echo "$TRAEFIK_CONTAINERS" | head -1)
    log_success "Container Traefik encontrado: $TRAEFIK_CONTAINER"
    
    # Analisar configuração do container Traefik
    TRAEFIK_INFO=$(docker inspect "$TRAEFIK_CONTAINER" 2>/dev/null)
    
    if [[ -z "$TRAEFIK_INFO" ]]; then
        log_error "Erro ao inspecionar container Traefik"
        REVERSE_PROXY="internal"
        return 1
    fi
    
    # Extrair informações importantes
    TRAEFIK_NETWORKS=$(echo "$TRAEFIK_INFO" | jq -r '.[0].NetworkSettings.Networks | keys[]' 2>/dev/null | grep -v bridge | head -3)
    TRAEFIK_PORTS=$(echo "$TRAEFIK_INFO" | jq -r '.[0].NetworkSettings.Ports | keys[]' 2>/dev/null)
    TRAEFIK_LABELS=$(echo "$TRAEFIK_INFO" | jq -r '.[0].Config.Labels | keys[]' 2>/dev/null | grep -E "(traefik|domain)" | head -5)
    
    # Detectar rede principal do Traefik
    if [[ -n "$TRAEFIK_NETWORKS" ]]; then
        TRAEFIK_MAIN_NETWORK=$(echo "$TRAEFIK_NETWORKS" | head -1)
        log_info "Rede principal do Traefik: $TRAEFIK_MAIN_NETWORK"
        
        # Usar a mesma rede do Traefik
        MAIN_NETWORK="$TRAEFIK_MAIN_NETWORK"
        USE_EXISTING_NETWORK="yes"
        NETWORK_NAME="$TRAEFIK_MAIN_NETWORK"
    fi
    
    # Verificar se Traefik tem configuração de certificados SSL
    TRAEFIK_SSL_CONFIG=$(echo "$TRAEFIK_INFO" | jq -r '.[0].Mounts[] | select(.Destination | contains("acme") or contains("ssl") or contains("certs")) | .Source' 2>/dev/null | head -1)
    if [[ -n "$TRAEFIK_SSL_CONFIG" ]]; then
        log_info "Configuração SSL do Traefik encontrada: $TRAEFIK_SSL_CONFIG"
        TRAEFIK_HAS_SSL="yes"
    else
        TRAEFIK_HAS_SSL="no"
    fi
    
    # Verificar se Traefik está configurado para Let's Encrypt
    TRAEFIK_ACME_CONFIG=$(docker logs "$TRAEFIK_CONTAINER" 2>/dev/null | grep -i "acme\|letsencrypt" | head -2)
    if [[ -n "$TRAEFIK_ACME_CONFIG" ]]; then
        log_info "Traefik configurado com Let's Encrypt automático"
        TRAEFIK_ACME_ENABLED="yes"
    else
        TRAEFIK_ACME_ENABLED="no"
    fi
    
    # Detectar versão do Traefik
    TRAEFIK_VERSION=$(docker exec "$TRAEFIK_CONTAINER" traefik version 2>/dev/null | grep "Version:" | cut -d' ' -f2 || echo "unknown")
    log_info "Versão do Traefik: $TRAEFIK_VERSION"
    
    # Verificar dashboard do Traefik
    TRAEFIK_DASHBOARD_PORT=$(echo "$TRAEFIK_PORTS" | grep "8080" || echo "")
    if [[ -n "$TRAEFIK_DASHBOARD_PORT" ]]; then
        log_info "Dashboard do Traefik disponível na porta 8080"
        TRAEFIK_DASHBOARD="yes"
    else
        TRAEFIK_DASHBOARD="no"
    fi
    
    REVERSE_PROXY="traefik"
    log_success "✅ Traefik totalmente detectado e analisado"
    
    # Mostrar resumo da configuração detectada
    log_info "=== CONFIGURAÇÃO TRAEFIK DETECTADA ==="
    log_info "Container: $TRAEFIK_CONTAINER"
    log_info "Versão: $TRAEFIK_VERSION"
    log_info "Rede principal: $TRAEFIK_MAIN_NETWORK"
    log_info "SSL/ACME: $TRAEFIK_ACME_ENABLED"
    log_info "Dashboard: $TRAEFIK_DASHBOARD"
    echo ""
    
    return 0
}

validate_traefik_integration() {
    log_info "Validando configuração de integração com Traefik..."
    
    # Verificar se a rede do Traefik existe
    if [[ -n "$NETWORK_NAME" ]]; then
        if docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
            log_success "✅ Rede $NETWORK_NAME confirmada e acessível"
        else
            log_error "❌ Rede $NETWORK_NAME não encontrada"
            return 1
        fi
    fi
    
    # Verificar conectividade com container Traefik
    if [[ -n "$TRAEFIK_CONTAINER" ]]; then
        if docker exec "$TRAEFIK_CONTAINER" traefik version >/dev/null 2>&1; then
            log_success "✅ Container Traefik respondendo"
        else
            log_warning "⚠️ Container Traefik pode estar com problemas"
        fi
        
        # Verificar logs do Traefik para erros
        TRAEFIK_ERRORS=$(docker logs "$TRAEFIK_CONTAINER" --tail=50 2>&1 | grep -i "error\|failed" | head -3)
        if [[ -n "$TRAEFIK_ERRORS" ]]; then
            log_warning "⚠️ Possíveis erros detectados nos logs do Traefik:"
            echo "$TRAEFIK_ERRORS" | while read line; do
                log_warning "   $line"
            done
        else
            log_success "✅ Logs do Traefik sem erros críticos"
        fi
    fi
    
    # Verificar se os domínios estão configurados no DNS (ping básico)
    if ping -c 1 "$DOMAIN" >/dev/null 2>&1; then
        log_success "✅ Domínio $DOMAIN resolve corretamente"
    else
        log_warning "⚠️ Domínio $DOMAIN não resolve - verifique DNS"
    fi
    
    if ping -c 1 "$API_DOMAIN" >/dev/null 2>&1; then
        log_success "✅ Domínio API $API_DOMAIN resolve corretamente"
    else
        log_warning "⚠️ Domínio API $API_DOMAIN não resolve - verifique DNS"
    fi
    
    log_success "Validação de integração concluída"
    return 0
}

test_traefik_integration() {
    log_step "Testando integração com Traefik..."
    
    # Aguardar containers iniciarem
    log_info "Aguardando containers iniciarem..."
    sleep 30
    
    # Testar se API está respondendo através do Traefik
    if curl -k -s "https://$API_DOMAIN/api/health" >/dev/null 2>&1; then
        log_success "✅ API acessível através do Traefik: https://$API_DOMAIN"
    else
        log_warning "⚠️ API não está acessível através do Traefik ainda"
        log_info "Isto é normal nos primeiros minutos. Certificados podem estar sendo gerados."
    fi
    
    # Testar frontend
    if curl -k -s "https://$DOMAIN" >/dev/null 2>&1; then
        log_success "✅ Frontend acessível através do Traefik: https://$DOMAIN"
    else
        log_warning "⚠️ Frontend não está acessível através do Traefik ainda"
    fi
    
    # Verificar se o Traefik está vendo o container
    TRAEFIK_SERVICES=$(docker exec "$TRAEFIK_CONTAINER" wget -qO- "http://localhost:8080/api/http/services" 2>/dev/null | jq -r '.[] | select(.name | contains("timepulse")) | .name' 2>/dev/null || echo "")
    if [[ -n "$TRAEFIK_SERVICES" ]]; then
        log_success "✅ Serviços TimePulse detectados no Traefik:"
        echo "$TRAEFIK_SERVICES" | while read service; do
            log_success "   - $service"
        done
    else
        log_warning "⚠️ Serviços TimePulse ainda não apareceram no Traefik"
        log_info "Aguarde alguns minutos para os containers serem detectados"
    fi
    
    return 0
}

# Configurações
echo -e "${YELLOW}=== CONFIGURAÇÃO DO DOMÍNIO ===${NC}"
read -p "Digite o domínio principal (ex: timepulseai.com.br): " DOMAIN
read -p "Digite o subdomínio da API (ex: api.timepulseai.com.br): " API_DOMAIN
read -p "Digite seu email para SSL (Let's Encrypt): " EMAIL

echo -e "${YELLOW}=== CONFIGURAÇÃO DAS APIs ===${NC}"
read -p "URL do Supabase (ex: https://xxx.supabase.co): " SUPABASE_URL
read -s -p "Chave Anônima do Supabase: " SUPABASE_ANON_KEY
echo ""
read -p "URL do Evolution API (ex: https://evolution.exemplo.com): " EVOLUTION_SERVER_URL
read -s -p "Chave da API Evolution: " EVOLUTION_API_KEY
echo ""
read -s -p "Token do Mapbox: " MAPBOX_ACCESS_TOKEN
echo ""
read -s -p "Chave da API OpenAI: " OPENAI_API_KEY
echo ""

# Validar inputs
if [[ -z "$DOMAIN" || -z "$API_DOMAIN" || -z "$EMAIL" || -z "$SUPABASE_URL" || -z "$SUPABASE_ANON_KEY" ]]; then
    log_error "Todos os campos obrigatórios devem ser preenchidos"
    exit 1
fi

log_step "Configuração definida:"
log_info "Domínio principal: $DOMAIN"
log_info "Domínio API: $API_DOMAIN"
log_info "Email SSL: $EMAIL"
log_info "Supabase URL: $SUPABASE_URL"
log_info "Evolution URL: $EVOLUTION_SERVER_URL"
log_info "APIs configuradas: Supabase, Evolution, Mapbox, OpenAI"

read -p "Continuar com a instalação? (y/n): " CONFIRM
if [[ $CONFIRM != "y" ]]; then
    log_info "Instalação cancelada"
    exit 0
fi

# ===== VERIFICAÇÕES DE AMBIENTE DOCKER EXISTENTE =====
log_step "Executando verificações de ambiente Docker..."

# Executar verificações
DOCKER_ALREADY_INSTALLED=false
COMPOSE_ALREADY_INSTALLED=false
PORTAINER_DETECTED=false

if check_docker_installation; then
    DOCKER_ALREADY_INSTALLED=true
fi

if check_docker_compose_installation; then
    COMPOSE_ALREADY_INSTALLED=true
fi

if check_portainer_instance; then
    PORTAINER_DETECTED=true
fi

# Verificar daemon do Docker
check_docker_daemon

# Configurar integração se Portainer foi detectado
if [[ $PORTAINER_DETECTED == true ]]; then
    get_portainer_integration_settings
    
    echo ""
    echo -e "${BLUE}=== CONFIGURAÇÃO DE INTEGRAÇÃO ===${NC}"
    echo -e "Portainer detectado! Configurando integração:"
    echo -e "  • Rede Docker: ${NETWORK_NAME}"
    echo -e "  • Proxy reverso: ${REVERSE_PROXY}"
    echo -e "  • Integração com Portainer: Ativada"
    echo ""
    
    read -p "Usar configurações automáticas de integração? (y/n): " USE_INTEGRATION
    if [[ $USE_INTEGRATION != "y" ]]; then
        log_info "Continuando sem integração automática"
        PORTAINER_DETECTED=false
    fi
fi

# 1. Atualizar sistema e instalar prerrequisitos
log_step "1/20 - Atualizando sistema e instalando prerrequisitos..."
apt update && apt upgrade -y

# Prerrequisitos essenciais para Debian 12
log_info "Instalando prerrequisitos do sistema..."
apt install -y \
    ca-certificates \
    curl \
    git \
    wget \
    unzip \
    gnupg \
    lsb-release \
    software-properties-common \
    postgresql-client-common \
    jq \
    ufw \
    openssl

# 2. Instalar Docker (se necessário)
if [[ $DOCKER_ALREADY_INSTALLED == false ]]; then
    log_step "2/20 - Instalando Docker..."
    
    if [[ $DEBIAN_BOOKWORM == true ]]; then
        log_info "Instalando Docker usando repositório oficial para Debian 12..."
        
        # Adicionar chave GPG do Docker
        curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
        
        # Adicionar repositório Docker
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian bookworm stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
        
        # Atualizar e instalar (verificação explícita dos pacotes)
        apt update
        log_info "Instalando Docker CE com todos os plugins necessários..."
        apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
        
        # Verificar se Docker Compose plugin foi instalado corretamente
        if docker compose version &>/dev/null; then
            log_success "✅ Docker Compose v2 (plugin) instalado corretamente"
            USE_COMPOSE_V2=true
        else
            log_warning "⚠️ Problema na instalação do Docker Compose plugin"
            USE_COMPOSE_V2=false
        fi
        
    else
        log_info "Instalando Docker usando script oficial..."
        curl -fsSL https://get.docker.com -o get-docker.sh
        sh get-docker.sh
        rm get-docker.sh
    fi
    
    # Configurar usuário
    usermod -aG docker $USER
    
    # Iniciar e habilitar Docker
    systemctl enable docker
    systemctl start docker
    
    log_success "Docker instalado"
else
    log_step "2/20 - Docker já instalado - pulando instalação"
fi

# 3. Instalar Docker Compose (se necessário)
if [[ $COMPOSE_ALREADY_INSTALLED == false ]]; then
    log_step "3/20 - Instalando Docker Compose..."
    
    if [[ $DEBIAN_BOOKWORM == true ]]; then
        log_info "Docker Compose v2 (plugin) já instalado junto com Docker"
        USE_COMPOSE_V2=true
    else
        log_info "Instalando Docker Compose v1 (legacy)..."
        curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
        chmod +x /usr/local/bin/docker-compose
        USE_COMPOSE_V2=false
    fi
    
    log_success "Docker Compose instalado"
else
    log_step "3/20 - Docker Compose já instalado - pulando instalação"
fi

# Definir comando do Docker Compose baseado na versão
if [[ $USE_COMPOSE_V2 == true ]]; then
    DOCKER_COMPOSE_CMD="docker compose"
    log_info "Usando Docker Compose v2: $DOCKER_COMPOSE_CMD"
else
    DOCKER_COMPOSE_CMD="docker-compose"
    log_info "Usando Docker Compose v1: $DOCKER_COMPOSE_CMD"
fi

# 4. Configurar diretórios
log_step "4/20 - Configurando estrutura de diretórios..."
mkdir -p /opt/timepulse
cd /opt/timepulse

# 5. Criar estrutura do projeto
log_step "5/20 - Criando estrutura do projeto TimePulse AI..."
mkdir -p {public,api,logs,backups,ssl}

# 6. Criar server.js do projeto
log_step "6/20 - Criando servidor Node.js..."
cat > server.js << 'EOF'
const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3001;

// Configuração de segurança
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://api.mapbox.com", "https://cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://api.mapbox.com", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://*.supabase.co", "https://api.mapbox.com", "https://api.openai.com", "wss://*.supabase.co"],
            frameSrc: ["'none'"]
        }
    }
}));

// CORS configurado para produção
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? [`https://${process.env.DOMAIN}`, `https://www.${process.env.DOMAIN}`]
        : '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Servir arquivos estáticos
app.use(express.static('public', {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : '0',
    etag: true
}));

// API Routes para configurações
app.get("/api/config", (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    
    try {
        const configData = fs.readFileSync("./api/config/index", "utf8");
        const config = JSON.parse(configData);
        config.timestamp = new Date().toISOString();
        config.forced_update = true;
        res.json(config);
    } catch (error) {
        console.error("Erro ao carregar configuração:", error);
        res.status(500).json({ error: "Configuration not found", details: error.message });
    }
});

app.get("/api/config/supabase", (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    
    try {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_ANON_KEY;
        
        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).json({ 
                error: "Configuration incomplete", 
                configured: false
            });
        }
        
        console.log(`🔧 Servindo Supabase config: ${supabaseUrl}`);
        
        const config = {
            "status": "ok",
            "configured": true,
            "environment": process.env.NODE_ENV || "production",
            "supabaseUrl": supabaseUrl,
            "supabaseAnonKey": supabaseKey,
            "url": supabaseUrl,
            "anon_key": supabaseKey,
            "project": {
                "ref": supabaseUrl.split('.')[0].split('//')[1],
                "region": "us-east-1"
            },
            "features": {
                "auth": true,
                "database": true,
                "storage": true,
                "realtime": true,
                "rls": true
            },
            "timestamp": new Date().toISOString(),
            "forced_update": true
        };
        
        res.json(config);
    } catch (error) {
        console.error("Erro ao carregar configuração Supabase:", error);
        res.status(500).json({ error: "Supabase configuration not found" });
    }
});

app.get("/api/config/evolution", (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    
    try {
        const serverUrl = process.env.EVOLUTION_SERVER_URL;
        const apiKey = process.env.EVOLUTION_API_KEY;
        
        if (!serverUrl || !apiKey) {
            return res.status(500).json({ 
                error: "Evolution API not configured", 
                configured: false 
            });
        }
        
        console.log(`🔧 Servindo Evolution config: ${serverUrl}`);
        
        const config = {
            "status": "ok",
            "configured": true,
            "serverUrl": serverUrl,
            "features": {
                "whatsapp": true,
                "telegram": false,
                "instagram": false
            },
            "timestamp": new Date().toISOString()
        };
        
        res.json(config);
    } catch (error) {
        console.error("Erro ao carregar configuração Evolution:", error);
        res.status(500).json({ error: "Evolution configuration not found" });
    }
});

app.get("/api/config/mapbox", (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    
    try {
        const accessToken = process.env.MAPBOX_ACCESS_TOKEN;
        
        if (!accessToken) {
            return res.status(500).json({ 
                error: "Mapbox token not configured", 
                configured: false 
            });
        }
        
        console.log(`🔧 Servindo Mapbox config (token configurado)`);
        
        const config = {
            "status": "ok",
            "configured": true,
            "accessToken": accessToken,
            "features": {
                "navigation": true,
                "geocoding": true,
                "directions": true
            },
            "timestamp": new Date().toISOString()
        };
        
        res.json(config);
    } catch (error) {
        console.error("Erro ao carregar configuração Mapbox:", error);
        res.status(500).json({ error: "Mapbox configuration not found" });
    }
});

app.get("/api/config/openai", (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    
    try {
        const apiKey = process.env.OPENAI_API_KEY;
        
        if (!apiKey) {
            return res.status(500).json({ 
                error: "OpenAI API key not configured", 
                configured: false 
            });
        }
        
        console.log(`🔧 Servindo OpenAI config (API key configurada)`);
        
        const config = {
            "status": "ok",
            "configured": true,
            "baseUrl": "https://api.openai.com/v1",
            "features": {
                "chat": true,
                "completions": true,
                "embeddings": true
            },
            "timestamp": new Date().toISOString()
        };
        
        res.json(config);
    } catch (error) {
        console.error("Erro ao carregar configuração OpenAI:", error);
        res.status(500).json({ error: "OpenAI configuration not found" });
    }
});

// Health check
app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        services: {
            database: "connected",
            apis: "operational"
        }
    });
});

// Fallback para SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Servidor TimePulse AI rodando em http://0.0.0.0:${PORT}`);
    console.log(`   Servidor iniciado em: ${new Date().toLocaleString()}`);
});

module.exports = app;
EOF

# 7. Criar package.json
log_step "7/20 - Criando package.json..."
cat > package.json << 'EOF'
{
  "name": "timepulse-ai",
  "version": "1.0.0",
  "description": "TimePulse AI - Delivery Management Platform",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "helmet": "^7.1.0",
    "cookie-parser": "^1.4.6"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
EOF

# 8. Criar estrutura da API
log_step "8/20 - Criando estrutura da API..."
mkdir -p api/config

cat > api/config/index << EOF
{
    "status": "ok",
    "environment": "production",
    "apiUrl": "https://$API_DOMAIN",
    "frontendUrl": "https://$DOMAIN",
    "baseUrl": "https://$DOMAIN",
    "protocol": "https",
    "secure": true,
    "version": "1.0.0",
    "timestamp": "$(date -Iseconds)",
    "ssl": {
        "enabled": true,
        "force": true
    },
    "cors": {
        "origin": ["https://$DOMAIN", "https://www.$DOMAIN"],
        "credentials": true,
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allowedHeaders": ["Content-Type", "Authorization", "X-Requested-With", "Accept"]
    },
    "services": {
        "supabase": {
            "enabled": true,
            "endpoint": "https://$API_DOMAIN/api/config/supabase",
            "secure": true
        },
        "evolution": {
            "enabled": true,
            "endpoint": "https://$API_DOMAIN/api/config/evolution",
            "secure": true
        },
        "mapbox": {
            "enabled": true,
            "endpoint": "https://$API_DOMAIN/api/config/mapbox",
            "secure": true
        },
        "openai": {
            "enabled": true,
            "endpoint": "https://$API_DOMAIN/api/config/openai",
            "secure": true
        }
    },
    "features": {
        "authentication": true,
        "realtime": true,
        "whatsapp": true,
        "maps": true,
        "ai": true,
        "ssl": true
    }
}
EOF

# 9. Criar página inicial
log_step "9/20 - Criando frontend básico..."
cat > public/index.html << 'EOF'
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TimePulse AI - Gestão de Delivery</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
        }
        
        .container {
            text-align: center;
            padding: 2rem;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 20px;
            backdrop-filter: blur(10px);
            box-shadow: 0 8px 32px rgba(31, 38, 135, 0.37);
            border: 1px solid rgba(255, 255, 255, 0.18);
        }
        
        h1 {
            font-size: 3rem;
            margin-bottom: 1rem;
            background: linear-gradient(45deg, #ff6b6b, #4ecdc4);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        
        .subtitle {
            font-size: 1.2rem;
            margin-bottom: 2rem;
            opacity: 0.9;
        }
        
        .status {
            display: flex;
            flex-direction: column;
            gap: 1rem;
            margin-top: 2rem;
        }
        
        .service {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 1rem;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 10px;
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        
        .service-name {
            font-weight: 600;
        }
        
        .service-status {
            padding: 0.5rem 1rem;
            border-radius: 20px;
            font-size: 0.9rem;
            font-weight: 600;
        }
        
        .status-ok {
            background: #4caf50;
            color: white;
        }
        
        .status-error {
            background: #f44336;
            color: white;
        }
        
        .loading {
            background: #ff9800;
            color: white;
        }
        
        .btn {
            display: inline-block;
            padding: 1rem 2rem;
            background: linear-gradient(45deg, #667eea, #764ba2);
            color: white;
            text-decoration: none;
            border-radius: 50px;
            font-weight: 600;
            margin-top: 2rem;
            transition: transform 0.3s ease;
        }
        
        .btn:hover {
            transform: translateY(-2px);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>TimePulse AI</h1>
        <p class="subtitle">Sistema de Gestão de Delivery</p>
        
        <div class="status" id="status">
            <div class="service">
                <span class="service-name">Carregando serviços...</span>
                <span class="service-status loading">⏳ Verificando</span>
            </div>
        </div>
        
        <a href="/login.html" class="btn">Acessar Sistema</a>
    </div>

    <script>
        async function checkServices() {
            const statusDiv = document.getElementById('status');
            
            try {
                const response = await fetch('/api/config');
                const config = await response.json();
                
                statusDiv.innerHTML = '';
                
                // Verificar cada serviço
                const services = [
                    { name: 'Supabase (Database)', key: 'supabase' },
                    { name: 'Evolution (WhatsApp)', key: 'evolution' },
                    { name: 'Mapbox (Mapas)', key: 'mapbox' },
                    { name: 'OpenAI (IA)', key: 'openai' }
                ];
                
                for (const service of services) {
                    const serviceDiv = document.createElement('div');
                    serviceDiv.className = 'service';
                    
                    try {
                        const serviceResponse = await fetch(`/api/config/${service.key}`);
                        const serviceConfig = await serviceResponse.json();
                        
                        serviceDiv.innerHTML = `
                            <span class="service-name">${service.name}</span>
                            <span class="service-status ${serviceConfig.configured ? 'status-ok' : 'status-error'}">
                                ${serviceConfig.configured ? '✅ Configurado' : '❌ Não configurado'}
                            </span>
                        `;
                    } catch (error) {
                        serviceDiv.innerHTML = `
                            <span class="service-name">${service.name}</span>
                            <span class="service-status status-error">❌ Erro</span>
                        `;
                    }
                    
                    statusDiv.appendChild(serviceDiv);
                }
                
            } catch (error) {
                statusDiv.innerHTML = `
                    <div class="service">
                        <span class="service-name">Erro ao carregar configurações</span>
                        <span class="service-status status-error">❌ Erro</span>
                    </div>
                `;
            }
        }
        
        // Verificar serviços quando a página carregar
        checkServices();
    </script>
</body>
</html>
EOF

# 10. Criar Dockerfile otimizado
log_step "10/20 - Criando Dockerfile..."
cat > Dockerfile << 'EOF'
# Multi-stage build para otimização
FROM node:18-alpine AS builder

WORKDIR /app

# Instalar dependências
COPY package*.json ./
RUN npm ci --only=production --silent

# Estágio final
FROM node:18-alpine

# Criar usuário não-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Instalar curl para healthcheck
RUN apk add --no-cache curl

WORKDIR /app

# Copiar dependências do builder
COPY --from=builder /app/node_modules ./node_modules

# Copiar código da aplicação
COPY --chown=nodejs:nodejs . .

# Criar diretórios necessários
RUN mkdir -p /app/logs /app/backups && \
    chown -R nodejs:nodejs /app

# Expor porta
EXPOSE 3001

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3001/api/health || exit 1

# Usar usuário não-root
USER nodejs

# Comando de inicialização
CMD ["node", "server.js"]
EOF

# 11. Criar docker-compose.yml
log_step "11/20 - Criando docker-compose.yml..."

# Configurar docker-compose baseado na detecção do ambiente
if [[ $PORTAINER_DETECTED == true && $USE_INTEGRATION == "y" ]]; then
    log_info "Criando docker-compose.yml integrado com Portainer..."
    
    cat > docker-compose.yml << EOF
version: '3.8'

services:
  timepulse-api:
    build: .
    container_name: timepulse_api
    restart: unless-stopped
    env_file: .env
    environment:
      # Apenas overrides essenciais - restante vem do .env
      - NODE_ENV=production
      - PORT=3001
    networks:
      - $NETWORK_NAME
    volumes:
      - ./logs:/app/logs
      - ./public:/app/public:ro
      - ./api:/app/api:ro
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
    labels:
      - "io.portainer.accesscontrol.teams=administrators"
      - "com.timepulse.service=api"
      - "com.timepulse.version=1.0"
EOF

    # Adicionar configurações específicas do proxy reverso detectado
    if [[ $REVERSE_PROXY == "traefik" ]]; then
        log_info "Configurando labels Traefik para integração completa..."
        
        # Configuração básica do Traefik
        cat >> docker-compose.yml << EOF
      - "traefik.enable=true"
      - "traefik.docker.network=$NETWORK_NAME"
EOF
        
        # Configuração da API
        cat >> docker-compose.yml << EOF
      - "traefik.http.services.timepulse-api.loadbalancer.server.port=3001"
      - "traefik.http.routers.timepulse-api.rule=Host(\`$API_DOMAIN\`)"
      - "traefik.http.routers.timepulse-api.entrypoints=websecure"
EOF
        
        # Configuração SSL baseada na detecção do Traefik
        if [[ $TRAEFIK_ACME_ENABLED == "yes" ]]; then
            cat >> docker-compose.yml << EOF
      - "traefik.http.routers.timepulse-api.tls=true"
      - "traefik.http.routers.timepulse-api.tls.certresolver=letsencrypt"
EOF
        else
            cat >> docker-compose.yml << EOF
      - "traefik.http.routers.timepulse-api.tls=true"
EOF
        fi
        
        # Configuração do Frontend (se não há proxy externo)
        cat >> docker-compose.yml << EOF
      - "traefik.http.services.timepulse-frontend.loadbalancer.server.port=3001"
      - "traefik.http.routers.timepulse-frontend.rule=Host(\`$DOMAIN\`)"
      - "traefik.http.routers.timepulse-frontend.entrypoints=websecure"
EOF
        
        if [[ $TRAEFIK_ACME_ENABLED == "yes" ]]; then
            cat >> docker-compose.yml << EOF
      - "traefik.http.routers.timepulse-frontend.tls=true"
      - "traefik.http.routers.timepulse-frontend.tls.certresolver=letsencrypt"
EOF
        else
            cat >> docker-compose.yml << EOF
      - "traefik.http.routers.timepulse-frontend.tls=true"
EOF
        fi
        
        # Middleware de segurança (opcional mas recomendado)
        cat >> docker-compose.yml << EOF
      - "traefik.http.middlewares.timepulse-security.headers.framedeny=true"
      - "traefik.http.middlewares.timepulse-security.headers.sslredirect=true"
      - "traefik.http.middlewares.timepulse-security.headers.stsincludesubdomains=true"
      - "traefik.http.middlewares.timepulse-security.headers.stspreload=true"
      - "traefik.http.middlewares.timepulse-security.headers.stsseconds=31536000"
      - "traefik.http.routers.timepulse-api.middlewares=timepulse-security@docker"
      - "traefik.http.routers.timepulse-frontend.middlewares=timepulse-security@docker"
EOF
    elif [[ $REVERSE_PROXY == "nginx-proxy" ]]; then
        cat >> docker-compose.yml << EOF
      - "VIRTUAL_HOST=$API_DOMAIN"
      - "LETSENCRYPT_HOST=$API_DOMAIN"
      - "LETSENCRYPT_EMAIL=$EMAIL"
EOF
    fi

    cat >> docker-compose.yml << EOF

EOF

    # Se não há proxy reverso externo, criar Nginx interno
    if [[ $REVERSE_PROXY == "internal" ]]; then
        cat >> docker-compose.yml << EOF
  nginx:
    image: nginx:alpine
    container_name: timepulse_nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./public:/usr/share/nginx/html:ro
      - ./ssl:/etc/nginx/ssl:ro
    networks:
      - $NETWORK_NAME
    depends_on:
      - timepulse-api
    labels:
      - "io.portainer.accesscontrol.teams=administrators"
      - "com.timepulse.service=nginx"

  postgres:
    image: postgres:15-alpine
    container_name: timepulse_postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: timepulse
      POSTGRES_USER: timepulse
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-timepulse_secure_2024}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./bd.sql:/docker-entrypoint-initdb.d/01-schema.sql:ro
    networks:
      - $NETWORK_NAME
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U timepulse"]
      interval: 10s
      timeout: 5s
      retries: 5
    labels:
      - "io.portainer.accesscontrol.teams=administrators"
      - "com.timepulse.service=database"

EOF
    fi

    # Configurar networks
    if [[ $USE_EXISTING_NETWORK == "yes" ]]; then
        cat >> docker-compose.yml << EOF
networks:
  $NETWORK_NAME:
    external: true

EOF
        if [[ $REVERSE_PROXY == "internal" ]]; then
            cat >> docker-compose.yml << EOF
volumes:
  postgres_data:
    labels:
      - "io.portainer.accesscontrol.teams=administrators"

EOF
        fi
    else
        cat >> docker-compose.yml << EOF
networks:
  $NETWORK_NAME:
    driver: bridge
    labels:
      - "io.portainer.accesscontrol.teams=administrators"
      - "com.timepulse.network=main"

EOF
        if [[ $REVERSE_PROXY == "internal" ]]; then
            cat >> docker-compose.yml << EOF
volumes:
  postgres_data:
    labels:
      - "io.portainer.accesscontrol.teams=administrators"

EOF
        fi
    fi

else
    log_info "Criando docker-compose.yml padrão..."
    
    cat > docker-compose.yml << EOF
version: '3.8'

services:
  timepulse-api:
    build: .
    container_name: timepulse_api
    restart: unless-stopped
    env_file: .env
    environment:
      # Apenas overrides essenciais - restante vem do .env
      - NODE_ENV=production
      - PORT=3001
    networks:
      - timepulse-network
    volumes:
      - ./logs:/app/logs
      - ./public:/app/public:ro
      - ./api:/app/api:ro
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s

  nginx:
    image: nginx:alpine
    container_name: timepulse_nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./public:/usr/share/nginx/html:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    depends_on:
      - timepulse-api
    networks:
      - timepulse-network

  # PostgreSQL para dados locais (opcional - pode usar apenas Supabase)
  postgres:
    image: postgres:15-alpine
    container_name: timepulse_postgres
    restart: unless-stopped
    environment:
      - POSTGRES_DB=timepulse
      - POSTGRES_USER=timepulse
      - POSTGRES_PASSWORD=\${POSTGRES_PASSWORD:-timepulse_secure_password}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./bd.sql:/docker-entrypoint-initdb.d/init.sql:ro
    networks:
      - timepulse-network
    ports:
      - "5432:5432"

networks:
  timepulse-network:
    driver: bridge

volumes:
  postgres_data:
EOF

fi

# 11.5. Validar integração com Traefik (se detectado)
if [[ $PORTAINER_DETECTED == true && $REVERSE_PROXY == "traefik" ]]; then
    log_step "11.5/20 - Validando integração com Traefik..."
    validate_traefik_integration
fi

# 12. Criar configuração do Nginx
log_step "12/20 - Criando configuração do Nginx..."
cat > nginx.conf << EOF
events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Configurações de segurança
    server_tokens off;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Gzip
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript application/x-font-ttf font/opentype image/svg+xml;

    # Rate limiting
    limit_req_zone \$binary_remote_addr zone=api:10m rate=30r/m;
    limit_req_zone \$binary_remote_addr zone=auth:10m rate=5r/m;

    # Redirect HTTP to HTTPS
    server {
        listen 80;
        server_name $DOMAIN $API_DOMAIN;
        
        location /.well-known/acme-challenge/ {
            root /usr/share/nginx/html;
        }
        
        location / {
            return 301 https://\$server_name\$request_uri;
        }
    }

    # Frontend (Main Domain)
    server {
        listen 443 ssl http2;
        server_name $DOMAIN;

        ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
        ssl_prefer_server_ciphers off;
        ssl_session_cache shared:SSL:10m;
        ssl_session_timeout 10m;

        # HSTS
        add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

        root /usr/share/nginx/html;
        index index.html;

        # Security headers
        add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://api.mapbox.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://api.mapbox.com https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: blob:; connect-src 'self' https://*.supabase.co https://api.mapbox.com https://api.openai.com wss://*.supabase.co https://$API_DOMAIN; frame-src 'none'; object-src 'none';" always;

        # Cache static assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
            add_header Vary "Accept-Encoding";
        }

        # Proxy API requests to backend
        location /api/ {
            limit_req zone=api burst=50 nodelay;
            
            proxy_pass http://timepulse-api:3001;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
            proxy_set_header X-Forwarded-Host \$host;
            proxy_set_header X-Forwarded-Port \$server_port;
            
            # Timeouts
            proxy_connect_timeout 30s;
            proxy_send_timeout 30s;
            proxy_read_timeout 30s;
            
            # CORS headers
            add_header Access-Control-Allow-Origin "https://$DOMAIN" always;
            add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
            add_header Access-Control-Allow-Headers "Origin, X-Requested-With, Content-Type, Accept, Authorization" always;
            add_header Access-Control-Allow-Credentials "true" always;
            
            if (\$request_method = 'OPTIONS') {
                return 204;
            }
        }

        # Rate limit auth endpoints
        location /api/auth/ {
            limit_req zone=auth burst=10 nodelay;
            proxy_pass http://timepulse-api:3001;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }

        # Fallback para SPA
        location / {
            try_files \$uri \$uri/ /index.html;
            
            # Cache para páginas HTML
            location ~* \.html$ {
                expires 1h;
                add_header Cache-Control "public, must-revalidate";
            }
        }
    }

    # API Domain (se diferente)
    server {
        listen 443 ssl http2;
        server_name $API_DOMAIN;

        ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
        ssl_protocols TLSv1.2 TLSv1.3;

        # HSTS
        add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

        location / {
            limit_req zone=api burst=50 nodelay;
            
            proxy_pass http://timepulse-api:3001;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
            
            # CORS headers para API
            add_header Access-Control-Allow-Origin "*" always;
            add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
            add_header Access-Control-Allow-Headers "Origin, X-Requested-With, Content-Type, Accept, Authorization" always;
            
            if (\$request_method = 'OPTIONS') {
                return 204;
            }
        }
    }
}
EOF

# 13. Criar arquivo .env
log_step "13/20 - Criando arquivo de configuração..."
cat > .env << EOF
# =============================================================================
# TimePulse AI - Configurações de Produção VPS
# Gerado automaticamente em $(date)
# =============================================================================

# Aplicação
NODE_ENV=production
PORT=3001
HOST=0.0.0.0

# Domínios
DOMAIN=$DOMAIN
API_DOMAIN=$API_DOMAIN
EMAIL=$EMAIL

# CORS Origins (URLs permitidas para CORS)
CORS_ORIGINS=https://$DOMAIN,https://www.$DOMAIN,https://$API_DOMAIN

# Supabase Database
SUPABASE_URL=$SUPABASE_URL
SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY

# Evolution API (WhatsApp)
EVOLUTION_SERVER_URL=$EVOLUTION_SERVER_URL
EVOLUTION_API_KEY=$EVOLUTION_API_KEY

# Mapbox (Mapas e Geocoding)
MAPBOX_ACCESS_TOKEN=$MAPBOX_ACCESS_TOKEN

# OpenAI (Inteligência Artificial)
OPENAI_API_KEY=$OPENAI_API_KEY

# PostgreSQL Local (Opcional)
POSTGRES_DB=timepulse
POSTGRES_USER=timepulse
POSTGRES_PASSWORD=timepulse_secure_password_$(openssl rand -base64 12)

# Configurações do Sistema
TZ=America/Sao_Paulo

# Configurações de Segurança
JWT_SECRET=$(openssl rand -base64 32)
SESSION_SECRET=$(openssl rand -base64 32)

# Configurações de Cache
REDIS_URL=redis://localhost:6379

# Configurações de Logs
LOG_LEVEL=info
LOG_FILE=/app/logs/app.log

# Integração Docker/Portainer
$(if [[ $PORTAINER_DETECTED == true ]]; then
echo "PORTAINER_INTEGRATION=true"
echo "DOCKER_NETWORK=$NETWORK_NAME"
echo "REVERSE_PROXY=$REVERSE_PROXY"
else
echo "PORTAINER_INTEGRATION=false"
echo "DOCKER_NETWORK=timepulse-network"
echo "REVERSE_PROXY=internal"
fi)
EOF

# Configurar permissões de segurança para o arquivo .env
chmod 600 .env
chown $USER:$USER .env 2>/dev/null || true
log_success "Arquivo .env criado com permissões de segurança (600)"

# 14. Criar schema do banco de dados
log_step "14/20 - Criando schema do banco de dados..."
cat > bd.sql << 'EOF'
-- =============================================================================
-- TimePulse AI - Schema do Banco de Dados
-- =============================================================================

-- Extensões
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Tabela de restaurantes
CREATE TABLE IF NOT EXISTS restaurants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(50),
    zipcode VARCHAR(20),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    minimum_delivery_fee DECIMAL(10, 2) DEFAULT 0.00,
    delivery_fee_per_km DECIMAL(10, 2) DEFAULT 0.50,
    minimum_distance_km DECIMAL(5, 2) DEFAULT 0.00,
    delivery_return_per_km DECIMAL(10, 2) DEFAULT 0.12,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de usuários
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de clientes
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    address TEXT,
    city VARCHAR(100),
    neighborhood VARCHAR(100),
    zipcode VARCHAR(20),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(restaurant_id, phone)
);

-- Tabela de categorias de produtos
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de produtos
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    image_url VARCHAR(500),
    active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de pedidos
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    customer_name VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(20) NOT NULL,
    customer_address TEXT,
    order_type VARCHAR(20) NOT NULL DEFAULT 'delivery', -- delivery, pickup, dine_in
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, confirmed, preparing, ready, out_for_delivery, delivered, cancelled
    payment_method VARCHAR(50), -- cash, card, pix, credit
    payment_status VARCHAR(50) DEFAULT 'pending', -- pending, paid, failed
    subtotal DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    delivery_fee DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    total DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    notes TEXT,
    delivery_time TIMESTAMP WITH TIME ZONE,
    estimated_delivery_time INTEGER, -- minutos
    delivery_distance DECIMAL(8, 2), -- km
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de itens do pedido
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    product_name VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price DECIMAL(10, 2) NOT NULL,
    total_price DECIMAL(10, 2) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de entregadores
CREATE TABLE IF NOT EXISTS deliverers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    vehicle_type VARCHAR(50), -- motorcycle, bicycle, car, foot
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de entregas
CREATE TABLE IF NOT EXISTS deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    deliverer_id UUID REFERENCES deliverers(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'assigned', -- assigned, picked_up, in_transit, delivered, failed
    started_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de formas de pagamento
CREATE TABLE IF NOT EXISTS payment_methods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL, -- cash, card, pix, credit
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_restaurants_email ON restaurants(email);
CREATE INDEX IF NOT EXISTS idx_users_restaurant_id ON users(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_customers_restaurant_id ON customers(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(restaurant_id, phone);
CREATE INDEX IF NOT EXISTS idx_products_restaurant_id ON products(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_id ON orders(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_order_id ON deliveries(order_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_deliverer_id ON deliveries(deliverer_id);

-- Triggers para updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_restaurants_updated_at BEFORE UPDATE ON restaurants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_categories_updated_at BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_deliverers_updated_at BEFORE UPDATE ON deliverers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_deliveries_updated_at BEFORE UPDATE ON deliveries FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Dados iniciais
INSERT INTO payment_methods (id, restaurant_id, name, type, active) VALUES
    (uuid_generate_v4(), uuid_generate_v4(), 'Dinheiro', 'cash', true),
    (uuid_generate_v4(), uuid_generate_v4(), 'Cartão de Débito', 'card', true),
    (uuid_generate_v4(), uuid_generate_v4(), 'Cartão de Crédito', 'card', true),
    (uuid_generate_v4(), uuid_generate_v4(), 'PIX', 'pix', true)
ON CONFLICT DO NOTHING;
EOF

# 15. Scripts de administração
log_step "15/20 - Criando scripts de administração..."

# Script de backup
cat > backup.sh << 'EOF'
#!/bin/bash

# Script de backup TimePulse AI
BACKUP_DIR="/opt/timepulse/backups"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

echo "🔄 Iniciando backup em $(date)"

# Backup do banco PostgreSQL local
if $DOCKER_COMPOSE_CMD ps postgres | grep -q "Up"; then
    echo "📦 Fazendo backup do PostgreSQL..."
    $DOCKER_COMPOSE_CMD exec -T postgres pg_dump -U timepulse timepulse > $BACKUP_DIR/database_$DATE.sql
fi

# Backup dos logs
echo "📄 Fazendo backup dos logs..."
tar -czf $BACKUP_DIR/logs_$DATE.tar.gz logs/ 2>/dev/null || true

# Backup das configurações
echo "⚙️ Fazendo backup das configurações..."
tar -czf $BACKUP_DIR/config_$DATE.tar.gz .env docker-compose.yml nginx.conf api/ 2>/dev/null || true

# Backup dos arquivos públicos
echo "🌐 Fazendo backup do frontend..."
tar -czf $BACKUP_DIR/public_$DATE.tar.gz public/ 2>/dev/null || true

# Manter apenas os últimos 30 backups
echo "🧹 Limpando backups antigos..."
find $BACKUP_DIR -name "*.tar.gz" -mtime +30 -delete
find $BACKUP_DIR -name "*.sql" -mtime +30 -delete

echo "✅ Backup concluído: $DATE"
echo "📊 Arquivos de backup:"
ls -lh $BACKUP_DIR/*$DATE*
EOF

chmod +x backup.sh

# Script de monitoramento
cat > monitor.sh << 'EOF'
#!/bin/bash

# Script de monitoramento TimePulse AI

echo "=== TimePulse AI - Status dos Serviços ==="
echo "Data: $(date)"
echo ""

check_service() {
    local service=$1
    local container=$2
    
    if docker-compose ps | grep -q "$container.*Up"; then
        echo "✅ $service está rodando"
        
        # Verificar saúde do container
        health=$(docker inspect --format='{{.State.Health.Status}}' $container 2>/dev/null || echo "unknown")
        if [[ "$health" != "unknown" ]]; then
            if [[ "$health" == "healthy" ]]; then
                echo "   💚 Saúde: $health"
            else
                echo "   ⚠️ Saúde: $health"
            fi
        fi
    else
        echo "❌ $service está parado - tentando reiniciar..."
        $DOCKER_COMPOSE_CMD restart $container
    fi
}

# Verificar serviços principais
check_service "API Backend" "timepulse_api"
check_service "Nginx (Frontend)" "timepulse_nginx"
check_service "PostgreSQL" "timepulse_postgres"

echo ""
echo "=== Uso de Recursos ==="
docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"

echo ""
echo "=== Espaço em Disco ==="
df -h /opt/timepulse

echo ""
echo "=== Conectividade ==="
if curl -sSf "http://localhost:3001/api/health" > /dev/null 2>&1; then
    echo "✅ API Backend respondendo"
else
    echo "❌ API Backend não está respondendo"
fi

if curl -sSf "http://localhost" > /dev/null 2>&1; then
    echo "✅ Frontend acessível"
else
    echo "❌ Frontend não está acessível"
fi

echo ""
echo "=== Logs Recentes (últimas 10 linhas) ==="
docker-compose logs --tail=10 timepulse-api 2>/dev/null || echo "Nenhum log disponível"
EOF

chmod +x monitor.sh

# Script de update
cat > update.sh << 'EOF'
#!/bin/bash

# Script de atualização TimePulse AI

echo "🔄 Iniciando atualização do TimePulse AI..."

# Fazer backup antes da atualização
echo "📦 Fazendo backup de segurança..."
./backup.sh

# Parar serviços
echo "⏹️ Parando serviços..."
$DOCKER_COMPOSE_CMD down

# Fazer backup das imagens atuais
echo "💾 Fazendo backup das imagens Docker..."
docker tag timepulse_timepulse-api:latest timepulse_timepulse-api:backup-$(date +%Y%m%d_%H%M%S) || true

# Rebuildar e iniciar
echo "🔨 Reconstruindo aplicação..."
$DOCKER_COMPOSE_CMD build --no-cache

echo "🚀 Iniciando serviços..."
$DOCKER_COMPOSE_CMD up -d

# Verificar se tudo está funcionando
echo "🔍 Verificando serviços..."
sleep 30
./monitor.sh

echo "✅ Atualização concluída!"
EOF

chmod +x update.sh

# 16. Configurar SSL
log_step "16/20 - Configurando certificados SSL..."

# Gerar certificados temporários
mkdir -p ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout ssl/privkey.pem \
    -out ssl/fullchain.pem \
    -subj "/C=BR/ST=SP/L=Sao Paulo/O=TimePulse AI/CN=$DOMAIN" \
    >/dev/null 2>&1

# 17. Configurar cron jobs
log_step "17/20 - Configurando tarefas agendadas..."
cat > /tmp/timepulse_cron << EOF
# TimePulse AI - Tarefas Agendadas

# Backup diário às 2:00 AM
0 2 * * * cd /opt/timepulse && ./backup.sh >> /var/log/timepulse-backup.log 2>&1

# Monitoramento a cada 15 minutos
*/15 * * * * cd /opt/timepulse && ./monitor.sh >> /var/log/timepulse-monitor.log 2>&1

# Renovação SSL (tenta todo dia às 3:00 AM)
0 3 * * * cd /opt/timepulse && docker run --rm -v /etc/letsencrypt:/etc/letsencrypt -v /opt/timepulse/public:/var/www/html certbot/certbot renew --webroot --webroot-path=/var/www/html && $DOCKER_COMPOSE_CMD exec nginx nginx -s reload

# Limpeza de logs antigos (semanal - domingo às 4:00 AM)
0 4 * * 0 find /opt/timepulse/logs -name "*.log" -mtime +30 -delete

# Restart preventivo (toda segunda às 5:00 AM)
0 5 * * 1 cd /opt/timepulse && $DOCKER_COMPOSE_CMD restart
EOF

crontab /tmp/timepulse_cron
rm /tmp/timepulse_cron

# 18. Configurar logs
log_step "18/20 - Configurando sistema de logs..."
mkdir -p /var/log/timepulse
chown $USER:$USER /var/log/timepulse

# Configurar logrotate
cat > /etc/logrotate.d/timepulse << 'EOF'
/var/log/timepulse-*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0644 root root
}

/opt/timepulse/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0644 root root
}
EOF

# 18.5. Validação de DNS
log_step "18.5/20 - Validando resolução DNS..."

# Verificar resolução DNS dos domínios
validate_dns() {
    local domain=$1
    local domain_type=$2
    
    log_info "Validando DNS para $domain ($domain_type)..."
    
    if nslookup "$domain" >/dev/null 2>&1; then
        log_success "✅ $domain resolve corretamente"
        return 0
    else
        log_warning "⚠️ $domain NÃO resolve - verifique configuração DNS"
        log_warning "   Configure um registro A apontando para este servidor: $(curl -s ipinfo.io/ip 2>/dev/null || hostname -I | awk '{print $1}')"
        return 1
    fi
}

DNS_VALIDATION_FAILED=false

# Validar domínio principal
if ! validate_dns "$DOMAIN" "domínio principal"; then
    DNS_VALIDATION_FAILED=true
fi

# Validar domínio da API (se diferente)
if [[ "$API_DOMAIN" != "$DOMAIN" ]]; then
    if ! validate_dns "$API_DOMAIN" "domínio da API"; then
        DNS_VALIDATION_FAILED=true
    fi
fi

if [[ $DNS_VALIDATION_FAILED == true ]]; then
    log_warning "ATENÇÃO: Problemas de DNS detectados!"
    log_warning "O sistema funcionará localmente, mas pode não ser acessível externamente."
    log_warning "Configure os registros DNS antes de usar em produção."
    echo ""
    read -p "Continuar mesmo assim? (y/n): " CONTINUE_DNS
    if [[ $CONTINUE_DNS != "y" ]]; then
        log_error "Instalação cancelada devido a problemas de DNS"
        exit 1
    fi
fi

# 19. Configurar firewall UFW
log_step "19/20 - Configurando firewall UFW..."

if command -v ufw &> /dev/null; then
    log_info "Configurando regras de firewall..."
    
    # Reset e configuração básica
    ufw --force reset
    ufw default deny incoming
    ufw default allow outgoing
    
    # Regras essenciais
    ufw allow ssh comment "SSH access"
    ufw allow 80/tcp comment "HTTP"
    ufw allow 443/tcp comment "HTTPS"
    
    # SEGURANÇA: Não liberar portas de banco de dados ou dashboards por padrão
    # PostgreSQL 5432 - NUNCA expor publicamente
    # Traefik Dashboard 8080 - NUNCA expor sem autenticação
    
    log_warning "🔒 SEGURANÇA: Portas PostgreSQL (5432) e Traefik Dashboard (8080) NÃO liberadas"
    log_warning "   Para acesso seguro ao PostgreSQL, use túnel SSH: ssh -L 5432:localhost:5432 user@server"
    log_warning "   Para Traefik Dashboard, configure autenticação primeiro"
    
    # Configurar regras específicas para Docker (crítico para segurança)
    log_info "Configurando regras Docker para UFW..."
    
    # Criar regras DOCKER-USER para bloquear acesso direto aos containers
    # Isso impede que o Docker bypasse as regras do UFW
    if ! iptables -t filter -C DOCKER-USER -j RETURN 2>/dev/null; then
        iptables -t filter -I DOCKER-USER -j RETURN
        log_success "✅ Regras DOCKER-USER configuradas para segurança"
    fi
    
    # Configurar regras DOCKER-USER específicas (estratégia mais segura)
    log_info "Implementando regras DOCKER-USER para bloquear acesso externo direto..."
    
    # Bloquear todo tráfego direto para containers vindos da internet
    iptables -I DOCKER-USER -i eth0 ! -s 127.0.0.1 -j DROP 2>/dev/null || true
    iptables -I DOCKER-USER -i eth0 -s 127.0.0.1 -j RETURN 2>/dev/null || true
    
    # Permitir apenas tráfego do proxy reverso (Nginx/Traefik)
    iptables -I DOCKER-USER -i br-+ -j RETURN 2>/dev/null || true
    iptables -I DOCKER-USER -i docker0 -j RETURN 2>/dev/null || true
    
    # Salvar regras iptables para persistir após reboot
    if command -v iptables-save &> /dev/null; then
        iptables-save > /etc/iptables/rules.v4 2>/dev/null || true
    fi
    
    # Configurar Docker daemon com logs otimizados (manter iptables=true)
    log_info "Configurando Docker daemon..."
    mkdir -p /etc/docker
    cat > /etc/docker/daemon.json << EOF
{
    "live-restore": true,
    "log-driver": "json-file",
    "log-opts": {
        "max-size": "10m",
        "max-file": "3"
    }
}
EOF
    
    log_success "✅ Docker daemon e regras de segurança configurados"
    
    # Habilitar firewall
    ufw --force enable
    
    # Mostrar status
    log_success "✅ Firewall UFW configurado e ativo"
    log_info "Regras aplicadas:"
    ufw status numbered | head -10
    
else
    log_warning "⚠️ UFW não está disponível - firewall não configurado"
    log_warning "Considere configurar iptables manualmente para maior segurança"
fi

# 20. Inicializar aplicação
log_step "20/20 - Inicializando TimePulse AI..."

# Build da aplicação
log_info "Construindo imagens Docker..."
$DOCKER_COMPOSE_CMD build --no-cache

# Iniciar nginx primeiro para certificados
log_info "Iniciando Nginx para validação SSL..."
$DOCKER_COMPOSE_CMD up -d nginx

# Aguardar Nginx inicializar
sleep 10

# Gerar certificados SSL reais
log_info "Gerando certificados SSL com Let's Encrypt..."
docker run --rm \
    -v /etc/letsencrypt:/etc/letsencrypt \
    -v /opt/timepulse/public:/var/www/html \
    certbot/certbot certonly \
    --webroot \
    --webroot-path=/var/www/html \
    --email $EMAIL \
    --agree-tos \
    --no-eff-email \
    -d $DOMAIN \
    -d $API_DOMAIN \
    || log_warning "Erro ao gerar certificados SSL - usando temporários"

# Parar nginx temporário
$DOCKER_COMPOSE_CMD down

# Iniciar todos os serviços
log_success "Iniciando todos os serviços..."
$DOCKER_COMPOSE_CMD up -d

# Aguardar inicialização
log_info "Aguardando inicialização dos serviços..."
sleep 60

# Verificações finais
log_step "Executando verificações finais..."

# Verificar API
if curl -sSf "http://localhost:3001/api/health" > /dev/null 2>&1; then
    log_success "✅ API backend está respondendo"
else
    log_error "❌ API backend não está respondendo"
fi

# Verificar frontend
if curl -sSf "http://localhost" > /dev/null 2>&1; then
    log_success "✅ Frontend está acessível"
else
    log_error "❌ Frontend não está acessível"
fi

# Verificar HTTPS
if curl -sSfk "https://localhost" > /dev/null 2>&1; then
    log_success "✅ HTTPS está funcionando"
else
    log_warning "⚠️ HTTPS pode estar com problemas - verificar certificados"
fi

# Verificar PostgreSQL
if $DOCKER_COMPOSE_CMD exec -T postgres psql -U timepulse -d timepulse -c "SELECT 1;" > /dev/null 2>&1; then
    log_success "✅ PostgreSQL está funcionando"
else
    log_warning "⚠️ PostgreSQL pode estar com problemas"
fi

# Testar integração com Traefik se detectado
if [[ $PORTAINER_DETECTED == true && $REVERSE_PROXY == "traefik" ]]; then
    log_step "Testando integração final com Traefik..."
    test_traefik_integration
fi

# Status final
./monitor.sh

# =============================================================================
# INSTALAÇÃO CONCLUÍDA
# =============================================================================

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                   INSTALAÇÃO CONCLUÍDA               ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}🌐 URLs de Acesso:${NC}"
echo -e "   Frontend: https://$DOMAIN"
echo -e "   API:      https://$API_DOMAIN"
echo -e "   Status:   https://$DOMAIN/api/health"
echo ""
echo -e "${BLUE}📁 Diretórios Importantes:${NC}"
echo -e "   Projeto:  /opt/timepulse"
echo -e "   Logs:     /opt/timepulse/logs"
echo -e "   Backups:  /opt/timepulse/backups"
echo -e "   Config:   /opt/timepulse/.env"
echo ""
echo -e "${BLUE}🔧 Comandos Úteis:${NC}"
echo -e "   Status:   cd /opt/timepulse && ./monitor.sh"
echo -e "   Logs:     cd /opt/timepulse && $DOCKER_COMPOSE_CMD logs -f"
echo -e "   Restart:  cd /opt/timepulse && $DOCKER_COMPOSE_CMD restart"
echo -e "   Update:   cd /opt/timepulse && ./update.sh"
echo -e "   Backup:   cd /opt/timepulse && ./backup.sh"
echo -e "   Shell:    cd /opt/timepulse && $DOCKER_COMPOSE_CMD exec timepulse-api sh"
echo ""
echo -e "${BLUE}📊 Serviços Configurados:${NC}"
echo -e "   ✅ Supabase (Database)"
echo -e "   ✅ Evolution API (WhatsApp)"
echo -e "   ✅ Mapbox (Mapas)"
echo -e "   ✅ OpenAI (IA)"
echo -e "   ✅ PostgreSQL Local"
echo -e "   ✅ Nginx (Proxy/SSL)"
echo -e "   ✅ SSL/HTTPS"
echo -e "   ✅ Backup Automático"
echo -e "   ✅ Monitoramento"
echo ""
echo -e "${YELLOW}⚠️  PRÓXIMOS PASSOS:${NC}"
echo -e "1. Testar todas as funcionalidades:"
echo -e "   ${BLUE}curl https://$DOMAIN/api/health${NC}"
echo ""
echo -e "2. Acessar o sistema:"
echo -e "   ${BLUE}https://$DOMAIN${NC}"
echo ""
echo -e "3. Monitorar os logs:"
echo -e "   ${BLUE}cd /opt/timepulse && $DOCKER_COMPOSE_CMD logs -f${NC}"
echo ""
echo -e "4. Configurar backups externos se necessário"
echo ""
echo -e "${GREEN}🎉 TimePulse AI está pronto para uso em produção!${NC}"
echo ""

# Informações específicas sobre integração com Portainer
if [[ $PORTAINER_DETECTED == true && $USE_INTEGRATION == "y" ]]; then
    echo -e "${BLUE}🐳 INTEGRAÇÃO COM PORTAINER:${NC}"
    echo -e "   ✅ TimePulse AI integrado à instância Docker existente"
    echo -e "   ✅ Usando rede: ${NETWORK_NAME}"
    echo -e "   ✅ Proxy reverso: ${REVERSE_PROXY}"
    echo -e "   ✅ Labels Portainer configurados para controle de acesso"
    echo ""
    echo -e "${BLUE}📊 Para visualizar no Portainer:${NC}"
    echo -e "   1. Acesse sua instância do Portainer"
    echo -e "   2. Vá para 'Stacks' ou 'Containers'"
    echo -e "   3. Procure por containers com prefixo 'timepulse_'"
    echo -e "   4. Use as labels para filtrar: com.timepulse.service"
    echo ""
    
    # Registrar stack no Portainer se possível
    PORTAINER_URL=$(docker ps --filter name=portainer --format "{{.Ports}}" | grep -o '0.0.0.0:[0-9]*' | head -1 | cut -d':' -f2)
    if [[ -n "$PORTAINER_URL" ]]; then
        echo -e "${BLUE}🔗 Portainer UI provavelmente disponível em:${NC}"
        echo -e "   http://$(hostname -I | awk '{print $1}'):${PORTAINER_URL}"
        echo -e "   https://$(hostname -I | awk '{print $1}'):${PORTAINER_URL}"
    fi
fi

echo -e "${PURPLE}📧 Suporte: Para dúvidas, consulte a documentação em /opt/timepulse${NC}"

# Criar arquivo de informações sobre a instalação
cat > /opt/timepulse/installation-info.txt << EOF
TimePulse AI - Informações da Instalação
========================================

Data da Instalação: $(date)
Versão do Sistema: $(lsb_release -d -s 2>/dev/null || echo "Linux")
Versão do Docker: $(docker --version 2>/dev/null || echo "N/A")
Versão do Docker Compose: $($DOCKER_COMPOSE_CMD --version 2>/dev/null || echo "N/A")

Configurações:
- Domínio Principal: $DOMAIN
- Domínio API: $API_DOMAIN
- Email SSL: $EMAIL

Ambiente Docker:
- Docker já instalado: $DOCKER_ALREADY_INSTALLED
- Docker Compose já instalado: $COMPOSE_ALREADY_INSTALLED
- Portainer detectado: $PORTAINER_DETECTED
$(if [[ $PORTAINER_DETECTED == true ]]; then
echo "- Rede utilizada: $NETWORK_NAME"
echo "- Proxy reverso: $REVERSE_PROXY"
echo "- Integração ativada: $USE_INTEGRATION"
fi)

Containers Criados:
- timepulse_api (API Backend)
$(if [[ $REVERSE_PROXY == "internal" ]]; then
echo "- timepulse_nginx (Frontend/Proxy)"
echo "- timepulse_postgres (Database)"
fi)

URLs de Acesso:
- Frontend: https://$DOMAIN
- API: https://$API_DOMAIN
- Health Check: https://$DOMAIN/api/health

Scripts Disponíveis:
- ./monitor.sh - Monitorar status dos serviços
- ./backup.sh - Fazer backup completo
- ./update.sh - Atualizar aplicação
- $DOCKER_COMPOSE_CMD logs -f - Ver logs em tempo real

Troubleshooting:
- Se containers não aparecerem no Portainer, verifique as networks
- Para debugging: $DOCKER_COMPOSE_CMD logs timepulse-api
- Para shell: $DOCKER_COMPOSE_CMD exec timepulse-api sh

EOF

log_success "Arquivo de informações salvo em /opt/timepulse/installation-info.txt"