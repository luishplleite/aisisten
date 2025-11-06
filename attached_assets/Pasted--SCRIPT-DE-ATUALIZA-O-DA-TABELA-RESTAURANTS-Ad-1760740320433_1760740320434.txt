-- ============================================
-- SCRIPT DE ATUALIZAÇÃO DA TABELA RESTAURANTS
-- Adiciona colunas para controle de entrega da casa
-- ============================================

-- Adicionar colunas para controle de tipos de entrega
ALTER TABLE restaurants
ADD COLUMN IF NOT EXISTS third_party_delivery_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS house_delivery_enabled BOOLEAN DEFAULT false;

-- Adicionar colunas para configuração de entrega da casa
ALTER TABLE restaurants
ADD COLUMN IF NOT EXISTS house_minimum_delivery_fee NUMERIC DEFAULT 5.00 CHECK (house_minimum_delivery_fee >= 0),
ADD COLUMN IF NOT EXISTS house_delivery_fee_per_km NUMERIC DEFAULT 2.00 CHECK (house_delivery_fee_per_km >= 0),
ADD COLUMN IF NOT EXISTS house_minimum_distance_km NUMERIC DEFAULT 2.0 CHECK (house_minimum_distance_km > 0),
ADD COLUMN IF NOT EXISTS house_delivery_radius NUMERIC DEFAULT 8.0 CHECK (house_delivery_radius > 0);

-- Comentários para documentação das colunas
COMMENT ON COLUMN restaurants.third_party_delivery_enabled IS 'Indica se a entrega de terceiros (apps delivery) está habilitada';
COMMENT ON COLUMN restaurants.house_delivery_enabled IS 'Indica se a entrega da casa (própria) está habilitada';
COMMENT ON COLUMN restaurants.house_minimum_delivery_fee IS 'Taxa mínima de entrega da casa em reais';
COMMENT ON COLUMN restaurants.house_delivery_fee_per_km IS 'Taxa por quilômetro para entrega da casa em reais';
COMMENT ON COLUMN restaurants.house_minimum_distance_km IS 'Distância mínima em km para entrega da casa';
COMMENT ON COLUMN restaurants.house_delivery_radius IS 'Raio máximo de entrega da casa em km';

-- Verificar se as colunas foram criadas com sucesso
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'restaurants' 
AND column_name IN (
    'third_party_delivery_enabled',
    'house_delivery_enabled',
    'house_minimum_delivery_fee',
    'house_delivery_fee_per_km',
    'house_minimum_distance_km',
    'house_delivery_radius'
)
ORDER BY column_name;

-- ============================================
-- OBSERVAÇÕES:
-- ============================================
-- 1. Execute este script no SQL Editor do Supabase
-- 2. As colunas serão criadas com valores padrão
-- 3. Restaurantes existentes terão ambos os tipos de entrega desabilitados por padrão
-- 4. Os administradores podem habilitar cada tipo de entrega individualmente
-- ============================================
