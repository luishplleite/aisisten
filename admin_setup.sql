-- ===== SISTEMA DE ADMINISTRAÇÃO DO TIMEPULSE AI =====
-- Script para criar tabela de administradores e dados iniciais
-- Data: 15/09/2025

-- =================================================================
-- 1. CRIAÇÃO DA TABELA DE ADMINISTRADORES
-- =================================================================

CREATE TABLE IF NOT EXISTS public.system_administrators (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    email character varying NOT NULL UNIQUE,
    password_hash character varying NOT NULL,
    name character varying NOT NULL,
    role character varying DEFAULT 'admin'::character varying 
        CHECK (role::text = ANY (ARRAY['admin'::character varying::text, 'super_admin'::character varying::text])),
    permissions jsonb DEFAULT '{"restaurants": {"view": true, "edit": true, "delete": false}, "trials": {"view": true, "extend": true, "block": true}, "subscriptions": {"view": true, "manage": true, "cancel": true}, "system": {"stats": true, "logs": true, "settings": false}}'::jsonb,
    last_login timestamp with time zone,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT system_administrators_pkey PRIMARY KEY (id)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_system_administrators_email ON public.system_administrators(email);
CREATE INDEX IF NOT EXISTS idx_system_administrators_active ON public.system_administrators(active);

-- =================================================================
-- 2. TABELA DE LOGS DE AÇÕES ADMINISTRATIVAS
-- =================================================================

CREATE TABLE IF NOT EXISTS public.admin_action_logs (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    admin_id uuid NOT NULL,
    action_type character varying NOT NULL,
    target_type character varying NOT NULL, -- 'restaurant', 'trial', 'subscription', 'system'
    target_id uuid,
    action_description text NOT NULL,
    old_values jsonb,
    new_values jsonb,
    ip_address inet,
    user_agent text,
    success boolean DEFAULT true,
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT admin_action_logs_pkey PRIMARY KEY (id),
    CONSTRAINT admin_action_logs_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.system_administrators(id)
);

-- Índices para logs
CREATE INDEX IF NOT EXISTS idx_admin_action_logs_admin_id ON public.admin_action_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_action_logs_action_type ON public.admin_action_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_admin_action_logs_created_at ON public.admin_action_logs(created_at);

-- =================================================================
-- 3. INSERIR USUÁRIO ADMINISTRADOR INICIAL
-- =================================================================

-- Função para gerar hash da senha (simulando bcrypt com sha256)
-- Em produção, use bcrypt adequadamente
DO $$ 
DECLARE
    password_plain text := '@Lucas281178@';
    salt text := 'timepulse_admin_salt_2025';
    password_hashed text;
BEGIN
    -- Simular hash com salt (em produção usar bcrypt)
    password_hashed := encode(sha256((password_plain || salt)::bytea), 'hex');
    
    -- Inserir administrador se não existir
    INSERT INTO public.system_administrators (
        email, 
        password_hash, 
        name, 
        role, 
        permissions,
        active
    ) VALUES (
        'luishplleite@gmail.com',
        password_hashed,
        'Luís Henrique - Admin',
        'super_admin',
        '{"restaurants": {"view": true, "edit": true, "delete": true}, "trials": {"view": true, "extend": true, "block": true, "reset": true}, "subscriptions": {"view": true, "manage": true, "cancel": true, "force_renew": true}, "system": {"stats": true, "logs": true, "settings": true, "backups": true}}'::jsonb,
        true
    ) ON CONFLICT (email) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        permissions = EXCLUDED.permissions,
        role = EXCLUDED.role,
        updated_at = now();
    
    RAISE NOTICE 'Administrador criado/atualizado: luishplleite@gmail.com';
    RAISE NOTICE 'Hash da senha: %', password_hashed;
END $$;

-- =================================================================
-- 4. VIEWS PARA RELATÓRIOS ADMINISTRATIVOS
-- =================================================================

-- View para estatísticas dos restaurantes
CREATE OR REPLACE VIEW admin_restaurant_stats AS
SELECT 
    COUNT(*) as total_restaurants,
    COUNT(*) FILTER (WHERE status = 'active') as active_restaurants,
    COUNT(*) FILTER (WHERE status = 'inactive') as inactive_restaurants,
    COUNT(*) FILTER (WHERE status = 'suspended') as suspended_restaurants,
    COUNT(*) FILTER (WHERE subscription_status = 'trial') as trial_restaurants,
    COUNT(*) FILTER (WHERE subscription_status = 'active') as paid_restaurants,
    COUNT(*) FILTER (WHERE subscription_status = 'expired') as expired_restaurants,
    COUNT(*) FILTER (WHERE subscription_status = 'cancelled') as cancelled_restaurants,
    COUNT(*) FILTER (WHERE trial_enabled = true AND trial_end_date > now()) as active_trials,
    COUNT(*) FILTER (WHERE trial_enabled = true AND trial_end_date <= now()) as expired_trials,
    AVG(trial_days_remaining) FILTER (WHERE subscription_status = 'trial') as avg_trial_days_remaining
FROM public.restaurants;

-- View para restaurantes com detalhes administrativos
CREATE OR REPLACE VIEW admin_restaurants_detailed AS
SELECT 
    r.id,
    r.name,
    r.owner_name,
    r.owner_phone,
    r.city,
    r.state,
    r.status,
    r.subscription_status,
    r.trial_enabled,
    r.trial_start_date,
    r.trial_end_date,
    r.trial_days_remaining,
    r.subscription_start_date,
    r.subscription_end_date,
    r.subscription_days_remaining,
    r.whatsapp_disconnected_due_to_trial,
    r.created_at,
    r.updated_at,
    -- Calcular dias restantes do trial em tempo real
    CASE 
        WHEN r.trial_enabled = true AND r.trial_end_date > now() 
        THEN EXTRACT(DAY FROM (r.trial_end_date - now()))::integer
        ELSE 0 
    END as trial_days_remaining_calculated,
    -- Status consolidado
    CASE 
        WHEN r.status = 'suspended' THEN 'Suspenso'
        WHEN r.status = 'inactive' THEN 'Inativo'
        WHEN r.subscription_status = 'trial' AND r.trial_end_date > now() THEN 'Teste Ativo'
        WHEN r.subscription_status = 'trial' AND r.trial_end_date <= now() THEN 'Teste Expirado'
        WHEN r.subscription_status = 'active' THEN 'Assinatura Ativa'
        WHEN r.subscription_status = 'expired' THEN 'Assinatura Expirada'
        WHEN r.subscription_status = 'cancelled' THEN 'Assinatura Cancelada'
        ELSE 'Indefinido'
    END as status_display
FROM public.restaurants r
ORDER BY r.created_at DESC;

-- =================================================================
-- 5. FUNÇÕES ADMINISTRATIVAS
-- =================================================================

-- Função para estender período de teste
CREATE OR REPLACE FUNCTION admin_extend_trial(
    restaurant_id_param uuid,
    extra_days integer,
    admin_id_param uuid
) RETURNS json AS $$
DECLARE
    result json;
    old_end_date timestamp with time zone;
    new_end_date timestamp with time zone;
    restaurant_name text;
BEGIN
    -- Buscar dados atuais
    SELECT trial_end_date, name INTO old_end_date, restaurant_name
    FROM public.restaurants 
    WHERE id = restaurant_id_param;
    
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Restaurante não encontrado');
    END IF;
    
    -- Calcular nova data
    new_end_date := old_end_date + (extra_days || ' days')::interval;
    
    -- Atualizar restaurante
    UPDATE public.restaurants 
    SET 
        trial_end_date = new_end_date,
        trial_days_remaining = EXTRACT(DAY FROM (new_end_date - now()))::integer,
        trial_enabled = true,
        updated_at = now()
    WHERE id = restaurant_id_param;
    
    -- Log da ação
    INSERT INTO public.admin_action_logs (
        admin_id, action_type, target_type, target_id, action_description,
        old_values, new_values
    ) VALUES (
        admin_id_param, 'extend_trial', 'restaurant', restaurant_id_param,
        format('Período de teste estendido em %s dias para %s', extra_days, restaurant_name),
        json_build_object('trial_end_date', old_end_date),
        json_build_object('trial_end_date', new_end_date, 'extra_days', extra_days)
    );
    
    RETURN json_build_object(
        'success', true, 
        'old_end_date', old_end_date,
        'new_end_date', new_end_date,
        'extra_days', extra_days
    );
END;
$$ LANGUAGE plpgsql;

-- Função para bloquear/desbloquear restaurante
CREATE OR REPLACE FUNCTION admin_toggle_restaurant_status(
    restaurant_id_param uuid,
    new_status text,
    admin_id_param uuid,
    reason text DEFAULT NULL
) RETURNS json AS $$
DECLARE
    result json;
    old_status text;
    restaurant_name text;
BEGIN
    -- Validar status
    IF new_status NOT IN ('active', 'inactive', 'suspended') THEN
        RETURN json_build_object('success', false, 'error', 'Status inválido');
    END IF;
    
    -- Buscar dados atuais
    SELECT status, name INTO old_status, restaurant_name
    FROM public.restaurants 
    WHERE id = restaurant_id_param;
    
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Restaurante não encontrado');
    END IF;
    
    -- Atualizar status
    UPDATE public.restaurants 
    SET 
        status = new_status,
        updated_at = now()
    WHERE id = restaurant_id_param;
    
    -- Log da ação
    INSERT INTO public.admin_action_logs (
        admin_id, action_type, target_type, target_id, action_description,
        old_values, new_values
    ) VALUES (
        admin_id_param, 'change_status', 'restaurant', restaurant_id_param,
        format('Status alterado de %s para %s para %s. Motivo: %s', old_status, new_status, restaurant_name, COALESCE(reason, 'Não informado')),
        json_build_object('status', old_status),
        json_build_object('status', new_status, 'reason', reason)
    );
    
    RETURN json_build_object(
        'success', true, 
        'old_status', old_status,
        'new_status', new_status
    );
END;
$$ LANGUAGE plpgsql;

-- =================================================================
-- 6. COMENTÁRIOS E DOCUMENTAÇÃO
-- =================================================================

COMMENT ON TABLE public.system_administrators IS 'Administradores do sistema TimePulse AI';
COMMENT ON TABLE public.admin_action_logs IS 'Log de todas as ações administrativas realizadas';
COMMENT ON VIEW admin_restaurant_stats IS 'Estatísticas consolidadas dos restaurantes para dashboard';
COMMENT ON VIEW admin_restaurants_detailed IS 'Listagem detalhada dos restaurantes com informações administrativas';

-- Finalização
DO $$ 
BEGIN
    RAISE NOTICE '=== SISTEMA ADMINISTRATIVO CRIADO COM SUCESSO ===';
    RAISE NOTICE 'Tabelas criadas:';
    RAISE NOTICE '- system_administrators';
    RAISE NOTICE '- admin_action_logs';
    RAISE NOTICE 'Views criadas:';
    RAISE NOTICE '- admin_restaurant_stats';
    RAISE NOTICE '- admin_restaurants_detailed';
    RAISE NOTICE 'Funções criadas:';
    RAISE NOTICE '- admin_extend_trial()';
    RAISE NOTICE '- admin_toggle_restaurant_status()';
    RAISE NOTICE '';
    RAISE NOTICE 'Usuário administrador criado:';
    RAISE NOTICE 'Email: luishplleite@gmail.com';
    RAISE NOTICE 'Senha: @Lucas281178@';
    RAISE NOTICE '';
    RAISE NOTICE 'Execute este script no editor SQL do Supabase!';
END $$;