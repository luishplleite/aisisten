-- Script de atualização para criar a tabela prompit
-- Executo: TimePulse AI - Adicionando tabela de prompts por tipo de negócio

-- Criar extensão UUID se não existir
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Criar tabela prompit para armazenar prompts da IA por tipo de negócio
CREATE TABLE IF NOT EXISTS public.prompit (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tipo_negocio VARCHAR(100) NOT NULL,
    prompt TEXT NOT NULL,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Criar índice para busca por tipo_negocio
CREATE INDEX IF NOT EXISTS idx_prompit_tipo_negocio ON public.prompit(tipo_negocio);

-- Criar índice para prompts ativos
CREATE INDEX IF NOT EXISTS idx_prompit_active ON public.prompit(active);

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_prompit_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_prompit_updated_at
    BEFORE UPDATE ON public.prompit
    FOR EACH ROW EXECUTE FUNCTION update_prompit_updated_at();

-- Inserir prompt padrão para restaurante se não existir
INSERT INTO public.prompit (tipo_negocio, prompt, active) 
SELECT 'restaurante', 'Você é Ana, assistente virtual especializada em delivery de restaurante. Ajude os clientes com pedidos, informações sobre o cardápio, e responda dúvidas sobre entrega de forma amigável e profissional.', true
WHERE NOT EXISTS (
    SELECT 1 FROM public.prompit WHERE tipo_negocio = 'restaurante'
);

-- Comentários para documentação
COMMENT ON TABLE public.prompit IS 'Tabela para armazenar prompts personalizados da IA por tipo de negócio';
COMMENT ON COLUMN public.prompit.tipo_negocio IS 'Tipo do negócio (ex: restaurante, lanchonete, pizzaria)';
COMMENT ON COLUMN public.prompit.prompt IS 'Texto do prompt para configurar o comportamento da IA';
COMMENT ON COLUMN public.prompit.active IS 'Indica se o prompt está ativo (apenas um ativo por tipo de negócio)';