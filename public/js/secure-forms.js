// ===== SISTEMA DE FORMULÁRIOS SEGUROS COM CSRF =====
// Exemplo de implementação para formulários com proteção CSRF

// Sistema de ocultação de logs para produção
if (typeof console !== 'undefined') {
    console.log = function() {};
    console.warn = function() {};
    console.error = function() {};
    console.info = function() {};
    console.debug = function() {};
}

class SecureFormManager {
    constructor() {
        this.forms = new Map();
        this.csrfToken = null;
        this.isInitialized = false;
    }
    
    // ===== INICIALIZAÇÃO =====
    async init() {
        if (this.isInitialized) return;
        
        try {
            // Garantir que o secureConfig está inicializado
            if (!window.secureConfig.isInitialized) {
                await window.secureConfig.init();
            }
            
            // Obter token CSRF
            await this.refreshCSRFToken();
            
            // Configurar todos os formulários existentes
            this.setupAllForms();
            
            this.isInitialized = true;
            console.log('🔒 Sistema de formulários seguros inicializado');
        } catch (error) {
            console.error('❌ Erro ao inicializar formulários seguros:', error);
        }
    }
    
    // ===== GERENCIAMENTO DO TOKEN CSRF =====
    async refreshCSRFToken() {
        try {
            this.csrfToken = await window.secureConfig.getCSRFToken();
            
            // Atualizar todos os formulários com o novo token
            this.updateAllFormsCSRFToken();
        } catch (error) {
            console.error('❌ Erro ao renovar CSRF token:', error);
        }
    }
    
    // ===== CONFIGURAÇÃO DE FORMULÁRIOS =====
    setupAllForms() {
        const forms = document.querySelectorAll('form[data-secure="true"]');
        forms.forEach(form => this.setupForm(form));
    }
    
    setupForm(form) {
        if (!form || !form.id) {
            console.warn('⚠️ Formulário sem ID encontrado, pulando configuração');
            return;
        }
        
        // Adicionar campo CSRF oculto
        this.addCSRFField(form);
        
        // Configurar submit handler
        this.setupSubmitHandler(form);
        
        // Configurar validação em tempo real
        this.setupRealTimeValidation(form);
        
        // Registrar formulário
        this.forms.set(form.id, {
            element: form,
            lastSubmit: null,
            isSubmitting: false
        });
        
        console.log(`🔧 Formulário seguro configurado: ${form.id}`);
    }
    
    addCSRFField(form) {
        // Remover campo CSRF existente se houver
        const existingField = form.querySelector('input[name="csrf_token"]');
        if (existingField) {
            existingField.remove();
        }
        
        // Adicionar novo campo CSRF
        const csrfField = document.createElement('input');
        csrfField.type = 'hidden';
        csrfField.name = 'csrf_token';
        csrfField.value = this.csrfToken || '';
        csrfField.className = 'csrf-token-field';
        
        form.insertBefore(csrfField, form.firstChild);
    }
    
    updateAllFormsCSRFToken() {
        document.querySelectorAll('.csrf-token-field').forEach(field => {
            field.value = this.csrfToken || '';
        });
    }
    
