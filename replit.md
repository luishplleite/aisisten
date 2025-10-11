# TimePulse AI - Delivery Management Platform

## Overview
TimePulse AI is a comprehensive restaurant delivery management system built with Node.js and Express. The platform includes features for order management, delivery tracking, AI-powered customer assistance, and integrations with external services.

**Current State**: ✅ Project fully configured and running with all API integrations active

## Recent Changes
- **2025-10-11**: ✅ Correção CRÍTICA do Sistema de Edição de Restaurantes - Admin (HTTP 500)
  - **🐛 Problema Raiz Identificado:**
    * Erro HTTP 500 ao salvar alterações de restaurantes
    * Violação de CHECK constraints do banco de dados Supabase
    * Sistema misturava dois campos diferentes com regras distintas:
      - Campo `status`: aceita apenas 'active', 'inactive', 'suspended'
      - Campo `subscription_status`: aceita 'trial', 'active', 'expired', 'cancelled'
    * Tentativa de salvar 'trial' no campo `status` → violação da constraint
    * Backend sobrescrevia `subscription_status` para 'active' automaticamente
  
  - **✅ Correções Implementadas:**
    * **Mapeamento Inteligente de Status (Frontend):**
      - 'trial' selecionado → status='active' + subscription_status='trial'
      - 'active' selecionado → status='active' + subscription_status='active'
      - 'suspended' selecionado → status='suspended' + subscription_status mantém valor
      - 'cancelled' selecionado → status='inactive' + subscription_status='cancelled'
    
    * **Backend Corrigido (server.js):**
      - Adicionado suporte para receber `subscription_status` explicitamente
      - Corrigido bug: subscription_status só é definido como 'active' automaticamente se NÃO for fornecido
      - Condicional adicionada: `if (!subscription_status) { updateData.subscription_status = 'active'; }`
    
    * **Mapeamento Completo de Campos:**
      - `name` → restaurants.name
      - `owner_email` → restaurants.owner_email
      - `owner_phone` → restaurants.owner_phone (corrigido de 'phone')
      - `address` → restaurants.address
      - `plan` → restaurants.plan
      - `status` → restaurants.status (valores permitidos respeitados)
      - `subscription_status` → restaurants.subscription_status (novo campo adicionado)
      - `trial_end_date` → restaurants.trial_end_date
      - `trial_extension_reason` → restaurants.trial_extension_reason
      - `subscription_end_date` → restaurants.subscription_end_date
      - `manual_activation_reason` → restaurants.manual_activation_reason
      - `status_change_reason` → restaurants.status_change_reason
  
  - **📝 Arquivos Modificados:**
    * `public/admin.html`: Lógica de mapeamento de status implementada em `saveRestaurantChanges()`
    * `server.js`: Endpoint PUT corrigido com suporte a subscription_status e lógica condicional
  
  - **✅ Validação Architect:** ✅ PASS - Todas constraints do banco respeitadas, sem sobrescritas indevidas
  
  - **✅ Resultado:** Sistema 100% funcional - Admin pode estender trials, alterar status e salvar todos os dados sem violar constraints do Supabase

- **2025-10-11**: ✅ Sistema de Ofuscação de Dados para Trial Implementado (Dashboard + Relatórios)
  - **🔒 Funcionalidade Trial-Gating:**
    * Usuários trial veem dados completos APENAS no primeiro dia
    * A partir do segundo dia de calendário: dados ofuscados automaticamente
    * Sistema usa dias de calendário (meia-noite) ao invés de 24h
    * Verificação defensiva para dados ausentes/inválidos
  
  - **📊 Seções Ofuscadas no Dashboard (5 total):**
    * Entregadores Ativos (card de estatísticas)
    * Pedidos Recentes (lista)
    * Vendas dos Últimos 7 Dias (gráfico)
    * Entregadores (lista)
    * Produtos Populares (lista)
  
  - **📊 Seções Ofuscadas em Relatórios (3 grupos):**
    * Métricas Principais: Faturamento, Custos, Lucro, Pedidos, Itens
    * Gráficos: Faturamento Anual/Mensal, Top Clientes, Categorias, Vendas por Horário
    * Insights: Insights Inteligentes e Assistente de Redes Sociais
  
  - **🎨 Experiência do Usuário:**
    * Efeito blur (desfoque) nos dados
    * Overlay branco semi-transparente
    * Ícone de cadeado (🔒)
    * Mensagem: "Conteúdo Premium - Assine para visualizar todos os dados"
    * Botão "Assinar Agora" → redireciona para assinaturas.html
  
  - **⚙️ Implementação Técnica:**
    * Query otimizada ao Supabase: `subscription_status, trial_start_date, trial_end_date`
    * Normalização de datas para meia-noite (00:00:00)
    * Cálculo correto de dias de calendário
    * Função: `applyTrialBlurIfNeeded()` em dashboard.html
    * CSS: `.trial-blur-content`, `.trial-blur-overlay`, `.trial-blur-container`

