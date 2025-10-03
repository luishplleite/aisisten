class TrialCountdown {
    constructor() {
        this.init();
    }

    async init() {
        await this.checkTrialStatus();
        this.createCountdownBanner();
        this.startCountdown();
        this.checkAutoDisconnect();
    }

    async checkTrialStatus() {
        try {
            // Tentar obter restaurantId de múltiplas fontes
            let restaurantId = null;
            
            // 1. Tentar getInstanceData se existir
            if (window.getInstanceData) {
                const instanceData = window.getInstanceData();
                restaurantId = instanceData?.restaurantId;
            }
            
            // 2. Tentar obter do cookie de sessão
            if (!restaurantId) {
                const cookieValue = this.getCookieValue('timepulse_instance_token');
                if (cookieValue) {
                    try {
                        const sessionData = JSON.parse(decodeURIComponent(cookieValue));
                        restaurantId = sessionData.restaurantId;
                    } catch (e) {
                        console.log('Erro ao parse do cookie de sessão:', e);
                    }
                }
            }
            
            // 3. Se não conseguir restaurantId, verificar se é desenvolvimento
            if (!restaurantId) {
                // Detectar ambiente de desenvolvimento
                const isDevelopment = window.location.hostname.includes('replit') || 
                                     window.location.hostname === 'localhost' || 
                                     window.location.hostname === '127.0.0.1' ||
                                     window.location.hostname.includes('replit.dev') ||
                                     window.location.hostname.includes('repl.co');
                
                if (isDevelopment) {
                    console.log('🛠️ MODO DESENVOLVIMENTO: Usando restaurantId mockado para trial');
                    restaurantId = 'dev-restaurant-1';
                } else {
                    console.log('❌ Nenhum restaurantId encontrado');
                    return;
                }
            }

            const response = await fetch(`/api/trial-status/${restaurantId}`);
            const data = await response.json();
            
            if (response.ok) {
                this.trialData = data;
                console.log('✅ Status da assinatura carregado:', data);
            } else {
                console.error('❌ Erro na resposta do servidor:', data);
            }
        } catch (error) {
            console.error('❌ Erro ao verificar status do teste:', error);
        }
    }
    
    getCookieValue(name) {
        const cookies = document.cookie.split('; ');
        for (let cookie of cookies) {
            const [cookieName, cookieValue] = cookie.split('=');
            if (cookieName === name) {
                return cookieValue;
            }
        }
        return null;
    }

    createCountdownBanner() {
        if (!this.trialData) return;

        const banner = document.createElement('div');
        banner.id = 'trial-countdown-banner';
        banner.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: linear-gradient(90deg, #ff6b6b, #ff8e53);
            color: white;
            text-align: center;
            padding: 12px;
            font-weight: 600;
            z-index: 9999;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        `;

        document.body.appendChild(banner);
        
        // Ajustar padding do body para não sobrepor conteúdo
        document.body.style.paddingTop = '50px';
    }

    startCountdown() {
        if (!this.trialData) return;

        const updateCountdown = () => {
            const now = new Date().getTime();
            const banner = document.getElementById('trial-countdown-banner');
            if (!banner) return;

            // Verificar se tem assinatura ativa (prioridade máxima)
            if (this.trialData.subscription_status === 'active') {
                // Status ativo é sempre suficiente - ignorar subscription_end_date
                banner.style.background = 'linear-gradient(90deg, #28a745, #20c997)';
                banner.innerHTML = `
                    <i class="fas fa-check-circle"></i> 
                    ASSINATURA ATIVA - Plano: ${this.trialData.plan?.toUpperCase() || 'BÁSICO'} | 
                    <a href="assinaturas.html" style="color: white; text-decoration: underline;">
                        Gerenciar assinatura
                    </a>
                `;
                return;
            }

            // Verificar se tem assinatura expirada (diferente de teste)
            if (this.trialData.subscription_status === 'expired') {
                banner.style.background = 'linear-gradient(90deg, #fd7e14, #e63946)';
                banner.innerHTML = `
                    <i class="fas fa-exclamation-circle"></i> 
                    ASSINATURA EXPIRADA - Renove para continuar usando | 
                    <a href="assinaturas.html" style="color: white; text-decoration: underline;">
                        Renovar assinatura
                    </a>
                `;
                return;
            }

            // Lógica do período de teste
            if (this.trialData.trial_end_date) {
                const endTime = new Date(this.trialData.trial_end_date).getTime();
                const distance = endTime - now;

                if (distance > 0 && (this.trialData.subscription_status === 'trial' || !this.trialData.subscription_status)) {
                    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
                    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));

                    // Teste ativo
                    banner.style.background = 'linear-gradient(90deg, #ff6b6b, #ff8e53)';
                    banner.innerHTML = `
                        <i class="fas fa-clock"></i> 
                        TESTE GRATUITO: ${days}d ${hours}h ${minutes}m restantes | 
                        <a href="assinaturas.html" style="color: white; text-decoration: underline;">
                            Assine agora e continue usando!
                        </a>
                    `;
                } else {
                    // Teste expirado
                    banner.style.background = 'linear-gradient(90deg, #dc3545, #c82333)';
                    banner.innerHTML = `
                        <i class="fas fa-exclamation-triangle"></i> 
                        TESTE EXPIRADO - Sistema limitado | 
                        <a href="assinaturas.html" style="color: white; text-decoration: underline;">
                            Assinar para reativar todas as funcionalidades
                        </a>
                    `;
                    
                    // Chamar função de tratamento de expiração
                    this.handleTrialExpired();
                }
            } else {
                // Sem data de teste - presumir expirado
                banner.style.background = 'linear-gradient(90deg, #dc3545, #c82333)';
                banner.innerHTML = `
                    <i class="fas fa-exclamation-triangle"></i> 
                    ACESSO LIMITADO - Configure sua assinatura | 
                    <a href="assinaturas.html" style="color: white; text-decoration: underline;">
                        Assinar agora
                    </a>
                `;
            }
        };

        updateCountdown();
        setInterval(updateCountdown, 60000); // Atualizar a cada minuto
    }

    async handleTrialExpired() {
        // Desconectar WhatsApp quando teste expira
        try {
            const instanceData = window.getInstanceData ? window.getInstanceData() : null;
            if (!instanceData?.restaurantId) return;

            const response = await fetch('/api/disconnect-whatsapp-trial', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    restaurantId: instanceData.restaurantId,
                    reason: 'trial_expired' 
                })
            });

            if (response.ok) {
                console.log('WhatsApp desconectado devido ao fim do teste');
            }
        } catch (error) {
            console.error('Erro ao desconectar WhatsApp:', error);
        }
    }

    async checkAutoDisconnect() {
        // Verificar se precisa desconectar o WhatsApp
        if (this.trialData?.subscription_status === 'expired' && 
            !this.trialData?.whatsapp_disconnected_due_to_trial) {
            await this.handleTrialExpired();
        }
    }
}

// Inicializar em todas as páginas
document.addEventListener('DOMContentLoaded', () => {
    new TrialCountdown();
});