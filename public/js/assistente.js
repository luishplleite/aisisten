// Ana - Assistente Virtual para Restaurantes
// Sistema de chat com GPT-5-mini e memory persistente

class AnaAssistant {
    constructor() {
        this.messages = [];
        this.chatMemory = new Map();
        this.isTyping = false;
        this.restaurantData = null;
        this.customerData = null;
        this.currentOrder = null;
        this.sessionId = null; // Será definido após autenticação para persistência
        this.messageCount = 0;
        this.ordersCreated = 0;
        this.customSystemPrompt = null; // Cache para prompt personalizado
        this.systemPromptLoaded = false; // Flag para evitar múltiplos carregamentos
        
        // Configurações do assistente baseadas no prompt
        this.config = {
            assistantName: "Ana",
            assistantRole: "Assistente Virtual",
            tone: "calorosa, humanizada brasileira",
            language: "pt-BR",
            restaurantSchedule: "das 18:00 às 23:00", // Padrão, será carregado do banco
        };
        
        // Estados do fluxo de conversa
        this.conversationState = {
            stage: 'initial', // initial, greeting, address_confirmation, menu_inquiry, product_selection, additionals, payment, finalization
            waitingForAddressConfirmation: false,
            waitingForPayment: false,
            currentProduct: null,
            selectedAdditionals: [],
            pendingOrder: null
        };
    }

    async init() {
        try {
            console.log('🚀 Inicializando Ana - Assistente Virtual...');
            
            // Verificar autenticação
            if (!window.SECURE_INSTANCE_MANAGER?.isAuthenticated()) {
                window.location.href = '../login.html';
                return;
            }

            // Carregar dados do restaurante
            await this.loadRestaurantData();
            
            // Carregar configuração do Supabase
            await this.initializeSupabase();
            
            // Configurar interface
            this.setupEventListeners();
            
            // Carregar prompt personalizado (se existir)
            await this.loadCustomSystemPrompt();
            
            // Verificar memória de chat existente
            await this.loadChatMemory();
            
            // Tentar obter telefone do cliente e carregar dados
            const customerPhone = this.getCustomerPhoneFromContext();
            if (customerPhone) {
                await this.loadCustomerData(customerPhone);
            }
            
            // Inicializar chat
            this.initializeChat();
            
            console.log('✅ Ana inicializada com sucesso');
            
        } catch (error) {
            console.error('❌ Erro ao inicializar Ana:', error);
            this.showError('Erro ao inicializar o assistente. Recarregue a página.');
        }
    }

    generateSessionId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    async loadRestaurantData() {
        try {
            const instance = window.SECURE_INSTANCE_MANAGER.getInstance();
            if (!instance?.restaurantId) {
                throw new Error('Restaurant ID não encontrado');
            }

            // Carregar dados do restaurante do Supabase
            const supabase = await window.secureConfig.getSupabaseClient();
            const { data: restaurant, error } = await supabase
                .from('restaurants')
                .select('*')
                .eq('id', instance.restaurantId)
                .single();

            if (error) throw error;
            
            this.restaurantData = restaurant;
            
            // Definir sessionId baseado no restaurante e usuário para persistência
            this.sessionId = `${instance.restaurantId}_${instance.userEmail}`.replace(/[^a-zA-Z0-9_]/g, '_');
            
            this.updateRestaurantUI();
            
            console.log('✅ Dados do restaurante carregados:', restaurant.name);
            console.log('🔑 Session ID definido:', this.sessionId);
            
        } catch (error) {
            console.error('❌ Erro ao carregar dados do restaurante:', error);
            throw error;
        }
    }

    async initializeSupabase() {
        try {
            this.supabase = await window.secureConfig.getSupabaseClient();
            if (!this.supabase) {
                throw new Error('Falha ao inicializar Supabase');
            }
            console.log('✅ Supabase inicializado para Ana');
        } catch (error) {
            console.error('❌ Erro ao inicializar Supabase:', error);
            throw error;
        }
    }

    updateRestaurantUI() {
        if (!this.restaurantData) return;
        
        document.getElementById('restaurantName').textContent = this.restaurantData.name;
        document.getElementById('restaurantPhone').textContent = this.restaurantData.phone || 'Não informado';
        
        // Atualizar horários se disponível
        const hours = this.restaurantData.hours || this.config.restaurantSchedule;
        document.getElementById('restaurantHours').textContent = hours;
    }

    setupEventListeners() {
        const messageInput = document.getElementById('messageInput');
        const sendButton = document.getElementById('sendButton');

        // Auto-resize do textarea
        messageInput.addEventListener('input', (e) => {
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
        });

        // Enviar mensagem com Enter
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Botão de enviar
        sendButton.addEventListener('click', () => this.sendMessage());

        // Habilitar input após inicialização
        setTimeout(() => {
            messageInput.disabled = false;
            sendButton.disabled = false;
            messageInput.focus();
            document.getElementById('loadingState').style.display = 'none';
        }, 1000);
    }