- **2025-10-11**: ✅ Padronização Mobile Responsiva Completa
  - **📱 Menu Hambúrguer Unificado:**
    * Padrão de responsividade mobile aplicado em TODOS os arquivos HTML
    * Menu hambúrguer (☰) fixo no topo em dispositivos móveis
    * Logo TimePulse AI centralizada no header mobile
    * Overlay escuro para fechar menu ao clicar fora
    * Animações suaves (slide-in/out) para sidebar
    * Auto-fechamento do menu ao clicar em links de navegação
  
  - **📐 Media Queries Implementadas:**
    * @media (max-width: 768px) - Tablets e celulares
    * @media (max-width: 380px) - Celulares pequenos
    * Ajustes automáticos de padding, font-size e layout
    * Touch-optimized scrolling para melhor experiência
  
  - **✅ Arquivos Padronizados:**
    * dashboard.html ✓
    * cozinha.html ✓
    * cardapio.html ✓
    * gestao_entregadores.html ✓
    * clientes.html ✓
    * relatorios.html ✓
    * assinaturas.html ✓
    * configuracoes.html ✓
    * admin.html ✓ (adaptado com admin-sidebar)
    * gestao_pedidos.html ✓ (arquivo de referência)
  
  - **🎨 Componentes Mobile:**
    * CSS: .mobile-header, .hamburger-btn, .sidebar-overlay
    * HTML: Header mobile + Overlay + Sidebar com ID
    * JavaScript: toggleMobileMenu() function
    * Z-index: Header (10000), Sidebar (9999), Overlay (9998)

- **2025-10-07**: ✅ Sistema COMPLETO de Prompts e Memória Implementado
  - **📝 Integração com Tabela `prompit` (OBRIGATÓRIO):**
    * Prompt carregado EXCLUSIVAMENTE da tabela `prompit` do Supabase
    * Baseado no `business_type` do restaurante
    * Sistema valida obrigatoriamente antes de processar mensagens
    * Endpoint: GET `/api/assistant/business-type-prompt`
    * Se prompt não existir, assistente não funciona (segurança)
  
  - **🤖 GPT-5-mini OBRIGATÓRIO (Hard-coded):**
    * Model: `gpt-5-mini` (fixo, não pode ser alterado)
    * Endpoint: `/api/assistant/chat` linha 3944
    * Garantia: Sempre usa GPT-5-mini, jamais outro modelo
  
  - **💾 Sistema de Memória Persistente:**
    * Histórico armazenado em `chat_histories` do Supabase
    * OpenAI recebe histórico das últimas 24 horas
    * Mensagens salvas automaticamente após cada interação
    * Interface carrega histórico ao iniciar
    * Endpoints:
      - GET `/api/assistant/chat-history/:sessionId`
      - POST `/api/assistant/save-message`
      - DELETE `/api/assistant/clean-history`
  
  - **🔄 Fluxo Completo Garantido:**
    1. Carrega prompt da tabela `prompit` → 
    2. Valida prompt existe → 
    3. **Busca dados do cliente cadastrado (reconhecimento)** → 
    4. Carrega histórico do `chat_histories` → 
    5. **Adiciona dados do cliente ao contexto** →
    6. Envia tudo para OpenAI (GPT-5-mini) → 
    7. Recebe resposta personalizada → 
    8. Salva no banco → 
    9. Exibe para usuário
  
  - **👤 Reconhecimento de Clientes (NOVO):**
    * Sistema busca cliente automaticamente usando telefone
    * Extrai telefone do session_id (WhatsApp)
    * Consulta tabela `customers` do Supabase
    * Adiciona nome, endereço e histórico ao contexto
    * OpenAI usa dados para personalizar resposta
    * Cliente é cumprimentado pelo nome
    * Endereço cadastrado é confirmado automaticamente

