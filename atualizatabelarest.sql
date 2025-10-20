-- =====================================================
-- SCRIPT DE ATUALIZAÇÃO DA TABELA RESTAURANTS
-- Vinculação do Tipo de Negócio com a Tabela business_types
-- =====================================================

-- PASSO 1: Adicionar coluna is_food_business à tabela business_types
-- =====================================================
ALTER TABLE public.business_types 
ADD COLUMN IF NOT EXISTS is_food_business boolean DEFAULT false;

-- PASSO 2: Popular a tabela business_types com os tipos de negócio
-- =====================================================
INSERT INTO public.business_types (name, description, active, is_food_business)
VALUES 
    ('Restaurante', 'Restaurante tradicional com atendimento completo', true, true),
    ('Lanchonete', 'Estabelecimento especializado em lanches e fast food', true, true),
    ('Pizzaria', 'Estabelecimento especializado em pizzas', true, true),
    ('Hamburgueria', 'Estabelecimento especializado em hambúrgueres', true, true),
    ('Sorveteria', 'Estabelecimento especializado em sorvetes e gelados', true, true),
    ('Açaí', 'Estabelecimento especializado em açaí e sobremesas', true, true),
    ('Padaria', 'Padaria e confeitaria', true, true),
    ('Cafeteria', 'Cafeteria e café gourmet', true, true),
    ('Bar', 'Bar e petiscaria', true, true),
    ('Sushi', 'Restaurante japonês especializado em sushi', true, true),
    ('Churrascaria', 'Churrascaria e carnes', true, true),
    ('Vegetariano/Vegano', 'Restaurante vegetariano ou vegano', true, true),
    ('Comida Caseira', 'Restaurante de comida caseira por quilo', true, true),
    ('Delivery', 'Estabelecimento focado em delivery', true, false),
    ('Outros', 'Outros tipos de estabelecimento', true, false)
ON CONFLICT (name) DO UPDATE SET 
    description = EXCLUDED.description,
    is_food_business = EXCLUDED.is_food_business;

-- PASSO 3: Adicionar coluna business_type_id na tabela restaurants
-- =====================================================
ALTER TABLE public.restaurants 
ADD COLUMN IF NOT EXISTS business_type_id uuid;

-- PASSO 4: Criar índice para melhorar performance
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_restaurants_business_type_id 
ON public.restaurants(business_type_id);

-- PASSO 5: Migrar dados existentes de business_type (texto) para business_type_id (UUID)
-- =====================================================

-- Atualizar restaurantes que têm business_type = 'restaurante'
UPDATE public.restaurants r
SET business_type_id = bt.id
FROM public.business_types bt
WHERE LOWER(r.business_type) = 'restaurante' 
  AND bt.name = 'Restaurante'
  AND r.business_type_id IS NULL;

-- Atualizar restaurantes que têm business_type = 'lanchonete'
UPDATE public.restaurants r
SET business_type_id = bt.id
FROM public.business_types bt
WHERE LOWER(r.business_type) = 'lanchonete'
  AND bt.name = 'Lanchonete'
  AND r.business_type_id IS NULL;

-- Atualizar restaurantes que têm business_type = 'pizzaria'
UPDATE public.restaurants r
SET business_type_id = bt.id
FROM public.business_types bt
WHERE LOWER(r.business_type) = 'pizzaria'
  AND bt.name = 'Pizzaria'
  AND r.business_type_id IS NULL;

-- Atualizar restaurantes que têm business_type = 'hamburgueria'
UPDATE public.restaurants r
SET business_type_id = bt.id
FROM public.business_types bt
WHERE LOWER(r.business_type) = 'hamburgueria'
  AND bt.name = 'Hamburgueria'
  AND r.business_type_id IS NULL;

-- Atualizar restaurantes que têm business_type = 'sorveteria'
UPDATE public.restaurants r
SET business_type_id = bt.id
FROM public.business_types bt
WHERE LOWER(r.business_type) = 'sorveteria'
  AND bt.name = 'Sorveteria'
  AND r.business_type_id IS NULL;