    // ===== SUBMIT HANDLER SEGURO =====
    setupSubmitHandler(form) {
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            await this.handleSecureSubmit(form, event);
        });
    }
    
    async handleSecureSubmit(form, event) {
        const formData = this.forms.get(form.id);
        if (!formData) return;
        
        // Prevenir submissões duplas
        if (formData.isSubmitting) {
            console.log('⏳ Formulário já sendo processado');
            return;
        }
        
        
        try {
            formData.isSubmitting = true;
            this.setFormLoading(form, true);
            
            // Validar formulário
            const validation = this.validateForm(form);
            if (!validation.isValid) {
                throw new Error(validation.errors[0]);
            }
            
            // Preparar dados
            const submitData = new FormData(form);
            const jsonData = this.formDataToObject(submitData);
            
            // Determinar URL de destino
            const actionUrl = form.getAttribute('data-action') || form.action;
            if (!actionUrl) {
                throw new Error('URL de destino não especificada');
            }
            
            // Enviar de forma segura
            const response = await window.secureConfig.secureFetch(actionUrl, {
                method: form.method || 'POST',
                body: JSON.stringify(jsonData)
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Erro do servidor: ${response.status}`);
            }
            
            const result = await response.json();
            
            // Processar sucesso
            await this.handleSubmitSuccess(form, result);
            
        } catch (error) {
            console.error('❌ Erro no envio do formulário:', error);
            this.handleSubmitError(form, error);
        } finally {
            formData.isSubmitting = false;
            this.setFormLoading(form, false);
        }
    }
    
    // ===== VALIDAÇÃO SEGURA =====
    validateForm(form) {
        const errors = [];
        
        // Validar campos obrigatórios
        const requiredFields = form.querySelectorAll('[required]');
        requiredFields.forEach(field => {
            if (!field.value.trim()) {
                const label = this.getFieldLabel(field);
                errors.push(`${label} é obrigatório`);
            }
        });
        
        // Validar emails
        const emailFields = form.querySelectorAll('input[type="email"]');
        emailFields.forEach(field => {
            if (field.value && !window.SecurityUtils.isValidEmail(field.value)) {
                const label = this.getFieldLabel(field);
                errors.push(`${label} deve ter um formato válido`);
            }
        });
        
        // Validar senhas (se houver)
        const passwordFields = form.querySelectorAll('input[type="password"]');
        passwordFields.forEach(field => {
            if (field.value && field.value.length < 6) {
                const label = this.getFieldLabel(field);
                errors.push(`${label} deve ter pelo menos 6 caracteres`);
            }
        });
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }
    
    setupRealTimeValidation(form) {
        const fields = form.querySelectorAll('input, textarea, select');
        
        fields.forEach(field => {
            // Validação on blur
            field.addEventListener('blur', () => {
                this.validateField(field);
            });
            
            // Limpeza de erros on input
            field.addEventListener('input', () => {
                this.clearFieldError(field);
            });
        });
    }
    
    validateField(field) {
        const errors = [];
        
        // Campo obrigatório
        if (field.hasAttribute('required') && !field.value.trim()) {
            const label = this.getFieldLabel(field);
            errors.push(`${label} é obrigatório`);
        }
        
        // Email
        if (field.type === 'email' && field.value && !window.SecurityUtils.isValidEmail(field.value)) {
            errors.push('Email deve ter um formato válido');
        }
        
        // Senha
        if (field.type === 'password' && field.value && field.value.length < 6) {
            errors.push('Senha deve ter pelo menos 6 caracteres');
        }
        
        if (errors.length > 0) {
            this.showFieldError(field, errors[0]);
        } else {
            this.clearFieldError(field);
        }
        
        return errors.length === 0;
    }
    
    // ===== FEEDBACK VISUAL =====
    setFormLoading(form, isLoading) {
        const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');
        const inputs = form.querySelectorAll('input, textarea, select');
        
        if (submitButton) {
            submitButton.disabled = isLoading;
            
            if (isLoading) {
                submitButton.classList.add('loading');
                const originalText = submitButton.textContent;
                submitButton.dataset.originalText = originalText;
                submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
            } else {
                submitButton.classList.remove('loading');
                submitButton.innerHTML = submitButton.dataset.originalText || 'Enviar';
            }
        }
        
        inputs.forEach(input => {
            input.disabled = isLoading;
        });
    }
    
    showFieldError(field, message) {
        this.clearFieldError(field);
        
        field.classList.add('error');
        
        const errorElement = document.createElement('div');
        errorElement.className = 'field-error';
        errorElement.textContent = message;
        
        field.parentNode.insertBefore(errorElement, field.nextSibling);
    }
    
    clearFieldError(field) {
        field.classList.remove('error');
        
        const errorElement = field.parentNode.querySelector('.field-error');
        if (errorElement) {
            errorElement.remove();
        }
    }
    
    // ===== HANDLERS DE RESULTADO =====
    async handleSubmitSuccess(form, result) {
        // Feedback de sucesso
        window.secureNotifications.show(
            result.message || 'Formulário enviado com sucesso!', 
            'success'
        );
        
        // Reset do formulário se especificado
        if (form.dataset.resetOnSuccess !== 'false') {
            form.reset();
        }
        
        // Redirecionamento se especificado
        if (result.redirect) {
            setTimeout(() => {
                window.location.href = result.redirect;
            }, 1500);
        }
        
        // Callback personalizado
        const successCallback = form.dataset.onSuccess;
        if (successCallback && typeof window[successCallback] === 'function') {
            window[successCallback](result);
        }
    }
    
    handleSubmitError(form, error) {
        // Se o erro for de CSRF, renovar token
        if (error.message.includes('CSRF')) {
            this.refreshCSRFToken();
        }
        
        // Feedback de erro
        window.secureNotifications.show(error.message, 'error');
        
        // Callback de erro
        const errorCallback = form.dataset.onError;
        if (errorCallback && typeof window[errorCallback] === 'function') {
            window[errorCallback](error);
        }
    }
    
    // ===== UTILITÁRIOS =====
    getFieldLabel(field) {
        const label = field.parentNode.querySelector('label[for="' + field.id + '"]') ||
                     field.parentNode.querySelector('label') ||
                     { textContent: field.placeholder || field.name || 'Campo' };
        return label.textContent.replace('*', '').trim();
    }
    
    formDataToObject(formData) {
        const object = {};
        formData.forEach((value, key) => {
            object[key] = value;
        });
        return object;
    }
    
    // ===== API PÚBLICA =====
    registerForm(formId, options = {}) {
        const form = document.getElementById(formId);
        if (form) {
            form.setAttribute('data-secure', 'true');
            if (options.action) form.setAttribute('data-action', options.action);
            if (options.resetOnSuccess !== undefined) form.setAttribute('data-reset-on-success', options.resetOnSuccess);
            if (options.onSuccess) form.setAttribute('data-on-success', options.onSuccess);
            if (options.onError) form.setAttribute('data-on-error', options.onError);
            
            this.setupForm(form);
        }
    }
    
    getFormData(formId) {
        const form = document.getElementById(formId);
        if (form) {
            const formData = new FormData(form);
            return this.formDataToObject(formData);
        }
        return null;
    }
}

// ===== CSS PARA FORMULÁRIOS SEGUROS =====
const secureFormsStyles = `
    .field-error {
        color: var(--danger-color);
        font-size: 0.8rem;
        margin-top: 0.25rem;
        display: block;
    }
    
    input.error, 
    textarea.error, 
    select.error {
        border-color: var(--danger-color) !important;
        box-shadow: 0 0 0 0.2rem rgba(220, 53, 69, 0.25) !important;
    }
    
    .btn.loading {
        position: relative;
        color: transparent !important;
    }
    
    .btn.loading::after {
        content: "";
        position: absolute;
        width: 16px;
        height: 16px;
        top: 50%;
        left: 50%;
        margin-left: -8px;
        margin-top: -8px;
        border: 2px solid #ffffff;
        border-radius: 50%;
        border-top-color: transparent;
        animation: spin 1s linear infinite;
    }
    
    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }
    
    /* Indicadores de campo obrigatório */
    .required::after {
        content: " *";
        color: var(--danger-color);
    }
`;

// Adicionar CSS ao documento
const styleSheet = document.createElement('style');
styleSheet.textContent = secureFormsStyles;
document.head.appendChild(styleSheet);

// ===== INSTÂNCIA GLOBAL =====
const secureFormManager = new SecureFormManager();

// Inicializar automaticamente quando o DOM estiver pronto
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        secureFormManager.init();
    });
} else {
    secureFormManager.init();
}

// Exportar para uso global
window.secureFormManager = secureFormManager;

console.log('🔒 Sistema de Formulários Seguros carregado');