    async loadChatMemory() {
        try {
            // Buscar memória de chat do localStorage ou banco
            const savedMemory = localStorage.getItem(`ana_memory_${this.sessionId}`);
            if (savedMemory) {
                this.chatMemory = new Map(JSON.parse(savedMemory));
                this.updateMemoryUI();
            }
        } catch (error) {
            console.warn('Não foi possível carregar memória de chat:', error);
        }
    }

    saveChatMemory() {
        try {
            localStorage.setItem(`ana_memory_${this.sessionId}`, 
                JSON.stringify([...this.chatMemory]));
        } catch (error) {
            console.warn('Não foi possível salvar memória de chat:', error);
        }
    }

    updateMemoryUI() {
        const memoryContainer = document.getElementById('chatMemory');
        if (!memoryContainer) return;

        if (this.chatMemory.size === 0) {
            memoryContainer.innerHTML = `
                <div class="memory-item">
                    <div class="memory-label">Status:</div>
                    Aguardando primeira interação...
                </div>
            `;
            return;
        }

        let memoryHTML = '';
        for (const [key, value] of this.chatMemory) {
            // Escapar tanto a chave quanto o valor para prevenir XSS
            const safeKey = this.escapeHTML(key);
            const safeValue = this.escapeHTML(value);
            
            memoryHTML += `
                <div class="memory-item">
                    <div class="memory-label">${safeKey}:</div>
                    ${safeValue}
                </div>
            `;
        }
        
        memoryContainer.innerHTML = memoryHTML;
    }

    // Função para obter telefone do cliente de diferentes fontes
    getCustomerPhoneFromContext() {
        try {
            // 1. Verificar URL parameters
            const urlParams = new URLSearchParams(window.location.search);
            const phoneFromUrl = urlParams.get('phone') || urlParams.get('telefone') || urlParams.get('customer_phone');
            
            if (phoneFromUrl) {
                console.log('📞 Telefone obtido da URL:', phoneFromUrl);
                return this.normalizePhoneNumber(phoneFromUrl);
            }
            
            // 2. Verificar se há dados na memória do chat
            const phoneFromMemory = this.chatMemory.get('phone');
            if (phoneFromMemory) {
                console.log('📞 Telefone obtido da memória:', phoneFromMemory);
                return this.normalizePhoneNumber(phoneFromMemory);
            }
            
            // 3. Verificar localStorage para sessão específica
            const instance = window.SECURE_INSTANCE_MANAGER.getInstance();
            const storedPhone = localStorage.getItem(`customer_phone_${instance.restaurantId}`);
            if (storedPhone) {
                console.log('📞 Telefone obtido do localStorage:', storedPhone);
                return this.normalizePhoneNumber(storedPhone);
            }
            
            // 4. Solicitar telefone ao usuário (apenas se necessário)
            console.log('📞 Nenhum telefone encontrado no contexto');
            return null;
            
        } catch (error) {
            console.warn('⚠️ Erro ao obter telefone do contexto:', error);
            return null;
        }
    }

    // Função para normalizar número de telefone
    normalizePhoneNumber(phone) {
        if (!phone) return null;
        
        // Remover caracteres não numéricos
        const digits = phone.replace(/[^0-9]/g, '');
        
        // Adicionar código do país se necessário (Brasil +55)
        if (digits.startsWith('55') && digits.length >= 12) {
            return '+' + digits;
        } else if (digits.length >= 10) {
            return '+55' + digits;
        }
        
        return '+55' + digits;
    }

    // Função para carregar dados do cliente do banco Supabase
    async loadCustomerData(phone) {
        if (!phone) {
            console.log('📞 Nenhum telefone fornecido para busca de cliente');
            return null;
        }
        
        try {
            console.log('🔍 Buscando dados do cliente no banco para telefone:', phone);
            
            // Usar o sistema MCP para consultar dados do cliente
            const mcpResponse = await this.queryCustomerDataMCP(phone);
            
            if (mcpResponse && mcpResponse.customer) {
                this.customerData = mcpResponse.customer;
                console.log('✅ Dados do cliente carregados:', this.customerData.name);
                
                // Salvar no localStorage para futuras sessões
                const instance = window.SECURE_INSTANCE_MANAGER.getInstance();
                localStorage.setItem(`customer_phone_${instance.restaurantId}`, phone);
                
                return this.customerData;
            } else {
                console.log('👤 Cliente não encontrado no banco para telefone:', phone);
                this.customerData = null;
                return null;
            }
            
        } catch (error) {
            console.error('❌ Erro ao carregar dados do cliente:', error);
            this.customerData = null;
            return null;
        }
    }

    // Função para consultar dados do cliente via MCP (melhorada)
    async queryCustomerDataMCP(phone) {
        try {
            // Tentar múltiplos formatos de telefone para melhor compatibilidade
            const phoneFormats = [
                phone, // Formato original
                phone.replace(/[^0-9]/g, ''), // Apenas dígitos
                phone.replace(/^\+55/, ''), // Remove código do país
                phone.replace(/^\+/, '') // Remove apenas o +
            ];
            
            for (const phoneFormat of phoneFormats) {
                const result = await this.queryCustomerWithPhoneFormat(phoneFormat);
                if (result && result.customer) {
                    return result;
                }
            }
            
            return null;
            
        } catch (error) {
            console.warn('⚠️ Erro ao consultar cliente via MCP:', error);
            return null;
        }
    }

