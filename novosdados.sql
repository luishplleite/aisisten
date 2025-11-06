-- ========================================
-- ATUALIZAÇÃO DA TABELA ORDERS
-- Adicionar campo delivery_type para tipo de entrega
-- Data: 2025-11-02
-- ========================================

-- Adicionar coluna delivery_type se não existir
-- Valores possíveis: 'third-party' (terceiros) ou 'house' (própria)
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS delivery_type VARCHAR(20) 
CHECK (delivery_type IN ('third-party', 'house'));

-- Adicionar comentário na coluna para documentação
COMMENT ON COLUMN public.orders.delivery_type IS 
'Tipo de entrega: third-party (terceiros/motoboy) ou house (própria/interna)';

-- ========================================
-- MIGRAÇÃO DE DADOS EXISTENTES (OPCIONAL)
-- Converter campo boolean tipo_entrega para delivery_type (se existir)
-- ========================================

-- Atualizar registros existentes baseado no campo tipo_entrega boolean (se a coluna existir)
-- tipo_entrega: true = casa (house), false = terceiros (third-party)
-- NOTA: Esta migração só funciona se a coluna tipo_entrega existir no seu banco
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'orders' 
        AND column_name = 'tipo_entrega'
    ) THEN
        UPDATE public.orders 
        SET delivery_type = CASE
            WHEN tipo_entrega = true THEN 'house'
            WHEN tipo_entrega = false THEN 'third-party'
            ELSE delivery_type
        END
        WHERE delivery_type IS NULL AND tipo_entrega IS NOT NULL;
    END IF;
END $$;

-- ========================================
-- VERIFICAÇÃO
-- ========================================

-- Verificar registros atualizados
SELECT 
    COUNT(*) as total_orders,
    COUNT(CASE WHEN delivery_type = 'house' THEN 1 END) as entrega_propria,
    COUNT(CASE WHEN delivery_type = 'third-party' THEN 1 END) as entrega_terceiros,
    COUNT(CASE WHEN delivery_type IS NULL THEN 1 END) as sem_tipo_entrega
FROM public.orders;

-- ========================================
-- CONCLUÍDO
-- Campo delivery_type adicionado e dados migrados com sucesso!
-- ========================================
