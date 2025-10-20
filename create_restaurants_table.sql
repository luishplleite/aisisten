-- ============================================
-- SCRIPT DE CRIAÇÃO DA TABELA RESTAURANTS
-- Inclui suporte para sistema de revendas
-- ============================================

CREATE TABLE IF NOT EXISTS public.restaurants (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  
  -- Dados básicos do restaurante
  name character varying(255) NOT NULL,
  dono character varying(255),
  email character varying(255) UNIQUE,
  telefone character varying(20),
  
  -- Endereço
  endereco text,
  numero character varying(20),
  complemento text,
  bairro character varying(100),
  cidade character varying(100),
  estado character varying(2),
  cep character varying(10),
  latitude numeric,
  longitude numeric,
  
  -- Sistema de revendas (NOVO)
  id_revendedor bigint REFERENCES public.subcontas_asass(id),
  
  -- Configurações de entrega
  third_party_delivery_enabled boolean DEFAULT false,
  house_delivery_enabled boolean DEFAULT false,
  house_minimum_delivery_fee numeric DEFAULT 5.00 CHECK (house_minimum_delivery_fee >= 0),
  house_delivery_fee_per_km numeric DEFAULT 2.00 CHECK (house_delivery_fee_per_km >= 0),
  house_minimum_distance_km numeric DEFAULT 2.0 CHECK (house_minimum_distance_km > 0),
  house_delivery_radius numeric DEFAULT 8.0 CHECK (house_delivery_radius > 0),
  
  -- Assinatura e trial
  subscription_plan character varying(50) DEFAULT 'trial',
  subscription_status character varying(50) DEFAULT 'trial',
  subscription_start_date timestamp with time zone,
  subscription_end_date timestamp with time zone,
  trial_end_date timestamp with time zone,
  
  -- Outros campos
  is_active boolean DEFAULT true,
  settings jsonb DEFAULT '{}'::jsonb,
  updated_at timestamp with time zone DEFAULT now()
);

-- Índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_restaurants_email ON public.restaurants(email);
CREATE INDEX IF NOT EXISTS idx_restaurants_id_revendedor ON public.restaurants(id_revendedor);
CREATE INDEX IF NOT EXISTS idx_restaurants_subscription_status ON public.restaurants(subscription_status);

-- Comentários para documentação
COMMENT ON TABLE public.restaurants IS 'Tabela de restaurantes cadastrados no sistema';
COMMENT ON COLUMN public.restaurants.id_revendedor IS 'ID do revendedor responsável pelo restaurante (FK para subcontas_asass)';
COMMENT ON COLUMN public.restaurants.third_party_delivery_enabled IS 'Indica se a entrega de terceiros (apps delivery) está habilitada';
COMMENT ON COLUMN public.restaurants.house_delivery_enabled IS 'Indica se a entrega da casa (própria) está habilitada';
COMMENT ON COLUMN public.restaurants.house_minimum_delivery_fee IS 'Taxa mínima de entrega da casa em reais';
COMMENT ON COLUMN public.restaurants.house_delivery_fee_per_km IS 'Taxa por quilômetro para entrega da casa em reais';
COMMENT ON COLUMN public.restaurants.house_minimum_distance_km IS 'Distância mínima em km para entrega da casa';
COMMENT ON COLUMN public.restaurants.house_delivery_radius IS 'Raio máximo de entrega da casa em km';

-- ============================================
-- OBSERVAÇÕES:
-- ============================================
-- 1. Execute este script no SQL Editor do Supabase
-- 2. A tabela será criada com suporte completo ao sistema de revendas
-- 3. A coluna id_revendedor é opcional e pode ser NULL para restaurantes sem revendedor
-- 4. Relacionamento com a tabela subcontas_asass está configurado via FK
-- ============================================