- **2025-10-07**: Assistente Ana atualizado para atendimento impecável
  - Prompt do sistema atualizado com fluxo completo de delivery seguindo modal "Novo Pedido - Delivery"
  - Coleta completa de dados: telefone, nome, endereço completo (CEP, rua, número, complemento, bairro, cidade, UF)
  - Validações obrigatórias implementadas antes de criar pedidos
  - Função createOrder melhorada com:
    * Validação de todos os campos obrigatórios
    * Cálculo automático de subtotal e total
    * Suporte a taxa de entrega e troco
    * Tratamento de erros com rollback automático
  - GARANTIDO: Todos os pedidos criados com status "novo"
    * Via assistente Ana (assistente.js)
    * Via webhook Evolution API (/api/webhook/evolution)
    * Via MCP (create_delivery_order e create_counter_order)

- **2025-10-06**: Initial Replit setup completed
  - Node.js environment configured
  - Dependencies installed
  - Development workflow configured on port 5000
  - All API keys configured (Supabase, OpenAI, Mapbox, Evolution API)
  - Server running successfully with all integrations active
  - Deployment configuration set up
  - Project documentation created

## Project Architecture

### Technology Stack
- **Backend**: Node.js with Express.js
- **Frontend**: Static HTML/CSS/JavaScript
- **Database**: Supabase (PostgreSQL)
- **AI Integration**: OpenAI GPT-5-mini
- **Maps**: Mapbox API
- **WhatsApp**: Evolution API
- **Security**: Helmet.js, CORS, JWT authentication

### Directory Structure
```
├── api/                    # API configuration files
│   ├── auth/              # Authentication endpoints
│   └── config/            # Service configurations
├── public/                # Frontend static files
│   ├── css/              # Stylesheets
│   ├── js/               # JavaScript files
│   └── *.html            # HTML pages
├── server.js             # Main Express server
├── package.json          # Dependencies
└── *.sql                 # Database schemas
```

### Key Features
1. **Order Management**: Real-time delivery order tracking
2. **AI Assistant**: Customer interaction via OpenAI
3. **Delivery Tracking**: Manage delivery personnel and routes
4. **Dashboard**: Statistics and analytics
5. **Menu Management**: Product and menu administration
6. **Payment Integration**: Payment gateway support
7. **WhatsApp Integration**: Communication via Evolution API

## Configuration

### Environment Variables
The application requires the following environment variables to function fully. These should be configured in Replit Secrets:

**Database & Backend Services:**
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous/public key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase admin key (server-side only)

**External APIs:**
- `EVOLUTION_API_BASE_URL` - Evolution API base URL for WhatsApp
- `EVOLUTION_API_KEY` - Evolution API authentication key
- `MAPBOX_ACCESS_TOKEN` - Mapbox API token for maps
- `OPENAI_API_KEY` - OpenAI API key for GPT-5-mini

**Security:**
- `JWT_SECRET` - Secret for JWT token signing (auto-generated if not set)

### Development Mode
The application runs in development mode by default with:
- Port: 5000
- Host: 0.0.0.0 (required for Replit)
- CORS: Permissive (allows all origins)
- Auth bypass: Enabled for testing

## Running the Project

The project is configured to run automatically with:
```bash
npm start
```

This starts the Express server on port 5000 with all static files served from the `public` directory.

## Security Notes
- Service role keys are never exposed to the frontend
- API keys are managed via environment variables
- CSRF protection is enabled for POST requests
- Rate limiting is implemented for API endpoints
- Development mode includes auth bypass for testing

## User Preferences
(To be updated as preferences are discovered)

## API Status
✅ All APIs configured and active:
- **Supabase**: Database and authentication configured
- **OpenAI**: AI assistant ready (GPT-5-mini)
- **Mapbox**: Maps and routing enabled
- **Evolution API**: WhatsApp integration active

## Next Steps
1. Configure database tables using the SQL schema files (bd.sql, atualizacao_bd.sql)
2. Register your first restaurant via the "Cadastrar Restaurante" page
3. Set up WhatsApp instance via Evolution API
4. Configure payment gateway (Asaas) if needed
