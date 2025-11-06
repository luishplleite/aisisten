-- ============================================================================
-- ATUALIZAÇÃO DA TABELA ORDERS PARA CÁLCULO DE TAXA DE ENTREGA
-- Data: 2025-11-02
-- Descrição: Adiciona campo delivery_type para armazenar o tipo de entrega
--            (terceiros ou própria) de forma mais clara
-- ============================================================================

-- Adicionar coluna delivery_type para armazenar 'third-party' ou 'house'
-- Isso substitui/complementa o campo tipo_entrega boolean existente
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS delivery_type VARCHAR(20) CHECK (delivery_type IN ('third-party', 'house'));

-- Adicionar comentário explicativo
COMMENT ON COLUMN public.orders.delivery_type IS 'Tipo de entrega: third-party (terceiros/motoboy) ou house (própria/interna)';

-- Os campos delivery_distance e delivery_duration já existem na tabela
-- Vamos adicionar comentários para clareza
COMMENT ON COLUMN public.orders.delivery_distance IS 'Distância calculada pelo Mapbox em km';
COMMENT ON COLUMN public.orders.delivery_duration IS 'Tempo estimado de entrega calculado pelo Mapbox em minutos';

-- Atualizar registros existentes baseado no campo tipo_entrega boolean (se houver)
-- true = própria (house), false/null = terceiros (third-party)
-- Atualiza TODOS os pedidos de delivery (não apenas os com delivery_fee > 0)
UPDATE public.orders
SET delivery_type = CASE
    WHEN tipo_entrega = true THEN 'house'
    ELSE 'third-party'
END
WHERE delivery_type IS NULL 
  AND delivery_address IS NOT NULL 
  AND delivery_address NOT IN ('Balcão', 'Mesa');  -- Apenas pedidos de delivery real

-- ============================================================================
-- FIM DA ATUALIZAÇÃO
-- ============================================================================
