# TimePulse AI - Delivery Management Platform

## Overview
TimePulse AI is a comprehensive restaurant delivery management system designed to streamline order processing, delivery tracking, and customer communication. Built with Node.js and Express, it integrates AI-powered customer assistance, real-time tracking, and robust administrative tools. The platform aims to provide a complete solution for restaurants to manage their delivery operations efficiently, enhance customer satisfaction through intelligent interactions, and offer data-driven insights.

## Recent Changes

### ✅ Otimização do Modal "Novo Pedido - Delivery" (2025-10-18)
**Implementação:** Layout compacto e totalmente responsivo do modal de delivery em gestao_pedidos.html.

**Mudanças CSS Implementadas:**
- Desktop (≥769px): Grids de 2, 3 e 4 colunas para exibição eficiente
- Mobile (≤768px): Todos os grids convertem para coluna única (1fr)
- Regras desktop envolvidas em `@media (min-width: 769px)` para evitar conflitos de cascata
- Espaçamentos reduzidos (gap: 0.5rem) para minimizar scroll

**Classes Otimizadas:**
- `.delivery-compact-grid`: 2 colunas desktop, 1 coluna mobile
- `.delivery-form-grid-2/3/4`: Multi-colunas desktop, 1 coluna mobile
- `.delivery-metrics`: 3 colunas desktop, 1 coluna mobile

**Validação:** Aprovado pelo Architect após 3 iterações, sem conflitos de cascata CSS

### ✅ Ocultação de Planos para Assinaturas Ativas (2025-10-14)
**Implementação:** Sistema que oculta automaticamente os cards de planos quando o restaurante tem assinatura ativa.

**Comportamento:**
- Quando `subscription_status = 'active'` na tabela `restaurants`, os cards de planos (Teste Gratuito, Premium, Empresarial) são ocultados automaticamente na página `assinaturas.html`
- O status de assinatura continua visível mostrando "Ativo" e os detalhes do plano atual
- Outros status (trial, expired, cancelled) mantêm os cards visíveis para permitir upgrade/reativação

**Lógica Implementada:**
- Função `updateSubscriptionDisplay()` modificada para controlar visibilidade via CSS `display: none` quando status = 'active'
- Melhora UX evitando confusão de clientes com assinatura ativa vendo opções de planos

### ✅ Integração Completa Asaas - Checkout Transparente (2025-10-14)
**Implementação:** Sistema completo de checkout transparente integrado à página de assinaturas.

**Endpoints da API criados:**
- GET /api/asaas/active-config - Retorna configuração Asaas ativa
- POST /api/asaas/create-customer - Cria cliente no Asaas
- POST /api/asaas/create-subscription - Cria assinatura mensal
- POST /api/asaas/create-checkout - Gera link de checkout transparente
- GET /api/asaas/billing-history/:restaurantId - Lista histórico de cobranças

**Frontend (assinaturas.html):**
- Função createSubscription() com fluxo completo de assinatura
- Função loadBillingHistory() para exibir pagamentos
- Mapeamento de status Asaas para português
- Tratamento de erros e feedback ao usuário

**Autenticação:** Sistema baseado em cookies (timepulse_instance_token) sem JWT Bearer

**Próximos Passos:**
- Adicionar campo asaas_customer_id na tabela restaurants quando for criada
- Ativar configuração Asaas no ambiente de produção (active=true)

### 2025-10-13

### ✅ Sistema de Bloqueio Independente por Plano - CORRIGIDO
**Problema:** Frontend não carregava configurações independentes por plano. Operador `|| 1` convertia 0 (bloqueio imediato) em 1 dia.

**Correções Implementadas:**
- Função `loadPlanConfiguration` corrigida para transformar array do backend em objeto
- Operador `|| 1` substituído por `?? 1` (nullish coalescing) para preservar valor 0
- Boolean corrigido de `|| false` para `!!` (double negation)
- Arquivo `SISTEMA_BLOQUEIO_INDEPENDENTE.md` criado com documentação completa

**Funcionalidade Garantida:**
- ✅ Cada plano (Trial, Básico, Premium, Enterprise) tem configuração independente
- ✅ Valores de bloqueio (0-30 dias) preservados corretamente
- ✅ Salvamento e carregamento sem corrupção de dados
- ✅ Revisão Architect: PASS (2 iterações)

### ✅ Sistema de Configuração de Assinatura - CRIADO
**Tabelas Criadas:**
- subscription_plans, blockable_elements, subscription_blocking_config
- restaurant_subscription_config, asaas_config, subscription_config_audit
- View: vw_subscription_blocking_details

**Endpoints da API:** 7 endpoints criados para gestão completa
- GET/POST /api/admin/subscription-plans
- GET/POST /api/admin/subscription-config/:planName
- GET/POST /api/admin/asaas-config
- POST /api/admin/asaas-test

**Correção Crítica:** Removida FK para public.restaurants (não existe no banco)

## User Preferences
(To be updated as preferences are discovered)

## System Architecture

### Technology Stack
- **Backend**: Node.js with Express.js
- **Frontend**: Static HTML/CSS/JavaScript
- **Database**: Supabase (PostgreSQL)
- **AI Integration**: OpenAI GPT-5-mini
- **Maps**: Mapbox API
- **WhatsApp**: Evolution API

### UI/UX Decisions
The platform features a standardized mobile-responsive design across all HTML pages, including a unified hamburger menu for mobile navigation. UI elements include blur effects and overlays for premium content gating in trial versions, guiding users towards subscription.

### Technical Implementations & Feature Specifications
- **Order Management**: Real-time tracking and management of delivery orders.
- **AI Assistant**: Leverages OpenAI GPT-5-mini for customer interaction, supporting order creation, queries, and personalized responses using persistent memory and customer data integration.
- **Delivery Tracking**: Tools for managing delivery personnel and optimizing routes.
- **Dashboard & Reporting**: Provides statistics and analytics, with data obfuscation for trial users after the first day.
- **Menu Management**: Administration of products and menus.
- **Subscription Management**: Configurable subscription plans with independent blocking settings for features.
- **Restaurant Management (Admin)**: Comprehensive admin interface for managing restaurant details, including careful handling of `status` and `subscription_status` to prevent database constraint violations.
- **WhatsApp Integration**: Communication capabilities via Evolution API for order notifications and customer support.
- **Security**: Implements Helmet.js, CORS, JWT authentication, CSRF protection, and rate limiting. Service role keys are secured and not exposed to the frontend.

### System Design Choices
- **Modular Structure**: Organized directory structure (`api/`, `public/`) for clear separation of concerns.
- **Environment Configuration**: Utilizes environment variables for sensitive data and API keys, managed via Replit Secrets.
- **Scalability**: Designed with Supabase as the backend, supporting PostgreSQL's capabilities for data management.
- **API-driven**: All core functionalities are exposed via well-defined API endpoints.
- **Trial Gating**: A robust system to gate premium features for trial users, using calendar days for obfuscation.
- **Hardcoded GPT-5-mini**: Ensures consistent AI model usage for all assistant interactions.
- **Prompt Management**: AI assistant prompts are loaded exclusively from the `prompit` Supabase table, validated by `business_type`.

## External Dependencies

- **Supabase**: Primary database (PostgreSQL) and authentication service.
- **OpenAI**: Provides the GPT-5-mini model for the AI assistant.
- **Mapbox API**: Used for mapping and routing functionalities.
- **Evolution API**: Integrated for WhatsApp communication and messaging.
- **Asaas**: Payment gateway for handling transactions.