    // Função auxiliar para consultar com formato específico de telefone
    async queryCustomerWithPhoneFormat(phone) {
        try {
            // Obter token CSRF primeiro
            const csrfResponse = await fetch('/api/csrf-token', {
                method: 'GET',
                credentials: 'include'
            });
            
            if (!csrfResponse.ok) {
                return null;
            }
            
            const csrfData = await csrfResponse.json();
            
            // Fazer chamada MCP específica para buscar cliente
            const response = await fetch('/api/mcp/activate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfData.csrfToken
                },
                credentials: 'include',
                body: JSON.stringify({
                    message: `customers_data phone:${phone} restaurant_id:${this.restaurantData?.id}`,
                    restaurantId: this.restaurantData?.id
                })
            });
            
            if (!response.ok) {
                return null;
            }
            
            const mcpData = await response.json();
            
            if (mcpData.mcpActivated && mcpData.response) {
                // Tentar extrair dados estruturados primeiro
                if (mcpData.data && mcpData.data.customer) {
                    return mcpData.data;
                }
                
                // Tentar parsear da resposta de texto
                return this.parseCustomerFromMCPResponse(mcpData.response);
            }
            
            return null;
            
        } catch (error) {
            console.warn('⚠️ Erro ao consultar formato de telefone:', phone, error);
            return null;
        }
    }

    // Função auxiliar para parsear dados do cliente da resposta MCP
    parseCustomerFromMCPResponse(responseText) {
        try {
            // Tentar extrair informações do cliente da resposta de texto
            // Esta função pode ser expandida conforme o formato da resposta MCP
            
            // Procurar por padrões na resposta que indiquem dados do cliente
            const nameMatch = responseText.match(/nome[:\s]*([^\n,]+)/i);
            const addressMatch = responseText.match(/endereço[:\s]*([^\n,]+)/i);
            const phoneMatch = responseText.match(/telefone[:\s]*([^\n,]+)/i);
            
            if (nameMatch || addressMatch || phoneMatch) {
                return {
                    customer: {
                        name: nameMatch ? nameMatch[1].trim() : null,
                        address: addressMatch ? addressMatch[1].trim() : null,
                        phone: phoneMatch ? phoneMatch[1].trim() : null
                    }
                };
            }
            
            return null;
            
        } catch (error) {
            console.warn('⚠️ Erro ao parsear resposta do cliente:', error);
            return null;
        }
    }

    async initializeChat() {
        // Verificar se há dados de cliente carregados para personalizar a mensagem inicial
        let welcomeMessage = 'Oi! Eu sou a Ana, sua assistente virtual! 😊 Estou aqui para ajudar você com seus pedidos.';
        
        // Se temos dados do cliente, confirmar informações
        if (this.customerData) {
            // Sanitizar dados do cliente para prevenir XSS
            const customerName = this.sanitizeForDisplay(this.customerData.name || 'Cliente');
            const customerAddress = this.sanitizeForDisplay(this.customerData.address || 'Endereço não cadastrado');
            
            welcomeMessage = `Olá ${customerName}! 😊 Eu sou a Ana, sua assistente virtual!\n\n` +
                           `Verifiquei nossos registros e encontrei os seguintes dados:\n` +
                           `📝 Nome: ${customerName}\n` +
                           `📍 Endereço: ${customerAddress}\n\n` +
                           `Estes dados estão corretos? Se estiver tudo certo, é só confirmar e podemos seguir com seu pedido! 🍕`;
            
            // Atualizar memória com dados do cliente (também sanitizados)
            this.chatMemory.set('nome', customerName);
            this.chatMemory.set('endereco', customerAddress);
            this.chatMemory.set('phone', this.customerData.phone);
            this.chatMemory.set('customer_id', this.customerData.id);
            this.chatMemory.set('data_confirmada', false);
            
            this.saveChatMemory();
        } else {
            welcomeMessage += ' Como posso te ajudar hoje?';
        }
        
        this.addMessage('assistant', welcomeMessage);
        this.updateMemoryUI();
    }

    // Função para sanitizar dados antes de exibir (prevenir XSS)
    sanitizeForDisplay(text) {
        if (!text) return text;
        
        // Criar elemento temporário para escapar HTML
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Função global para escapar HTML de forma segura
    escapeHTML(text) {
        if (!text) return '';
        
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
            '/': '&#x2F;'
        };
        
        return String(text).replace(/[&<>"'\/]/g, function (s) {
            return map[s];
        });
    }

    async sendMessage() {
        const messageInput = document.getElementById('messageInput');
        const message = messageInput.value.trim();
        
        if (!message || this.isTyping) return;

        // Adicionar mensagem do usuário
        this.addMessage('user', message);
        messageInput.value = '';
        messageInput.style.height = 'auto';
        
        // Incrementar contador de mensagens
        this.messageCount++;
        document.getElementById('messageCount').textContent = this.messageCount;

        // Mostrar indicador de digitação
        this.showTyping();

        try {
            // Processar mensagem com Ana
            const response = await this.processMessage(message);
            
            // Remover indicador de digitação
            this.hideTyping();
            
            // Adicionar resposta da Ana
            this.addMessage('assistant', response);
            
        } catch (error) {
            console.error('❌ Erro ao processar mensagem:', error);
            this.hideTyping();
            this.addMessage('assistant', 'Ops! Tive um problema aqui. Pode tentar novamente? 😅');
        }
    }

    addMessage(sender, content) {
        const messagesContainer = document.getElementById('chatMessages');
        const messageElement = document.createElement('div');
        messageElement.className = `message ${sender}`;
        
        const currentTime = new Date().toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit'
        });

        messageElement.innerHTML = `
            <div class="message-content">
                ${this.formatMessage(content)}
                <div class="message-time">${currentTime}</div>
            </div>
        `;

        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        // Salvar mensagem no histórico
        this.messages.push({
            sender,
            content,
            timestamp: new Date().toISOString()
        });
    }

    formatMessage(content) {
        // Escapar conteúdo primeiro para prevenir XSS
        const safeContent = this.escapeHTML(content);
        
        // Processar formatação especial para pedidos (com conteúdo já escapado)
        if (safeContent.includes('+++++++++++++++++++++++++++')) {
            return `<div class="order-summary">${safeContent}</div>`;
        }
        
        // Processar opções de pagamento (com conteúdo já escapado)
        if (safeContent.includes('🟢 PIX') || safeContent.includes('💳 Cartão') || safeContent.includes('💵 Dinheiro')) {
            const lines = safeContent.split('\n');
            let formattedContent = '';
            let inPaymentOptions = false;
            
            for (const line of lines) {
                if (line.includes('🟢 PIX') || line.includes('💳 Cartão') || line.includes('💵 Dinheiro')) {
                    if (!inPaymentOptions) {
                        formattedContent += '<div class="payment-options">';
                        inPaymentOptions = true;
                    }
                    // Escapar novamente para o atributo onclick
                    const escapedLine = this.escapeHTML(line.trim());
                    formattedContent += `<div class="payment-option" onclick="selectPaymentMethod('${escapedLine}')">${line}</div>`;
                } else {
                    if (inPaymentOptions) {
                        formattedContent += '</div>';
                        inPaymentOptions = false;
                    }
                    formattedContent += line + '<br>';
                }
            }
            
            if (inPaymentOptions) {
                formattedContent += '</div>';
            }
            
            return formattedContent;
        }
        
        // Formatação básica com conteúdo já escapado
        return safeContent.replace(/\n/g, '<br>');
    }

    showTyping() {
        this.isTyping = true;
        const messagesContainer = document.getElementById('chatMessages');
        
        const typingElement = document.createElement('div');
        typingElement.className = 'typing-indicator';
        typingElement.id = 'typingIndicator';
        typingElement.innerHTML = `
            <div class="typing-dots">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
            Ana está digitando...
        `;
        
        messagesContainer.appendChild(typingElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    hideTyping() {
        this.isTyping = false;
        const typingElement = document.getElementById('typingIndicator');
        if (typingElement) {
            typingElement.remove();
        }
    }

    async processMessage(userMessage) {
        try {
            // Verificar se é uma confirmação de dados do cliente
            if (this.customerData && this.chatMemory.get('data_confirmada') === false) {
                const confirmation = this.checkDataConfirmation(userMessage);
                if (confirmation !== null) {
                    if (confirmation) {
                        this.chatMemory.set('data_confirmada', true);
                        this.saveChatMemory();
                        return 'Perfeito! 🎉 Dados confirmados! Agora me conta, o que você gostaria de pedir hoje? Posso te mostrar nosso cardápio se quiser! 😊';
                    } else {
                        // Cliente quer alterar dados - iniciar fluxo de atualização
                        this.chatMemory.set('data_confirmada', false);
                        this.chatMemory.set('updating_customer_data', true);
                        this.customerData = null;
                        this.saveChatMemory();
                        return 'Sem problemas! 😊 Vamos atualizar seus dados.\n\nPor favor, me informe:\n📝 Seu nome completo\n📍 Seu endereço completo para entrega\n\nPode enviar tudo em uma mensagem mesmo!';
                    }
                }
            }

            // Verificar se estamos no fluxo de atualização de dados do cliente
            if (this.chatMemory.get('updating_customer_data') === true) {
                const updateResult = await this.processCustomerDataUpdate(userMessage);
                if (updateResult) {
                    return updateResult;
                }
            }
            
            // Extrair informações importantes da mensagem
            this.extractInfoFromMessage(userMessage);
            
            // 🔧 INTEGRAÇÃO MCP: Verificar se deve ativar MCP
            const mcpResponse = await this.checkAndActivateMCP(userMessage);
            if (mcpResponse) {
                // Se MCP foi ativado, usar resposta diretamente
                this.updateChatMemory(userMessage, mcpResponse);
                return mcpResponse;
            }
            
            // Preparar contexto para o GPT-5-mini
            const context = this.buildContext(userMessage);
            
            // Chamar GPT-5-mini via AI/ML API
            const response = await this.callGPT5Mini(context);
            
            // Processar resposta e extrair ações
            const processedResponse = await this.processGPTResponse(response, userMessage);
            
            // Atualizar memória
            this.updateChatMemory(userMessage, processedResponse);
            
            return processedResponse;
            
        } catch (error) {
            console.error('❌ Erro ao processar mensagem:', error);
            return 'Desculpe, tive um problema técnico. Pode tentar novamente?';
        }
    }

    // Função para processar atualização de dados do cliente
    async processCustomerDataUpdate(userMessage) {
        try {
            // Extrair nome e endereço da mensagem
            const nameMatch = userMessage.match(/(?:nome|eu sou|me chamo|sou)\s*[:\s]*([a-zA-ZÀ-ÿ\s]+)/i);
            const addressMatch = userMessage.match(/(?:endereço|endereço|rua|avenida|av|r\.)\s*[:\s]*([^,\n]+)/i);
            
            let hasName = false;
            let hasAddress = false;
            
            if (nameMatch) {
                const extractedName = nameMatch[1].trim();
                this.chatMemory.set('nome', this.sanitizeForDisplay(extractedName));
                hasName = true;
            }
            
            if (addressMatch) {
                const extractedAddress = addressMatch[1].trim();
                this.chatMemory.set('endereco', this.sanitizeForDisplay(extractedAddress));
                hasAddress = true;
            }
            
            // Se a mensagem contém tanto nome quanto endereço, ou se já temos ambos
            const currentName = this.chatMemory.get('nome');
            const currentAddress = this.chatMemory.get('endereco');
            
            if ((hasName && hasAddress) || (currentName && currentAddress)) {
                // Finalizar atualização
                this.chatMemory.set('updating_customer_data', false);
                this.chatMemory.set('data_confirmada', true);
                this.saveChatMemory();
                
                return `Perfeito! ✅ Dados atualizados:\n📝 Nome: ${currentName || 'Não informado'}\n📍 Endereço: ${currentAddress || 'Não informado'}\n\nAgora podemos prosseguir! O que você gostaria de pedir hoje? 😊`;
            } else {
                // Ainda precisamos de mais informações
                const missing = [];
                if (!currentName && !hasName) missing.push('nome');
                if (!currentAddress && !hasAddress) missing.push('endereço');
                
                return `Obrigada pelas informações! 😊 Ainda preciso do seu ${missing.join(' e ')}. Pode me informar?`;
            }
            
        } catch (error) {
            console.error('❌ Erro ao processar atualização de dados:', error);
            this.chatMemory.set('updating_customer_data', false);
            this.saveChatMemory();
            return 'Houve um problema ao atualizar seus dados. Vamos continuar nossa conversa normalmente! 😊';
        }
    }

    // Função para verificar se a mensagem é uma confirmação de dados
    checkDataConfirmation(message) {
        const msg = message.toLowerCase().trim();
        
        // Palavras de confirmação positiva
        const positiveWords = ['sim', 'correto', 'certo', 'confirmo', 'ok', 'perfeito', 'exato', 'isso mesmo', 'está certo', 'confirmar', 'confirmado'];
        
        // Palavras de negação
        const negativeWords = ['não', 'nao', 'errado', 'incorreto', 'alterar', 'mudar', 'trocar', 'atualizar', 'corrigir'];
        
        // Verificar confirmação positiva
        if (positiveWords.some(word => msg.includes(word))) {
            return true;
        }
        
        // Verificar negação
        if (negativeWords.some(word => msg.includes(word))) {
            return false;
        }
        
        // Se não é claro, retornar null para continuar processamento normal
        return null;
    }

    // 🔧 FUNÇÃO MCP: Verificar e ativar MCP se necessário
    async checkAndActivateMCP(userMessage) {
        try {
            // Palavras-chave para ativar MCP (sincronizado com servidor)
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
            
            const messageNormalized = userMessage.toLowerCase().trim();
            const shouldActivateMCP = mcpKeywords.some(keyword => messageNormalized.includes(keyword));
            
            if (!shouldActivateMCP) {
                return null; // Não ativar MCP
            }
            
            console.log('🔧 Palavra-chave MCP detectada:', userMessage);
            
            // Obter token CSRF primeiro
            const csrfResponse = await fetch('/api/csrf-token', {
                method: 'GET',
                credentials: 'include'
            });
            
            if (!csrfResponse.ok) {
                console.warn('⚠️ Não foi possível obter token CSRF');
                return null;
            }
            
            const csrfData = await csrfResponse.json();
            
            // Fazer chamada para endpoint MCP com CSRF token
            const response = await fetch('/api/mcp/activate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfData.csrfToken
                },
                credentials: 'include',
                body: JSON.stringify({
                    message: userMessage,
                    restaurantId: this.restaurantData?.id
                })
            });
            
            if (!response.ok) {
                console.warn('⚠️ Erro na chamada MCP, continuando normalmente');
                return null;
            }
            
            const mcpData = await response.json();
            
            if (mcpData.mcpActivated && mcpData.response) {
                console.log('✅ MCP ativado com sucesso!');
                
                // Adicionar indicador visual de que MCP foi ativado
                const mcpIndicator = '🔧 <strong>MCP Database Ativado</strong><br><br>';
                
                return mcpIndicator + mcpData.response;
            }
            
            return null;
            
        } catch (error) {
            console.warn('⚠️ Erro ao verificar MCP:', error);
            return null; // Continuar sem MCP em caso de erro
        }
    }

    extractInfoFromMessage(message) {
        // Extrair informações conforme especificado no prompt
        const phoneRegex = /(\(?\d{2}\)?\s?\d{4,5}-?\d{4})/;
        const nameRegex = /(?:meu nome é|me chamo|sou|eu sou)\s+([a-zA-ZÀ-ÿ\s]+)/i;
        const addressRegex = /(rua|avenida|av|r\.)\s+([^,]+)/i;
        
        const phoneMatch = message.match(phoneRegex);
        const nameMatch = message.match(nameRegex);
        const addressMatch = message.match(addressRegex);
        
        if (phoneMatch) {
            this.chatMemory.set('phone', phoneMatch[1]);
        }
        
        if (nameMatch) {
            this.chatMemory.set('nome', nameMatch[1].trim());
        }
        
        if (addressMatch) {
            this.chatMemory.set('endereco', `${addressMatch[1]} ${addressMatch[2]}`);
        }
        
        // Salvar session_id
        this.chatMemory.set('session_id', `${this.sessionId}@s.whatsapp.net`);
        this.chatMemory.set('restaurant_id', this.restaurantData.id);
        
        this.saveChatMemory();
        this.updateMemoryUI();
    }

    // Carregar prompt personalizado do servidor
    async loadCustomSystemPrompt() {
        if (this.systemPromptLoaded) {
            return this.customSystemPrompt;
        }
        
        try {
            console.log('📖 Tentando carregar prompt personalizado...');
            
            // PRIORIDADE 1: Tentar carregar prompt baseado no tipo de negócio do restaurante
            if (this.restaurantData && this.restaurantData.id) {
                console.log('📖 Tentando carregar prompt baseado no tipo de negócio...');
                
                const businessTypeResponse = await fetch(`/api/assistant/business-type-prompt?restaurant_id=${this.restaurantData.id}`, {
                    method: 'GET',
                    credentials: 'include',
                    headers: {
                        'Accept': 'application/json'
                    }
                });
                
                if (businessTypeResponse.ok) {
                    const businessTypeData = await businessTypeResponse.json();
                    
                    if (businessTypeData.hasPrompt && businessTypeData.prompt) {
                        this.customSystemPrompt = businessTypeData.prompt;
                        this.systemPromptLoaded = true;
                        console.log(`✅ Prompt baseado no tipo de negócio carregado: ${businessTypeData.businessType}!`);
                        return this.customSystemPrompt;
                    } else {
                        console.log(`📖 Nenhum prompt encontrado para tipo de negócio: ${businessTypeData.businessType || 'não definido'}`);
                    }
                } else {
                    console.warn('⚠️ Erro ao carregar prompt por tipo de negócio');
                }
            }
            
            // PRIORIDADE 2: Carregar prompt personalizado específico do restaurante
            const response = await fetch('/api/assistant/system-prompt', {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                
                if (data.hasCustomPrompt && data.prompt) {
                    this.customSystemPrompt = data.prompt;
                    this.systemPromptLoaded = true;
                    console.log('✅ Prompt personalizado específico carregado do servidor!');
                    return this.customSystemPrompt;
                } else {
                    console.log('📖 Nenhum prompt personalizado específico no servidor, verificando localStorage...');
                }
            } else {
                console.warn('⚠️ Erro ao carregar prompt específico do servidor, verificando localStorage...');
            }
            
        } catch (error) {
            console.warn('⚠️ Erro na requisição do prompt personalizado:', error);
        }
        
        // PRIORIDADE 3: Fallback para localStorage
        try {
            const instance = window.SECURE_INSTANCE_MANAGER.getInstance();
            const localPrompt = localStorage.getItem(`custom_prompt_${instance.restaurantId}`);
            
            if (localPrompt) {
                this.customSystemPrompt = localPrompt;
                console.log('✅ Prompt personalizado carregado do localStorage!');
            } else {
                console.log('📖 Usando prompt padrão (nenhum personalizado encontrado)');
            }
        } catch (localError) {
            console.warn('⚠️ Erro ao acessar localStorage:', localError);
        }
        
        this.systemPromptLoaded = true;
        return this.customSystemPrompt;
    }

    buildContext(userMessage) {
        // Usar prompt personalizado se já foi carregado
        
        // Definir prompt do sistema (personalizado ou padrão)
        let systemPrompt;
        
        if (this.customSystemPrompt) {
            // Usar prompt personalizado, mas ainda adicionar dados dinâmicos
            systemPrompt = `${this.customSystemPrompt}

DADOS DO RESTAURANTE (DINÂMICOS):
- Nome: ${this.restaurantData.name}
- ID: ${this.restaurantData.id}
- Horário: ${this.restaurantData.hours || this.config.restaurantSchedule}

MEMÓRIA ATUAL DA CONVERSA:
${Array.from(this.chatMemory.entries()).map(([key, value]) => `${key}: ${value}`).join('\n')}

Estado da conversa: ${this.conversationState.stage}`;
        } else {
            // Usar prompt padrão hardcoded
            systemPrompt = `Você é Ana, uma assistente virtual calorosa e humanizada para restaurantes brasileiros. 

IDENTIDADE:
- Nome: Ana
- Tom: humanizado brasileiro ("tá", "você"), calorosa
- Sempre chame o cliente pelo nome extraído da memória
- Use emojis apropriados

DADOS DO RESTAURANTE:
- Nome: ${this.restaurantData.name}
- ID: ${this.restaurantData.id}
- Horário: ${this.restaurantData.hours || this.config.restaurantSchedule}

MEMÓRIA ATUAL:
${Array.from(this.chatMemory.entries()).map(([key, value]) => `${key}: ${value}`).join('\n')}

FLUXO OBRIGATÓRIO:
1. Para clientes cadastrados - DUAS ETAPAS SEPARADAS:
   - ETAPA 1: Saudação + confirmação de endereço
   - ETAPA 2: Pergunta sobre pedido (APÓS confirmação)

2. JAMAIS misture confirmação de endereço com pergunta sobre pedido

3. Use dados da memória PRIMEIRO, depois consulte sistema se necessário

REGRAS:
- Todos os pedidos criados devem ter status "novo"
- Sempre extrair: Restaurant_ID, Nome Cliente, Endereço, Telefone, session_id
- Cardápio deve ser apresentado diretamente na conversa, NUNCA como arquivo
- Ser conversacional, humana e espontânea

Estado da conversa: ${this.conversationState.stage}`;
        }
        
        // Construir contexto baseado no prompt fornecido
        const context = {
            messages: [
                {
                    role: "system",
                    content: systemPrompt
                },
                ...this.messages.slice(-10).map(msg => ({
                    role: msg.sender === 'user' ? 'user' : 'assistant',
                    content: msg.content
                })),
                {
                    role: "user",
                    content: userMessage
                }
            ]
        };
        
        return context;
    }

    async callGPT5Mini(context) {
        try {
            const response = await fetch('/api/assistant/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({
                    messages: context.messages,
                    model: 'gpt-5-mini',
                    reasoning_effort: 'medium',
                    max_completion_tokens: 4096,
                    temperature: 0.7,
                    restaurant_id: this.restaurantData.id,
                    session_id: this.sessionId
                })
            });

            if (!response.ok) {
                throw new Error(`Erro na API: ${response.status}`);
            }

            const data = await response.json();
            return data.response || data.message || 'Desculpe, não consegui processar sua mensagem.';
            
        } catch (error) {
            console.error('❌ Erro ao chamar GPT-5-mini:', error);
            throw error;
        }
    }

    async processGPTResponse(response, userMessage) {
        // Processar resposta do GPT e identificar ações especiais
        
        // Verificar se precisa criar pedido
        if (response.includes('action":"finalizar') || response.includes('finalizar pedido')) {
            try {
                await this.createOrder();
                this.ordersCreated++;
                document.getElementById('ordersCount').textContent = this.ordersCreated;
            } catch (error) {
                console.error('❌ Erro ao criar pedido:', error);
                return response + '\n\nOps! Tive um problema ao processar seu pedido. Nosso suporte entrará em contato.';
            }
        }
        
        // Verificar se precisa consultar cardápio
        if (response.includes('consulta_sistema') || userMessage.toLowerCase().includes('cardápio') || userMessage.toLowerCase().includes('menu')) {
            try {
                const menu = await this.getRestaurantMenu();
                if (menu) {
                    return this.formatMenuResponse(menu);
                }
            } catch (error) {
                console.error('❌ Erro ao buscar cardápio:', error);
            }
        }
        
        return response;
    }

    async getRestaurantMenu() {
        try {
            const { data: products, error } = await this.supabase
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
                .eq('restaurant_id', this.restaurantData.id)
                .eq('active', true)
                .order('category_id')
                .order('name');

            if (error) throw error;
            return products;
            
        } catch (error) {
            console.error('❌ Erro ao buscar cardápio:', error);
            return null;
        }
    }

    formatMenuResponse(products) {
        if (!products || products.length === 0) {
            return 'Desculpe, não consegui carregar nosso cardápio no momento. 😅';
        }

        // Agrupar por categoria
        const categories = {};
        products.forEach(product => {
            const categoryName = product.product_categories?.name || 'Outros';
            if (!categories[categoryName]) {
                categories[categoryName] = [];
            }
            categories[categoryName].push(product);
        });

        let menuText = `Aqui está nosso cardápio delicioso! 😋\n\n`;
        
        for (const [categoryName, categoryProducts] of Object.entries(categories)) {
            menuText += `🍽️ **${categoryName}**\n\n`;
            
            categoryProducts.forEach(product => {
                const price = parseFloat(product.price).toFixed(2).replace('.', ',');
                menuText += `• **${product.name}** - R$ ${price}\n`;
                if (product.description) {
                    menuText += `  ${product.description}\n`;
                }
                menuText += '\n';
            });
        }
        
        menuText += 'Qual desses te deixou com água na boca? 😊';
        
        return menuText;
    }

    async createOrder() {
        try {
            // Extrair dados da memória para criar pedido
            const customerName = this.chatMemory.get('nome') || 'Cliente';
            const customerPhone = this.chatMemory.get('phone') || '';
            const customerAddress = this.chatMemory.get('endereco') || '';
            
            if (!customerPhone) {
                throw new Error('Telefone do cliente não informado');
            }

            // Criar pedido no banco de dados com status "novo"
            const orderData = {
                restaurant_id: this.restaurantData.id,
                customer_name: customerName,
                customer_phone: customerPhone,
                customer_address: customerAddress,
                order_type: 'delivery',
                status: 'novo', // Status obrigatório conforme solicitado
                total: this.currentOrder?.total || 0,
                payment_method: this.currentOrder?.paymentMethod || 'PIX',
                notes: `Pedido criado via Ana - Assistente Virtual\nSession ID: ${this.sessionId}`,
                created_at: new Date().toISOString()
            };

            const { data: order, error: orderError } = await this.supabase
                .from('orders')
                .insert([orderData])
                .select()
                .single();

            if (orderError) throw orderError;

            // Criar itens do pedido se existirem
            if (this.currentOrder?.items && this.currentOrder.items.length > 0) {
                const orderItems = this.currentOrder.items.map(item => ({
                    order_id: order.id,
                    product_name: item.name,
                    quantity: item.quantity || 1,
                    unit_price: item.price || 0,
                    total_price: (item.price || 0) * (item.quantity || 1),
                    additionals: item.additionals || []
                }));

                const { error: itemsError } = await this.supabase
                    .from('order_items')
                    .insert(orderItems);

                if (itemsError) throw itemsError;
            }

            console.log('✅ Pedido criado com sucesso:', order.id);
            
            // Atualizar memória
            this.chatMemory.set('ultimo_pedido_id', order.id);
            this.saveChatMemory();
            this.updateMemoryUI();
            
            return order;
            
        } catch (error) {
            console.error('❌ Erro ao criar pedido:', error);
            throw error;
        }
    }

    updateChatMemory(userMessage, response) {
        // Atualizar memória baseado na conversa
        this.chatMemory.set('ultima_mensagem_user', userMessage);
        this.chatMemory.set('ultima_resposta_ana', response);
        this.chatMemory.set('timestamp', new Date().toISOString());
        
        this.saveChatMemory();
        this.updateMemoryUI();
    }

    showError(message) {
        const messagesContainer = document.getElementById('chatMessages');
        const errorElement = document.createElement('div');
        errorElement.className = 'error-message';
        errorElement.innerHTML = `
            <i class="fas fa-exclamation-triangle"></i>
            ${message}
        `;
        messagesContainer.appendChild(errorElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

// Funções globais
function clearChat() {
    if (confirm('Tem certeza que deseja limpar o chat? Isso apagará toda a conversa atual.')) {
        const messagesContainer = document.getElementById('chatMessages');
        messagesContainer.innerHTML = '';
        
        if (window.ana) {
            window.ana.messages = [];
            window.ana.chatMemory.clear();
            window.ana.conversationState.stage = 'initial';
            window.ana.messageCount = 0;
            window.ana.ordersCreated = 0;
            
            document.getElementById('messageCount').textContent = '0';
            document.getElementById('ordersCount').textContent = '0';
            
            window.ana.initializeChat();
            window.ana.updateMemoryUI();
        }
    }
}

function selectPaymentMethod(method) {
    const messageInput = document.getElementById('messageInput');
    messageInput.value = method.trim();
    messageInput.focus();
}

// Inicializar quando a página carregar
document.addEventListener('DOMContentLoaded', async () => {
    try {
        window.ana = new AnaAssistant();
        await window.ana.init();
    } catch (error) {
        console.error('❌ Erro ao inicializar Ana:', error);
        document.getElementById('loadingState').innerHTML = `
            <div class="error-message">
                <i class="fas fa-exclamation-triangle"></i>
                Erro ao carregar o assistente. Recarregue a página.
            </div>
        `;
    }
});

// Exportar para uso global
window.AnaAssistant = AnaAssistant;