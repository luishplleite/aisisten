-- ============================================
-- SCRIPT DE CRIAÇÃO DA TABELA SUBCONTAS_ASASS
-- Sistema de Revendas - TimePulse AI
-- ============================================

CREATE TABLE IF NOT EXISTS public.subcontas_asass (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  
  -- Dados pessoais
  name text,
  email text,
  phone text,
  cpfCnpj text,
  birthDate text,
  personType text, -- 'FISICA' ou 'JURIDICA'
  
  -- Endereço
  address text,
  addressNumber text,
  complement text,
  postalCode text,
  city text,
  state text,
  country text,
  
  -- Dados financeiros/bancários
  walletId text,
  apiKey text,
  agency text,
  account text,
  accountDigi text,
  status boolean,
  saldo_atual text,
  tipo_conta text,
  
  CONSTRAINT subcontas_asass_pkey PRIMARY KEY (id)
);

-- Índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_subcontas_asass_email ON public.subcontas_asass(email);
CREATE INDEX IF NOT EXISTS idx_subcontas_asass_cpfcnpj ON public.subcontas_asass(cpfCnpj);

-- Comentários para documentação
COMMENT ON TABLE public.subcontas_asass IS 'Tabela de subcontas Asaas - Revendedores do TimePulse AI';
COMMENT ON COLUMN public.subcontas_asass.walletId IS 'ID da carteira Asaas do revendedor';
COMMENT ON COLUMN public.subcontas_asass.apiKey IS 'Chave API Asaas do revendedor';
COMMENT ON COLUMN public.subcontas_asass.status IS 'Status ativo/inativo do revendedor';
COMMENT ON COLUMN public.subcontas_asass.saldo_atual IS 'Saldo atual do revendedor';

-- ============================================
-- DADOS DE EXEMPLO
-- ============================================
-- Email: pereiraleiteluis@gmail.com
-- CPF: 70507678834
-- Nome: HELENA MARIA PEREIRA LEITE
-- ============================================
