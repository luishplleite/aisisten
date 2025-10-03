-- =================================================================
-- ATUALIZAÇÃO DO BANCO DE DADOS - FORMULÁRIO ADMIN RESTAURANTES
-- =================================================================
-- Data: 2025-09-15
-- Descrição: Adiciona colunas necessárias para o formulário de edição
--            de restaurantes no painel administrativo (admin.html#restaurants)
-- =================================================================

-- Executar todas as alterações em uma transação
BEGIN;

-- Verificar e adicionar coluna para email do responsável
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'restaurants' 
                   AND column_name = 'owner_email') THEN
        ALTER TABLE public.restaurants 
        ADD COLUMN owner_email character varying;
        RAISE NOTICE 'Coluna owner_email adicionada com sucesso';
    ELSE
        RAISE NOTICE 'Coluna owner_email já existe';
    END IF;
END $$;

-- Verificar e adicionar coluna para motivo da extensão do teste
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'restaurants' 
                   AND column_name = 'trial_extension_reason') THEN
        ALTER TABLE public.restaurants 
        ADD COLUMN trial_extension_reason text;
        RAISE NOTICE 'Coluna trial_extension_reason adicionada com sucesso';
    ELSE
        RAISE NOTICE 'Coluna trial_extension_reason já existe';
    END IF;
END $$;

-- Verificar e adicionar coluna para motivo da ativação manual
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'restaurants' 
                   AND column_name = 'manual_activation_reason') THEN
        ALTER TABLE public.restaurants 
        ADD COLUMN manual_activation_reason text;
        RAISE NOTICE 'Coluna manual_activation_reason adicionada com sucesso';
    ELSE
        RAISE NOTICE 'Coluna manual_activation_reason já existe';
    END IF;
END $$;

-- Verificar e adicionar coluna para motivo da alteração de status
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'restaurants' 
                   AND column_name = 'status_change_reason') THEN
        ALTER TABLE public.restaurants 
        ADD COLUMN status_change_reason text;
        RAISE NOTICE 'Coluna status_change_reason adicionada com sucesso';
    ELSE
        RAISE NOTICE 'Coluna status_change_reason já existe';
    END IF;
END $$;

-- =================================================================
-- COMENTÁRIOS SOBRE AS NOVAS COLUNAS
-- =================================================================
COMMENT ON COLUMN public.restaurants.owner_email IS 'Email do responsável pelo restaurante (usado no formulário admin)';
COMMENT ON COLUMN public.restaurants.trial_extension_reason IS 'Motivo da extensão do período de teste (registro administrativo)';
COMMENT ON COLUMN public.restaurants.manual_activation_reason IS 'Motivo da ativação manual de assinatura (registro administrativo)';
COMMENT ON COLUMN public.restaurants.status_change_reason IS 'Motivo da alteração de status do restaurante (registro administrativo)';

-- Confirmar transação
COMMIT;

-- =================================================================
-- VERIFICAÇÃO FINAL
-- =================================================================
-- Verificar se todas as colunas foram criadas
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_schema = 'public'
AND table_name = 'restaurants' 
AND column_name IN ('owner_email', 'trial_extension_reason', 'manual_activation_reason', 'status_change_reason')
ORDER BY column_name;

-- Relatório final de sucesso
DO $$ 
BEGIN
    RAISE NOTICE '=================================================================';
    RAISE NOTICE 'ATUALIZAÇÃO CONCLUÍDA - Novas colunas para formulário admin';
    RAISE NOTICE '=================================================================';
    RAISE NOTICE '✅ owner_email - Email do responsável';
    RAISE NOTICE '✅ trial_extension_reason - Motivo extensão teste';
    RAISE NOTICE '✅ manual_activation_reason - Motivo ativação manual';
    RAISE NOTICE '✅ status_change_reason - Motivo alteração status';
    RAISE NOTICE '=================================================================';
END $$;