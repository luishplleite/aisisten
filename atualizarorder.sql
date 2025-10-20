-- Adicionar coluna Tipo_entrega na tabela orders
-- true = Entrega da Casa (Própria)
-- false = Entrega de Terceiros (Apps de Delivery)

ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS Tipo_entrega BOOLEAN DEFAULT NULL;

-- Comentário explicativo
COMMENT ON COLUMN public.orders.Tipo_entrega IS 'Tipo de entrega: true = Entrega da Casa (própria), false = Entrega de Terceiros (apps), NULL = não definido';