-- Atualizar restaurantes que têm business_type = 'açaí' ou 'acai'
UPDATE public.restaurants r
SET business_type_id = bt.id
FROM public.business_types bt
WHERE (LOWER(r.business_type) = 'açaí' OR LOWER(r.business_type) = 'acai')
  AND bt.name = 'Açaí'
  AND r.business_type_id IS NULL;

-- Atualizar restaurantes que têm business_type = 'padaria'
UPDATE public.restaurants r
SET business_type_id = bt.id
FROM public.business_types bt
WHERE LOWER(r.business_type) = 'padaria'
  AND bt.name = 'Padaria'
  AND r.business_type_id IS NULL;

-- Atualizar restaurantes que têm business_type = 'cafeteria'
UPDATE public.restaurants r
SET business_type_id = bt.id
FROM public.business_types bt
WHERE LOWER(r.business_type) = 'cafeteria'
  AND bt.name = 'Cafeteria'
  AND r.business_type_id IS NULL;

-- Atualizar restaurantes que têm business_type = 'bar'
UPDATE public.restaurants r
SET business_type_id = bt.id
FROM public.business_types bt
WHERE LOWER(r.business_type) = 'bar'
  AND bt.name = 'Bar'
  AND r.business_type_id IS NULL;

-- Atualizar restaurantes sem business_type definido para 'Outros'
UPDATE public.restaurants r
SET business_type_id = bt.id
FROM public.business_types bt
WHERE (r.business_type IS NULL OR r.business_type = '')
  AND bt.name = 'Outros'
  AND r.business_type_id IS NULL;

-- Atualizar restaurantes com business_type não mapeado para 'Outros'
UPDATE public.restaurants r
SET business_type_id = bt.id
FROM public.business_types bt
WHERE r.business_type_id IS NULL
  AND bt.name = 'Outros';

-- PASSO 5: Adicionar Foreign Key constraint
-- =====================================================
ALTER TABLE public.restaurants
ADD CONSTRAINT fk_restaurants_business_type 
FOREIGN KEY (business_type_id) 
REFERENCES public.business_types(id)
ON DELETE SET NULL;

-- PASSO 6: Adicionar comentários nas colunas para documentação
-- =====================================================
COMMENT ON COLUMN public.restaurants.business_type IS 'Campo legado - usar business_type_id';
COMMENT ON COLUMN public.restaurants.business_type_id IS 'Referência para a tabela business_types - Tipo de negócio do restaurante';

-- =====================================================
-- VERIFICAÇÕES FINAIS
-- =====================================================

-- Ver quantos restaurantes foram migrados
SELECT 
    'Total de restaurantes' as descricao,
    COUNT(*) as quantidade
FROM public.restaurants
UNION ALL
SELECT 
    'Restaurantes com business_type_id definido' as descricao,
    COUNT(*) as quantidade
FROM public.restaurants
WHERE business_type_id IS NOT NULL
UNION ALL
SELECT 
    'Restaurantes sem business_type_id' as descricao,
    COUNT(*) as quantidade
FROM public.restaurants
WHERE business_type_id IS NULL;

-- Ver distribuição por tipo de negócio
SELECT 
    bt.name as tipo_negocio,
    COUNT(r.id) as quantidade_restaurantes
FROM public.business_types bt
LEFT JOIN public.restaurants r ON r.business_type_id = bt.id
WHERE bt.active = true
GROUP BY bt.name
ORDER BY quantidade_restaurantes DESC;

-- =====================================================
-- SCRIPT CONCLUÍDO COM SUCESSO
-- =====================================================
-- PRÓXIMOS PASSOS:
-- 1. Atualizar configuracoes.html para carregar tipos de negócio dinamicamente
-- 2. Criar endpoint /api/business-types para listar tipos ativos
-- 3. Considerar remover coluna business_type (texto) após validação
-- =====================================================
